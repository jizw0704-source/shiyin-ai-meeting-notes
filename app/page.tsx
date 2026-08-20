"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowClockwise,
  Brain,
  ChartBar,
  CheckCircle,
  Clock,
  Compass,
  DownloadSimple,
  Flag,
  FolderOpen,
  GearSix,
  HardDrives,
  Key,
  ListChecks,
  MagnifyingGlass,
  PencilSimple,
  PushPin,
  Quotes,
  Sparkle,
  Target,
  Trash,
  UsersThree,
  Waveform,
  WarningCircle,
  X,
} from "@phosphor-icons/react";

type View = "transcript" | "summary" | "actions";
type MeetingStatus = "recording" | "correcting" | "summarizing" | "retranscribing" | "completed" | "failed";
type SummaryTemplateId = "meeting-minutes" | "daily-log" | "project-sync" | "brainstorm";
type ReportStyle = "detailed" | "visual";
type AudioSourceMode = "microphone" | "system" | "mixed";
type SpeakerLimit = 6 | 12 | 20;
type TranscriptMode = "organized" | "original";
type TranscriptOrder = "ascending" | "descending";
type AudioCaptureCapabilities = {
  platform: string;
  macOSVersion: string;
  nativeSystemAudioPicker: boolean;
  systemAudioSupported: boolean;
  microphonePermission: string;
  screenPermission: string;
};
type GlobalShortcutStatus = {
  openWindow: boolean;
  toggleRecording: boolean;
  openAccelerator: string;
  recordingAccelerator: string;
  openLabel: string;
  recordingLabel: string;
};
type ApplicationUpdateStatus = "unavailable" | "idle" | "checking" | "available" | "not-available" | "downloading" | "downloaded" | "error";
type ApplicationUpdateState = {
  status: ApplicationUpdateStatus;
  currentVersion: string;
  availableVersion: string | null;
  percent: number | null;
  message: string;
  supported: boolean;
  canCheck: boolean;
  canDownload: boolean;
  canInstall: boolean;
};
type MiniMaxSettings = {
  configured: boolean;
  model: string;
  managedByApp: boolean;
  storageLocation: string;
};
type NotebookSettings = {
  obsidianConfigured: boolean;
  obsidianVaultName: string | null;
  canceled?: boolean;
};
type StorageInfo = {
  totalBytes: number;
  recordingsBytes: number;
  temporaryBytes: number;
  temporaryFiles: number;
  databaseBytes: number;
  meetingCount: number;
  interruptedCount: number;
  dataRoot: string;
};
type BackupOperationResult = {
  canceled: boolean;
  path?: string;
  meetingCount?: number;
  totalBytes?: number;
  importedMeetings?: number;
  skippedMeetings?: number;
};
type ObsidianSaveResult = {
  canceled: boolean;
  path?: string;
  relativePath?: string;
  fileName?: string;
  updated?: boolean;
};
type TranscriptVersion = {
  id: string;
  meetingId: string;
  versionNo: number;
  label: string;
  engine: string;
  segmentCount: number;
  createdAt: string;
};
type Speaker = {
  id: string;
  meetingId: string;
  label: string;
  displayName: string;
  color: string;
  manuallyNamed: boolean;
  profileId: string | null;
  autoMatched: boolean;
};
type Segment = {
  id: string;
  meetingId: string;
  seq: number;
  startMs: number;
  endMs: number | null;
  pauseAfterMs: number | null;
  text: string;
  originalText: string;
  editedText: string | null;
  cleanedText: string;
  speakerId: string | null;
  source: "realtime" | "local-realtime" | "local-retranscribed" | "corrected" | "restored";
  confidence: number | null;
};
type Summary = {
  headline?: string;
  overview: string;
  isLiveDraft?: boolean;
  generatedAt?: string;
  throughSeq?: number | null;
  meetingBackground?: string;
  overviewCards?: Array<{
    title: string;
    summary: string;
    points: string[];
    evidenceSeqs: number[];
  }>;
  keyFacts?: Array<{
    value: string;
    label: string;
    context: string;
    evidenceSeqs: number[];
  }>;
  decisions: string[];
  topics: string[];
  risks: string[];
  detailedTopics?: Array<{
    title: string;
    summary: string;
    points: string[];
    conclusion: string;
    evidenceSeqs: number[];
  }>;
  aiInsights?: Array<{
    title: string;
    insight: string;
    basis: string;
    confidence: "高" | "中" | "低";
    evidenceSeqs: number[];
  }>;
  actionItems: Array<{
    owner: string;
    task: string;
    due: string;
    priority?: "高" | "中" | "低";
    evidenceSeqs?: number[];
  }>;
  chapters?: Array<{
    title: string;
    startMs: number;
    endMs: number;
    summary: string;
    highlights: string[];
    evidenceSeqs: number[];
  }>;
  speakerInsights?: Array<{
    speaker: string;
    contribution: string;
    keyPoints: string[];
    evidenceSeqs: number[];
  }>;
  notableMoments?: Array<{
    timeMs: number;
    speaker: string;
    text: string;
    reason: string;
    evidenceSeq: number;
  }>;
  keywords?: string[];
};
type Job = {
  id: string;
  kind: "speaker-correction" | "summary" | "retranscription";
  status: "pending" | "running" | "completed" | "failed";
  progress: number;
  error: string | null;
};
type AudioInput = { deviceId: string; label: string };
type MeetingBrief = {
  id: string;
  title: string;
  status: MeetingStatus;
  startedAt: string;
  endedAt: string | null;
  durationMs: number;
  audioPath: string | null;
  summary: Summary | null;
  liveSummary: Summary | null;
  error: string | null;
  summaryTemplate: SummaryTemplateId;
  templateVersion: number;
  reportStyle: ReportStyle;
  fillerFilterEnabled: boolean;
  summaryStale: boolean;
  maxSpeakers: SpeakerLimit;
};
type Meeting = MeetingBrief & {
  speakers: Speaker[];
  segments: Segment[];
  jobs: Job[];
  canUndoTranscriptEdit: boolean;
  activeTranscriptVersionId: string | null;
  transcriptVersions: TranscriptVersion[];
};

declare global {
  interface Window {
    shiyinDesktop?: {
      getAudioCaptureCapabilities: () => Promise<AudioCaptureCapabilities>;
      getGlobalShortcutStatus: () => Promise<GlobalShortcutStatus>;
      openAudioPrivacySettings: (kind: "microphone" | "screen") => Promise<boolean>;
      openDataFolder: () => Promise<boolean>;
      createWorkspaceBackup: () => Promise<BackupOperationResult>;
      restoreWorkspaceBackup: () => Promise<BackupOperationResult>;
      saveMeetingToObsidian: (meeting: {
        meetingId: string;
        title: string;
        startedAt: string;
        markdown: string;
        openAfterSave: boolean;
      }) => Promise<ObsidianSaveResult>;
      getNotebookSettings: () => Promise<NotebookSettings>;
      connectObsidianVault: () => Promise<NotebookSettings>;
      relaunch: () => void;
      getMiniMaxSettings: () => Promise<MiniMaxSettings>;
      saveMiniMaxSettings: (settings: { apiKey: string; model: string }) => Promise<MiniMaxSettings>;
      getApplicationUpdateState: () => Promise<ApplicationUpdateState>;
      checkForApplicationUpdates: () => Promise<ApplicationUpdateState>;
      downloadApplicationUpdate: () => Promise<ApplicationUpdateState>;
      installApplicationUpdate: () => Promise<ApplicationUpdateState>;
      onApplicationUpdateState: (callback: (state: ApplicationUpdateState) => void) => () => void;
      onCommand: (callback: (command: string) => void) => () => void;
      setRecording: (active: boolean) => void;
    };
  }
}

const websocketBase = process.env.NEXT_PUBLIC_ASR_PROXY_URL || "ws://127.0.0.1:8788";
const apiBase = process.env.NEXT_PUBLIC_API_URL || websocketBase.replace(/^ws/, "http");
const DEFAULT_SUMMARY_TEMPLATE: SummaryTemplateId = "meeting-minutes";
const DEFAULT_REPORT_STYLE: ReportStyle = "detailed";
const DEFAULT_SPEAKER_LIMIT: SpeakerLimit = 6;
const speakerLimitOptions: Array<{ value: SpeakerLimit; label: string; detail: string }> = [
  { value: 6, label: "6 人", detail: "小型会议" },
  { value: 12, label: "12 人", detail: "内部会议" },
  { value: 20, label: "20 人", detail: "大型会议" },
];
const summaryTemplates: Array<{
  id: SummaryTemplateId;
  name: string;
  description: string;
  accent: string;
}> = [
  { id: "meeting-minutes", name: "会议纪要", description: "决策、议题、风险与行动项", accent: "blue" },
  { id: "daily-log", name: "日常记录", description: "按时间整理交流、灵感与提醒", accent: "cyan" },
  { id: "project-sync", name: "项目周会", description: "进展、阻塞、依赖与下一步", accent: "green" },
  { id: "brainstorm", name: "头脑风暴", description: "想法簇、优缺点与验证实验", accent: "violet" },
];

function summaryTemplateName(id: SummaryTemplateId | undefined) {
  return summaryTemplates.find((template) => template.id === id)?.name || "会议纪要";
}

function summaryTemplateIcon(id: SummaryTemplateId, size = 20) {
  if (id === "daily-log") return <Quotes size={size} weight="duotone" />;
  if (id === "project-sync") return <Target size={size} weight="duotone" />;
  if (id === "brainstorm") return <Brain size={size} weight="duotone" />;
  return <ListChecks size={size} weight="duotone" />;
}

function formatClock(milliseconds: number | null | undefined) {
  const seconds = Math.max(0, Math.round((milliseconds || 0) / 1000));
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function formatMeetingDate(iso: string) {
  const value = new Date(iso);
  const today = new Date();
  const sameDay = value.toDateString() === today.toDateString();
  const date = sameDay
    ? "今天"
    : `${value.getMonth() + 1}月${value.getDate()}日`;
  return `${date} ${value.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
}

function formatBytes(bytes: number | null | undefined) {
  const value = Math.max(0, bytes || 0);
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && size >= 1024; index += 1) {
    size /= 1024;
    unit = units[index];
  }
  return `${size >= 10 ? size.toFixed(1) : size.toFixed(2)} ${unit}`;
}

function statusLabel(status: MeetingStatus) {
  return {
    recording: "正在听记",
    correcting: "正在校正发言人",
    summarizing: "正在生成总结",
    retranscribing: "正在重新转写录音",
    completed: "已完成",
    failed: "处理失败",
  }[status];
}

function meetingIsBusy(status: MeetingStatus | undefined) {
  return status === "recording"
    || status === "correcting"
    || status === "summarizing"
    || status === "retranscribing";
}

function summaryLooksInvalid(summary: Summary | null | undefined) {
  if (!summary) return false;
  const overview = String(summary.overview || "").trim();
  if (/^```(?:json)?/i.test(overview) || (/^\{/.test(overview) && /"(?:headline|overview|chapters)"\s*:/.test(overview))) {
    return true;
  }
  const structuredItems = [
    summary.overviewCards,
    summary.keyFacts,
    summary.decisions,
    summary.topics,
    summary.detailedTopics,
    summary.risks,
    summary.aiInsights,
    summary.actionItems,
    summary.chapters,
    summary.speakerInsights,
    summary.notableMoments,
    summary.keywords,
  ].reduce((total, items) => total + (items?.length || 0), 0);
  return !summary.headline && structuredItems === 0;
}

function microphoneScore(input: AudioInput) {
  const label = input.label.toLowerCase();
  let score = 0;
  if (/nahimic|vad|virtual|stereo mix|立体声混音|cable|blackhole|soundflower|loopback|aggregate|multi-output|多输出/.test(label)) score -= 1000;
  if (/macbook.*microphone|macbook.*麦克风|built-in microphone|内建麦克风/.test(label)) score += 140;
  if (/realtek|麦克风阵列|microphone array/.test(label)) score += 120;
  if (/airpods|studio display|iphone.*microphone|iphone.*麦克风/.test(label)) score += 70;
  if (/maxhub/.test(label)) score += 80;
  if (/麦克风|microphone|mic/.test(label)) score += 20;
  if (input.deviceId === "default" || input.deviceId === "communications") score -= 10;
  return score;
}

function preferredMicrophone(inputs: AudioInput[]) {
  return [...inputs]
    .filter((input) => input.deviceId && input.label)
    .sort((left, right) => microphoneScore(right) - microphoneScore(left))[0] || null;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function markdownCell(value: unknown) {
  return String(value ?? "").replaceAll("|", "\\|").replace(/\s*\n\s*/g, " ").trim();
}

function safeFilename(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "-");
}

function displayedSegmentText(segment: Segment, mode: TranscriptMode) {
  return mode === "original" ? segment.originalText : segment.cleanedText;
}

function replacementPattern(term: string, caseSensitive: boolean, wholeWord: boolean) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const useWordBoundary = wholeWord && /^[\p{L}\p{N}_]+$/u.test(term);
  const pattern = useWordBoundary
    ? `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`
    : escaped;
  return new RegExp(pattern, `gu${caseSensitive ? "" : "i"}`);
}

function previewReplacement(text: string, term: string, replacement: string, caseSensitive: boolean, wholeWord: boolean) {
  if (!term) return { text, count: 0 };
  let count = 0;
  const next = text.replace(replacementPattern(term, caseSensitive, wholeWord), () => {
    count += 1;
    return replacement;
  });
  return { text: next, count };
}

function downloadText(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `请求失败（${response.status}）`);
  return result;
}

export default function Home() {
  const [view, setView] = useState<View>("transcript");
  const [meetings, setMeetings] = useState<MeetingBrief[]>([]);
  const [historyQuery, setHistoryQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [query, setQuery] = useState("");
  const [transcriptMode, setTranscriptMode] = useState<TranscriptMode>("organized");
  const [transcriptOrder, setTranscriptOrder] = useState<TranscriptOrder>("ascending");
  const [replaceDialogOpen, setReplaceDialogOpen] = useState(false);
  const [replaceFind, setReplaceFind] = useState("");
  const [replaceWith, setReplaceWith] = useState("");
  const [replaceCaseSensitive, setReplaceCaseSensitive] = useState(false);
  const [replaceWholeWord, setReplaceWholeWord] = useState(false);
  const [transcriptSaving, setTranscriptSaving] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [obsidianSaving, setObsidianSaving] = useState(false);
  const [obsidianAutoSave, setObsidianAutoSave] = useState(false);
  const [notebookSettings, setNotebookSettings] = useState<NotebookSettings | null>(null);
  const [notebookConnecting, setNotebookConnecting] = useState(false);
  const [notice, setNotice] = useState("");
  const [liveText, setLiveText] = useState("");
  const [liveConfirmedText, setLiveConfirmedText] = useState("");
  const [connectionStatus, setConnectionStatus] = useState("本地实时 ASR");
  const [loading, setLoading] = useState(true);
  const [completedActions, setCompletedActions] = useState<Set<number>>(new Set());
  const [audioSourceMode, setAudioSourceMode] = useState<AudioSourceMode>("microphone");
  const [systemAudioAvailable, setSystemAudioAvailable] = useState(false);
  const [audioCaptureCapabilities, setAudioCaptureCapabilities] = useState<AudioCaptureCapabilities | null>(null);
  const [globalShortcutStatus, setGlobalShortcutStatus] = useState<GlobalShortcutStatus | null>(null);
  const [applicationUpdate, setApplicationUpdate] = useState<ApplicationUpdateState | null>(null);
  const [sourceWarning, setSourceWarning] = useState("");
  const [captureSettingsOpened, setCaptureSettingsOpened] = useState(false);
  const [audioInputs, setAudioInputs] = useState<AudioInput[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [activeDeviceLabel, setActiveDeviceLabel] = useState("自动选择麦克风");
  const [inputLevel, setInputLevel] = useState(0);
  const [audioWarning, setAudioWarning] = useState("");
  const [highlightedSeq, setHighlightedSeq] = useState<number | null>(null);
  const [renamingMeeting, setRenamingMeeting] = useState<MeetingBrief | null>(null);
  const [meetingTitleDraft, setMeetingTitleDraft] = useState("");
  const [meetingRenameSaving, setMeetingRenameSaving] = useState(false);
  const [meetingRenameError, setMeetingRenameError] = useState("");
  const [renamingSpeaker, setRenamingSpeaker] = useState<Speaker | null>(null);
  const [speakerNameDraft, setSpeakerNameDraft] = useState("");
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [defaultSummaryTemplate, setDefaultSummaryTemplate] = useState<SummaryTemplateId>(DEFAULT_SUMMARY_TEMPLATE);
  const [defaultReportStyle, setDefaultReportStyle] = useState<ReportStyle>(DEFAULT_REPORT_STYLE);
  const [speakerLimit, setSpeakerLimit] = useState<SpeakerLimit>(DEFAULT_SPEAKER_LIMIT);
  const [templateDraft, setTemplateDraft] = useState<SummaryTemplateId>(DEFAULT_SUMMARY_TEMPLATE);
  const [reportStyleDraft, setReportStyleDraft] = useState<ReportStyle>(DEFAULT_REPORT_STYLE);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [miniMaxSettings, setMiniMaxSettings] = useState<MiniMaxSettings | null>(null);
  const [miniMaxKeyDraft, setMiniMaxKeyDraft] = useState("");
  const [miniMaxModelDraft, setMiniMaxModelDraft] = useState("MiniMax-M3");
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [storageDialogOpen, setStorageDialogOpen] = useState(false);
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [storageLoading, setStorageLoading] = useState(false);
  const [storageCleaning, setStorageCleaning] = useState(false);
  const [backupBusy, setBackupBusy] = useState<"create" | "restore" | null>(null);
  const [storageError, setStorageError] = useState("");
  const [transcriptionDialogOpen, setTranscriptionDialogOpen] = useState(false);
  const [retranscriptionStarting, setRetranscriptionStarting] = useState(false);
  const [versionRestoringId, setVersionRestoringId] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const playbackRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamsRef = useRef<MediaStream[]>([]);
  const recordingRef = useRef(false);
  const sessionPeakRef = useRef(0);
  const captureStartedAtRef = useRef(0);
  const lastLevelUpdateRef = useRef(0);
  const silenceWarningShownRef = useRef(false);
  const commandHandlerRef = useRef<(command: string) => void>(() => undefined);

  const refreshCaptureCapabilities = useCallback(async () => {
    const desktop = window.shiyinDesktop;
    if (!desktop) {
      setSystemAudioAvailable(false);
      setAudioCaptureCapabilities(null);
      return null;
    }
    const capabilities = await desktop.getAudioCaptureCapabilities();
    setAudioCaptureCapabilities(capabilities);
    setSystemAudioAvailable(capabilities.systemAudioSupported);
    const savedMode = window.localStorage.getItem("shiyin.audioSourceMode") as AudioSourceMode | null;
    if (savedMode === "microphone") {
      setAudioSourceMode(savedMode);
    } else if (
      capabilities.systemAudioSupported
      && (savedMode === "system" || savedMode === "mixed")
    ) {
      setAudioSourceMode(savedMode);
    } else if (!capabilities.systemAudioSupported && savedMode) {
      setAudioSourceMode("microphone");
      window.localStorage.setItem("shiyin.audioSourceMode", "microphone");
    }
    return capabilities;
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const savedTemplate = window.localStorage.getItem("shiyin.summaryTemplate") as SummaryTemplateId | null;
      const savedStyle = window.localStorage.getItem("shiyin.reportStyle");
      const savedSpeakerLimit = Number(window.localStorage.getItem("shiyin.maxSpeakers"));
      const savedObsidianAutoSave = window.localStorage.getItem("shiyin.obsidianAutoSave");
      const savedTranscriptOrder = window.localStorage.getItem("shiyin.transcriptOrder");
      if (summaryTemplates.some((template) => template.id === savedTemplate)) {
        setDefaultSummaryTemplate(savedTemplate!);
      }
      if (savedStyle === "visual") setDefaultReportStyle("visual");
      if (speakerLimitOptions.some((option) => option.value === savedSpeakerLimit)) {
        setSpeakerLimit(savedSpeakerLimit as SpeakerLimit);
      }
      setObsidianAutoSave(savedObsidianAutoSave === "true");
      if (savedTranscriptOrder === "descending") setTranscriptOrder("descending");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let active = true;
    const desktop = window.shiyinDesktop;
    if (!desktop) return () => { active = false; };
    const capabilityTimer = window.setTimeout(() => {
      refreshCaptureCapabilities().catch(() => undefined);
    }, 0);
    desktop.getMiniMaxSettings()
      .then((settings) => {
        if (active) setMiniMaxSettings(settings);
      })
      .catch(() => undefined);
    desktop.getNotebookSettings()
      .then((settings) => {
        if (active) setNotebookSettings(settings);
      })
      .catch(() => undefined);
    desktop.getGlobalShortcutStatus()
      .then((status) => {
        if (active) setGlobalShortcutStatus(status);
      })
      .catch(() => undefined);
    desktop.getApplicationUpdateState()
      .then((state) => {
        if (active) setApplicationUpdate(state);
      })
      .catch(() => undefined);
    const removeUpdateListener = desktop.onApplicationUpdateState((state) => {
      if (!active) return;
      setApplicationUpdate(state);
      if (state.status === "available") setNotice(state.message);
      if (state.status === "downloaded") setNotice("新版本已下载，方便时可重启安装");
    });
    return () => {
      active = false;
      window.clearTimeout(capabilityTimer);
      removeUpdateListener();
    };
  }, [refreshCaptureCapabilities]);

  useEffect(() => {
    if (!window.shiyinDesktop) return;
    const refreshOnFocus = () => {
      refreshCaptureCapabilities().catch(() => undefined);
    };
    window.addEventListener("focus", refreshOnFocus);
    return () => window.removeEventListener("focus", refreshOnFocus);
  }, [refreshCaptureCapabilities]);

  useEffect(() => {
    if (!templateDialogOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTemplateDialogOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [templateDialogOpen]);

  const openSettingsDialog = useCallback(async () => {
    const desktop = window.shiyinDesktop;
    if (!desktop) {
      setNotice("MiniMax 密钥由桌面版管理");
      return;
    }
    try {
      const [settings, notebook] = await Promise.all([
        desktop.getMiniMaxSettings(),
        desktop.getNotebookSettings(),
      ]);
      setMiniMaxSettings(settings);
      setNotebookSettings(notebook);
      setMiniMaxModelDraft(settings.model);
      setMiniMaxKeyDraft("");
      setSettingsError("");
      setSettingsDialogOpen(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法读取 MiniMax 配置");
    }
  }, []);

  const connectNotebook = useCallback(async () => {
    const desktop = window.shiyinDesktop;
    if (!desktop) return;
    setNotebookConnecting(true);
    setSettingsError("");
    try {
      const settings = await desktop.connectObsidianVault();
      setNotebookSettings(settings);
      if (!settings.canceled && settings.obsidianConfigured) {
        setNotice(`已连接 AI 笔记本：${settings.obsidianVaultName || "Obsidian"}`);
      }
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "无法连接 AI 笔记本");
    } finally {
      setNotebookConnecting(false);
    }
  }, []);

  const handleApplicationUpdate = useCallback(async () => {
    const desktop = window.shiyinDesktop;
    if (!desktop || !applicationUpdate) return;
    try {
      let state: ApplicationUpdateState;
      if (applicationUpdate.status === "downloaded") {
        setNotice("应用正在重新启动并安装更新…");
        state = await desktop.installApplicationUpdate();
      } else if (applicationUpdate.status === "available") {
        state = await desktop.downloadApplicationUpdate();
      } else {
        state = await desktop.checkForApplicationUpdates();
      }
      setApplicationUpdate(state);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "更新操作失败，请稍后重试");
    }
  }, [applicationUpdate]);

  const saveSettings = useCallback(async () => {
    const desktop = window.shiyinDesktop;
    if (!desktop) return;
    if (!miniMaxSettings?.configured && !miniMaxKeyDraft.trim()) {
      setSettingsError("请输入 MiniMax API Key");
      return;
    }
    setSettingsSaving(true);
    setSettingsError("");
    try {
      const settings = await desktop.saveMiniMaxSettings({
        apiKey: miniMaxKeyDraft,
        model: miniMaxModelDraft,
      });
      setMiniMaxSettings(settings);
      setMiniMaxKeyDraft("");
      setSettingsDialogOpen(false);
      setNotice("配置已安全保存，现在可以直接生成 AI 总结");
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "保存失败，请重试");
    } finally {
      setSettingsSaving(false);
    }
  }, [miniMaxKeyDraft, miniMaxModelDraft, miniMaxSettings?.configured]);

  const openStorageDialog = useCallback(async () => {
    setStorageDialogOpen(true);
    setStorageLoading(true);
    setStorageError("");
    try {
      setStorageInfo(await api<StorageInfo>("/api/storage"));
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "无法读取本机存储信息");
    } finally {
      setStorageLoading(false);
    }
  }, []);

  const cleanupStorage = useCallback(async () => {
    setStorageCleaning(true);
    setStorageError("");
    try {
      const result = await api<{ filesRemoved: number; bytesFreed: number; storage: StorageInfo }>(
        "/api/storage/cleanup",
        { method: "POST" },
      );
      setStorageInfo(result.storage);
      setNotice(result.filesRemoved
        ? `已安全释放 ${formatBytes(result.bytesFreed)}，会议录音与记录均已保留`
        : "当前没有可清理的临时音频");
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "清理失败，请稍后重试");
    } finally {
      setStorageCleaning(false);
    }
  }, []);

  const openDataFolder = useCallback(async () => {
    try {
      if (!window.shiyinDesktop) {
        setNotice(storageInfo?.dataRoot || "数据文件夹仅可由桌面版直接打开");
        return;
      }
      await window.shiyinDesktop.openDataFolder();
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "无法打开数据文件夹");
    }
  }, [storageInfo?.dataRoot]);

  async function createBackup() {
    if (!window.shiyinDesktop) {
      setStorageError("完整备份需要在拾音 AI 桌面版中使用");
      return;
    }
    setBackupBusy("create");
    setStorageError("");
    try {
      const result = await window.shiyinDesktop.createWorkspaceBackup();
      if (!result.canceled) {
        setNotice(`已备份 ${result.meetingCount || 0} 场会议，共 ${formatBytes(result.totalBytes)}`);
      }
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "创建备份失败");
    } finally {
      setBackupBusy(null);
    }
  }

  async function restoreBackup() {
    if (!window.shiyinDesktop) {
      setStorageError("恢复备份需要在拾音 AI 桌面版中使用");
      return;
    }
    setBackupBusy("restore");
    setStorageError("");
    try {
      const result = await window.shiyinDesktop.restoreWorkspaceBackup();
      if (!result.canceled) {
        const restored = result.importedMeetings || 0;
        const skipped = result.skippedMeetings || 0;
        const items = await refreshMeetings();
        if (selectedId && items.some((item) => item.id === selectedId)) await loadMeeting(selectedId);
        setStorageInfo(await api<StorageInfo>("/api/storage"));
        setNotice(`已恢复 ${restored} 场会议${skipped ? `，跳过 ${skipped} 场已有会议` : ""}`);
      }
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "恢复备份失败");
    } finally {
      setBackupBusy(null);
    }
  }

  const refreshAudioInputs = useCallback(async () => {
    const devices = (await navigator.mediaDevices.enumerateDevices())
      .filter((device) => device.kind === "audioinput")
      .map((device) => ({ deviceId: device.deviceId, label: device.label }));
    setAudioInputs(devices);
    const saved = window.localStorage.getItem("shiyin.microphoneId") || "";
    const validSaved = devices.find((device) => device.deviceId === saved);
    const preferred = validSaved || preferredMicrophone(devices);
    if (preferred) {
      setSelectedDeviceId(preferred.deviceId);
      setActiveDeviceLabel(preferred.label);
    }
    return { devices, preferred };
  }, []);

  const refreshMeetings = useCallback(async (preferredId?: string) => {
    const result = await api<{ meetings: MeetingBrief[] }>("/api/meetings");
    setMeetings(result.meetings);
    setSelectedId((current) => preferredId || current || null);
    return result.meetings;
  }, []);

  const loadMeeting = useCallback(async (meetingId: string) => {
    const value = await api<Meeting>(`/api/meetings/${meetingId}`);
    setMeeting(value);
    return value;
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      refreshMeetings()
        .catch((error) => setNotice(`无法读取本地会议：${error.message}`))
        .finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshMeetings]);

  useEffect(() => {
    const refresh = () => refreshAudioInputs().catch(() => undefined);
    const timer = window.setTimeout(refresh, 0);
    navigator.mediaDevices?.addEventListener("devicechange", refresh);
    return () => {
      window.clearTimeout(timer);
      navigator.mediaDevices?.removeEventListener("devicechange", refresh);
    };
  }, [refreshAudioInputs]);

  useEffect(() => {
    if (!selectedId) return;
    if (recordingRef.current && meeting?.id === selectedId) return;
    const timer = window.setTimeout(() => {
      loadMeeting(selectedId).catch((error) => setNotice(error.message));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selectedId, loadMeeting, meeting?.id]);

  useEffect(() => {
    recordingRef.current = recording;
    if (!recording) return;
    const id = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, [recording]);

  const stopAudioCapture = useCallback(async () => {
    for (const stream of mediaStreamsRef.current) {
      stream.getTracks().forEach((track) => track.stop());
    }
    mediaStreamsRef.current = [];
    await audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
  }, []);

  const stopRecording = useCallback(async () => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setRecording(false);
    window.shiyinDesktop?.setRecording(false);
    setProcessing(true);
    if (miniMaxSettings?.configured) setView("summary");
    setConnectionStatus(miniMaxSettings?.configured
      ? "录音已保存，正在生成 AI 总结…"
      : "录音已保存，正在完成会议…");
    await stopAudioCapture();
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "session.stop" }));
    }
  }, [miniMaxSettings?.configured, stopAudioCapture]);

  useEffect(() => {
    const unsubscribe = window.shiyinDesktop?.onCommand((command) => commandHandlerRef.current(command));
    return () => unsubscribe?.();
  }, []);

  const filteredSegments = useMemo(() => {
    const segments = meeting?.segments || [];
    let matched = segments;
    if (query.trim()) {
      const speakers = new Map(meeting?.speakers.map((speaker) => [speaker.id, speaker.displayName]));
      const term = query.toLowerCase();
      matched = segments.filter((segment) =>
        `${speakers.get(segment.speakerId || "") || ""}${displayedSegmentText(segment, transcriptMode)}`.toLowerCase().includes(term));
    }
    return transcriptOrder === "descending" ? [...matched].reverse() : matched;
  }, [meeting, query, transcriptMode, transcriptOrder]);

  const replacementPreview = useMemo(() => {
    if (!meeting || !replaceFind.trim()) return { count: 0, segments: [] as Array<{ segment: Segment; count: number; next: string }> };
    const segments = meeting.segments.flatMap((segment) => {
      const result = previewReplacement(
        segment.text,
        replaceFind,
        replaceWith,
        replaceCaseSensitive,
        replaceWholeWord,
      );
      return result.count ? [{ segment, count: result.count, next: result.text }] : [];
    });
    return {
      count: segments.reduce((total, item) => total + item.count, 0),
      segments,
    };
  }, [meeting, replaceCaseSensitive, replaceFind, replaceWholeWord, replaceWith]);

  const speakerMap = useMemo(
    () => new Map(meeting?.speakers.map((speaker) => [speaker.id, speaker]) || []),
    [meeting?.speakers],
  );
  const finalSummaryInvalid = summaryLooksInvalid(meeting?.summary);
  const liveSummaryInvalid = summaryLooksInvalid(meeting?.liveSummary);
  const finalSummary = finalSummaryInvalid ? null : meeting?.summary;
  const liveSummary = liveSummaryInvalid ? null : meeting?.liveSummary;
  const usingLiveSummary = Boolean(!finalSummary && liveSummary);
  const summaryFailed = Boolean(
    !finalSummary
    && !liveSummary
    && (finalSummaryInvalid || (meeting?.status === "failed" && meeting.error?.startsWith("总结失败"))),
  );
  const summaryFailureMessage = finalSummaryInvalid
    ? "上次生成的总结格式异常，原始内容已被安全隐藏。请重新生成。"
    : meeting?.error || "";
  const usableSummary = finalSummary || liveSummary || null;
  const actions = usableSummary?.actionItems || [];
  const chapters = usableSummary?.chapters || [];
  const overviewCards = usableSummary?.overviewCards || [];
  const keyFacts = usableSummary?.keyFacts || [];
  const detailedTopics = usableSummary?.detailedTopics || [];
  const aiInsights = usableSummary?.aiInsights || [];
  const speakerInsights = useMemo(
    () => usableSummary?.speakerInsights || [],
    [usableSummary?.speakerInsights],
  );
  const notableMoments = usableSummary?.notableMoments || [];
  const activeJob = meeting?.jobs?.filter((job) => job.status === "running").at(-1);
  const speakerStats = useMemo(() => {
    if (!meeting) return [];
    const insightMap = new Map(speakerInsights.map((insight) => [insight.speaker, insight]));
    const values = meeting.speakers.map((speaker) => {
      const segments = meeting.segments.filter((segment) => segment.speakerId === speaker.id);
      const durationMs = segments.reduce(
        (total, segment) => total + Math.max(0, (segment.endMs ?? segment.startMs) - segment.startMs),
        0,
      );
      return {
        ...speaker,
        turns: segments.length,
        durationMs,
        insight: insightMap.get(speaker.displayName) || insightMap.get(speaker.label),
      };
    });
    const total = values.reduce((sum, speaker) => sum + speaker.durationMs, 0) || 1;
    return values.map((speaker) => ({ ...speaker, share: Math.round((speaker.durationMs / total) * 100) }));
  }, [meeting, speakerInsights]);
  const visibleMeetings = useMemo(() => {
    const normalizedQuery = historyQuery.trim().toLocaleLowerCase("zh-CN");
    if (!normalizedQuery) return meetings;
    return meetings.filter((item) => (
      item.title.toLocaleLowerCase("zh-CN").includes(normalizedQuery)
      || formatMeetingDate(item.startedAt).toLocaleLowerCase("zh-CN").includes(normalizedQuery)
    ));
  }, [historyQuery, meetings]);

  function mergeMeetingList(value: MeetingBrief) {
    setMeetings((items) => [value, ...items.filter((item) => item.id !== value.id)]);
  }

  function updateLiveSegment(segment: Segment, speakers?: Speaker[]) {
    setMeeting((current) => {
      if (!current || current.id !== segment.meetingId) return current;
      const previous = current.segments.at(-1);
      const updatedSegments = previous && previous.endMs !== null
        ? [
          ...current.segments.slice(0, -1),
          { ...previous, pauseAfterMs: Math.max(0, segment.startMs - previous.endMs) },
          segment,
        ]
        : [...current.segments, segment];
      return { ...current, segments: updatedSegments, speakers: speakers || current.speakers };
    });
  }

  function selectAudioSource(mode: AudioSourceMode) {
    setAudioSourceMode(mode);
    window.localStorage.setItem("shiyin.audioSourceMode", mode);
    setAudioWarning("");
    setSourceWarning("");
  }

  async function openAudioPrivacySettings(kind: "microphone" | "screen") {
    const opened = await window.shiyinDesktop?.openAudioPrivacySettings(kind);
    if (!opened) return;
    if (kind === "screen") setCaptureSettingsOpened(true);
    setNotice(
      kind === "screen"
        ? "已打开“屏幕与系统音频录制”，请允许拾音 AI 后返回应用"
        : "已打开“麦克风”权限设置，请允许拾音 AI 后返回应用",
    );
  }

  async function startRecording() {
    try {
      setNotice("");
      setSourceWarning("");
      const captureMode = audioSourceMode;
      const needsMicrophone = captureMode === "microphone" || captureMode === "mixed";
      const needsSystemAudio = captureMode === "system" || captureMode === "mixed";
      if (needsSystemAudio && !systemAudioAvailable) {
        throw new Error("电脑声音录制仅在拾音 AI 桌面版中可用");
      }
      let currentCaptureCapabilities = audioCaptureCapabilities;
      if (needsSystemAudio && window.shiyinDesktop) {
        currentCaptureCapabilities = await refreshCaptureCapabilities();
        if (
          currentCaptureCapabilities?.platform === "darwin"
          && !currentCaptureCapabilities.nativeSystemAudioPicker
        ) {
          throw new Error("Mac 电脑声音录制需要 macOS 15 或更高版本；当前仍可使用麦克风录制");
        }
        if (
          currentCaptureCapabilities?.platform === "darwin"
          && ["denied", "restricted"].includes(currentCaptureCapabilities.screenPermission)
        ) {
          throw new Error("请先在“系统设置 → 隐私与安全性 → 屏幕与系统音频录制”中允许拾音 AI");
        }
      }

      const audioConstraints = (deviceId = ""): MediaStreamConstraints => ({
        audio: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const captureStreams: MediaStream[] = [];
      let microphoneStream: MediaStream | null = null;
      let systemStream: MediaStream | null = null;
      let microphoneLabel = "当前麦克风";
      const systemAudioName = currentCaptureCapabilities?.platform === "darwin" ? "Mac 声音" : "电脑声音";

      if (needsMicrophone) {
        setConnectionStatus("正在连接麦克风…");
        microphoneStream = await navigator.mediaDevices.getUserMedia(audioConstraints(selectedDeviceId));
        const refreshed = await refreshAudioInputs();
        const savedInput = refreshed.devices.find((input) => input.deviceId === selectedDeviceId);
        const targetInput = savedInput || refreshed.preferred;
        const currentDeviceId = microphoneStream.getAudioTracks()[0]?.getSettings().deviceId;
        if (targetInput && currentDeviceId !== targetInput.deviceId) {
          microphoneStream.getTracks().forEach((track) => track.stop());
          microphoneStream = await navigator.mediaDevices.getUserMedia(audioConstraints(targetInput.deviceId));
        }
        const microphoneTrack = microphoneStream.getAudioTracks()[0];
        const finalDeviceId = microphoneTrack?.getSettings().deviceId || targetInput?.deviceId || "";
        microphoneLabel = microphoneTrack?.label || targetInput?.label || "当前麦克风";
        setSelectedDeviceId(finalDeviceId);
        if (finalDeviceId) window.localStorage.setItem("shiyin.microphoneId", finalDeviceId);
        captureStreams.push(microphoneStream);
        mediaStreamsRef.current = [...captureStreams];
      }

      if (needsSystemAudio) {
        setConnectionStatus(
          currentCaptureCapabilities?.platform === "darwin"
            ? "请在 macOS 共享面板中选择屏幕，并开启系统音频…"
            : currentCaptureCapabilities?.platform === "win32"
              ? "正在连接 Windows 电脑声音…"
              : "请选择要共享的屏幕，并开启系统音频…",
        );
        systemStream = await navigator.mediaDevices.getDisplayMedia({
          audio: true,
          video: {
            frameRate: { ideal: 1, max: 5 },
            width: { max: 640 },
            height: { max: 360 },
          },
          systemAudio: "include",
          selfBrowserSurface: "exclude",
          surfaceSwitching: "exclude",
        } as DisplayMediaStreamOptions);
        if (!systemStream.getAudioTracks().length) {
          systemStream.getTracks().forEach((track) => track.stop());
          throw new Error(
            currentCaptureCapabilities?.platform === "darwin"
              ? "已选择屏幕，但没有收到 Mac 声音；请重新开始并在共享面板中开启“系统音频”"
              : currentCaptureCapabilities?.platform === "win32"
                ? "没有收到 Windows 电脑声音，请确认会议或媒体正在播放声音"
                : "没有收到电脑声音，请重新选择屏幕并开启“共享系统音频”",
          );
        }
        captureStreams.push(systemStream);
        mediaStreamsRef.current = [...captureStreams];
      }

      const captureLabel = captureMode === "mixed"
        ? `电脑声音 + ${microphoneLabel}`
        : captureMode === "system" ? "电脑声音" : microphoneLabel;
      setActiveDeviceLabel(captureLabel);
      setConnectionStatus("正在启动本地转写…");
      let sessionAsrLabel = "实时转写";
      const socketUrl = new URL(websocketBase);
      socketUrl.searchParams.set("template", defaultSummaryTemplate);
      socketUrl.searchParams.set("reportStyle", defaultReportStyle);
      socketUrl.searchParams.set("maxSpeakers", String(speakerLimit));
      const socket = new WebSocket(socketUrl.toString());
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;

      await new Promise<void>((resolve, reject) => {
        let ready = false;
        const timeout = window.setTimeout(() => reject(new Error("连接听记后台超时")), 12000);
        socket.onerror = () => {
          if (!ready) reject(new Error("无法连接拾音后台，请先启动本地服务"));
        };
        socket.onmessage = (event) => {
          const message = JSON.parse(event.data);
          if (message.type === "session.started") {
            ready = true;
            sessionAsrLabel = message.asrLabel || "实时转写";
            window.clearTimeout(timeout);
            const value = message.meeting as Meeting;
            setLiveText("");
            setLiveConfirmedText("");
            setMeeting(value);
            setSelectedId(value.id);
            mergeMeetingList(value);
            setConnectionStatus(
              message.speakerModelAvailable
                ? `${sessionAsrLabel} · 本地声纹分离`
                : `${sessionAsrLabel} · 声纹模型不可用`,
            );
            resolve();
          } else if (message.type === "asr.partial") {
            setLiveText(message.text || "");
          } else if (message.type === "segment.final") {
            setLiveText("");
            setLiveConfirmedText(message.segment.cleanedText || message.segment.text || "");
            updateLiveSegment(message.segment, message.speakers);
          } else if (message.type === "summary.preview.started") {
            setConnectionStatus("MiniMax 正在整理实时草稿…");
          } else if (message.type === "summary.preview.progress") {
            const characters = Number(message.characters || 0);
            setConnectionStatus(
              characters > 0
                ? `MiniMax 正在生成实时草稿 · ${characters} 字`
                : "MiniMax 正在生成实时草稿…",
            );
          } else if (message.type === "summary.preview") {
            setMeeting((current) => {
              if (!current || current.id !== message.meetingId) return current;
              return { ...current, liveSummary: message.summary };
            });
            setMeetings((items) => items.map((item) => (
              item.id === message.meetingId ? { ...item, liveSummary: message.summary } : item
            )));
            setConnectionStatus(`${sessionAsrLabel} · 实时草稿已更新`);
          } else if (message.type === "summary.preview.error") {
            setConnectionStatus(`${sessionAsrLabel} · 实时草稿稍后重试`);
          } else if (message.type === "job.progress") {
            setProcessing(true);
            setMeeting((current) => {
              if (!current || current.id !== message.meetingId) return current;
              return {
                ...current,
                status: message.job.kind === "summary" ? "summarizing" : "correcting",
                jobs: [...current.jobs.filter((job) => job.id !== message.job.id), message.job],
              };
            });
            setConnectionStatus(
              message.job.kind === "summary"
                ? `正在生成会议总结 ${message.job.progress}%`
                : `正在校正发言人 ${message.job.progress}%`,
            );
          } else if (message.type === "speaker.corrected") {
            setMeeting(message.meeting);
            mergeMeetingList(message.meeting);
          } else if (message.type === "session.completed") {
            const value = message.meeting as Meeting;
            setMeeting(value);
            mergeMeetingList(value);
            setProcessing(false);
            setConnectionStatus("处理完成");
            setNotice(message.summarySkipped
              ? "会议和逐字稿已保存；配置 MiniMax 密钥后可生成 AI 总结"
              : value.error || "会议已保存，AI 总结已完成；如有需要可手动校正发言人");
            if (obsidianAutoSave && notebookSettings?.obsidianConfigured) {
              void saveMeetingToObsidian(value, { automatic: true });
            }
            window.shiyinDesktop?.setRecording(false);
            socket.close();
            socketRef.current = null;
          } else if (message.type === "error") {
            setNotice(message.message);
            if (!ready && !message.recoverable) reject(new Error(message.message));
          }
        };
      });

      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;
      await audioContext.audioWorklet.addModule("/pcm-worklet.js");
      const mixer = audioContext.createGain();
      const compressor = audioContext.createDynamicsCompressor();
      compressor.threshold.value = -12;
      compressor.knee.value = 12;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;
      if (microphoneStream) {
        const microphoneSource = audioContext.createMediaStreamSource(microphoneStream);
        const microphoneGain = audioContext.createGain();
        microphoneGain.gain.value = captureMode === "mixed" ? 0.9 : 1;
        microphoneSource.connect(microphoneGain).connect(mixer);
      }
      if (systemStream) {
        const systemSource = audioContext.createMediaStreamSource(systemStream);
        const systemGain = audioContext.createGain();
        systemGain.gain.value = captureMode === "mixed" ? 0.85 : 1;
        systemSource.connect(systemGain).connect(mixer);
        for (const track of systemStream.getAudioTracks()) {
          track.addEventListener("ended", () => {
            if (!recordingRef.current) return;
            if (captureMode === "system") {
              setNotice(`${systemAudioName}共享已停止，正在结束本次听记`);
              stopRecording().catch(() => undefined);
            } else {
              setActiveDeviceLabel(microphoneLabel);
              setSourceWarning(`${systemAudioName}共享已停止，当前继续录制麦克风`);
            }
          });
        }
      }
      const capture = new AudioWorkletNode(audioContext, "pcm-capture");
      const silentGain = audioContext.createGain();
      // Keep the graph active in Chromium while remaining effectively inaudible.
      silentGain.gain.value = 0.000001;
      sessionPeakRef.current = 0;
      captureStartedAtRef.current = Date.now();
      lastLevelUpdateRef.current = 0;
      silenceWarningShownRef.current = false;
      setInputLevel(0);
      setAudioWarning("");
      capture.port.onmessage = (event) => {
        const samples = new Int16Array(event.data);
        let framePeak = 0;
        for (let index = 0; index < samples.length; index += 1) {
          framePeak = Math.max(framePeak, Math.abs(samples[index]));
        }
        sessionPeakRef.current = Math.max(sessionPeakRef.current, framePeak);
        const now = Date.now();
        if (now - lastLevelUpdateRef.current >= 160) {
          setInputLevel(Math.min(100, Math.round((framePeak / 4000) * 100)));
          lastLevelUpdateRef.current = now;
        }
        if (
          now - captureStartedAtRef.current >= 2500
          && sessionPeakRef.current < 32
          && !silenceWarningShownRef.current
        ) {
          silenceWarningShownRef.current = true;
          if (captureMode === "microphone") {
            setAudioWarning(`“${captureLabel}”没有检测到声音，请检查当前录音来源`);
          } else {
            setSourceWarning(`“${captureLabel}”没有检测到声音，请确认会议正在播放声音`);
          }
          setConnectionStatus("当前录音来源没有输入");
          setNotice(`当前“${captureLabel}”录到的是静音，请检查左侧录音来源`);
        } else if (framePeak >= 64 && silenceWarningShownRef.current) {
          silenceWarningShownRef.current = false;
          setAudioWarning("");
          setSourceWarning("");
          setConnectionStatus(`${sessionAsrLabel} · 本地声纹分离`);
        }
        if (socket.readyState === WebSocket.OPEN) socket.send(event.data);
      };
      mixer.connect(compressor).connect(capture).connect(silentGain).connect(audioContext.destination);
      setSeconds(0);
      setRecording(true);
      recordingRef.current = true;
      window.shiyinDesktop?.setRecording(true);
    } catch (error) {
      await stopAudioCapture();
      socketRef.current?.close();
      socketRef.current = null;
      setRecording(false);
      recordingRef.current = false;
      window.shiyinDesktop?.setRecording(false);
      setProcessing(false);
      setConnectionStatus("本地实时 ASR");
      const message = error instanceof Error ? error.message : "无法启动实时听记";
      let userMessage = message;
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        if (audioSourceMode === "microphone") {
          userMessage = "麦克风权限未开启，请在“系统设置 → 隐私与安全性 → 麦克风”中允许拾音 AI";
          setAudioWarning(userMessage);
        } else {
          const latestCapabilities = await refreshCaptureCapabilities().catch(() => null);
          userMessage = ["denied", "restricted"].includes(latestCapabilities?.screenPermission || "")
            ? "Mac 系统音频权限未开启，请在“屏幕与系统音频录制”中允许拾音 AI"
            : "已取消 Mac 声音共享；重新开始后请选择会议所在屏幕并开启系统音频";
        }
      }
      if (audioSourceMode !== "microphone") setSourceWarning(userMessage);
      setNotice(userMessage);
    }
  }

  async function toggleRecording() {
    if (recordingRef.current) {
      await stopRecording();
      return;
    }
    if (processing) {
      setNotice("上一场会议仍在处理中，请完成后再开始新的听记");
      return;
    }
    await startRecording();
  }

  commandHandlerRef.current = (command) => {
    if (command === "stop-recording") void stopRecording();
    if (command === "open-settings") void openSettingsDialog();
    if (command === "toggle-recording") void toggleRecording();
  };

  function beginRenameSpeaker(speaker: Speaker) {
    setRenamingSpeaker(speaker);
    setSpeakerNameDraft(speaker.displayName);
  }

  async function saveSpeakerName() {
    if (!renamingSpeaker) return;
    const name = speakerNameDraft.trim();
    if (!name) return;
    if (name === renamingSpeaker.displayName) {
      setRenamingSpeaker(null);
      return;
    }
    try {
      const updated = await api<Speaker>(`/api/speakers/${renamingSpeaker.id}`, {
        method: "PATCH",
        body: JSON.stringify({ displayName: name }),
      });
      setMeeting((current) => current
        ? { ...current, speakers: current.speakers.map((item) => item.id === updated.id ? updated : item) }
        : current);
      setNotice(`已保存 ${updated.displayName}，并更新本机发言人声纹库`);
      setRenamingSpeaker(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "重命名失败");
    }
  }

  async function rerunCorrection() {
    if (!meeting || meeting.status === "recording") return;
    try {
      await api(`/api/meetings/${meeting.id}/correct`, { method: "POST" });
      setProcessing(true);
      setNotice("已在后台重新校正发言人并生成总结");
      const poll = window.setInterval(async () => {
        const value = await loadMeeting(meeting.id).catch(() => null);
        if (value && (value.status === "completed" || value.status === "failed")) {
          window.clearInterval(poll);
          setProcessing(false);
          mergeMeetingList(value);
        }
      }, 1500);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法启动校正任务");
    }
  }

  async function startHistoricalRetranscription() {
    if (!meeting || meetingIsBusy(meeting.status) || !meeting.audioPath) return;
    const meetingId = meeting.id;
    setRetranscriptionStarting(true);
    try {
      await api(`/api/meetings/${meetingId}/retranscribe`, { method: "POST" });
      setTranscriptionDialogOpen(false);
      setProcessing(true);
      setConnectionStatus("正在读取历史录音并重新转写…");
      setMeeting((current) => current?.id === meetingId ? { ...current, status: "retranscribing", error: null } : current);
      setNotice("历史录音已进入本地重新转写；原逐字稿会自动保留为版本");
      window.shiyinDesktop?.setRecording(true);
      const poll = window.setInterval(async () => {
        const value = await loadMeeting(meetingId).catch(() => null);
        if (!value) return;
        const job = [...value.jobs].reverse().find((item) => item.kind === "retranscription");
        if (value.status === "retranscribing") {
          setConnectionStatus(`正在重新转写历史录音 ${job?.progress || 0}%`);
          return;
        }
        window.clearInterval(poll);
        setProcessing(false);
        setRetranscriptionStarting(false);
        window.shiyinDesktop?.setRecording(false);
        mergeMeetingList(value);
        setConnectionStatus(job?.status === "completed" ? "历史录音重新转写完成" : "重新转写未完成");
        setNotice(value.error || "重新转写已完成；旧逐字稿可在转写版本中恢复");
      }, 1500);
    } catch (error) {
      setRetranscriptionStarting(false);
      setProcessing(false);
      window.shiyinDesktop?.setRecording(false);
      setNotice(error instanceof Error ? error.message : "无法启动历史录音重新转写");
    }
  }

  async function restoreTranscriptVersion(version: TranscriptVersion) {
    if (!meeting || meetingIsBusy(meeting.status)) return;
    setVersionRestoringId(version.id);
    try {
      const restored = await api<Meeting>(
        `/api/meetings/${meeting.id}/transcript-versions/${version.id}/restore`,
        { method: "POST" },
      );
      setMeeting(restored);
      mergeMeetingList(restored);
      setNotice(`已切换到“${version.label}”；切换前内容也已自动保存`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法恢复转写版本");
    } finally {
      setVersionRestoringId(null);
    }
  }

  async function rerunSummary() {
    if (!meeting || meetingIsBusy(meeting.status)) return;
    if (!miniMaxSettings?.configured) {
      setNotice("请先配置 MiniMax，再重新生成 AI 总结");
      await openSettingsDialog();
      return;
    }
    await regenerateSummary(meeting.id);
  }

  async function regenerateSummary(meetingId: string) {
    try {
      await api(`/api/meetings/${meetingId}/summarize`, { method: "POST" });
      setProcessing(true);
      setConnectionStatus("正在重新生成 MiniMax 总结…");
      setMeeting((current) => current?.id === meetingId ? { ...current, status: "summarizing", error: null } : current);
      setNotice("已在后台重新生成 AI 总结");
      const poll = window.setInterval(async () => {
        const value = await loadMeeting(meetingId).catch(() => null);
        if (value && (value.status === "completed" || value.status === "failed")) {
          window.clearInterval(poll);
          setProcessing(false);
          setConnectionStatus(value.status === "completed" ? "总结已更新" : "总结生成失败");
          setNotice(value.error || "AI 总结已重新生成");
          mergeMeetingList(value);
        }
      }, 1500);
    } catch (error) {
      setProcessing(false);
      setNotice(error instanceof Error ? error.message : "无法重新生成总结");
    }
  }

  function openTemplateDialog() {
    setTemplateDraft(meeting?.summaryTemplate || defaultSummaryTemplate);
    setReportStyleDraft(meeting?.reportStyle || defaultReportStyle);
    setTemplateDialogOpen(true);
  }

  async function applyTemplateSettings() {
    window.localStorage.setItem("shiyin.summaryTemplate", templateDraft);
    window.localStorage.setItem("shiyin.reportStyle", reportStyleDraft);
    setDefaultSummaryTemplate(templateDraft);
    setDefaultReportStyle(reportStyleDraft);

    if (!meeting) {
      setTemplateDialogOpen(false);
      setNotice(`新听记将使用“${summaryTemplateName(templateDraft)}”与${reportStyleDraft === "visual" ? "图文纪要" : "深度纪要"}`);
      return;
    }

    const templateChanged = meeting.summaryTemplate !== templateDraft;
    try {
      const updated = await api<Meeting>(`/api/meetings/${meeting.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          summaryTemplate: templateDraft,
          reportStyle: reportStyleDraft,
        }),
      });
      setMeeting(updated);
      mergeMeetingList(updated);
      setTemplateDialogOpen(false);
      if (templateChanged) {
        setView("summary");
        await regenerateSummary(updated.id);
      } else {
        setNotice(`已切换为${reportStyleDraft === "visual" ? "图文纪要" : "深度纪要"}，无需重新调用 MiniMax`);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法保存总结模板");
    }
  }

  function beginRenameMeeting(item: MeetingBrief) {
    if (meetingIsBusy(item.status) || processing || recording) return;
    setRenamingMeeting(item);
    setMeetingTitleDraft(item.title);
    setMeetingRenameError("");
  }

  async function saveMeetingTitle() {
    if (!renamingMeeting || meetingRenameSaving) return;
    const title = meetingTitleDraft.trim();
    if (!title) {
      setMeetingRenameError("会议名称不能为空");
      return;
    }
    if (title === renamingMeeting.title) {
      setRenamingMeeting(null);
      return;
    }
    setMeetingRenameSaving(true);
    setMeetingRenameError("");
    try {
      const updated = await api<Meeting>(`/api/meetings/${renamingMeeting.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title }),
      });
      mergeMeetingList(updated);
      setMeeting((current) => current?.id === updated.id ? updated : current);
      setRenamingMeeting(null);
      setNotice(`会议已重命名为“${updated.title}”`);
    } catch (error) {
      setMeetingRenameError(error instanceof Error ? error.message : "无法重命名会议");
    } finally {
      setMeetingRenameSaving(false);
    }
  }

  async function deleteMeeting() {
    if (!meeting || meeting.status === "recording") return;
    if (!window.confirm(`删除“${meeting.title}”及其本地录音？此操作无法撤销。`)) return;
    try {
      await api(`/api/meetings/${meeting.id}`, { method: "DELETE" });
      setMeeting(null);
      setSelectedId(null);
      await refreshMeetings();
      setNotice("会议及本地录音已删除");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "删除失败");
    }
  }

  function seekToAudio(milliseconds: number, autoplay = true) {
    const audio = playbackRef.current;
    if (!audio) {
      setNotice("当前会议没有可播放的原始录音");
      return;
    }
    const seek = () => {
      audio.currentTime = Math.max(0, milliseconds / 1000);
      if (autoplay) {
        void audio.play().catch(() => setNotice("无法播放原始录音，请稍后重试"));
      }
    };
    if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) seek();
    else audio.addEventListener("loadedmetadata", seek, { once: true });
  }

  function jumpToEvidence(seq: number) {
    setView("transcript");
    setHighlightedSeq(seq);
    const startMs = meeting?.segments.find((segment) => segment.seq === seq)?.startMs;
    if (startMs !== undefined) seekToAudio(startMs, false);
    window.setTimeout(() => {
      document.getElementById(`segment-${seq}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    window.setTimeout(() => setHighlightedSeq(null), 2600);
  }

  function openReplaceDialog() {
    setReplaceFind(query.trim());
    setReplaceWith("");
    setReplaceCaseSensitive(false);
    setReplaceWholeWord(false);
    setReplaceDialogOpen(true);
  }

  async function applyTranscriptReplacement() {
    if (!meeting || !replaceFind.trim() || !replacementPreview.count) return;
    setTranscriptSaving(true);
    try {
      const result = await api<{ meeting: Meeting; count: number }>(
        `/api/meetings/${meeting.id}/transcript/replace`,
        {
          method: "POST",
          body: JSON.stringify({
            find: replaceFind,
            replace: replaceWith,
            caseSensitive: replaceCaseSensitive,
            wholeWord: replaceWholeWord,
          }),
        },
      );
      setMeeting(result.meeting);
      mergeMeetingList(result.meeting);
      setTranscriptMode("organized");
      setQuery(replaceWith || replaceFind);
      setReplaceDialogOpen(false);
      setNotice(`已替换 ${result.count} 处；原始记录已保留，建议重新生成 AI 总结`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "替换失败");
    } finally {
      setTranscriptSaving(false);
    }
  }

  async function undoTranscriptReplacement() {
    if (!meeting?.canUndoTranscriptEdit) return;
    setTranscriptSaving(true);
    try {
      const result = await api<{ meeting: Meeting; restored: number }>(
        `/api/meetings/${meeting.id}/transcript/undo`,
        { method: "POST" },
      );
      setMeeting(result.meeting);
      mergeMeetingList(result.meeting);
      setNotice(`已撤销上一次批量替换，恢复 ${result.restored} 段记录`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "撤销失败");
    } finally {
      setTranscriptSaving(false);
    }
  }

  async function toggleFillerFilter() {
    if (!meeting) return;
    setTranscriptSaving(true);
    try {
      const value = await api<Meeting>(`/api/meetings/${meeting.id}`, {
        method: "PATCH",
        body: JSON.stringify({ fillerFilterEnabled: !meeting.fillerFilterEnabled }),
      });
      setMeeting(value);
      mergeMeetingList(value);
      setTranscriptMode("organized");
      setNotice(value.fillerFilterEnabled
        ? "已启用保守口语过滤；原始记录仍可随时查看"
        : "已关闭口语过滤；人工术语替换仍然保留");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法更新口语过滤设置");
    } finally {
      setTranscriptSaving(false);
    }
  }

  function buildMarkdownReport(sourceMeeting: Meeting | null = meeting) {
    if (!sourceMeeting) return "";
    const summary = (summaryLooksInvalid(sourceMeeting.summary) ? null : sourceMeeting.summary)
      || (summaryLooksInvalid(sourceMeeting.liveSummary) ? null : sourceMeeting.liveSummary)
      || null;
    const names = new Map(sourceMeeting.speakers.map((speaker) => [speaker.id, speaker.displayName]));
    const lines: string[] = [
      `# ${sourceMeeting.title}`,
      "",
      `> 拾音 AI 会议报告 · ${formatMeetingDate(sourceMeeting.startedAt)} · ${formatClock(sourceMeeting.durationMs)} · ${sourceMeeting.speakers.length} 位发言人`,
      "",
      "## 会议概述",
      "",
      summary?.overview || "尚未生成总结",
    ];
    const addList = (title: string, items: string[] | undefined) => {
      if (!items?.length) return;
      lines.push("", `## ${title}`, "", ...items.map((item) => `- ${item}`));
    };

    if (summary?.meetingBackground) lines.push("", "## 会议背景", "", summary.meetingBackground);
    if (summary?.overviewCards?.length) {
      lines.push("", "## 会议总览");
      for (const card of summary.overviewCards) {
        lines.push("", `### ${card.title}`, "", card.summary);
        lines.push(...(card.points || []).map((point) => `- ${point}`));
      }
    }
    if (summary?.keyFacts?.length) {
      lines.push("", "## 关键事实", "", "| 数值/名词 | 含义 | 上下文 |", "|---|---|---|");
      for (const fact of summary.keyFacts) {
        lines.push(`| ${markdownCell(fact.value)} | ${markdownCell(fact.label)} | ${markdownCell(fact.context)} |`);
      }
    }
    addList("关键决策", summary?.decisions);
    if (summary?.detailedTopics?.length) {
      lines.push("", "## 详细议题");
      for (const topic of summary.detailedTopics) {
        lines.push("", `### ${topic.title}`, "", topic.summary);
        lines.push(...(topic.points || []).map((point) => `- ${point}`));
        if (topic.conclusion) lines.push("", `**结论：** ${topic.conclusion}`);
      }
    }
    if (summary?.aiInsights?.length) {
      lines.push("", "## AI 洞察");
      for (const insight of summary.aiInsights) {
        lines.push("", `### ${insight.title}`, "", insight.insight);
        if (insight.basis) lines.push("", `- 判断依据：${insight.basis}`);
        lines.push(`- 可信度：${insight.confidence}`);
      }
    }
    if (summary?.actionItems?.length) {
      lines.push("", "## 行动项", "", "| 负责人 | 任务 | 截止时间 | 优先级 |", "|---|---|---|---|");
      for (const item of summary.actionItems) {
        lines.push(`| ${markdownCell(item.owner)} | ${markdownCell(item.task)} | ${markdownCell(item.due)} | ${markdownCell(item.priority || "中")} |`);
      }
    }
    if (summary?.speakerInsights?.length) {
      lines.push("", "## 发言人贡献");
      for (const speaker of summary.speakerInsights) {
        lines.push("", `### ${speaker.speaker}`, "", speaker.contribution);
        lines.push(...(speaker.keyPoints || []).map((point) => `- ${point}`));
      }
    }
    if (summary?.chapters?.length) {
      lines.push("", "## 章节时间轴");
      for (const chapter of summary.chapters) {
        lines.push("", `### ${formatClock(chapter.startMs)}–${formatClock(chapter.endMs)} ${chapter.title}`, "", chapter.summary);
        lines.push(...(chapter.highlights || []).map((point) => `- ${point}`));
      }
    }
    addList("风险与待确认", summary?.risks);
    const topics = [...(summary?.topics || []), ...(summary?.keywords || [])]
      .filter((item, index, items) => items.indexOf(item) === index);
    if (topics.length) lines.push("", "## 主题与关键词", "", topics.map((item) => `\`${item}\``).join(" "));

    lines.push("", "## 完整逐字稿（整理稿）");
    if (sourceMeeting.fillerFilterEnabled) lines.push("", "> 已应用保守口语过滤；原始识别文本仍保存在拾音 AI 中。");
    for (const segment of sourceMeeting.segments) {
      const name = names.get(segment.speakerId || "") || "待确认发言人";
      lines.push("", `### ${formatClock(segment.startMs)}–${formatClock(segment.endMs)} ${name}`, "", segment.cleanedText);
    }
    return `${lines.join("\n").trim()}\n`;
  }

  function downloadMarkdownReport() {
    if (!meeting) return;
    downloadText(
      buildMarkdownReport(),
      `${safeFilename(meeting.title)}-AI会议报告.md`,
      "text/markdown;charset=utf-8",
    );
    setExportMenuOpen(false);
    setNotice("Markdown 报告已下载，可直接交给其他 AI Agent");
  }

  async function copyMarkdownReport() {
    if (!meeting) return;
    try {
      await navigator.clipboard.writeText(buildMarkdownReport());
      setNotice("Markdown 报告已复制到剪贴板");
    } catch {
      setNotice("无法访问剪贴板，请改用下载 Markdown");
    }
    setExportMenuOpen(false);
  }

  async function saveMeetingToObsidian(
    sourceMeeting: Meeting | null = meeting,
    options: { automatic?: boolean } = {},
  ) {
    if (!sourceMeeting) return false;
    const desktop = window.shiyinDesktop;
    if (!desktop) {
      setNotice("保存到 Obsidian 需要使用拾音 AI 桌面版");
      return false;
    }
    setObsidianSaving(true);
    if (!options.automatic) setExportMenuOpen(false);
    try {
      const result = await desktop.saveMeetingToObsidian({
        meetingId: sourceMeeting.id,
        title: sourceMeeting.title,
        startedAt: sourceMeeting.startedAt,
        markdown: buildMarkdownReport(sourceMeeting),
        openAfterSave: !options.automatic,
      });
      if (result.canceled) return false;
      setNotice(options.automatic
        ? `会议已自动同步到 Obsidian：${result.fileName || sourceMeeting.title}`
        : `${result.updated ? "已更新" : "已保存"} Obsidian 笔记：${result.fileName || sourceMeeting.title}`);
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存到 Obsidian 失败");
      return false;
    } finally {
      setObsidianSaving(false);
    }
  }

  function toggleObsidianAutoSave() {
    if (!notebookSettings?.obsidianConfigured) {
      setSettingsDialogOpen(true);
      setNotice("请先连接 Obsidian AI 笔记本");
      return;
    }
    const enabled = !obsidianAutoSave;
    setObsidianAutoSave(enabled);
    window.localStorage.setItem("shiyin.obsidianAutoSave", String(enabled));
    setNotice(enabled ? "已开启：会议结束后自动同步到 Obsidian" : "已关闭 Obsidian 自动同步；仍可手动保存");
  }

  function exportHtmlReport() {
    if (!meeting) return;
    if (summaryFailed) {
      setNotice("当前总结生成失败，请重新生成后再导出报告");
      return;
    }
    const names = new Map(meeting.speakers.map((speaker) => [speaker.id, speaker.displayName]));
    const summary = usableSummary;
    const list = (items: string[]) =>
      items.length ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "<p class=\"muted\">无</p>";
    const transcript = meeting.segments.map((segment) => `
      <div class="transcript-row">
        <time>${formatClock(segment.startMs)}–${formatClock(segment.endMs)}</time>
        <div><b>${escapeHtml(names.get(segment.speakerId || "") || "待确认发言人")}</b><p>${escapeHtml(segment.cleanedText)}</p></div>
      </div>`).join("");
    const overviewMapHtml = (summary?.overviewCards || []).map((card, index) => `
      <article class="map-card">
        <span>${String(index + 1).padStart(2, "0")}</span>
        <h3>${escapeHtml(card.title)}</h3>
        <p>${escapeHtml(card.summary)}</p>
        ${list(card.points || [])}
      </article>`).join("");
    const factHtml = (summary?.keyFacts || []).map((fact) => `
      <article class="fact-card">
        <strong>${escapeHtml(fact.value)}</strong>
        <b>${escapeHtml(fact.label)}</b>
        <p>${escapeHtml(fact.context)}</p>
      </article>`).join("");
    const detailedTopicHtml = (summary?.detailedTopics || []).map((topic, index) => `
      <article class="detail-topic">
        <div class="topic-index">${String(index + 1).padStart(2, "0")}</div>
        <div>
          <h3>${escapeHtml(topic.title)}</h3>
          <p>${escapeHtml(topic.summary)}</p>
          ${list(topic.points || [])}
          ${topic.conclusion ? `<aside><b>形成结论</b>${escapeHtml(topic.conclusion)}</aside>` : ""}
        </div>
      </article>`).join("");
    const aiInsightHtml = (summary?.aiInsights || []).map((insight) => `
      <article class="ai-insight">
        <header><b>${escapeHtml(insight.title)}</b><span>${escapeHtml(insight.confidence)}可信度</span></header>
        <p>${escapeHtml(insight.insight)}</p>
        ${insight.basis ? `<small><b>判断依据：</b>${escapeHtml(insight.basis)}</small>` : ""}
      </article>`).join("");
    const chapterHtml = (summary?.chapters || []).map((chapter, index) => `
      <article class="chapter">
        <time>${formatClock(chapter.startMs)}–${formatClock(chapter.endMs)}</time>
        <div><h3>${index + 1}. ${escapeHtml(chapter.title)}</h3><p>${escapeHtml(chapter.summary)}</p>${list(chapter.highlights || [])}</div>
      </article>`).join("");
    const actionHtml = (summary?.actionItems || []).map((item) => `
      <tr><td>${escapeHtml(item.owner)}</td><td>${escapeHtml(item.task)}</td><td>${escapeHtml(item.due)}</td><td>${escapeHtml(item.priority || "中")}</td></tr>`).join("");
    const speakerHtml = speakerStats.map((speaker) => `
      <article class="speaker-card">
        <div><b>${escapeHtml(speaker.displayName)}</b><span>${speaker.turns} 次发言 · 约占 ${speaker.share}% · ${formatClock(speaker.durationMs)}</span></div>
        <p>${escapeHtml(speaker.insight?.contribution || "参与了会议讨论，详细观点见完整记录。")}</p>
        ${list(speaker.insight?.keyPoints || [])}
      </article>`).join("");
    const notableHtml = (summary?.notableMoments || []).map((moment) => `
      <blockquote><p>“${escapeHtml(moment.text)}”</p><footer>${escapeHtml(moment.speaker)} · ${formatClock(moment.timeMs)} · ${escapeHtml(moment.reason)}</footer></blockquote>`).join("");
    const topicHtml = [...(summary?.topics || []), ...(summary?.keywords || [])]
      .filter((item, index, items) => items.indexOf(item) === index)
      .map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("");
    const report = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(meeting.title)}｜拾音 AI 会议报告</title>
<style>
body{margin:0;background:#f4f1eb;color:#292722;font-family:"Microsoft YaHei UI","Microsoft YaHei","PingFang SC","Noto Sans CJK SC","Segoe UI",sans-serif;font-synthesis:none;-webkit-font-smoothing:antialiased}.page{max-width:940px;margin:40px auto;background:white;padding:58px 64px;box-shadow:0 16px 50px #30291e17}.brand{color:#6e53d8;font-size:13px;font-weight:800;letter-spacing:.08em}.hero{font-size:32px;font-weight:650;line-height:1.55;margin:14px 0}.meta,.muted{color:#8e897f;font-size:12px}.overview{font-size:16px;line-height:1.9;color:#504c44;border-left:3px solid #ef5c37;padding-left:18px}section{border-top:1px solid #eae5dc;margin-top:36px;padding-top:28px}h2{font-size:20px;font-weight:650}h3{font-size:15px;margin:0 0 8px}p,li{font-size:13px;line-height:1.8}.meeting-background{padding:20px 24px;background:#faf8f4;border:1px solid #ece7de}.overview-map{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.map-card{position:relative;padding:20px;border:1px solid #e9e4db}.map-card>span{color:#7658d4;font-size:11px;font-weight:800}.map-card h3{margin-top:10px}.map-card p{color:#5c574f}.map-card ul{padding-left:18px}.fact-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.fact-card{padding:17px;background:#f8f6f1;border-top:3px solid #e8b448}.fact-card strong,.fact-card b{display:block}.fact-card strong{font-size:23px}.fact-card b{font-size:11px;margin-top:5px}.fact-card p{font-size:10px;color:#817b71}.detail-topic{display:grid;grid-template-columns:42px 1fr;gap:14px;padding:22px 0;border-bottom:1px solid #eeeae2}.topic-index{color:#7658d4;font-weight:800}.detail-topic ul{padding-left:18px}.detail-topic aside{padding:12px 14px;background:#f1f7f2;color:#42634e;font-size:12px}.detail-topic aside b{margin-right:10px}.ai-insight-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}.ai-insight{padding:18px;background:#faf8fd;border-left:3px solid #7658d4}.ai-insight header{display:flex;justify-content:space-between}.ai-insight header span{font-size:10px;color:#7658d4}.ai-insight small{display:block;color:#837d74;line-height:1.7}.chapter{display:grid;grid-template-columns:100px 1fr;gap:20px;padding:18px 0;border-bottom:1px solid #eeeae2}.chapter time,.transcript-row time{font-size:11px;color:#795fce}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:12px;border-bottom:1px solid #ebe6dd;font-size:12px}th{color:#878278;background:#f8f6f1}.speaker-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.speaker-card{border:1px solid #ebe6dd;padding:16px}.speaker-card div{display:flex;justify-content:space-between;gap:12px}.speaker-card span{color:#958f85;font-size:11px}.speaker-card p{color:#5c574f}.speaker-card ul{padding-left:18px}blockquote{margin:10px 0;padding:16px 20px;background:#faf8fd;border-left:3px solid #7a5bd1}blockquote p{font-size:16px;font-weight:600;line-height:1.8}blockquote footer{color:#8d877d;font-size:11px}.tag{display:inline-block;margin:0 6px 6px 0;padding:6px 9px;background:#f5f2ec;border:1px solid #eae5dc;font-size:11px}.transcript-row{display:grid;grid-template-columns:100px 1fr;gap:20px;padding:14px 0;border-bottom:1px solid #f0ece5}.transcript-row p{margin:5px 0}@media(max-width:680px){.page{margin:0;padding:28px}.speaker-grid,.overview-map,.ai-insight-grid{grid-template-columns:1fr}.fact-grid{grid-template-columns:repeat(2,1fr)}}@media print{body{background:white}.page{margin:0;box-shadow:none;padding:24px}.map-card,.fact-card,.detail-topic,.ai-insight{break-inside:avoid}}
</style></head><body><main class="page">
<div class="brand">✦ 拾音 AI · 深度会议纪要</div>
<h1 class="hero">${escapeHtml(summary?.headline || summary?.overview || meeting.title)}</h1>
<p class="meta">${escapeHtml(meeting.title)} · ${formatMeetingDate(meeting.startedAt)} · ${formatClock(meeting.durationMs)} · ${meeting.speakers.length} 位发言人</p>
<p class="overview">${escapeHtml(summary?.overview || "尚未生成总结")}</p>
${overviewMapHtml ? `<section><h2>会议总览</h2><div class="overview-map">${overviewMapHtml}</div></section>` : ""}
${summary?.meetingBackground ? `<section><h2>会议背景</h2><p class="meeting-background">${escapeHtml(summary.meetingBackground)}</p></section>` : ""}
${factHtml ? `<section><h2>关键数字与事实</h2><div class="fact-grid">${factHtml}</div></section>` : ""}
<section><h2>关键决策</h2>${list(summary?.decisions || [])}</section>
${detailedTopicHtml ? `<section><h2>详细议题</h2>${detailedTopicHtml}</section>` : ""}
${aiInsightHtml ? `<section><h2>AI 洞察</h2><div class="ai-insight-grid">${aiInsightHtml}</div></section>` : ""}
<section><h2>行动项</h2>${actionHtml ? `<table><thead><tr><th>责任人</th><th>任务</th><th>截止时间</th><th>优先级</th></tr></thead><tbody>${actionHtml}</tbody></table>` : "<p class=\"muted\">未识别到明确行动项</p>"}</section>
${speakerHtml ? `<section><h2>发言人贡献</h2><div class="speaker-grid">${speakerHtml}</div></section>` : ""}
${notableHtml ? `<section><h2>值得回看的发言</h2>${notableHtml}</section>` : ""}
${chapterHtml ? `<section><h2>章节时间轴</h2>${chapterHtml}</section>` : ""}
<section><h2>风险与待确认</h2>${list(summary?.risks || [])}</section>
${topicHtml ? `<section><h2>主题与关键词</h2><div>${topicHtml}</div></section>` : ""}
<section><h2>完整记录</h2>${transcript}</section>
</main></body></html>`;
    downloadText(report, `${safeFilename(meeting.title)}-AI会议报告.html`, "text/html;charset=utf-8");
    setExportMenuOpen(false);
  }

  const isMacDesktop = audioCaptureCapabilities?.platform === "darwin";
  const isWindowsDesktop = audioCaptureCapabilities?.platform === "win32";
  const macScreenPermission = audioCaptureCapabilities?.screenPermission || "unknown";
  const macMicrophonePermission = audioCaptureCapabilities?.microphonePermission || "unknown";
  const macScreenPermissionBlocked = ["denied", "restricted"].includes(macScreenPermission);
  const macMicrophonePermissionBlocked = ["denied", "restricted"].includes(macMicrophonePermission);
  const macSystemMode = audioSourceMode === "system" || audioSourceMode === "mixed";
  const macCaptureState = sourceWarning
    ? "warning"
    : macScreenPermissionBlocked
      ? "blocked"
      : macScreenPermission === "granted" ? "ready" : "pending";
  const macCaptureTitle = sourceWarning
    || (macScreenPermissionBlocked
      ? "需要开启 Mac 系统音频权限"
      : macScreenPermission === "granted" ? "Mac 系统音频已就绪" : "首次使用需要系统确认");
  const macCaptureDetail = macScreenPermissionBlocked
    ? "在系统设置的“屏幕与系统音频录制”中允许拾音 AI。"
    : macScreenPermission === "granted"
      ? audioSourceMode === "mixed"
        ? "开始后选择会议所在屏幕；建议佩戴耳机，避免声音被重复录入。"
        : "开始后选择会议所在屏幕，并确认共享系统音频。"
      : "点击开始后，macOS 会弹出共享面板，请选择会议所在屏幕并开启系统音频。";

  return (
    <main className="app-shell">
      <header className="window-chrome" aria-label="拾音 AI 软件窗口">
        <div className="window-chrome-safe-area">
          <div className="window-chrome-brand">
            <span className="window-chrome-mark">听</span>
            <strong>拾音 AI</strong>
            <i />
            <span>会议听记工作台</span>
          </div>
          <div className="window-chrome-state"><i /> 本地运行</div>
        </div>
      </header>
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">听</span><span>拾音</span><em>AI</em></div>
        <button className="new-note" disabled={processing} onClick={toggleRecording}>
          <span>{recording ? "■" : "●"}</span>{recording ? "结束听记" : "开始新听记"}
        </button>
        <button type="button" className="local-storage-note" onClick={() => void openStorageDialog()}>
          <HardDrives size={17} weight="duotone" />
          <span><b>本机存储</b><small>管理录音与空间</small></span>
          <ArrowRight size={13} />
        </button>
        {isMacDesktop ? (
          <section className="mac-audio-source-picker" aria-labelledby="mac-audio-source-title">
            <div className="mac-source-heading">
              <span id="mac-audio-source-title">录音来源</span>
              <em>macOS</em>
            </div>
            <div className="mac-source-options" role="radiogroup" aria-label="选择录音来源">
              <button
                type="button"
                className={audioSourceMode === "microphone" ? "active" : ""}
                aria-pressed={audioSourceMode === "microphone"}
                disabled={recording}
                onClick={() => selectAudioSource("microphone")}
              >
                <b>现场</b><small>麦克风</small>
              </button>
              <button
                type="button"
                className={audioSourceMode === "system" ? "active" : ""}
                aria-pressed={audioSourceMode === "system"}
                disabled={recording || !systemAudioAvailable}
                onClick={() => selectAudioSource("system")}
              >
                <b>线上</b><small>Mac 声音</small>
              </button>
              <button
                type="button"
                className={audioSourceMode === "mixed" ? "active" : ""}
                aria-pressed={audioSourceMode === "mixed"}
                disabled={recording || !systemAudioAvailable}
                onClick={() => selectAudioSource("mixed")}
              >
                <b>混合</b><small>声音 + 麦克风</small>
              </button>
            </div>
            {!systemAudioAvailable && (
              <p className="mac-version-note">Mac 电脑声音需要 macOS 15 或更高版本</p>
            )}
            {macSystemMode && systemAudioAvailable && (
              <div className={`mac-capture-status ${macCaptureState}`}>
                <div><i /><span><b>{macCaptureTitle}</b><small>{macCaptureDetail}</small></span></div>
                <p>只读取系统声音；共享画面不会保存，也不会上传。</p>
                <div className="mac-permission-actions">
                  {macScreenPermissionBlocked && (
                    <button type="button" onClick={() => openAudioPrivacySettings("screen")}>打开系统设置</button>
                  )}
                  <button type="button" onClick={() => refreshCaptureCapabilities()}>重新检测</button>
                  {captureSettingsOpened && macScreenPermission === "granted" && (
                    <button type="button" onClick={() => window.shiyinDesktop?.relaunch()}>重启应用</button>
                  )}
                </div>
              </div>
            )}
          </section>
        ) : (
          <label className="audio-source-picker">
            <span>录音来源</span>
            <select
              value={audioSourceMode}
              disabled={recording}
              onChange={(event) => selectAudioSource(event.target.value as AudioSourceMode)}
            >
              <option value="microphone">仅麦克风</option>
              <option value="system" disabled={!systemAudioAvailable}>仅电脑声音</option>
              <option value="mixed" disabled={!systemAudioAvailable}>电脑声音 + 麦克风</option>
            </select>
            <small>
              {systemAudioAvailable
                ? isWindowsDesktop
                  ? "Windows 桌面版会直接采集系统播放声音"
                  : "电脑声音模式开始时会让你选择共享屏幕"
                : "电脑声音录制仅在桌面版可用"}
            </small>
          </label>
        )}
        <div className={`microphone-picker ${audioSourceMode === "system" ? "is-unused" : ""}`}>
          <span>麦克风设备</span>
          <select
            aria-label="麦克风设备"
            value={selectedDeviceId}
            disabled={recording || audioSourceMode === "system"}
            onChange={(event) => {
              const deviceId = event.target.value;
              const input = audioInputs.find((item) => item.deviceId === deviceId);
              setSelectedDeviceId(deviceId);
              setActiveDeviceLabel(input?.label || "自动选择麦克风");
              window.localStorage.setItem("shiyin.microphoneId", deviceId);
            }}
          >
            {!audioInputs.length && <option value="">正在读取麦克风…</option>}
            {audioInputs.map((input, index) => (
              <option value={input.deviceId} key={input.deviceId}>{input.label || `麦克风 ${index + 1}`}</option>
            ))}
          </select>
          <div className="mic-level"><i style={{ width: `${inputLevel}%` }} /></div>
          <small className={audioWarning ? "warning" : ""}>
            {audioWarning || (isMacDesktop && macMicrophonePermissionBlocked && audioSourceMode !== "system"
              ? "需要在系统设置中允许麦克风"
              : recording
              ? `正在使用：${activeDeviceLabel}`
              : audioSourceMode === "system" ? "仅录 Mac 声音，不启用麦克风" : "开始后可看到输入电平")}
          </small>
          {isMacDesktop && macMicrophonePermissionBlocked && audioSourceMode !== "system" && (
            <button
              type="button"
              className="microphone-permission-button"
              disabled={recording}
              onClick={() => openAudioPrivacySettings("microphone")}
            >
              打开麦克风权限
            </button>
          )}
        </div>
        <section className="speaker-limit-picker" aria-labelledby="speaker-limit-title">
          <div className="speaker-limit-heading">
            <UsersThree size={15} weight="duotone" />
            <span><b id="speaker-limit-title">预计参会人数</b><small>用于区分发言人</small></span>
          </div>
          <div className="speaker-limit-options" role="radiogroup" aria-label="选择新会议的发言人数上限">
            {speakerLimitOptions.map((option) => (
              <button
                type="button"
                key={option.value}
                className={speakerLimit === option.value ? "active" : ""}
                aria-pressed={speakerLimit === option.value}
                disabled={recording || processing}
                onClick={() => {
                  setSpeakerLimit(option.value);
                  window.localStorage.setItem("shiyin.maxSpeakers", String(option.value));
                  setNotice(`下一场会议最多区分 ${option.value} 位发言人`);
                }}
              >
                <b>{option.label}</b><small>{option.detail}</small>
              </button>
            ))}
          </div>
          {speakerLimit > 12 && <p>人数较多时，建议会后检查并合并误分的发言人。</p>}
        </section>
        <button className="template-quick-button" onClick={openTemplateDialog} disabled={recording || processing}>
          <span className={`template-quick-icon ${(meeting?.summaryTemplate || defaultSummaryTemplate).replace("meeting-", "")}`}>
            {summaryTemplateIcon(meeting?.summaryTemplate || defaultSummaryTemplate, 18)}
          </span>
          <span>
            <small>总结模板</small>
            <b>{summaryTemplateName(meeting?.summaryTemplate || defaultSummaryTemplate)}</b>
            <em>{(meeting?.reportStyle || defaultReportStyle) === "visual" ? "图文纪要" : "深度纪要"}</em>
          </span>
          <ArrowRight size={15} />
        </button>
        {globalShortcutStatus && (
          <div className={`shortcut-hint ${globalShortcutStatus.openWindow && globalShortcutStatus.toggleRecording ? "" : "warning"}`}>
            <span><b>{globalShortcutStatus.openLabel}</b><small>打开应用</small></span>
            <span><b>{globalShortcutStatus.recordingLabel}</b><small>开始 / 结束</small></span>
            <em>{globalShortcutStatus.openWindow && globalShortcutStatus.toggleRecording ? "桌面全局快捷键" : "快捷键被其他应用占用"}</em>
          </div>
        )}
        <div className="nav-label history-heading">
          <span>历史会议</span>
          <b>{meetings.length}</b>
        </div>
        <div className="history-search">
          <MagnifyingGlass size={13} />
          <input
            type="search"
            value={historyQuery}
            onChange={(event) => setHistoryQuery(event.target.value)}
            placeholder="搜索历史会议"
            aria-label="搜索历史会议"
          />
          {historyQuery && <button type="button" onClick={() => setHistoryQuery("")} aria-label="清空历史会议搜索"><X size={12} /></button>}
        </div>
        <div className="meeting-list" role="region" aria-label="历史会议列表">
          {visibleMeetings.map((item) => (
            <div className={`history-meeting-row ${selectedId === item.id ? "active" : ""}`} key={item.id}>
              <button
                className={`meeting ${selectedId === item.id ? "active" : ""}`}
                onClick={() => setSelectedId(item.id)}
                aria-label={`查看会议：${item.title}`}
              >
                <span className="meeting-icon">▥</span>
                <span>
                  <strong>{item.title}</strong>
                  <small>{formatMeetingDate(item.startedAt)} · {formatClock(item.durationMs)}</small>
                </span>
              </button>
              <button
                type="button"
                className="meeting-rename"
                onClick={() => beginRenameMeeting(item)}
                disabled={meetingIsBusy(item.status) || processing || recording}
                aria-label={`重命名会议：${item.title}`}
                title="重命名会议"
              >
                <PencilSimple size={14} />
              </button>
            </div>
          ))}
          {!loading && !meetings.length && <p className="no-meetings">还没有会议记录</p>}
          {!loading && Boolean(meetings.length) && !visibleMeetings.length && <p className="no-meetings">没有找到匹配的会议</p>}
        </div>
        <div className="sidebar-bottom">
          <div className="privacy-state"><span>●</span> 本地后台已连接</div>
          {applicationUpdate?.supported && (
            <button
              type="button"
              className={`settings-button update-button status-${applicationUpdate.status}`}
              disabled={recording || processing || applicationUpdate.status === "checking" || applicationUpdate.status === "downloading"}
              onClick={() => void handleApplicationUpdate()}
            >
              {applicationUpdate.status === "available" ? <DownloadSimple size={17} weight="duotone" />
                : applicationUpdate.status === "downloaded" ? <CheckCircle size={17} weight="duotone" />
                : <ArrowClockwise size={17} weight="duotone" />}
              <span>
                <b>{applicationUpdate.status === "available" ? "下载新版本"
                  : applicationUpdate.status === "downloaded" ? "重启并更新"
                  : "版本更新"}</b>
                <small>{applicationUpdate.message}</small>
              </span>
            </button>
          )}
          <button className={`settings-button ${miniMaxSettings?.configured ? "" : "needs-attention"}`} disabled={recording || processing} onClick={() => void openSettingsDialog()}>
            <GearSix size={17} weight="duotone" />
            <span><b>MiniMax 设置</b><small>{miniMaxSettings?.configured ? "密钥已配置" : "配置密钥与模型"}</small></span>
          </button>
          <div className="profile"><span>本</span><p><b>本机工作区</b><small>新会议最多 {speakerLimit} 人</small></p></div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <div className="eyebrow">
              <span className={`status-dot ${meeting?.status === "recording" ? "recording" : ""}`} />
              {meeting ? `${statusLabel(meeting.status)} · ${formatMeetingDate(meeting.startedAt)}` : "准备开始本地听记"}
            </div>
            <h1>{meeting?.title || "拾音 AI 会议听记"}</h1>
            <p>
              {meeting
                ? `${meeting.speakers.length || "待识别"} 位发言人 · 上限 ${meeting.maxSpeakers} 人 · ${formatClock(meeting.durationMs || seconds * 1000)}`
                : "选择录音来源与参会人数，然后开始本地会议听记"}
            </p>
          </div>
          {meeting ? <div className="top-actions">
            <button disabled={recording || processing} onClick={openTemplateDialog}><Compass size={15} /> 模板</button>
            <button disabled={!meeting || processing || meetingIsBusy(meeting.status)} onClick={rerunCorrection}>↻ 重新校正</button>
            <button disabled={!meeting || processing || meetingIsBusy(meeting.status)} onClick={rerunSummary}>✦ 重新总结</button>
            <button disabled={!meeting || processing || meetingIsBusy(meeting?.status)} onClick={() => setTranscriptionDialogOpen(true)}><Waveform size={15} /> 转写版本</button>
            <div className="export-control">
              <button
                className="primary"
                disabled={!meeting || processing || meetingIsBusy(meeting.status)}
                onClick={() => setExportMenuOpen((open) => !open)}
                aria-expanded={exportMenuOpen}
              >⇩ 导出报告</button>
              {exportMenuOpen && (
                <div className="export-menu" role="menu">
                  <button
                    disabled={obsidianSaving}
                    onClick={() => notebookSettings?.obsidianConfigured
                      ? void saveMeetingToObsidian()
                      : void openSettingsDialog()}
                  ><b>{obsidianSaving ? "正在同步…" : notebookSettings?.obsidianConfigured ? "同步到 AI 笔记本" : "连接 AI 笔记本"}</b><span>{notebookSettings?.obsidianConfigured ? `Obsidian · ${notebookSettings.obsidianVaultName || "已连接"}` : "可选连接自己的 Obsidian 知识库"}</span></button>
                  <button onClick={toggleObsidianAutoSave}><b>结束后自动同步</b><span>{obsidianAutoSave ? "已开启 · 后续会议自动保存" : "默认关闭 · 用户可自行开启"}</span></button>
                  <button onClick={exportHtmlReport}><b>网页报告</b><span>适合浏览与打印</span></button>
                  <button onClick={downloadMarkdownReport}><b>Markdown 文件</b><span>适合 AI Agent 分析</span></button>
                  <button onClick={() => void copyMarkdownReport()}><b>复制 Markdown</b><span>直接粘贴给其他 AI</span></button>
                </div>
              )}
            </div>
            <button className="more danger" disabled={!meeting || processing || meetingIsBusy(meeting.status)} onClick={deleteMeeting}>删除</button>
          </div> : (
            <div className="top-actions start-top-actions">
              <button disabled={recording || processing} onClick={openTemplateDialog}><Compass size={15} /> 选择总结模板</button>
            </div>
          )}
        </header>

        <div className={`content-grid ${!meeting ? "start-screen" : view === "summary" ? "report-mode" : ""}`}>
          <article className="main-card">
            {(recording || processing) && (
              <div className={`recording-bar ${processing ? "processing" : ""}`}>
                <span className="pulse" />
                <b>{recording ? `正在听记 ${formatClock(seconds * 1000)}` : "正在后台处理"}</b>
                <small>{recording ? `${connectionStatus} · ${activeDeviceLabel}` : connectionStatus}</small>
                {activeJob
                  ? <div className="job-progress"><i style={{ width: `${activeJob.progress}%` }} /></div>
                  : <div className="wave">▂▅▃▆▄▇▃▅▂▆▃▇</div>}
                {recording && <button onClick={stopRecording}>结束</button>}
              </div>
            )}
            {(liveConfirmedText || liveText) && (
              <div className="live-caption">
                <span>实时</span>
                {liveConfirmedText && <strong>{liveConfirmedText}</strong>}
                {liveText && <em>{liveText}</em>}
              </div>
            )}
            {meeting?.audioPath && (
              <section className="audio-dock" aria-label="原始录音播放器">
                <div className="audio-dock-label">
                  <span><Waveform size={19} weight="duotone" /></span>
                  <p><b>原始录音</b><small>{formatClock(meeting.durationMs)} · 本机保存 · 点击文字时间可回听</small></p>
                </div>
                <audio
                  key={meeting.id}
                  ref={playbackRef}
                  controls
                  preload="metadata"
                  src={`${apiBase}/api/meetings/${encodeURIComponent(meeting.id)}/audio`}
                >
                  当前系统不支持音频播放。
                </audio>
              </section>
            )}
            {!meeting ? (
              <section className="meeting-start-page" aria-labelledby="meeting-start-title">
                <div className="meeting-start-orb" aria-hidden="true">
                  <Waveform size={42} weight="duotone" />
                </div>
                <span className="meeting-start-kicker"><i /> 本地听记已准备就绪</span>
                <h2 id="meeting-start-title">开始一场新的会议</h2>
                <p>录音和转写会保存在这台电脑；会议结束后，再由 MiniMax 自动整理纪要与行动项。</p>
                <button
                  type="button"
                  className="meeting-start-button"
                  disabled={recording || processing}
                  onClick={() => void startRecording()}
                >
                  <span><Waveform size={22} weight="fill" /></span>
                  <strong>{recording ? "正在启动…" : "开始会议"}</strong>
                  <small>
                    {audioSourceMode === "mixed" ? "电脑声音 + 麦克风" : audioSourceMode === "system" ? "电脑声音" : "麦克风"}
                    {` · 最多 ${speakerLimit} 人`}
                  </small>
                </button>
                <div className="meeting-start-features" aria-label="会议处理方式">
                  <span><CheckCircle size={15} weight="fill" /> 本地实时转写</span>
                  <span><HardDrives size={15} weight="duotone" /> 录音保存在本机</span>
                  <span><Sparkle size={15} weight="fill" /> MiniMax 生成纪要</span>
                </div>
                {meetings.length > 0 && <small className="meeting-start-history-hint">需要回看旧内容？请从左侧“历史会议”中选择。</small>}
              </section>
            ) : (
              <>
            <div className="tabs">
              <button className={view === "transcript" ? "active" : ""} onClick={() => setView("transcript")}>完整记录</button>
              <button className={view === "summary" ? "active" : ""} onClick={() => setView("summary")}>AI 总结 <span>✦</span></button>
              <button className={view === "actions" ? "active" : ""} onClick={() => setView("actions")}>行动项 <i>{actions.length}</i></button>
              <label className="search">⌕<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索记录" /></label>
            </div>

            {view === "transcript" && (
              <>
                <div className="transcript-toolbar">
                  <div className="transcript-mode-toggle" aria-label="逐字稿版本">
                    <button className={transcriptMode === "organized" ? "active" : ""} onClick={() => setTranscriptMode("organized")}>整理稿</button>
                    <button className={transcriptMode === "original" ? "active" : ""} onClick={() => setTranscriptMode("original")}>原始记录</button>
                  </div>
                  <div className="transcript-mode-toggle transcript-order-toggle" aria-label="记录排列顺序">
                    <button
                      className={transcriptOrder === "ascending" ? "active" : ""}
                      aria-pressed={transcriptOrder === "ascending"}
                      onClick={() => {
                        setTranscriptOrder("ascending");
                        window.localStorage.setItem("shiyin.transcriptOrder", "ascending");
                      }}
                    >正序</button>
                    <button
                      className={transcriptOrder === "descending" ? "active" : ""}
                      aria-pressed={transcriptOrder === "descending"}
                      onClick={() => {
                        setTranscriptOrder("descending");
                        window.localStorage.setItem("shiyin.transcriptOrder", "descending");
                      }}
                    >倒序</button>
                  </div>
                  <label className="filler-filter-toggle">
                    <input
                      type="checkbox"
                      checked={Boolean(meeting?.fillerFilterEnabled)}
                      disabled={!meeting || transcriptSaving || processing || recording}
                      onChange={() => void toggleFillerFilter()}
                    />
                    <span>过滤“嗯、啊、呃”</span>
                  </label>
                  <button className="replace-trigger" disabled={!meeting || transcriptSaving || processing || recording} onClick={openReplaceDialog}>⌕ 查找与替换</button>
                  {meeting?.canUndoTranscriptEdit && (
                    <button className="undo-replace" disabled={transcriptSaving} onClick={() => void undoTranscriptReplacement()}>↶ 撤销上次替换</button>
                  )}
                  {meeting?.summaryStale && <span className="summary-stale-badge">逐字稿已更新 · 建议重新总结</span>}
                </div>
                <div className="transcript">
                {filteredSegments.map((segment) => {
                  const speaker = segment.speakerId ? speakerMap.get(segment.speakerId) : null;
                  const name = speaker?.displayName || "待确认发言人";
                  const pauseMarker = (segment.pauseAfterMs || 0) >= 1000
                    ? <div className="pause-marker"><span>停顿 {(segment.pauseAfterMs! / 1000).toFixed(1)} 秒</span></div>
                    : null;
                  return (
                    <Fragment key={segment.id}>
                      {transcriptOrder === "descending" && pauseMarker}
                      <div
                        id={`segment-${segment.seq}`}
                        className={`utterance ${highlightedSeq === segment.seq ? "highlighted" : ""}`}
                      >
                        <div className={`avatar ${speaker?.color || "neutral"}`}>{name.slice(0, 1)}</div>
                        <div>
                          <div className="speaker">
                            {speaker
                              ? <button title="点击修改姓名" onClick={() => beginRenameSpeaker(speaker)}>{name}<i>✎</i></button>
                              : <b>{name}</b>}
                            <button
                              className="segment-time"
                              title={`从 ${formatClock(segment.startMs)} 播放原声`}
                              onClick={() => seekToAudio(segment.startMs)}
                            >
                              <Waveform size={12} />{formatClock(segment.startMs)}–{formatClock(segment.endMs)}
                            </button>
                            {segment.source === "corrected" && <em>已校正</em>}
                            {speaker?.autoMatched && <em className="speaker-auto-match">声纹匹配</em>}
                          </div>
                          <p>{displayedSegmentText(segment, transcriptMode)}</p>
                        </div>
                      </div>
                      {transcriptOrder === "ascending" && pauseMarker}
                    </Fragment>
                  );
                })}
                {!filteredSegments.length && (
                  <div className="empty-pane">
                    <span>◉</span>
                    <h2>{meeting ? "暂时没有转写内容" : "开始一场新的会议听记"}</h2>
                    <p>{meeting ? "短录音或无有效语音时可能不会产生文字。" : "录音会持续保存在本机，隐藏窗口也不会中断。"}</p>
                    {!meeting && <button onClick={startRecording}>开始新听记</button>}
                  </div>
                )}
                </div>
              </>
            )}

            {view === "summary" && (
              <div className="summary-pane">
                {meeting?.summaryStale && (
                  <div className="summary-stale-banner" role="status">
                    <span>逐字稿已更新，当前总结仍基于修改前的内容。</span>
                    <button disabled={processing} onClick={rerunSummary}>重新生成总结</button>
                  </div>
                )}
                {usingLiveSummary && (
                  <div className="live-summary-banner" role="status">
                    <span className="live-summary-pulse" aria-hidden="true" />
                    <div>
                      <strong>实时草稿</strong>
                      <p>会议进行中持续更新；结束后会自动生成更完整的正式报告。</p>
                    </div>
                    <time>
                      {liveSummary?.generatedAt
                        ? `更新于 ${new Date(liveSummary.generatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
                        : "正在更新"}
                    </time>
                  </div>
                )}
                {summaryFailed ? (
                  <div className="summary-error-state" role="alert">
                    <WarningCircle size={34} weight="duotone" />
                    <h2>AI 总结生成失败</h2>
                    <p>{summaryFailureMessage}</p>
                    <button disabled={processing} onClick={rerunSummary}>
                      {processing ? "正在重新生成…" : "重新生成 AI 总结"}
                    </button>
                  </div>
                ) : usableSummary ? (
                  meeting?.reportStyle === "visual" ? (
                    <div className="visual-report">
                      <header className="visual-report-hero">
                        <div className="visual-hero-topline">
                          <span><Sparkle size={13} weight="fill" /> MiniMax AI {usingLiveSummary ? "实时草稿" : "图文纪要"}</span>
                          <button onClick={openTemplateDialog}>{summaryTemplateName(meeting?.summaryTemplate || "meeting-minutes")} · 更换模板</button>
                        </div>
                        <h2>{usableSummary.headline || meeting?.title}</h2>
                        <p>{usableSummary.overview}</p>
                        <div className="visual-metrics">
                          <article><Clock size={18} weight="duotone" /><span><strong>{formatClock(meeting?.durationMs || 0)}</strong><small>会议时长</small></span></article>
                          <article><UsersThree size={19} weight="duotone" /><span><strong>{meeting?.speakers.length || 0}</strong><small>位发言人</small></span></article>
                          <article><Target size={18} weight="duotone" /><span><strong>{usableSummary.decisions.length}</strong><small>项关键决策</small></span></article>
                          <article><CheckCircle size={19} weight="duotone" /><span><strong>{actions.length}</strong><small>项行动任务</small></span></article>
                        </div>
                      </header>

                      {!!overviewCards.length && (
                        <section className="visual-section">
                          <div className="visual-section-heading">
                            <div><span>01</span><h3>会议全景</h3></div>
                            <p>从讨论到落地，一屏掌握本次会议</p>
                          </div>
                          <div className="visual-overview-grid">
                            {overviewCards.slice(0, 6).map((card, index) => (
                              <article key={`${card.title}-${index}`}>
                                <header>
                                  <span className={`visual-card-icon tone-${index % 4}`}>
                                    {index % 4 === 0 && <Compass size={18} weight="duotone" />}
                                    {index % 4 === 1 && <Target size={18} weight="duotone" />}
                                    {index % 4 === 2 && <ListChecks size={18} weight="duotone" />}
                                    {index % 4 === 3 && <Brain size={18} weight="duotone" />}
                                  </span>
                                  <h4>{card.title}</h4>
                                  <i>{String(index + 1).padStart(2, "0")}</i>
                                </header>
                                <p>{card.summary}</p>
                                {!!card.points?.length && <ul>{card.points.slice(0, 3).map((point) => <li key={point}>{point}</li>)}</ul>}
                                {!!card.evidenceSeqs?.length && (
                                  <button onClick={() => jumpToEvidence(card.evidenceSeqs[0])}>查看原文 <ArrowRight size={12} /></button>
                                )}
                              </article>
                            ))}
                          </div>
                        </section>
                      )}

                      {!!keyFacts.length && (
                        <section className="visual-section visual-fact-section">
                          <div className="visual-section-heading">
                            <div><span>02</span><h3>关键事实</h3></div>
                            <p>会议中值得记住的数字与条件</p>
                          </div>
                          <div className="visual-fact-grid">
                            {keyFacts.slice(0, 5).map((fact, index) => (
                              <button key={`${fact.label}-${index}`} onClick={() => fact.evidenceSeqs?.[0] !== undefined && jumpToEvidence(fact.evidenceSeqs[0])}>
                                <strong>{fact.value}</strong>
                                <span>{fact.label}</span>
                                <small>{fact.context}</small>
                              </button>
                            ))}
                          </div>
                        </section>
                      )}

                      <section className="visual-section">
                        <div className="visual-section-heading">
                          <div><span>03</span><h3>结论与执行</h3></div>
                          <p>把明确结果与下一步放在同一张看板</p>
                        </div>
                        <div className="visual-execution-grid">
                          <article className="visual-decision-panel">
                            <header><span><Target size={18} weight="duotone" /></span><div><h4>已形成决策</h4><p>{usableSummary.decisions.length} 项明确结论</p></div></header>
                            {usableSummary.decisions.length ? (
                              <ol>{usableSummary.decisions.slice(0, 6).map((item) => <li key={item}>{item}</li>)}</ol>
                            ) : <p className="visual-empty">本次讨论尚未形成明确决策。</p>}
                          </article>
                          <article className="visual-action-panel">
                            <header><span><CheckCircle size={18} weight="duotone" /></span><div><h4>行动任务</h4><p>责任人与时间要求</p></div></header>
                            <div>
                              {actions.slice(0, 6).map((item, index) => (
                                <button key={`${item.task}-${index}`} onClick={() => item.evidenceSeqs?.[0] !== undefined && jumpToEvidence(item.evidenceSeqs[0])}>
                                  <span>{item.owner.slice(0, 1)}</span>
                                  <p><b>{item.task}</b><small>{item.owner} · {item.due || "待确定"}</small></p>
                                  <i className={`priority ${item.priority || "中"}`}>{item.priority || "中"}</i>
                                </button>
                              ))}
                              {!actions.length && <p className="visual-empty">未识别到明确行动项。</p>}
                            </div>
                          </article>
                        </div>
                      </section>

                      <section className="visual-section visual-bottom-grid">
                        <article className="visual-risk-panel">
                          <header><WarningCircle size={19} weight="duotone" /><div><h3>风险与待确认</h3><p>需要继续追踪的信息缺口</p></div></header>
                          {usableSummary.risks.length ? (
                            <ul>{usableSummary.risks.slice(0, 6).map((item) => <li key={item}>{item}</li>)}</ul>
                          ) : <p className="visual-empty">暂未识别到明显风险。</p>}
                        </article>
                        <article className="visual-chapter-panel">
                          <header><PushPin size={19} weight="duotone" /><div><h3>会议章节</h3><p>点击时间可定位原声</p></div></header>
                          <div>
                            {chapters.slice(0, 6).map((chapter, index) => (
                              <button key={`${chapter.title}-${index}`} onClick={() => seekToAudio(chapter.startMs)}>
                                <time>{formatClock(chapter.startMs)}</time>
                                <span><b>{chapter.title}</b><small>{chapter.summary}</small></span>
                                <ArrowRight size={13} />
                              </button>
                            ))}
                          </div>
                        </article>
                      </section>
                    </div>
                  ) : (
                  <div className="report-page">
                    <header className="report-hero">
                      <div className="ai-label"><Sparkle size={14} weight="fill" /> MiniMax AI {usingLiveSummary ? "实时草稿" : "深度纪要"}</div>
                      <h2>{usableSummary.headline || usableSummary.overview}</h2>
                      <p className="report-overview">{usableSummary.overview}</p>
                      <div className="report-meta">
                        <span><Clock size={14} />{formatClock(meeting?.durationMs || 0)}</span>
                        <span><UsersThree size={15} />{meeting?.speakers.length || 0} 位发言人</span>
                        <span><Quotes size={15} />{meeting?.segments.length || 0} 段有效发言</span>
                      </div>
                      <div className="report-stats">
                        <div><strong>{chapters.length || usableSummary.topics.length}</strong><span>讨论章节</span></div>
                        <div><strong>{usableSummary.decisions.length}</strong><span>关键决策</span></div>
                        <div><strong>{actions.length}</strong><span>行动任务</span></div>
                        <div><strong>{usableSummary.risks.length}</strong><span>风险待确认</span></div>
                      </div>
                    </header>

                    {!!overviewCards.length && (
                      <section className="report-section report-map-section">
                        <div className="report-section-heading">
                          <span className="section-icon map"><Compass size={18} weight="duotone" /></span>
                          <div><h3>会议总览</h3><p>一页掌握本次会议的核心版图</p></div>
                        </div>
                        <div className="overview-map-grid">
                          {overviewCards.map((card, index) => (
                            <article key={`${card.title}-${index}`}>
                              <div className="overview-card-number">{String(index + 1).padStart(2, "0")}</div>
                              <div>
                                <h4>{card.title}</h4>
                                <p>{card.summary}</p>
                                {!!card.points?.length && (
                                  <ul>{card.points.map((point) => <li key={point}>{point}</li>)}</ul>
                                )}
                                {!!card.evidenceSeqs?.length && (
                                  <div className="evidence-links">
                                    {card.evidenceSeqs.slice(0, 3).map((seq) => (
                                      <button key={seq} onClick={() => jumpToEvidence(seq)}>原文 #{seq}<ArrowRight size={12} /></button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </article>
                          ))}
                        </div>
                      </section>
                    )}

                    {!!usableSummary.meetingBackground && (
                      <section className="report-section">
                        <div className="report-section-heading">
                          <span className="section-icon background"><Flag size={18} weight="duotone" /></span>
                          <div><h3>会议背景</h3><p>为什么召开，以及希望解决什么问题</p></div>
                        </div>
                        <p className="meeting-background">{usableSummary.meetingBackground}</p>
                      </section>
                    )}

                    {!!keyFacts.length && (
                      <section className="report-section">
                        <div className="report-section-heading">
                          <span className="section-icon facts"><ChartBar size={18} weight="duotone" /></span>
                          <div><h3>关键数字与事实</h3><p>会议中出现的重要量化信息</p></div>
                        </div>
                        <div className="key-fact-grid">
                          {keyFacts.map((fact, index) => (
                            <article key={`${fact.label}-${index}`}>
                              <strong>{fact.value}</strong>
                              <h4>{fact.label}</h4>
                              <p>{fact.context}</p>
                              {!!fact.evidenceSeqs?.length && (
                                <button onClick={() => jumpToEvidence(fact.evidenceSeqs[0])}>查看原文 <ArrowRight size={11} /></button>
                              )}
                            </article>
                          ))}
                        </div>
                      </section>
                    )}

                    {!!usableSummary.decisions.length && (
                      <section className="report-section">
                        <div className="report-section-heading">
                          <span className="section-icon decision"><Target size={17} weight="duotone" /></span>
                          <div><h3>关键决策</h3><p>会议中已形成的明确结论</p></div>
                        </div>
                        <div className="decision-list">
                          {usableSummary.decisions.map((item, index) => (
                            <article key={`${item}-${index}`}>
                              <span>{String(index + 1).padStart(2, "0")}</span>
                              <p>{item}</p>
                            </article>
                          ))}
                        </div>
                      </section>
                    )}

                    {!!detailedTopics.length && (
                      <section className="report-section">
                        <div className="report-section-heading">
                          <span className="section-icon details"><ListChecks size={18} weight="duotone" /></span>
                          <div><h3>详细议题</h3><p>保留方案、数字、案例、理由与约束条件</p></div>
                        </div>
                        <div className="detailed-topic-list">
                          {detailedTopics.map((topic, index) => (
                            <article key={`${topic.title}-${index}`}>
                              <div className="detail-topic-number">{String(index + 1).padStart(2, "0")}</div>
                              <div className="detail-topic-body">
                                <h4>{topic.title}</h4>
                                <p>{topic.summary}</p>
                                {!!topic.points?.length && (
                                  <ul>{topic.points.map((point) => <li key={point}>{point}</li>)}</ul>
                                )}
                                {!!topic.conclusion && <aside><b>形成结论</b><span>{topic.conclusion}</span></aside>}
                                {!!topic.evidenceSeqs?.length && (
                                  <div className="evidence-links">
                                    {topic.evidenceSeqs.slice(0, 4).map((seq) => (
                                      <button key={seq} onClick={() => jumpToEvidence(seq)}>原文 #{seq}<ArrowRight size={12} /></button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </article>
                          ))}
                        </div>
                      </section>
                    )}

                    {!!aiInsights.length && (
                      <section className="report-section">
                        <div className="report-section-heading">
                          <span className="section-icon ai-insights"><Brain size={18} weight="duotone" /></span>
                          <div><h3>AI 洞察</h3><p>基于会议事实的跨议题归纳，不等同于参会者原话</p></div>
                        </div>
                        <div className="ai-insight-grid">
                          {aiInsights.map((insight, index) => (
                            <article key={`${insight.title}-${index}`}>
                              <header><h4>{insight.title}</h4><span className={`confidence ${insight.confidence}`}>{insight.confidence}可信度</span></header>
                              <p>{insight.insight}</p>
                              {!!insight.basis && <aside><b>判断依据</b>{insight.basis}</aside>}
                              {!!insight.evidenceSeqs?.length && (
                                <div className="evidence-links">
                                  {insight.evidenceSeqs.slice(0, 3).map((seq) => (
                                    <button key={seq} onClick={() => jumpToEvidence(seq)}>原文 #{seq}<ArrowRight size={12} /></button>
                                  ))}
                                </div>
                              )}
                            </article>
                          ))}
                        </div>
                      </section>
                    )}

                    <section className="report-section">
                      <div className="report-section-heading">
                        <span className="section-icon actions"><CheckCircle size={18} weight="duotone" /></span>
                        <div><h3>行动项</h3><p>责任人、任务与时间要求</p></div>
                      </div>
                      {actions.length ? (
                        <div className="report-action-table">
                          <div className="report-action-head"><span>责任人</span><span>任务</span><span>截止时间</span><span>优先级</span><span /></div>
                          {actions.map((item, index) => (
                            <div className="report-action-item" key={`${item.task}-${index}`}>
                              <div className="action-owner"><i>{item.owner.slice(0, 1)}</i><b>{item.owner}</b></div>
                              <p>{item.task}</p>
                              <time>{item.due || "待确定"}</time>
                              <span className={`priority ${item.priority || "中"}`}>{item.priority || "中"}</span>
                              <div className="evidence-links compact">
                                {item.evidenceSeqs?.slice(0, 1).map((seq) => (
                                  <button key={seq} onClick={() => jumpToEvidence(seq)}>原文 <ArrowRight size={12} /></button>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : <p className="report-empty">未识别到明确行动项。</p>}
                    </section>

                    {!!speakerStats.length && (
                      <section className="report-section">
                        <div className="report-section-heading">
                          <span className="section-icon speakers"><UsersThree size={18} weight="duotone" /></span>
                          <div><h3>发言人贡献</h3><p>结合发言时长与内容提炼各自关注点</p></div>
                        </div>
                        <div className="speaker-contribution-grid">
                          {speakerStats.map((speaker) => (
                            <article key={speaker.id}>
                              <div className="speaker-card-head">
                                <span className={`avatar ${speaker.color}`}>{speaker.displayName.slice(0, 1)}</span>
                                <div><h4>{speaker.displayName}</h4><p>{speaker.turns} 次发言 · 约占 {speaker.share}%</p></div>
                                <strong>{formatClock(speaker.durationMs)}</strong>
                              </div>
                              <p className="speaker-contribution">
                                {speaker.insight?.contribution || "参与了会议讨论，详细观点可在完整记录中查看。"}
                              </p>
                              {!!speaker.insight?.keyPoints?.length && (
                                <ul>{speaker.insight.keyPoints.slice(0, 3).map((point) => <li key={point}>{point}</li>)}</ul>
                              )}
                              {!!speaker.insight?.evidenceSeqs?.length && (
                                <div className="evidence-links">
                                  {speaker.insight.evidenceSeqs.slice(0, 3).map((seq) => (
                                    <button key={seq} onClick={() => jumpToEvidence(seq)}>原文 #{seq}<ArrowRight size={12} /></button>
                                  ))}
                                </div>
                              )}
                            </article>
                          ))}
                        </div>
                      </section>
                    )}

                    {!!notableMoments.length && (
                      <section className="report-section">
                        <div className="report-section-heading">
                          <span className="section-icon moments"><Quotes size={18} weight="duotone" /></span>
                          <div><h3>值得回看的发言</h3><p>关键观点与代表性表达</p></div>
                        </div>
                        <div className="notable-grid">
                          {notableMoments.map((moment, index) => (
                            <article key={`${moment.evidenceSeq}-${index}`}>
                              <Quotes size={23} weight="fill" />
                              <blockquote>{moment.text}</blockquote>
                              <footer>
                                <span>{moment.speaker} · {formatClock(moment.timeMs)}</span>
                                <button onClick={() => jumpToEvidence(moment.evidenceSeq)}>定位原文 <ArrowRight size={12} /></button>
                              </footer>
                              <p>{moment.reason}</p>
                            </article>
                          ))}
                        </div>
                      </section>
                    )}

                    {!!chapters.length && (
                      <section className="report-section">
                        <div className="report-section-heading">
                          <span className="section-icon chapters"><PushPin size={18} weight="duotone" /></span>
                          <div><h3>章节时间轴</h3><p>按时间还原会议推进过程，可定位原文</p></div>
                        </div>
                        <div className="chapter-timeline">
                          {chapters.map((chapter, index) => (
                            <article className="chapter-item" key={`${chapter.title}-${index}`}>
                              <div className="chapter-time">
                                <b>{formatClock(chapter.startMs)}</b>
                                <span>{formatClock(chapter.endMs)}</span>
                              </div>
                              <div className="chapter-body">
                                <div className="chapter-title"><i>{index + 1}</i><h4>{chapter.title}</h4></div>
                                <p>{chapter.summary}</p>
                                {!!chapter.highlights?.length && (
                                  <ul>{chapter.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}</ul>
                                )}
                                {!!chapter.evidenceSeqs?.length && (
                                  <div className="evidence-links">
                                    {chapter.evidenceSeqs.slice(0, 4).map((seq) => (
                                      <button key={seq} onClick={() => jumpToEvidence(seq)}>
                                        原文 #{seq}<ArrowRight size={12} />
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </article>
                          ))}
                        </div>
                      </section>
                    )}

                    {!!usableSummary.risks.length && (
                      <section className="report-section">
                        <div className="report-section-heading">
                          <span className="section-icon risks"><WarningCircle size={18} weight="duotone" /></span>
                          <div><h3>风险与待确认</h3><p>尚未闭环的问题和信息缺口</p></div>
                        </div>
                        <div className="risk-list">
                          {usableSummary.risks.map((item) => (
                            <article key={item}><WarningCircle size={17} /><p>{item}</p></article>
                          ))}
                        </div>
                      </section>
                    )}

                    {!!usableSummary.topics.length && (
                      <section className="report-section report-topics">
                        <div className="report-section-heading">
                          <span className="section-icon topics"><Sparkle size={17} weight="duotone" /></span>
                          <div><h3>主题与关键词</h3><p>便于检索和后续归档</p></div>
                        </div>
                        <div className="topic-tags">
                          {[...usableSummary.topics, ...(usableSummary.keywords || [])]
                            .filter((item, index, items) => items.indexOf(item) === index)
                            .map((topic) => <span key={topic}>{topic}</span>)}
                        </div>
                      </section>
                    )}
                  </div>
                  )
                ) : (
                  <div className="empty-summary">
                    <Sparkle size={28} weight="duotone" />
                    <h2>{meeting?.status === "recording" ? "正在等待首份实时草稿" : "尚未生成总结"}</h2>
                    <p>
                      {meeting?.status === "recording"
                        ? "录音约 30 秒后开始生成，并随会议内容持续更新。"
                        : meeting?.status === "summarizing"
                          ? "MiniMax 正在流式生成正式报告，请稍候。"
                          : "结束听记后，会直接用 MiniMax 生成完整会议报告；发言人校正可按需手动运行。"}
                    </p>
                    {!miniMaxSettings?.configured && meeting?.status !== "recording" && (
                      <button className="empty-summary-configure" onClick={() => void openSettingsDialog()}>
                        配置 MiniMax 并生成总结
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {view === "actions" && (
              <div className="action-pane">
                <div className="action-heading"><div><h2>行动项</h2><p>AI 从校正后的会议记录中识别出 {actions.length} 项任务</p></div></div>
                {actions.map((item, index) => (
                  <label className={`action-row ${completedActions.has(index) ? "done" : ""}`} key={`${item.task}-${index}`}>
                    <input
                      type="checkbox"
                      checked={completedActions.has(index)}
                      onChange={() => setCompletedActions((current) => {
                        const next = new Set(current);
                        if (next.has(index)) next.delete(index); else next.add(index);
                        return next;
                      })}
                    />
                    <span className="checkmark">✓</span>
                    <p><b>{item.task}</b><small><i>{item.owner.slice(0, 1)}</i>{item.owner}</small></p>
                    <time>{item.due}</time>
                  </label>
                ))}
                {!actions.length && <div className="empty-summary"><h2>暂无行动项</h2><p>AI 总结完成后，识别到的责任人、任务和截止时间会显示在这里。</p></div>}
              </div>
            )}
              </>
            )}
          </article>

          {meeting && <aside className="insight-card">
            <div className="insight-title"><span>✦</span><div><h2>会议速览</h2><p>{usingLiveSummary ? "本地转写 · MiniMax 实时草稿" : "本地转写 · MiniMax 总结"}</p></div><button disabled={!meeting || processing || meetingIsBusy(meeting.status)} onClick={rerunSummary} aria-label="重新生成总结">↻</button></div>
            <div className="metric-row">
              <div><strong>{Math.ceil((meeting?.durationMs || 0) / 60000)}<small>分钟</small></strong><span>会议时长</span></div>
              <div><strong>{meeting?.speakers.length || 0}<small>位</small></strong><span>识别发言人</span></div>
              <div><strong>{actions.length}<small>项</small></strong><span>行动任务</span></div>
            </div>
            <div className={`insight-section ${summaryFailed ? "summary-warning" : ""}`}>
              <h3>{summaryFailed ? "总结状态" : "一句话总结"}</h3>
              <p>{summaryFailed ? summaryFailureMessage : usableSummary?.overview || (meeting?.status === "recording" ? "录音约 30 秒后出现实时草稿。" : "结束听记后自动生成。")}</p>
            </div>
            <div className="insight-section"><h3>讨论主题</h3><div className="tags">{(usableSummary?.topics || []).map((topic) => <span key={topic}>{topic}</span>)}{!usableSummary?.topics?.length && <span>{summaryFailed ? "等待重新生成" : "等待总结"}</span>}</div></div>
            <div className="insight-section">
              <h3>发言人</h3>
              <div className="speaker-list">
                {(meeting?.speakers || []).map((speaker) => (
                  <button key={speaker.id} onClick={() => beginRenameSpeaker(speaker)}>
                    <i className={`avatar ${speaker.color}`}>{speaker.displayName.slice(0, 1)}</i>
                    <span>{speaker.displayName}<small>{speaker.manuallyNamed ? "已确认并记住" : speaker.autoMatched ? "本机声纹自动匹配" : "点击重命名"}</small></span>
                  </button>
                ))}
                {!meeting?.speakers.length && <p>有效语音出现后自动编号</p>}
              </div>
            </div>
            <button className="open-summary" onClick={() => summaryFailed ? rerunSummary() : setView("summary")}>
              {summaryFailed ? "重新生成 AI 总结" : usingLiveSummary ? "查看实时草稿" : "查看完整 AI 总结"} <span>→</span>
            </button>
          </aside>}
        </div>
      </section>
      {storageDialogOpen && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !storageCleaning && !backupBusy) setStorageDialogOpen(false);
          }}
        >
          <section
            className="settings-dialog storage-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="storage-dialog-title"
            onKeyDown={(event) => {
              if (event.key === "Escape" && !storageCleaning && !backupBusy) setStorageDialogOpen(false);
            }}
          >
            <div className="settings-dialog-heading">
              <span><HardDrives size={21} weight="duotone" /></span>
              <div>
                <h2 id="storage-dialog-title">本机存储</h2>
                <p>录音、逐字稿和声纹数据只保存在这台电脑。</p>
              </div>
              <button type="button" onClick={() => setStorageDialogOpen(false)} disabled={storageCleaning || Boolean(backupBusy)} aria-label="关闭本机存储">
                <X size={17} />
              </button>
            </div>
            {storageLoading ? (
              <div className="storage-loading">正在统计本机数据…</div>
            ) : storageInfo ? (
              <>
                <div className="storage-total">
                  <span>当前占用</span>
                  <strong>{formatBytes(storageInfo.totalBytes)}</strong>
                  <small>{storageInfo.meetingCount} 场会议 · 数据库 {formatBytes(storageInfo.databaseBytes)}</small>
                </div>
                <div className="storage-metrics">
                  <article><span>会议录音</span><b>{formatBytes(storageInfo.recordingsBytes)}</b></article>
                  <article><span>可清理临时文件</span><b>{formatBytes(storageInfo.temporaryBytes)}</b></article>
                </div>
                <div className="storage-safety-note">
                  <CheckCircle size={17} weight="fill" />
                  <p>
                    <b>{storageInfo.interruptedCount ? `${storageInfo.interruptedCount} 场会议等待恢复` : "异常恢复已开启"}</b>
                    <span>应用意外退出时，会在下次启动后尽量找回未完成的录音。</span>
                  </p>
                </div>
                <div className="storage-backup-card">
                  <div>
                    <b>完整数据备份</b>
                    <span>保存录音、逐字稿、总结、发言人声纹库与转写版本；不包含 MiniMax 密钥。</span>
                  </div>
                  <div>
                    <button type="button" onClick={() => void createBackup()} disabled={Boolean(backupBusy) || recording || processing}>
                      {backupBusy === "create" ? "正在备份…" : "创建备份"}
                    </button>
                    <button type="button" onClick={() => void restoreBackup()} disabled={Boolean(backupBusy) || recording || processing}>
                      {backupBusy === "restore" ? "正在校验…" : "从备份恢复"}
                    </button>
                  </div>
                </div>
                <div className="storage-path">
                  <span>数据位置</span>
                  <code>{storageInfo.dataRoot}</code>
                </div>
                <p className="storage-clean-hint">清理只会删除已经转换完成的重复临时音频，不会删除会议、录音或逐字稿。</p>
              </>
            ) : null}
            {storageError && <p className="settings-error"><WarningCircle size={14} />{storageError}</p>}
            <div className="settings-dialog-actions storage-actions">
              <button type="button" onClick={() => void openDataFolder()} disabled={storageLoading || storageCleaning || Boolean(backupBusy)}>
                <FolderOpen size={15} /> 打开数据文件夹
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => void cleanupStorage()}
                disabled={storageLoading || storageCleaning || Boolean(backupBusy) || !storageInfo?.temporaryBytes || recording}
              >
                <Trash size={15} /> {storageCleaning ? "正在清理…" : "清理临时文件"}
              </button>
            </div>
          </section>
        </div>
      )}
      {transcriptionDialogOpen && meeting && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !retranscriptionStarting && !versionRestoringId) {
              setTranscriptionDialogOpen(false);
            }
          }}
        >
          <section
            className="settings-dialog transcript-version-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="transcript-version-title"
            onKeyDown={(event) => {
              if (event.key === "Escape" && !retranscriptionStarting && !versionRestoringId) {
                setTranscriptionDialogOpen(false);
              }
            }}
          >
            <div className="settings-dialog-heading">
              <span><Waveform size={21} weight="duotone" /></span>
              <div>
                <h2 id="transcript-version-title">转写版本</h2>
                <p>用原始录音重新测试本地模型，旧逐字稿始终保留。</p>
              </div>
              <button type="button" onClick={() => setTranscriptionDialogOpen(false)} disabled={retranscriptionStarting || Boolean(versionRestoringId)} aria-label="关闭转写版本">
                <X size={17} />
              </button>
            </div>
            <div className="retranscription-card">
              <div>
                <b>重新转写这场会议</b>
                <span>全程在本机运行，不使用云端额度。长会议可能需要等待几分钟。</span>
              </div>
              <button
                type="button"
                className="primary"
                onClick={() => void startHistoricalRetranscription()}
                disabled={!meeting.audioPath || retranscriptionStarting || Boolean(versionRestoringId)}
              >
                {retranscriptionStarting ? "正在启动…" : "开始重新转写"}
              </button>
            </div>
            <div className="transcript-version-heading">
              <b>历史版本</b>
              <span>{meeting.transcriptVersions.length} 个安全快照</span>
            </div>
            <div className="transcript-version-list">
              {meeting.transcriptVersions.map((version) => {
                const active = meeting.activeTranscriptVersionId === version.id;
                return (
                  <article className={active ? "active" : ""} key={version.id}>
                    <span><Clock size={16} weight="duotone" /></span>
                    <div>
                      <b>{version.label}{active ? " · 当前" : ""}</b>
                      <small>{formatMeetingDate(version.createdAt)} · {version.segmentCount} 段 · {version.engine}</small>
                    </div>
                    <button
                      type="button"
                      disabled={active || Boolean(versionRestoringId) || retranscriptionStarting}
                      onClick={() => void restoreTranscriptVersion(version)}
                    >
                      {versionRestoringId === version.id ? "正在切换…" : active ? "当前版本" : "切换到此版本"}
                    </button>
                  </article>
                );
              })}
              {!meeting.transcriptVersions.length && (
                <p>还没有历史版本。首次重新转写时，会先自动保存当前逐字稿。</p>
              )}
            </div>
          </section>
        </div>
      )}
      {settingsDialogOpen && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !settingsSaving) setSettingsDialogOpen(false);
          }}
        >
          <form
            className="settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-dialog-title"
            onSubmit={(event) => {
              event.preventDefault();
              void saveSettings();
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !settingsSaving) setSettingsDialogOpen(false);
            }}
          >
            <div className="settings-dialog-heading">
              <span><Key size={21} weight="duotone" /></span>
              <div>
                <h2 id="settings-dialog-title">MiniMax 设置</h2>
                <p>密钥只保存在当前电脑，不会写进安装包。</p>
              </div>
              <button type="button" onClick={() => setSettingsDialogOpen(false)} disabled={settingsSaving} aria-label="关闭设置">
                <X size={17} />
              </button>
            </div>
            <label htmlFor="minimax-api-key">MiniMax API Key</label>
            <input
              id="minimax-api-key"
              type="password"
              autoFocus
              autoComplete="off"
              value={miniMaxKeyDraft}
              disabled={!miniMaxSettings?.managedByApp || settingsSaving}
              onChange={(event) => setMiniMaxKeyDraft(event.target.value)}
              placeholder={miniMaxSettings?.configured ? "留空可保留当前密钥" : "请输入你的 MiniMax API Key"}
            />
            <label htmlFor="minimax-model">模型</label>
            <input
              id="minimax-model"
              value={miniMaxModelDraft}
              disabled={!miniMaxSettings?.managedByApp || settingsSaving}
              onChange={(event) => setMiniMaxModelDraft(event.target.value)}
              placeholder="MiniMax-M3"
            />
            {settingsError && <p className="settings-error"><WarningCircle size={14} />{settingsError}</p>}
            <div className="settings-security-note">
              <CheckCircle size={17} weight="fill" />
              <p>
                <b>{miniMaxSettings?.configured ? "密钥已配置" : "等待配置密钥"}</b>
                <span>{miniMaxSettings?.managedByApp
                  ? "保存后由当前系统安全加密，并自动重启应用使配置生效。"
                  : "开发版继续使用项目中的 .env.local；安装版可在这里直接配置。"}</span>
              </p>
            </div>
            <div className="notebook-settings-card">
              <div>
                <b>AI 笔记本 <em>可选</em></b>
                <span>{notebookSettings?.obsidianConfigured
                  ? `已连接 Obsidian：${notebookSettings.obsidianVaultName || "当前 Vault"}`
                  : "可连接自己的 Obsidian；未连接时不会自动同步或弹出错误。"}</span>
              </div>
              <button type="button" onClick={() => void connectNotebook()} disabled={notebookConnecting || settingsSaving}>
                {notebookConnecting ? "正在选择…" : notebookSettings?.obsidianConfigured ? "更换" : "连接 Obsidian"}
              </button>
              <label>
                <input
                  type="checkbox"
                  checked={obsidianAutoSave}
                  disabled={!notebookSettings?.obsidianConfigured}
                  onChange={toggleObsidianAutoSave}
                />
                会议结束后自动同步
              </label>
            </div>
            <div className="settings-dialog-actions">
              <button type="button" onClick={() => setSettingsDialogOpen(false)} disabled={settingsSaving}>取消</button>
              <button className="primary" type="submit" disabled={!miniMaxSettings?.managedByApp || settingsSaving}>
                {settingsSaving ? "正在保存…" : "保存并立即生效"}
              </button>
            </div>
          </form>
        </div>
      )}
      {templateDialogOpen && (
        <div
          className="dialog-backdrop template-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setTemplateDialogOpen(false);
          }}
        >
          <section
            className="template-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="template-dialog-title"
            onKeyDown={(event) => {
              if (event.key === "Escape") setTemplateDialogOpen(false);
            }}
          >
            <header className="template-dialog-heading">
              <div>
                <span className="template-eyebrow"><Sparkle size={13} weight="fill" /> MiniMax 总结方式</span>
                <h2 id="template-dialog-title">这次想怎么整理？</h2>
                <p>{meeting ? "内容模板会影响 AI 的提炼重点；展示样式可随时切换。" : "设置会用于下一场听记，之后仍可重新选择。"}</p>
              </div>
              <button autoFocus className="template-close" onClick={() => setTemplateDialogOpen(false)} aria-label="关闭模板选择">
                <X size={18} />
              </button>
            </header>

            <div className="template-dialog-section">
              <div className="template-section-title">
                <div><h3>内容模板</h3><p>选择 MiniMax 分析会议时关注的重点</p></div>
                <span>切换后重新生成</span>
              </div>
              <div className="template-card-grid">
                {summaryTemplates.map((template) => {
                  const selected = templateDraft === template.id;
                  return (
                    <button
                      key={template.id}
                      className={`template-card ${template.accent} ${selected ? "selected" : ""}`}
                      aria-pressed={selected}
                      onClick={() => setTemplateDraft(template.id)}
                    >
                      <span className="template-card-icon">{summaryTemplateIcon(template.id, 22)}</span>
                      <span><b>{template.name}</b><small>{template.description}</small></span>
                      {selected && <CheckCircle className="template-check" size={20} weight="fill" />}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="template-dialog-section">
              <div className="template-section-title">
                <div><h3>报告样式</h3><p>同一份结构化内容，用不同方式呈现</p></div>
                <span>切换不消耗额度</span>
              </div>
              <div className="report-style-grid">
                <button
                  className={reportStyleDraft === "detailed" ? "selected" : ""}
                  aria-pressed={reportStyleDraft === "detailed"}
                  onClick={() => setReportStyleDraft("detailed")}
                >
                  <span className="style-preview detailed"><ListChecks size={28} weight="duotone" /></span>
                  <span><b>深度纪要</b><small>完整展开议题、原文证据与时间轴</small></span>
                  {reportStyleDraft === "detailed" && <CheckCircle size={20} weight="fill" />}
                </button>
                <button
                  className={reportStyleDraft === "visual" ? "selected" : ""}
                  aria-pressed={reportStyleDraft === "visual"}
                  onClick={() => setReportStyleDraft("visual")}
                >
                  <span className="style-preview visual"><ChartBar size={28} weight="duotone" /></span>
                  <span><b>图文纪要</b><small>看板化呈现重点、数据、任务与风险</small></span>
                  {reportStyleDraft === "visual" && <CheckCircle size={20} weight="fill" />}
                </button>
              </div>
            </div>

            <footer className="template-dialog-footer">
              <p>
                {meeting && meeting.summaryTemplate !== templateDraft
                  ? `将以“${summaryTemplateName(templateDraft)}”提示词重新调用 MiniMax`
                  : "当前选择只改变展示，不会重复生成内容"}
              </p>
              <div>
                <button onClick={() => setTemplateDialogOpen(false)}>取消</button>
                <button className="primary" onClick={() => void applyTemplateSettings()}>
                  {meeting && meeting.summaryTemplate !== templateDraft ? "应用并重新生成" : "保存设置"}
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}
      {renamingSpeaker && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setRenamingSpeaker(null);
          }}
        >
          <form
            className="rename-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-speaker-title"
            onSubmit={(event) => {
              event.preventDefault();
              void saveSpeakerName();
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") setRenamingSpeaker(null);
            }}
          >
            <div className="rename-dialog-heading">
              <span><UsersThree size={20} weight="duotone" /></span>
              <div>
                <h2 id="rename-speaker-title">修改发言人姓名</h2>
                <p>{renamingSpeaker.autoMatched ? "当前姓名由本机声纹库匹配；如有误可直接修改。" : "保存后会记住声纹，下次会议可自动匹配。"}</p>
              </div>
            </div>
            <label htmlFor="speaker-name">发言人姓名</label>
            <input
              id="speaker-name"
              autoFocus
              maxLength={32}
              value={speakerNameDraft}
              onChange={(event) => setSpeakerNameDraft(event.target.value)}
              placeholder="例如：王工、产品负责人"
            />
            <div className="rename-dialog-actions">
              <button type="button" onClick={() => setRenamingSpeaker(null)}>取消</button>
              <button className="primary" type="submit" disabled={!speakerNameDraft.trim()}>保存名称</button>
            </div>
          </form>
        </div>
      )}
      {renamingMeeting && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !meetingRenameSaving) setRenamingMeeting(null);
          }}
        >
          <form
            className="rename-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-meeting-title"
            onSubmit={(event) => {
              event.preventDefault();
              void saveMeetingTitle();
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !meetingRenameSaving) setRenamingMeeting(null);
            }}
          >
            <div className="rename-dialog-heading">
              <span><PencilSimple size={20} weight="duotone" /></span>
              <div>
                <h2 id="rename-meeting-title">重命名会议</h2>
                <p>{formatMeetingDate(renamingMeeting.startedAt)} · {formatClock(renamingMeeting.durationMs)}</p>
              </div>
            </div>
            <label htmlFor="meeting-title">会议名称</label>
            <input
              id="meeting-title"
              autoFocus
              maxLength={80}
              value={meetingTitleDraft}
              disabled={meetingRenameSaving}
              onChange={(event) => {
                setMeetingTitleDraft(event.target.value);
                setMeetingRenameError("");
              }}
              placeholder="例如：产品设计周会"
            />
            {meetingRenameError && <p className="rename-dialog-error"><WarningCircle size={14} />{meetingRenameError}</p>}
            <div className="rename-dialog-actions">
              <button type="button" onClick={() => setRenamingMeeting(null)} disabled={meetingRenameSaving}>取消</button>
              <button className="primary" type="submit" disabled={!meetingTitleDraft.trim() || meetingRenameSaving}>
                {meetingRenameSaving ? "正在保存…" : "保存名称"}
              </button>
            </div>
          </form>
        </div>
      )}
      {replaceDialogOpen && meeting && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !transcriptSaving) setReplaceDialogOpen(false);
          }}
        >
          <form
            className="replace-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="replace-dialog-title"
            onSubmit={(event) => {
              event.preventDefault();
              void applyTranscriptReplacement();
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !transcriptSaving) setReplaceDialogOpen(false);
            }}
          >
            <header className="replace-dialog-heading">
              <div>
                <span>⌕</span>
                <div><h2 id="replace-dialog-title">查找与全局替换</h2><p>只修改整理稿，原始识别文本始终保留。</p></div>
              </div>
              <button type="button" onClick={() => setReplaceDialogOpen(false)} disabled={transcriptSaving} aria-label="关闭查找与替换"><X size={17} /></button>
            </header>
            <div className="replace-fields">
              <label><span>查找</span><input autoFocus value={replaceFind} onChange={(event) => setReplaceFind(event.target.value)} placeholder="例如：破丝" /></label>
              <label><span>替换为</span><input value={replaceWith} onChange={(event) => setReplaceWith(event.target.value)} placeholder="例如：POS（留空表示删除）" /></label>
            </div>
            <div className="replace-options">
              <label><input type="checkbox" checked={replaceCaseSensitive} onChange={(event) => setReplaceCaseSensitive(event.target.checked)} /> 区分大小写</label>
              <label><input type="checkbox" checked={replaceWholeWord} onChange={(event) => setReplaceWholeWord(event.target.checked)} /> 英文整词匹配</label>
              <span>{replacementPreview.count} 处匹配 · {replacementPreview.segments.length} 段记录</span>
            </div>
            <div className="replace-preview">
              {replacementPreview.segments.slice(0, 6).map(({ segment, count, next }) => (
                <article key={segment.id}>
                  <header><time>{formatClock(segment.startMs)}</time><span>{count} 处</span></header>
                  <p>{segment.text}</p>
                  <p className="replacement-result">→ {next}</p>
                </article>
              ))}
              {!replacementPreview.count && <div className="replace-empty">{replaceFind.trim() ? "当前整理稿中没有匹配内容" : "输入简称、产品名或专业术语即可预览"}</div>}
              {replacementPreview.segments.length > 6 && <small>另有 {replacementPreview.segments.length - 6} 段匹配，将一并替换。</small>}
            </div>
            <footer className="replace-dialog-actions">
              <p>替换后旧的 AI 总结会标记为待更新，可手动重新生成。</p>
              <div>
                <button type="button" onClick={() => setReplaceDialogOpen(false)} disabled={transcriptSaving}>取消</button>
                <button className="primary" type="submit" disabled={!replaceFind.trim() || !replacementPreview.count || transcriptSaving}>
                  {transcriptSaving ? "正在替换…" : `全部替换 ${replacementPreview.count} 处`}
                </button>
              </div>
            </footer>
          </form>
        </div>
      )}
      {notice && <button className="toast" onClick={() => setNotice("")}>{notice}<i>×</i></button>}
    </main>
  );
}
