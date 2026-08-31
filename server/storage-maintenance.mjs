import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { AudioSession } from "./audio-session.mjs";

const INTERRUPTED_STATUSES = new Set(["recording", "correcting", "summarizing", "retranscribing", "enhancing"]);

function validWav(filePath) {
  if (!existsSync(filePath)) return false;
  const details = statSync(filePath);
  return details.isFile() && details.size > 44;
}

function failInterruptedJobs(storage, meetingId, message) {
  for (const job of storage.listJobs(meetingId)) {
    if (job.status === "pending" || job.status === "running") {
      storage.updateJob(job.id, { status: "failed", error: message });
    }
  }
}

export async function recoverInterruptedMeetings({ storage, dataRoot }) {
  const result = { recoveredRecordings: 0, interruptedTasks: 0, failedRecordings: 0 };
  const now = new Date().toISOString();

  for (const meeting of storage.listMeetings()) {
    if (!INTERRUPTED_STATUSES.has(meeting.status)) continue;
    const directory = path.join(dataRoot, "meetings", meeting.id);
    const pcmPath = path.join(directory, "audio.pcm.tmp");
    const wavPath = path.join(directory, "audio.wav");
    const interruptedMessage = "应用上次退出，处理任务已中断；已保留录音和记录，可重新执行。";
    try {
      failInterruptedJobs(storage, meeting.id, interruptedMessage);

      if (meeting.status === "recording") {
        if (AudioSession.isRecoverable(pcmPath)) {
          const audio = new AudioSession(dataRoot, meeting.id);
          await audio.finalize();
          storage.updateMeeting(meeting.id, {
            endedAt: now,
            durationMs: audio.durationMs,
            audioPath: wavPath,
            status: "completed",
            error: "检测到上次异常退出，录音已自动找回；如有需要，可重新校正发言人或生成总结。",
          });
          result.recoveredRecordings += 1;
          continue;
        }
        if (validWav(wavPath)) {
          const durationMs = Math.round((statSync(wavPath).size - 44) / 32);
          storage.updateMeeting(meeting.id, {
            endedAt: meeting.endedAt || now,
            durationMs: meeting.durationMs || durationMs,
            audioPath: wavPath,
            status: "completed",
            error: "检测到上次异常退出，已恢复保存完成的录音。",
          });
          result.recoveredRecordings += 1;
          continue;
        }
        storage.updateMeeting(meeting.id, {
          endedAt: meeting.endedAt || now,
          status: "failed",
          error: "上次录音异常中断，且没有找到可恢复的音频。",
        });
        result.failedRecordings += 1;
        continue;
      }

      const hasSavedContent = validWav(wavPath)
        || storage.listSegments(meeting.id).length > 0
        || Boolean(meeting.summary || meeting.liveSummary);
      storage.updateMeeting(meeting.id, {
        endedAt: meeting.endedAt || now,
        audioPath: validWav(wavPath) ? wavPath : meeting.audioPath,
        status: hasSavedContent ? "completed" : "failed",
        error: hasSavedContent
          ? interruptedMessage
          : "应用上次退出时任务尚未完成，也没有找到可继续使用的会议内容。",
      });
      result.interruptedTasks += 1;
    } catch (error) {
      storage.updateMeeting(meeting.id, {
        endedAt: meeting.endedAt || now,
        status: "failed",
        error: `异常恢复未完成：${error.message}`,
      });
      if (meeting.status === "recording") result.failedRecordings += 1;
      else result.interruptedTasks += 1;
    }
  }

  return result;
}

function walkFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(filePath);
      else if (entry.isFile()) files.push({ path: filePath, name: entry.name, size: statSync(filePath).size });
    }
  }
  return files;
}

export function getStorageStats({ storage, dataRoot }) {
  const files = walkFiles(dataRoot);
  const meetings = storage.listMeetings();
  return {
    totalBytes: files.reduce((total, file) => total + file.size, 0),
    recordingsBytes: files.filter((file) => file.name === "audio.wav").reduce((total, file) => total + file.size, 0),
    temporaryBytes: files.filter((file) => file.name === "audio.pcm.tmp").reduce((total, file) => total + file.size, 0),
    temporaryFiles: files.filter((file) => file.name === "audio.pcm.tmp").length,
    databaseBytes: files.filter((file) => file.name.startsWith("shiyin.sqlite")).reduce((total, file) => total + file.size, 0),
    meetingCount: meetings.length,
    interruptedCount: meetings.filter((meeting) => INTERRUPTED_STATUSES.has(meeting.status)).length,
    dataRoot: path.resolve(dataRoot),
  };
}

export function cleanupTemporaryAudio({ storage, dataRoot, activeMeetingIds = new Set() }) {
  let filesRemoved = 0;
  let bytesFreed = 0;
  for (const meeting of storage.listMeetings()) {
    if (meeting.status === "recording" || activeMeetingIds.has(meeting.id)) continue;
    const directory = path.join(dataRoot, "meetings", meeting.id);
    const pcmPath = path.join(directory, "audio.pcm.tmp");
    const wavPath = path.join(directory, "audio.wav");
    if (!existsSync(pcmPath) || !validWav(wavPath)) continue;
    bytesFreed += statSync(pcmPath).size;
    rmSync(pcmPath, { force: true });
    filesRemoved += 1;
  }
  return {
    filesRemoved,
    bytesFreed,
    storage: getStorageStats({ storage, dataRoot }),
  };
}
