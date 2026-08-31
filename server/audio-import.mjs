import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { inspectPcmWav } from "./historical-transcription.mjs";

export const supportedMediaExtensions = new Set([
  ".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".opus",
  ".mp4", ".mov", ".mkv", ".webm",
]);

const maximumImportBytes = 12 * 1024 * 1024 * 1024;

export function validateImportedMedia(sourcePath) {
  const resolved = path.resolve(String(sourcePath || ""));
  if (!sourcePath || !existsSync(resolved)) throw new Error("没有找到所选音频文件");
  const stats = statSync(resolved);
  if (!stats.isFile()) throw new Error("请选择一个音频或视频文件");
  if (!stats.size) throw new Error("所选文件没有音频内容");
  if (stats.size > maximumImportBytes) throw new Error("单个文件不能超过 12 GB");
  const extension = path.extname(resolved).toLowerCase();
  if (!supportedMediaExtensions.has(extension)) {
    throw new Error("暂不支持这个格式，请选择 WAV、MP3、M4A、AAC、FLAC、OGG、MP4、MOV、MKV 或 WebM");
  }
  return { sourcePath: resolved, sourceName: path.basename(resolved), extension, sizeBytes: stats.size };
}

export function importedMeetingTitle(sourceName) {
  const base = path.basename(String(sourceName || "导入录音"), path.extname(String(sourceName || "")))
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (base || "导入录音").slice(0, 80);
}

function directPcmWav(sourcePath) {
  try {
    return inspectPcmWav(sourcePath);
  } catch {
    return null;
  }
}

function runFfmpeg({ ffmpegPath, sourcePath, temporaryPath, onProgress }) {
  return new Promise((resolve, reject) => {
    let durationSeconds = 0;
    let stderr = "";
    const child = spawn(ffmpegPath, [
      "-hide_banner", "-nostdin", "-y", "-i", sourcePath,
      "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000",
      "-c:a", "pcm_s16le", "-f", "wav", temporaryPath,
    ], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-12000);
      const duration = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
      if (duration) durationSeconds = Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]);
      const matches = [...stderr.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/gi)];
      const current = matches.at(-1);
      if (durationSeconds && current) {
        const seconds = Number(current[1]) * 3600 + Number(current[2]) * 60 + Number(current[3]);
        onProgress(Math.min(99, Math.max(1, Math.round((seconds / durationSeconds) * 100))));
      }
    });
    child.once("error", (error) => reject(new Error(
      error.code === "ENOENT" ? "音频转换组件不可用，请重新安装最新版拾音 AI" : `无法启动音频转换：${error.message}`,
    )));
    child.once("close", (code) => {
      if (code === 0) return resolve();
      const detail = stderr.split(/\r?\n/).filter(Boolean).slice(-3).join("；");
      reject(new Error(`无法读取该文件中的音频${detail ? `：${detail}` : ""}`));
    });
  });
}

export async function normalizeImportedAudio({ sourcePath, destinationPath, ffmpegPath, onProgress = () => {} }) {
  const source = validateImportedMedia(sourcePath);
  mkdirSync(path.dirname(destinationPath), { recursive: true });
  const temporaryPath = `${destinationPath}.importing`;
  rmSync(temporaryPath, { force: true });
  try {
    onProgress(1);
    const wav = directPcmWav(source.sourcePath);
    if (wav) {
      copyFileSync(source.sourcePath, temporaryPath);
      onProgress(100);
    } else {
      if (!ffmpegPath || !existsSync(ffmpegPath)) {
        throw new Error("音频转换组件不可用；当前仍可直接导入拾音生成的 16 kHz 单声道 WAV 文件");
      }
      await runFfmpeg({ ffmpegPath, sourcePath: source.sourcePath, temporaryPath, onProgress });
    }
    const normalized = inspectPcmWav(temporaryPath);
    renameSync(temporaryPath, destinationPath);
    return { ...source, durationMs: normalized.durationMs };
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}
