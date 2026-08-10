import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_OBSIDIAN_FOLDER = path.join("20 会议", "拾音 AI");
export const OBSIDIAN_USER_NOTES_MARKER = "<!-- shiyin-user-notes -->";

function inside(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}

function yamlString(value) {
  return JSON.stringify(String(value ?? ""));
}

function safeFilename(value) {
  const normalized = String(value || "会议记录")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "");
  return (normalized || "会议记录").slice(0, 80);
}

function meetingDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => index === 0 ? String(part) : String(part).padStart(2, "0"))
    .join("-");
}

function existingUserNotes(existingContent) {
  const markerIndex = existingContent.indexOf(OBSIDIAN_USER_NOTES_MARKER);
  if (markerIndex < 0) {
    return existingContent.trim()
      ? `> [!warning] 原笔记缺少拾音 AI 同步标记，旧内容已完整保留在下方。\n\n${existingContent.trim()}`
      : "";
  }
  return existingContent
    .slice(markerIndex + OBSIDIAN_USER_NOTES_MARKER.length)
    .replace(/^\r?\n/, "");
}

export function buildObsidianMeetingNote({
  meetingId,
  title,
  startedAt,
  markdown,
  savedAt = new Date().toISOString(),
  existingContent = "",
}) {
  const userNotes = existingUserNotes(existingContent);
  const frontmatter = [
    "---",
    `title: ${yamlString(title)}`,
    "type: meeting-note",
    "source: 拾音 AI",
    `shiyin_meeting_id: ${yamlString(meetingId)}`,
    `meeting_started: ${yamlString(startedAt)}`,
    `updated: ${yamlString(savedAt)}`,
    "tags:",
    "  - 会议纪要",
    "  - 来源/拾音AI",
    "---",
  ].join("\n");
  return [
    frontmatter,
    String(markdown || "").trim(),
    "---",
    "## 我的补充",
    "",
    OBSIDIAN_USER_NOTES_MARKER,
    userNotes.trimEnd(),
    "",
  ].join("\n\n").replace(/\n{4,}/g, "\n\n\n");
}

function validateRelativeNotePath(vaultPath, outputDirectory, relativePath) {
  if (!relativePath || path.isAbsolute(relativePath) || path.extname(relativePath).toLowerCase() !== ".md") {
    return null;
  }
  const destination = path.resolve(vaultPath, relativePath);
  return inside(vaultPath, destination) && inside(outputDirectory, destination) ? destination : null;
}

export async function saveObsidianMeeting({
  vaultPath,
  relativeFolder = DEFAULT_OBSIDIAN_FOLDER,
  existingRelativePath = null,
  meetingId,
  title,
  startedAt,
  markdown,
  savedAt = new Date().toISOString(),
}) {
  const resolvedVault = path.resolve(String(vaultPath || ""));
  const vaultDetails = await stat(resolvedVault).catch(() => null);
  if (!vaultDetails?.isDirectory() || !existsSync(path.join(resolvedVault, ".obsidian"))) {
    throw new Error("请选择包含 .obsidian 文件夹的 Obsidian Vault");
  }
  if (!/^[A-Za-z0-9-]{1,80}$/.test(String(meetingId || ""))) {
    throw new Error("会议编号无效，无法保存到 Obsidian");
  }
  const markdownBytes = Buffer.byteLength(String(markdown || ""), "utf8");
  if (!markdownBytes || markdownBytes > 20 * 1024 * 1024) {
    throw new Error(markdownBytes ? "会议笔记超过 20 MB，无法直接同步" : "会议笔记内容为空");
  }

  const outputDirectory = path.resolve(resolvedVault, relativeFolder);
  if (!inside(resolvedVault, outputDirectory)) throw new Error("Obsidian 保存目录无效");
  await mkdir(outputDirectory, { recursive: true });

  const rememberedPath = validateRelativeNotePath(resolvedVault, outputDirectory, existingRelativePath);
  const defaultFilename = `${meetingDate(startedAt)} ${safeFilename(title)} [${String(meetingId).slice(0, 8)}].md`;
  const destination = rememberedPath || path.join(outputDirectory, defaultFilename);
  if (!inside(resolvedVault, destination) || !inside(outputDirectory, destination)) {
    throw new Error("Obsidian 笔记路径无效");
  }

  const existingContent = await readFile(destination, "utf8").catch(() => "");
  const content = buildObsidianMeetingNote({
    meetingId,
    title,
    startedAt,
    markdown,
    savedAt,
    existingContent,
  });
  const temporaryPath = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    await writeFile(temporaryPath, content, "utf8");
    await rename(temporaryPath, destination);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }

  const relativePath = path.relative(resolvedVault, destination).split(path.sep).join("/");
  return {
    path: destination,
    relativePath,
    fileName: path.basename(destination),
    vaultPath: resolvedVault,
    updated: Boolean(existingContent),
  };
}
