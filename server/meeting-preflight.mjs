import { accessSync, constants, mkdirSync, statfsSync } from "node:fs";

export const PREFLIGHT_MINIMUM_FREE_BYTES = 512 * 1024 * 1024;
export const PREFLIGHT_WARNING_FREE_BYTES = 2 * 1024 * 1024 * 1024;

function check(id, label, status, detail, blocking = false) {
  return { id, label, status, detail, blocking };
}

export function inspectMeetingStorage(dataRoot, dependencies = {}) {
  const ensureDirectory = dependencies.mkdirSync || mkdirSync;
  const verifyAccess = dependencies.accessSync || accessSync;
  const readFileSystem = dependencies.statfsSync || statfsSync;
  try {
    ensureDirectory(dataRoot, { recursive: true });
    verifyAccess(dataRoot, constants.R_OK | constants.W_OK);
    const statistics = readFileSystem(dataRoot);
    const availableBlocks = Number(statistics.bavail ?? statistics.bfree ?? 0);
    const blockSize = Number(statistics.bsize ?? 0);
    const freeBytes = Math.max(0, availableBlocks * blockSize);
    if (freeBytes < PREFLIGHT_MINIMUM_FREE_BYTES) {
      return {
        writable: true,
        freeBytes,
        status: "blocked",
        detail: "剩余空间不足 512 MB，请先释放本机空间",
      };
    }
    if (freeBytes < PREFLIGHT_WARNING_FREE_BYTES) {
      return {
        writable: true,
        freeBytes,
        status: "warning",
        detail: "剩余空间不足 2 GB，长时间会议前建议清理空间",
      };
    }
    return {
      writable: true,
      freeBytes,
      status: "ready",
      detail: "会议录音目录可写，空间充足",
    };
  } catch (error) {
    return {
      writable: false,
      freeBytes: null,
      status: "blocked",
      detail: `无法写入会议数据目录：${error?.message || "权限不足"}`,
    };
  }
}

export function buildMeetingPreflight({
  asrMode,
  localAsrAvailable,
  punctuationModelAvailable,
  speakerModelAvailable,
  miniMaxConfigured,
  autoSummary = true,
  activeMeetings = 0,
  storage,
}) {
  const checks = [];
  if (!asrMode) {
    checks.push(check("transcription", "实时转写", "blocked", "没有可用的本地或云端转写引擎", true));
  } else if (asrMode === "local" && localAsrAvailable) {
    checks.push(check("transcription", "实时转写", "ready", "本地 Paraformer 模型可用"));
  } else {
    checks.push(check("transcription", "实时转写", "warning", "本地模型不可用，本次将使用云端转写"));
  }

  checks.push(check(
    "storage",
    "本机存储",
    storage.status,
    storage.detail,
    storage.status === "blocked",
  ));
  checks.push(activeMeetings > 0
    ? check("workspace", "会议任务", "blocked", "已有会议正在录音或处理中", true)
    : check("workspace", "会议任务", "ready", "当前没有占用中的会议任务"));
  checks.push(punctuationModelAvailable
    ? check("punctuation", "断句标点", "ready", "本地标点模型可用")
    : check("punctuation", "断句标点", "warning", "标点模型不可用，转写仍可继续"));
  checks.push(speakerModelAvailable
    ? check("speaker", "发言人识别", "ready", "本地声纹模型可用")
    : check("speaker", "发言人识别", "warning", "声纹模型不可用，将保留普通发言人编号"));
  checks.push(!autoSummary
    ? check("summary", "AI 总结", "ready", "本次已关闭，不影响本地录音")
    : miniMaxConfigured
      ? check("summary", "AI 总结", "ready", "MiniMax 已配置")
      : check("summary", "AI 总结", "warning", "尚未配置 MiniMax；录音和转写仍可正常进行"));

  const status = checks.some((item) => item.status === "blocked")
    ? "blocked"
    : checks.some((item) => item.status === "warning") ? "warning" : "ready";
  return {
    checkedAt: new Date().toISOString(),
    status,
    freeBytes: storage.freeBytes,
    checks,
  };
}
