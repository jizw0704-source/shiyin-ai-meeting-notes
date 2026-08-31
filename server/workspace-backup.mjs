import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const BACKUP_FORMAT = "shiyin-ai-backup";
const BACKUP_VERSION = 4;
const SUPPORTED_BACKUP_VERSIONS = new Set([1, 2, 3, BACKUP_VERSION]);

function inside(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}

async function sha256(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function fileRecord(root, filePath) {
  const details = await stat(filePath);
  return {
    path: path.relative(root, filePath).split(path.sep).join("/"),
    size: details.size,
    sha256: await sha256(filePath),
  };
}

function backupFolderName(date = new Date()) {
  const timestamp = date.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `拾音AI备份-${timestamp}-${randomUUID().slice(0, 6)}`;
}

export async function createWorkspaceBackup({ storage, dataRoot, destinationRoot, appVersion = "unknown" }) {
  const destination = path.resolve(String(destinationRoot || ""));
  if (!destinationRoot) throw new Error("请选择备份保存位置");
  if (inside(dataRoot, destination)) {
    throw new Error("备份位置不能位于拾音 AI 数据目录内部");
  }
  const destinationDetails = await stat(destination).catch(() => null);
  if (!destinationDetails?.isDirectory()) throw new Error("备份保存位置不存在或不是文件夹");

  const folderName = backupFolderName();
  const finalPath = path.join(destination, folderName);
  const temporaryPath = path.join(destination, `.${folderName}.tmp`);
  const meetings = [];
  const files = [];
  await mkdir(temporaryPath, { recursive: false });
  try {
    const speakerProfilesPath = path.join(temporaryPath, "speaker-profiles.json");
    await writeFile(
      speakerProfilesPath,
      `${JSON.stringify(storage.exportSpeakerProfiles(), null, 2)}\n`,
      "utf8",
    );
    files.push(await fileRecord(temporaryPath, speakerProfilesPath));
    for (const meeting of storage.listMeetings({ includeDeleted: true })) {
      const meetingDirectory = path.join(temporaryPath, "meetings", meeting.id);
      await mkdir(meetingDirectory, { recursive: true });
      const snapshotPath = path.join(meetingDirectory, "meeting.json");
      await writeFile(
        snapshotPath,
        `${JSON.stringify(storage.exportMeetingSnapshot(meeting.id), null, 2)}\n`,
        "utf8",
      );
      files.push(await fileRecord(temporaryPath, snapshotPath));

      const sourceAudioPath = path.join(dataRoot, "meetings", meeting.id, "audio.wav");
      let audioRelativePath = null;
      if (existsSync(sourceAudioPath)) {
        const audioPath = path.join(meetingDirectory, "audio.wav");
        await copyFile(sourceAudioPath, audioPath);
        files.push(await fileRecord(temporaryPath, audioPath));
        audioRelativePath = path.relative(temporaryPath, audioPath).split(path.sep).join("/");
      }
      const attachmentPaths = [];
      for (const attachment of storage.listAttachments(meeting.id)) {
        const sourceAttachmentPath = path.join(dataRoot, "meetings", meeting.id, "attachments", attachment.storedName);
        if (!existsSync(sourceAttachmentPath)) continue;
        const attachmentPath = path.join(meetingDirectory, "attachments", attachment.storedName);
        await mkdir(path.dirname(attachmentPath), { recursive: true });
        await copyFile(sourceAttachmentPath, attachmentPath);
        files.push(await fileRecord(temporaryPath, attachmentPath));
        attachmentPaths.push(path.relative(temporaryPath, attachmentPath).split(path.sep).join("/"));
      }
      const clipPaths = [];
      for (const clip of storage.listAudioClips(meeting.id)) {
        const sourceClipPath = path.join(dataRoot, "meetings", meeting.id, "clips", clip.storedName);
        if (!existsSync(sourceClipPath)) continue;
        const clipPath = path.join(meetingDirectory, "clips", clip.storedName);
        await mkdir(path.dirname(clipPath), { recursive: true });
        await copyFile(sourceClipPath, clipPath);
        files.push(await fileRecord(temporaryPath, clipPath));
        clipPaths.push(path.relative(temporaryPath, clipPath).split(path.sep).join("/"));
      }
      meetings.push({
        id: meeting.id,
        title: meeting.title,
        snapshotPath: path.relative(temporaryPath, snapshotPath).split(path.sep).join("/"),
        audioPath: audioRelativePath,
        attachmentPaths,
        clipPaths,
      });
    }

    const manifest = {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_VERSION,
      appVersion,
      createdAt: new Date().toISOString(),
      meetingCount: meetings.length,
      speakerProfilesPath: path.relative(temporaryPath, speakerProfilesPath).split(path.sep).join("/"),
      meetings,
      files,
    };
    await writeFile(path.join(temporaryPath, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await rename(temporaryPath, finalPath);
    const totalBytes = files.reduce((total, file) => total + file.size, 0);
    return { path: finalPath, meetingCount: meetings.length, totalBytes, createdAt: manifest.createdAt };
  } catch (error) {
    await rm(temporaryPath, { recursive: true, force: true });
    throw error;
  }
}

async function loadAndValidateManifest(backupPath) {
  const root = path.resolve(String(backupPath || ""));
  const raw = await readFile(path.join(root, "manifest.json"), "utf8")
    .catch(() => { throw new Error("所选文件夹不是有效的拾音 AI 备份"); });
  const manifest = JSON.parse(raw);
  if (manifest.format !== BACKUP_FORMAT || !SUPPORTED_BACKUP_VERSIONS.has(manifest.formatVersion)) {
    throw new Error("备份格式不受支持或版本不兼容");
  }
  if (!Array.isArray(manifest.meetings) || !Array.isArray(manifest.files)) {
    throw new Error("备份清单不完整");
  }
  const validatedFiles = new Map();
  for (const file of manifest.files) {
    const filePath = path.resolve(root, String(file.path || ""));
    if (!inside(root, filePath) || filePath === root) throw new Error("备份中包含无效文件路径");
    const details = await stat(filePath).catch(() => null);
    if (!details?.isFile() || details.size !== file.size || await sha256(filePath) !== file.sha256) {
      throw new Error(`备份文件校验失败：${file.path}`);
    }
    validatedFiles.set(file.path, filePath);
  }
  return { root, manifest, validatedFiles };
}

export async function restoreWorkspaceBackup({ storage, dataRoot, backupPath }) {
  const { manifest, validatedFiles } = await loadAndValidateManifest(backupPath);
  if (manifest.speakerProfilesPath) {
    const profilesFile = validatedFiles.get(manifest.speakerProfilesPath);
    if (!profilesFile) throw new Error("备份缺少本机发言人声纹库");
    const profiles = JSON.parse(await readFile(profilesFile, "utf8"));
    if (!Array.isArray(profiles)) throw new Error("备份中的发言人声纹库格式无效");
    storage.importSpeakerProfiles(profiles);
  }
  let importedMeetings = 0;
  let skippedMeetings = 0;
  for (const entry of manifest.meetings) {
    if (!/^[A-Za-z0-9-]{1,80}$/.test(String(entry.id || ""))) throw new Error("备份中的会议编号无效");
    if (storage.getMeeting(entry.id)) {
      skippedMeetings += 1;
      continue;
    }
    const snapshotFile = validatedFiles.get(entry.snapshotPath);
    if (!snapshotFile) throw new Error(`备份缺少会议记录：${entry.id}`);
    const snapshot = JSON.parse(await readFile(snapshotFile, "utf8"));
    if (snapshot.id !== entry.id) throw new Error(`会议记录校验失败：${entry.id}`);

    const meetingDirectory = path.join(dataRoot, "meetings", entry.id);
    const targetAudioPath = entry.audioPath ? path.join(meetingDirectory, "audio.wav") : null;
    const temporaryAudioPath = targetAudioPath ? `${targetAudioPath}.restore.tmp` : null;
    if (targetAudioPath && existsSync(targetAudioPath)) throw new Error(`数据目录中已存在同名录音：${entry.id}`);
    await mkdir(meetingDirectory, { recursive: true });
    try {
      if (entry.audioPath) {
        const sourceAudioPath = validatedFiles.get(entry.audioPath);
        if (!sourceAudioPath) throw new Error(`备份缺少会议录音：${entry.id}`);
        await copyFile(sourceAudioPath, temporaryAudioPath);
        await rename(temporaryAudioPath, targetAudioPath);
      }
      for (const relativeAttachmentPath of entry.attachmentPaths || []) {
        const sourceAttachmentPath = validatedFiles.get(relativeAttachmentPath);
        if (!sourceAttachmentPath) throw new Error(`备份缺少会议资料：${entry.id}`);
        const storedName = path.basename(relativeAttachmentPath);
        const targetAttachmentPath = path.join(meetingDirectory, "attachments", storedName);
        await mkdir(path.dirname(targetAttachmentPath), { recursive: true });
        await copyFile(sourceAttachmentPath, targetAttachmentPath);
      }
      for (const relativeClipPath of entry.clipPaths || []) {
        const sourceClipPath = validatedFiles.get(relativeClipPath);
        if (!sourceClipPath) throw new Error(`备份缺少音频剪辑：${entry.id}`);
        const storedName = path.basename(relativeClipPath);
        const targetClipPath = path.join(meetingDirectory, "clips", storedName);
        await mkdir(path.dirname(targetClipPath), { recursive: true });
        await copyFile(sourceClipPath, targetClipPath);
      }
      const result = storage.importMeetingSnapshot(snapshot, { audioPath: targetAudioPath });
      if (result.imported) importedMeetings += 1;
      else skippedMeetings += 1;
    } catch (error) {
      if (temporaryAudioPath) await rm(temporaryAudioPath, { force: true });
      if (targetAudioPath && !storage.getMeeting(entry.id)) await rm(targetAudioPath, { force: true });
      throw error;
    }
  }
  return {
    importedMeetings,
    skippedMeetings,
    backupCreatedAt: manifest.createdAt,
    backupVersion: manifest.appVersion,
  };
}
