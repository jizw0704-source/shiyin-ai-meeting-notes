"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowClockwise,
  ArrowUp,
  Brain,
  ChartBar,
  CheckCircle,
  Clock,
  Compass,
  DownloadSimple,
  Desktop,
  FileText,
  Flag,
  FolderOpen,
  GearSix,
  HardDrives,
  ListChecks,
  Moon,
  MagnifyingGlass,
  PencilSimple,
  Paperclip,
  Palette,
  PushPin,
  Quotes,
  Scissors,
  ShieldCheck,
  Sparkle,
  Sun,
  Target,
  Trash,
  UsersThree,
  Waveform,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import versionHistoryData from "../public/version-history.json";

type View = "transcript" | "summary" | "actions";
type MeetingStatus = "recording" | "importing" | "correcting" | "summarizing" | "retranscribing" | "enhancing" | "completed" | "failed";
type SummaryTemplateId = "meeting-brief" | "meeting-minutes" | "daily-log" | "project-sync" | "brainstorm";
type ReportStyle = "detailed" | "visual";
type MeetingType = "general" | "research" | "project" | "review" | "decision" | "brainstorm";
type AudioSourceMode = "microphone" | "system" | "mixed";
type SpeakerLimit = 6 | 12 | 20;
type SpeakerLimitMode = "auto" | "manual";
type TranscriptMode = "organized" | "original";
type TranscriptOrder = "ascending" | "descending";
type ThemeMode = "system" | "light" | "dark";
type RecordingBackdrop = "paper" | "focus" | "wave" | "midnight";
type SettingsSection = "general" | "meeting" | "ai" | "notebook" | "data" | "updates";
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
  releaseName: string | null;
  releaseNotes: string[];
  percent: number | null;
  message: string;
  supported: boolean;
  canCheck: boolean;
  canDownload: boolean;
  canInstall: boolean;
};
type VersionHistoryItem = {
  version: string;
  date: string;
  summary: string;
  changes: string[];
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
type MeetingAttachment = {
  id: string;
  meetingId: string;
  originalName: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  aiReadable: boolean;
  createdAt: string;
};
type AudioClip = {
  id: string;
  meetingId: string;
  name: string;
  storedName: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  sizeBytes: number;
  speakerIds: string[];
  sourceRanges: Array<{ startMs: number; endMs: number }>;
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
  suggestedProfileId: string | null;
  suggestedName: string | null;
  suggestedScore: number | null;
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
  source: "realtime" | "local-realtime" | "local-retranscribed" | "corrected" | "overlap-separated" | "restored";
  confidence: number | null;
  overlapSuspected: boolean;
  overlapConfidence: number | null;
  overlapSpeakerIds: string[];
};
type Summary = {
  headline?: string;
  overview: string;
  meetingType?: MeetingType;
  meetingTypeReason?: string;
  meetingTypeConfidence?: "高" | "中" | "低";
  meetingIdentity?: {
    scope: "external" | "internal" | "unknown";
    counterpartyOrganization: string;
    primaryContact: string;
    projectOrDepartment: string;
    subject: string;
    evidenceSeqs: number[];
  };
  brief?: {
    subject: string;
    participants: string;
    sections: Array<{
      id: string;
      title: string;
      content: string;
      evidenceSeqs: number[];
    }>;
    aiSuggestions: string[];
    userEdited?: boolean;
    updatedAt?: string;
  };
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
  kind: "audio-import" | "speaker-correction" | "summary" | "retranscription" | "overlap-enhancement";
  status: "pending" | "running" | "completed" | "failed";
  progress: number;
  error: string | null;
};
type AudioInput = { deviceId: string; label: string };
type PreflightStatus = "ready" | "warning" | "blocked";
type MeetingPreflightCheck = {
  id: string;
  label: string;
  status: PreflightStatus;
  detail: string;
  blocking: boolean;
};
type MeetingPreflight = {
  checkedAt: string;
  status: PreflightStatus;
  freeBytes: number | null;
  checks: MeetingPreflightCheck[];
};
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
  speakerLimitMode: SpeakerLimitMode;
  titleSource: "default" | "automatic" | "manual";
  sourceType: "recorded" | "imported";
  sourceName: string | null;
  deletedAt: string | null;
  attachmentCount: number;
};
type Meeting = MeetingBrief & {
  speakers: Speaker[];
  segments: Segment[];
  jobs: Job[];
  canUndoTranscriptEdit: boolean;
  activeTranscriptVersionId: string | null;
  transcriptVersions: TranscriptVersion[];
  attachments: MeetingAttachment[];
  audioClips: AudioClip[];
};

declare global {
  interface Window {
    shiyinDesktop?: {
      getAudioCaptureCapabilities: () => Promise<AudioCaptureCapabilities>;
      selectAudioImport: (options: {
        summaryTemplate: SummaryTemplateId;
        reportStyle: ReportStyle;
        maxSpeakers: SpeakerLimit;
        speakerLimitMode: SpeakerLimitMode;
      }) => Promise<{ canceled: boolean; accepted?: boolean; meeting?: Meeting }>;
      importDroppedAudio: (file: File, options: {
        summaryTemplate: SummaryTemplateId;
        reportStyle: ReportStyle;
        maxSpeakers: SpeakerLimit;
        speakerLimitMode: SpeakerLimitMode;
      }) => Promise<{ canceled: boolean; accepted?: boolean; meeting?: Meeting }>;
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
const versionHistory = versionHistoryData as VersionHistoryItem[];
const CURRENT_APP_VERSION = versionHistory[0]?.version || "0.6.7";
const DEFAULT_SUMMARY_TEMPLATE: SummaryTemplateId = "meeting-brief";
const DEFAULT_REPORT_STYLE: ReportStyle = "visual";
const DEFAULT_SPEAKER_LIMIT: SpeakerLimit = 6;
const speakerLimitOptions: Array<{ value: SpeakerLimit; label: string; detail: string }> = [
  { value: 6, label: "6 人", detail: "小型会议" },
  { value: 12, label: "12 人", detail: "内部会议" },
  { value: 20, label: "20 人", detail: "大型会议" },
];
const recordingBackdrops: Array<{ id: RecordingBackdrop; name: string; detail: string }> = [
  { id: "paper", name: "清爽", detail: "暖白纸面" },
  { id: "focus", name: "专注", detail: "沉浸蓝光" },
  { id: "wave", name: "声场", detail: "青蓝声场" },
  { id: "midnight", name: "夜间", detail: "低光蓝灰" },
];
const summaryTemplates: Array<{
  id: SummaryTemplateId;
  name: string;
  description: string;
  accent: string;
}> = [
  { id: "meeting-brief", name: "会议简报", description: "AI 分类后提炼问题、期望、共识与推进", accent: "slate" },
  { id: "meeting-minutes", name: "会议纪要", description: "决策、议题、风险与行动项", accent: "blue" },
  { id: "daily-log", name: "日常记录", description: "按时间整理交流、灵感与提醒", accent: "cyan" },
  { id: "project-sync", name: "项目周会", description: "进展、阻塞、依赖与下一步", accent: "green" },
  { id: "brainstorm", name: "头脑风暴", description: "想法簇、优缺点与验证实验", accent: "violet" },
];

function summaryTemplateName(id: SummaryTemplateId | undefined) {
  return summaryTemplates.find((template) => template.id === id)?.name || "会议简报";
}

function summaryTemplateIcon(id: SummaryTemplateId, size = 20) {
  if (id === "meeting-brief") return <FileText size={size} weight="duotone" />;
  if (id === "daily-log") return <Quotes size={size} weight="duotone" />;
  if (id === "project-sync") return <Target size={size} weight="duotone" />;
  if (id === "brainstorm") return <Brain size={size} weight="duotone" />;
  return <ListChecks size={size} weight="duotone" />;
}

const meetingTypeNames: Record<MeetingType, string> = {
  general: "通用会议",
  research: "调研访谈",
  project: "项目推进",
  review: "方案评审",
  decision: "决策讨论",
  brainstorm: "头脑风暴",
};

type EditableMeetingBrief = {
  subject: string;
  participants: string;
  sections: Array<{ id: string; title: string; content: string; evidenceSeqs: number[] }>;
  aiSuggestions: string[];
  actionItems: Summary["actionItems"];
};

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

function formatWorkspaceDuration(milliseconds: number) {
  const minutes = Math.max(0, Math.round(milliseconds / 60000));
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} 小时 ${remainder} 分` : `${hours} 小时`;
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
    importing: "正在解析导入录音",
    correcting: "正在校正发言人",
    summarizing: "正在生成总结",
    retranscribing: "正在重新转写录音",
    enhancing: "正在拆解多人发言",
    completed: "已完成",
    failed: "处理失败",
  }[status];
}

function meetingIsBusy(status: MeetingStatus | undefined) {
  return status === "recording"
    || status === "importing"
    || status === "correcting"
    || status === "summarizing"
    || status === "retranscribing"
    || status === "enhancing";
}

function summaryLooksInvalid(summary: Summary | null | undefined) {
  if (!summary) return false;
  const overview = String(summary.overview || "").trim();
  if (/^```(?:json)?/i.test(overview) || (/^\{/.test(overview) && /"(?:headline|overview|chapters)"\s*:/.test(overview))) {
    return true;
  }
  const structuredItems = [
    summary.overviewCards,
    summary.brief?.sections,
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

function deriveMeetingBrief(meeting: Meeting, summary: Summary): EditableMeetingBrief {
  const fallbackSections = (summary.overviewCards || []).slice(0, 5).map((card, index) => ({
    id: `overview-${index + 1}`,
    title: card.title,
    content: [card.summary, ...(card.points || [])].filter(Boolean).join("；"),
    evidenceSeqs: card.evidenceSeqs || [],
  }));
  if (!fallbackSections.length) {
    fallbackSections.push(
      { id: "overview", title: "核心讨论", content: summary.overview, evidenceSeqs: [] },
      { id: "problems", title: "主要问题", content: summary.risks.join("；") || "会议中未明确", evidenceSeqs: [] },
      { id: "consensus", title: "会议共识", content: summary.decisions.join("；") || "会议中未明确", evidenceSeqs: [] },
    );
  }
  const namedSpeakers = meeting.speakers
    .map((speaker) => speaker.displayName)
    .filter((name) => name && !/^发言人\d+$/.test(name));
  return {
    subject: summary.brief?.subject || summary.headline || meeting.title,
    participants: summary.brief?.participants || namedSpeakers.join(" · ") || `${meeting.speakers.length} 位参会者`,
    sections: summary.brief?.sections?.length ? summary.brief.sections : fallbackSections,
    aiSuggestions: summary.brief?.aiSuggestions || summary.aiInsights?.slice(0, 3).map((item) => item.insight) || [],
    actionItems: summary.actionItems || [],
  };
}

function briefDate(iso: string) {
  const value = new Date(iso);
  return value.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).replaceAll("/", ".");
}

function wrapCanvasText(context: CanvasRenderingContext2D, value: string, maxWidth: number) {
  const lines: string[] = [];
  for (const paragraph of String(value || "").split(/\n+/)) {
    let line = "";
    for (const character of paragraph || " ") {
      const next = line + character;
      if (line && context.measureText(next).width > maxWidth) {
        lines.push(line);
        line = character;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : ["会议中未明确"];
}

function downloadBriefImage(meeting: Meeting, summary: Summary, brief: EditableMeetingBrief) {
  const width = 1240;
  const margin = 118;
  const contentWidth = width - margin * 2;
  const measureCanvas = document.createElement("canvas");
  const measure = measureCanvas.getContext("2d");
  if (!measure) throw new Error("当前设备无法生成简报图片");
  measure.font = '32px "PingFang SC", "Microsoft YaHei", sans-serif';
  const sectionLayouts = brief.sections.map((section) => ({
    ...section,
    lines: wrapCanvasText(measure, section.content, contentWidth - 150),
  }));
  const actionLayouts = brief.actionItems.slice(0, 8).map((item) => ({
    ...item,
    lines: wrapCanvasText(measure, item.task, contentWidth - 330),
  }));
  const suggestionLines = brief.aiSuggestions.flatMap((item) => wrapCanvasText(measure, item, contentWidth - 70));
  const bodyHeight = sectionLayouts.reduce((total, section) => total + 94 + section.lines.length * 43, 0)
    + (actionLayouts.length ? 130 + actionLayouts.reduce((total, item) => total + Math.max(68, item.lines.length * 38), 0) : 0)
    + (suggestionLines.length ? 150 + suggestionLines.length * 42 : 0);
  const height = Math.max(1754, 570 + bodyHeight);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前设备无法生成简报图片");
  context.fillStyle = "#f9f7f1";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#315fae";
  context.font = '600 24px "PingFang SC", "Microsoft YaHei", sans-serif';
  context.fillText("会议简报  ·  给未参会的人", margin, 104);
  context.fillStyle = "#202421";
  context.font = '600 48px "Songti SC", "STSong", serif';
  const titleLines = wrapCanvasText(context, brief.subject || meeting.title, contentWidth);
  titleLines.slice(0, 2).forEach((line, index) => context.fillText(line, margin, 184 + index * 62));
  let y = 225 + Math.min(2, titleLines.length) * 62;
  context.fillStyle = "#59605a";
  context.font = '25px "PingFang SC", "Microsoft YaHei", sans-serif';
  context.fillText(`${briefDate(meeting.startedAt)}  ·  ${formatClock(meeting.durationMs)}  ·  ${brief.participants}`, margin, y);
  y += 65;
  context.strokeStyle = "#d2d3cb";
  context.lineWidth = 1;
  context.beginPath(); context.moveTo(margin, y); context.lineTo(width - margin, y); context.stroke();
  y += 76;
  sectionLayouts.forEach((section, index) => {
    context.fillStyle = "#315fae";
    context.font = '500 37px "Georgia", serif';
    context.fillText(String(index + 1).padStart(2, "0"), margin, y);
    context.fillStyle = "#202421";
    context.font = '600 32px "PingFang SC", "Microsoft YaHei", sans-serif';
    context.fillText(section.title, margin + 118, y);
    context.fillStyle = "#3e443f";
    context.font = '28px "PingFang SC", "Microsoft YaHei", sans-serif';
    section.lines.forEach((line, lineIndex) => context.fillText(line, margin + 118, y + 54 + lineIndex * 43));
    y += 92 + section.lines.length * 43;
    context.strokeStyle = "#dbdcd5";
    context.beginPath(); context.moveTo(margin + 118, y - 24); context.lineTo(width - margin, y - 24); context.stroke();
  });
  if (actionLayouts.length) {
    context.fillStyle = "#202421";
    context.font = '600 32px "PingFang SC", "Microsoft YaHei", sans-serif';
    context.fillText("会后推进", margin + 118, y + 20);
    y += 70;
    context.font = '27px "PingFang SC", "Microsoft YaHei", sans-serif';
    actionLayouts.forEach((item, index) => {
      context.fillStyle = "#788474";
      context.fillText(String(index + 1).padStart(2, "0"), margin + 118, y);
      context.fillStyle = "#303531";
      item.lines.forEach((line, lineIndex) => context.fillText(line, margin + 182, y + lineIndex * 38));
      context.fillStyle = "#656b66";
      context.fillText(`${item.owner}  ${item.due}`, width - margin - 230, y);
      y += Math.max(68, item.lines.length * 38);
    });
  }
  if (suggestionLines.length) {
    y += 24;
    context.fillStyle = "#eceee8";
    context.fillRect(margin + 118, y, contentWidth - 118, 105 + suggestionLines.length * 42);
    context.fillStyle = "#65715f";
    context.font = '600 29px "PingFang SC", "Microsoft YaHei", sans-serif';
    context.fillText("AI 推进建议", margin + 155, y + 48);
    context.fillStyle = "#414741";
    context.font = '27px "PingFang SC", "Microsoft YaHei", sans-serif';
    suggestionLines.forEach((line, index) => context.fillText(line, margin + 155, y + 94 + index * 42));
  }
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeFilename(meeting.title)}-会议简报.png`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, "image/png");
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

function combinePreflightStatus(checks: MeetingPreflightCheck[]): PreflightStatus {
  if (checks.some((item) => item.status === "blocked")) return "blocked";
  if (checks.some((item) => item.status === "warning")) return "warning";
  return "ready";
}

function recordingSourcePreflight(
  mode: AudioSourceMode,
  capabilities: AudioCaptureCapabilities | null,
  devices: AudioInput[],
  desktopAvailable: boolean,
): MeetingPreflightCheck {
  const needsMicrophone = mode === "microphone" || mode === "mixed";
  const needsSystemAudio = mode === "system" || mode === "mixed";
  const problems: string[] = [];
  const reminders: string[] = [];

  if (needsMicrophone) {
    if (["denied", "restricted"].includes(capabilities?.microphonePermission || "")) {
      problems.push("麦克风权限未开启");
    } else if (capabilities?.microphonePermission === "not-determined") {
      reminders.push("开始时将请求麦克风权限");
    } else if (!devices.length) {
      reminders.push("开始时将确认麦克风设备");
    }
  }
  if (needsSystemAudio) {
    if (!desktopAvailable) {
      problems.push("电脑声音录制需要桌面版");
    } else if (!capabilities?.systemAudioSupported) {
      problems.push(capabilities?.platform === "darwin" ? "当前 macOS 版本不支持电脑声音录制" : "当前系统不支持电脑声音录制");
    } else if (["denied", "restricted"].includes(capabilities.screenPermission || "")) {
      problems.push("屏幕与系统音频录制权限未开启");
    } else if (capabilities.platform === "darwin") {
      reminders.push("开始时需要在系统面板选择会议所在屏幕");
    }
  }

  const sourceName = mode === "mixed" ? "电脑声音和麦克风" : mode === "system" ? "电脑声音" : "麦克风";
  if (problems.length) {
    return { id: "recording-source", label: "录音来源", status: "blocked", detail: problems.join("；"), blocking: true };
  }
  if (reminders.length) {
    return { id: "recording-source", label: "录音来源", status: "warning", detail: reminders.join("；"), blocking: false };
  }
  const preferred = preferredMicrophone(devices);
  return {
    id: "recording-source",
    label: "录音来源",
    status: "ready",
    detail: mode === "microphone" && preferred?.label ? preferred.label : `${sourceName}可用`,
    blocking: false,
  };
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

function fileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`无法读取“${file.name}”`));
    reader.onload = () => resolve(String(reader.result || "").split(",").at(-1) || "");
    reader.readAsDataURL(file);
  });
}

function ShiyinMark({ className }: { className: string }) {
  return (
    <span className={className} aria-hidden="true">
      <span className="shiyin-wave-bars">
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
      <i className="shiyin-wave-dot" />
    </span>
  );
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
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [summaryMode, setSummaryMode] = useState<"brief" | "full">("brief");
  const [briefEditing, setBriefEditing] = useState(false);
  const [briefDraft, setBriefDraft] = useState<EditableMeetingBrief | null>(null);
  const [briefSaving, setBriefSaving] = useState(false);
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
  const [meetingPreflight, setMeetingPreflight] = useState<MeetingPreflight | null>(null);
  const [meetingPreflightLoading, setMeetingPreflightLoading] = useState(true);
  const [highlightedSeq, setHighlightedSeq] = useState<number | null>(null);
  const [renamingMeeting, setRenamingMeeting] = useState<MeetingBrief | null>(null);
  const [meetingTitleDraft, setMeetingTitleDraft] = useState("");
  const [meetingRenameSaving, setMeetingRenameSaving] = useState(false);
  const [meetingRenameError, setMeetingRenameError] = useState("");
  const [meetingAutoNaming, setMeetingAutoNaming] = useState(false);
  const [renamingSpeaker, setRenamingSpeaker] = useState<Speaker | null>(null);
  const [speakerNameDraft, setSpeakerNameDraft] = useState("");
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [defaultSummaryTemplate, setDefaultSummaryTemplate] = useState<SummaryTemplateId>(DEFAULT_SUMMARY_TEMPLATE);
  const [defaultReportStyle, setDefaultReportStyle] = useState<ReportStyle>(DEFAULT_REPORT_STYLE);
  const [speakerLimit, setSpeakerLimit] = useState<SpeakerLimit>(DEFAULT_SPEAKER_LIMIT);
  const [speakerLimitMode, setSpeakerLimitMode] = useState<SpeakerLimitMode>("auto");
  const [templateDraft, setTemplateDraft] = useState<SummaryTemplateId>(DEFAULT_SUMMARY_TEMPLATE);
  const [reportStyleDraft, setReportStyleDraft] = useState<ReportStyle>(DEFAULT_REPORT_STYLE);
  const [settingsPageOpen, setSettingsPageOpen] = useState(false);
  const [workspacePageOpen, setWorkspacePageOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
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
  const [segmentSpeakerSavingId, setSegmentSpeakerSavingId] = useState<string | null>(null);
  const [speakerSuggestionSavingId, setSpeakerSuggestionSavingId] = useState<string | null>(null);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const [recordingBackdrop, setRecordingBackdrop] = useState<RecordingBackdrop>("paper");
  const [autoSummaryEnabled, setAutoSummaryEnabled] = useState(true);
  const [autoTitleEnabled, setAutoTitleEnabled] = useState(true);
  const [pendingAttachments, setPendingAttachments] = useState<File[]>([]);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [audioImportStarting, setAudioImportStarting] = useState(false);
  const [audioImportDragActive, setAudioImportDragActive] = useState(false);
  const [audioEditorOpen, setAudioEditorOpen] = useState(false);
  const [audioClipSaving, setAudioClipSaving] = useState(false);
  const [audioClipName, setAudioClipName] = useState("");
  const [audioClipStartMs, setAudioClipStartMs] = useState(0);
  const [audioClipEndMs, setAudioClipEndMs] = useState(0);
  const [audioClipSpeakerIds, setAudioClipSpeakerIds] = useState<Set<string>>(new Set());
  const [trashDialogOpen, setTrashDialogOpen] = useState(false);
  const [deletedMeetings, setDeletedMeetings] = useState<MeetingBrief[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const playbackRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamsRef = useRef<MediaStream[]>([]);
  const recordingRef = useRef(false);
  const currentMeetingIdRef = useRef<string | null>(null);
  const sessionPeakRef = useRef(0);
  const captureStartedAtRef = useRef(0);
  const lastLevelUpdateRef = useRef(0);
  const silenceWarningShownRef = useRef(false);
  const commandHandlerRef = useRef<(command: string) => void>(() => undefined);

  useEffect(() => {
    const workspace = workspaceRef.current;
    const updateVisibility = () => {
      setShowBackToTop(Math.max(workspace?.scrollTop || 0, window.scrollY) > 420);
    };
    workspace?.addEventListener("scroll", updateVisibility, { passive: true });
    window.addEventListener("scroll", updateVisibility, { passive: true });
    updateVisibility();
    return () => {
      workspace?.removeEventListener("scroll", updateVisibility);
      window.removeEventListener("scroll", updateVisibility);
    };
  }, []);

  const scrollWorkspaceToTop = useCallback(() => {
    const behavior: ScrollBehavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth";
    workspaceRef.current?.scrollTo({ top: 0, behavior });
    window.scrollTo({ top: 0, behavior });
  }, []);

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem("shiyin.sidebarCollapsed", String(next));
      return next;
    });
  }, []);

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
      const savedSpeakerLimitMode = window.localStorage.getItem("shiyin.speakerLimitMode");
      const savedObsidianAutoSave = window.localStorage.getItem("shiyin.obsidianAutoSave");
      const savedTranscriptOrder = window.localStorage.getItem("shiyin.transcriptOrder");
      const savedTheme = window.localStorage.getItem("shiyin.themeMode") as ThemeMode | null;
      const savedBackdrop = window.localStorage.getItem("shiyin.recordingBackdrop") as RecordingBackdrop | null;
      const savedAutoSummary = window.localStorage.getItem("shiyin.autoSummary");
      const savedAutoTitle = window.localStorage.getItem("shiyin.autoTitle");
      const savedSidebarCollapsed = window.localStorage.getItem("shiyin.sidebarCollapsed");
      if (summaryTemplates.some((template) => template.id === savedTemplate)) {
        setDefaultSummaryTemplate(savedTemplate!);
      }
      if (savedStyle === "visual" || savedStyle === "detailed") setDefaultReportStyle(savedStyle);
      if (speakerLimitOptions.some((option) => option.value === savedSpeakerLimit)) {
        setSpeakerLimit(savedSpeakerLimit as SpeakerLimit);
      }
      if (savedSpeakerLimitMode === "manual") setSpeakerLimitMode("manual");
      setObsidianAutoSave(savedObsidianAutoSave === "true");
      if (savedTranscriptOrder === "descending") setTranscriptOrder("descending");
      if (["system", "light", "dark"].includes(savedTheme || "")) setThemeMode(savedTheme!);
      if (recordingBackdrops.some((item) => item.id === savedBackdrop)) setRecordingBackdrop(savedBackdrop!);
      setAutoSummaryEnabled(savedAutoSummary !== "false");
      setAutoTitleEnabled(savedAutoTitle !== "false");
      setSidebarCollapsed(savedSidebarCollapsed === "true");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const systemPreference = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const effectiveTheme = themeMode === "system"
        ? (systemPreference.matches ? "dark" : "light")
        : themeMode;
      document.documentElement.dataset.theme = effectiveTheme;
      document.documentElement.dataset.themeMode = themeMode;
    };
    applyTheme();
    systemPreference.addEventListener("change", applyTheme);
    return () => systemPreference.removeEventListener("change", applyTheme);
  }, [themeMode]);

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
    if (!templateDialogOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTemplateDialogOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [templateDialogOpen]);

  const openSettingsDialog = useCallback(async (section: SettingsSection = "general") => {
    setWorkspacePageOpen(false);
    const desktop = window.shiyinDesktop;
    if (!desktop) {
      setSettingsSection(section);
      setSettingsPageOpen(true);
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
      setSettingsSection(section);
      setSettingsPageOpen(true);
      api<StorageInfo>("/api/storage").then(setStorageInfo).catch(() => undefined);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法读取应用设置");
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

  const refreshMeetingPreflight = useCallback(async () => {
    setMeetingPreflightLoading(true);
    try {
      const [backend, capabilities, audio] = await Promise.all([
        api<MeetingPreflight>(`/api/preflight?autoSummary=${String(autoSummaryEnabled)}`),
        refreshCaptureCapabilities().catch(() => null),
        refreshAudioInputs().catch(() => ({ devices: [] as AudioInput[], preferred: null })),
      ]);
      const sourceCheck = recordingSourcePreflight(
        audioSourceMode,
        capabilities,
        audio.devices,
        Boolean(window.shiyinDesktop),
      );
      const checks = [sourceCheck, ...backend.checks];
      const result = { ...backend, status: combinePreflightStatus(checks), checks };
      setMeetingPreflight(result);
      return result;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "";
      const result: MeetingPreflight = {
        checkedAt: new Date().toISOString(),
        status: "blocked",
        freeBytes: null,
        checks: [{
          id: "backend",
          label: "本地服务",
          status: "blocked",
          detail: /failed to fetch/i.test(detail) ? "无法连接本地听记服务" : detail || "无法连接本地听记服务",
          blocking: true,
        }],
      };
      setMeetingPreflight(result);
      return result;
    } finally {
      setMeetingPreflightLoading(false);
    }
  }, [audioSourceMode, autoSummaryEnabled, refreshAudioInputs, refreshCaptureCapabilities]);

  useEffect(() => {
    if (!window.shiyinDesktop) return;
    const refreshOnFocus = () => {
      if (meeting || recordingRef.current) return;
      refreshMeetingPreflight().catch(() => undefined);
    };
    window.addEventListener("focus", refreshOnFocus);
    return () => window.removeEventListener("focus", refreshOnFocus);
  }, [meeting, refreshMeetingPreflight]);

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

  const processAudioImportResult = useCallback(async (result: { canceled: boolean; meeting?: Meeting }) => {
    if (result.canceled || !result.meeting) return;
    const meetingId = result.meeting.id;
    currentMeetingIdRef.current = meetingId;
    setMeeting(result.meeting);
    setSelectedId(meetingId);
    setMeetings((items) => [result.meeting!, ...items.filter((item) => item.id !== meetingId)]);
    setConnectionStatus("正在转换并解析导入录音…");
    window.shiyinDesktop?.setRecording(true);
    for (;;) {
      await new Promise((resolve) => window.setTimeout(resolve, 1400));
      const value = await loadMeeting(meetingId);
      setMeetings((items) => [value, ...items.filter((item) => item.id !== meetingId)]);
      const activeJob = [...value.jobs].reverse().find((job) => job.status === "running");
      if (activeJob?.kind === "audio-import") {
        setConnectionStatus(`正在解析导入录音 · ${activeJob.progress}%`);
      } else {
        setConnectionStatus(statusLabel(value.status));
      }
      if (!meetingIsBusy(value.status)) {
        setView(value.summary || value.liveSummary ? "summary" : "transcript");
        setNotice(value.status === "failed"
          ? (value.error || "录音解析失败，请检查文件后重试")
          : miniMaxSettings?.configured && autoSummaryEnabled
            ? "录音已完成本地转写、发言人识别与 AI 总结"
            : autoSummaryEnabled
              ? "录音已完成本地转写；配置 MiniMax 后可生成 AI 总结"
              : "录音已完成本地转写；本次已按设置跳过 AI 总结");
        break;
      }
    }
  }, [autoSummaryEnabled, loadMeeting, miniMaxSettings?.configured]);

  const audioImportOptions = useCallback(() => ({
    summaryTemplate: defaultSummaryTemplate,
    reportStyle: defaultReportStyle,
    maxSpeakers: speakerLimit,
    speakerLimitMode,
    autoSummary: autoSummaryEnabled,
    autoTitle: autoTitleEnabled,
  }), [autoSummaryEnabled, autoTitleEnabled, defaultReportStyle, defaultSummaryTemplate, speakerLimit, speakerLimitMode]);

  const importMeetingAudio = useCallback(async (droppedFile?: File) => {
    const desktop = window.shiyinDesktop;
    if (!desktop) {
      setNotice("导入其他会议录音需要在拾音 AI 桌面版中使用");
      return;
    }
    setAudioImportStarting(true);
    setProcessing(true);
    try {
      const result = droppedFile
        ? await desktop.importDroppedAudio(droppedFile, audioImportOptions())
        : await desktop.selectAudioImport(audioImportOptions());
      await processAudioImportResult(result);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法导入这份会议录音");
    } finally {
      window.shiyinDesktop?.setRecording(false);
      setAudioImportStarting(false);
      setProcessing(false);
      await refreshMeetings().catch(() => undefined);
    }
  }, [audioImportOptions, processAudioImportResult, refreshMeetings]);

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
    if (meeting || recording) return;
    const timer = window.setTimeout(() => {
      refreshMeetingPreflight().catch(() => undefined);
    }, 80);
    return () => window.clearTimeout(timer);
  }, [meeting, recording, refreshMeetingPreflight]);

  useEffect(() => {
    if (!selectedId) return;
    if (recordingRef.current && meeting?.id === selectedId) return;
    const timer = window.setTimeout(() => {
      loadMeeting(selectedId).catch((error) => setNotice(error.message));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selectedId, loadMeeting, meeting?.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setBriefEditing(false);
      setBriefDraft(null);
      setSummaryMode("brief");
      setMoreMenuOpen(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [meeting?.id]);

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
    if (miniMaxSettings?.configured && autoSummaryEnabled) setView("summary");
    setConnectionStatus(miniMaxSettings?.configured && autoSummaryEnabled
      ? "录音已保存，正在生成 AI 总结…"
      : "录音已保存，正在完成会议…");
    await stopAudioCapture();
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "session.stop" }));
    }
  }, [autoSummaryEnabled, miniMaxSettings?.configured, stopAudioCapture]);

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
  const overlapCount = useMemo(
    () => meeting?.segments.filter((segment) => segment.overlapSuspected).length || 0,
    [meeting?.segments],
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
  const generatedBrief = useMemo(
    () => meeting && usableSummary ? deriveMeetingBrief(meeting, usableSummary) : null,
    [meeting, usableSummary],
  );
  const activeBrief = briefDraft || generatedBrief;
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
  const workspaceStats = useMemo(() => ({
    totalDurationMs: meetings.reduce((total, item) => total + Math.max(0, item.durationMs || 0), 0),
    summarizedMeetings: meetings.filter((item) => Boolean(item.summary)).length,
    attachmentCount: meetings.reduce((total, item) => total + Math.max(0, item.attachmentCount || 0), 0),
  }), [meetings]);
  const meetingsWithMaterials = useMemo(
    () => meetings.filter((item) => item.attachmentCount > 0),
    [meetings],
  );
  const preflightReadyCount = meetingPreflight?.checks.filter((item) => item.status === "ready").length || 0;
  const preflightAttentionCount = meetingPreflight?.checks.filter((item) => item.status !== "ready").length || 0;
  const preflightStatusLabel = meetingPreflightLoading && !meetingPreflight
    ? "检查中"
    : meetingPreflight?.status === "blocked" ? "需要处理"
      : meetingPreflight?.status === "warning" ? "可以开始 · 有提醒" : "可以开始";

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

  function selectTheme(mode: ThemeMode) {
    setThemeMode(mode);
    window.localStorage.setItem("shiyin.themeMode", mode);
  }

  function selectRecordingBackdrop(backdrop: RecordingBackdrop) {
    setRecordingBackdrop(backdrop);
    window.localStorage.setItem("shiyin.recordingBackdrop", backdrop);
    setNotice(`录音界面已切换为“${recordingBackdrops.find((item) => item.id === backdrop)?.name}”背景`);
  }

  function returnToCurrentMeeting() {
    const targetMeetingId = currentMeetingIdRef.current || selectedId || meeting?.id || null;
    setSettingsPageOpen(false);
    setWorkspacePageOpen(false);
    setView("transcript");
    if (targetMeetingId) {
      setSelectedId(targetMeetingId);
      if (meeting?.id !== targetMeetingId) {
        loadMeeting(targetMeetingId).catch((error) => setNotice(error.message));
      }
    } else {
      setMeeting(null);
      setSelectedId(null);
    }
    window.requestAnimationFrame(scrollWorkspaceToTop);
  }

  function openLocalWorkspace() {
    setSettingsPageOpen(false);
    setWorkspacePageOpen(true);
    window.requestAnimationFrame(scrollWorkspaceToTop);
  }

  function openWorkspaceMeeting(meetingId: string) {
    setWorkspacePageOpen(false);
    setSettingsPageOpen(false);
    setSelectedId(meetingId);
    if (meeting?.id !== meetingId) loadMeeting(meetingId).catch((error) => setNotice(error.message));
    window.requestAnimationFrame(scrollWorkspaceToTop);
  }

  function selectAutoSummary(enabled: boolean) {
    setAutoSummaryEnabled(enabled);
    window.localStorage.setItem("shiyin.autoSummary", String(enabled));
    if (!enabled) {
      setAutoTitleEnabled(false);
      window.localStorage.setItem("shiyin.autoTitle", "false");
    }
  }

  function selectAutoTitle(enabled: boolean) {
    setAutoTitleEnabled(enabled);
    window.localStorage.setItem("shiyin.autoTitle", String(enabled));
  }

  async function uploadAttachments(meetingId: string, files: File[]) {
    if (!files.length || attachmentUploading) return;
    setAttachmentUploading(true);
    try {
      let updatedMeeting: Meeting | null = null;
      for (const file of files) {
        const result = await api<{ attachment: MeetingAttachment; meeting: Meeting }>(
          `/api/meetings/${meetingId}/attachments`,
          {
            method: "POST",
            body: JSON.stringify({
              name: file.name,
              mimeType: file.type || "application/octet-stream",
              base64: await fileAsBase64(file),
            }),
          },
        );
        updatedMeeting = result.meeting;
      }
      if (updatedMeeting) {
        setMeeting((current) => current?.id === updatedMeeting?.id ? updatedMeeting : current);
        mergeMeetingList(updatedMeeting);
      }
      setPendingAttachments([]);
      setNotice(`已将 ${files.length} 份会议资料保存在本地${updatedMeeting?.summary ? "；重新总结后会引用可读取的文本资料" : ""}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法保存会议资料");
    } finally {
      setAttachmentUploading(false);
    }
  }

  function handleAttachmentFiles(fileList: FileList | null) {
    const files = Array.from(fileList || []);
    if (attachmentInputRef.current) attachmentInputRef.current.value = "";
    if (!files.length) return;
    const tooLarge = files.find((file) => file.size > 12 * 1024 * 1024);
    if (tooLarge) {
      setNotice(`“${tooLarge.name}”超过 12 MB，请压缩后再添加`);
      return;
    }
    const existingCount = meeting?.attachments.length || pendingAttachments.length;
    if (existingCount + files.length > 12) {
      setNotice("每场会议最多添加 12 份资料");
      return;
    }
    if (meeting) {
      void uploadAttachments(meeting.id, files);
      return;
    }
    setPendingAttachments((items) => [...items, ...files]);
    setNotice(`已选择 ${files.length} 份资料，开始会议后会自动保存在本地`);
  }

  async function removeAttachment(attachment: MeetingAttachment) {
    if (!meeting || attachmentUploading) return;
    if (!window.confirm(`从本次会议中移除“${attachment.originalName}”？`)) return;
    setAttachmentUploading(true);
    try {
      const result = await api<{ meeting: Meeting }>(
        `/api/meetings/${meeting.id}/attachments/${attachment.id}`,
        { method: "DELETE" },
      );
      setMeeting(result.meeting);
      mergeMeetingList(result.meeting);
      setNotice("会议资料已移除；原有 AI 总结不会自动改变");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法移除会议资料");
    } finally {
      setAttachmentUploading(false);
    }
  }

  function openAudioEditor() {
    if (!meeting?.audioPath || meetingIsBusy(meeting.status)) return;
    setAudioClipName(`${meeting.title}-剪辑`);
    setAudioClipStartMs(0);
    setAudioClipEndMs(meeting.durationMs);
    setAudioClipSpeakerIds(new Set(meeting.speakers.map((speaker) => speaker.id)));
    setAudioEditorOpen(true);
  }

  function toggleAudioClipSpeaker(speakerId: string) {
    setAudioClipSpeakerIds((current) => {
      const next = new Set(current);
      if (next.has(speakerId)) next.delete(speakerId);
      else next.add(speakerId);
      return next;
    });
  }

  async function saveAudioClip() {
    if (!meeting || audioClipSaving || (meeting.speakers.length > 0 && !audioClipSpeakerIds.size)) return;
    setAudioClipSaving(true);
    try {
      const result = await api<{ clip: AudioClip; meeting: Meeting }>(
        `/api/meetings/${meeting.id}/audio-clips`,
        {
          method: "POST",
          body: JSON.stringify({
            name: audioClipName.trim(),
            startMs: audioClipStartMs,
            endMs: audioClipEndMs,
            speakerIds: [...audioClipSpeakerIds],
          }),
        },
      );
      setMeeting(result.meeting);
      mergeMeetingList(result.meeting);
      setAudioEditorOpen(false);
      setNotice(`已保存“${result.clip.name}”，原始录音保持不变`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法保存音频剪辑");
    } finally {
      setAudioClipSaving(false);
    }
  }

  async function deleteAudioClip(clip: AudioClip) {
    if (!meeting || audioClipSaving) return;
    if (!window.confirm(`删除音频剪辑“${clip.name}”？原始录音不会受到影响。`)) return;
    setAudioClipSaving(true);
    try {
      const result = await api<{ meeting: Meeting }>(
        `/api/meetings/${meeting.id}/audio-clips/${clip.id}`,
        { method: "DELETE" },
      );
      setMeeting(result.meeting);
      mergeMeetingList(result.meeting);
      setNotice("音频剪辑已删除，原始录音仍然保留");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法删除音频剪辑");
    } finally {
      setAudioClipSaving(false);
    }
  }

  async function openAudioPrivacySettings(kind: "microphone" | "screen") {
    const opened = await window.shiyinDesktop?.openAudioPrivacySettings(kind);
    if (!opened) return false;
    if (kind === "screen") setCaptureSettingsOpened(true);
    setNotice(
      kind === "screen"
        ? "已打开“屏幕与系统音频录制”，请允许拾音 AI 后返回应用"
        : "已打开“麦克风”权限设置，请允许拾音 AI 后返回应用",
    );
    return true;
  }

  async function startRecording() {
    try {
      setNotice("");
      setSourceWarning("");
      const captureMode = audioSourceMode;
      const needsMicrophone = captureMode === "microphone" || captureMode === "mixed";
      const needsSystemAudio = captureMode === "system" || captureMode === "mixed";
      const preflight = await refreshMeetingPreflight();
      const blockingCheck = preflight.checks.find((item) => item.blocking || item.status === "blocked");
      if (blockingCheck) {
        if (
          needsMicrophone
          && blockingCheck.id === "recording-source"
          && blockingCheck.detail.includes("麦克风权限未开启")
        ) {
          const opened = await openAudioPrivacySettings("microphone");
          const permissionMessage = opened
            ? "已打开麦克风权限设置，请允许拾音 AI 后返回应用"
            : "麦克风权限未开启，请在系统隐私设置中允许拾音 AI";
          setAudioWarning(permissionMessage);
          setNotice(permissionMessage);
          return;
        }
        throw new Error(`会议前自检未通过：${blockingCheck.detail}`);
      }
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
      socketUrl.searchParams.set("speakerLimitMode", speakerLimitMode);
      socketUrl.searchParams.set("autoSummary", String(autoSummaryEnabled));
      socketUrl.searchParams.set("autoTitle", String(autoTitleEnabled));
      if (speakerLimitMode === "auto") socketUrl.searchParams.set("maxSpeakers", "20");
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
            currentMeetingIdRef.current = value.id;
            setLiveText("");
            setLiveConfirmedText("");
            setMeeting(value);
            setSelectedId(value.id);
            mergeMeetingList(value);
            if (pendingAttachments.length) void uploadAttachments(value.id, pendingAttachments);
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
            if (message.speakerDetection?.expandedTo) {
              setNotice(`检测到持续出现的新声音，已自动扩展到最多 ${message.speakerDetection.expandedTo} 位发言人`);
            } else if (message.speakerDetection?.pendingNewSpeaker) {
              setConnectionStatus(`${sessionAsrLabel} · 正在确认新的发言人…`);
            } else if (message.speakerDetection?.limitReached) {
              setNotice("已达到 20 位发言人上限，新的声音暂标记为待确认");
            }
          } else if (message.type === "speaker.profiles.updated") {
            setMeeting((current) => {
              if (!current || current.id !== message.meetingId) return current;
              return { ...current, speakers: message.speakers };
            });
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
              const nextStatus: MeetingStatus = message.job.kind === "summary"
                ? "summarizing"
                : message.job.kind === "overlap-enhancement"
                  ? "enhancing"
                  : message.job.kind === "retranscription"
                    ? "retranscribing"
                    : "correcting";
              return {
                ...current,
                status: nextStatus,
                jobs: [...current.jobs.filter((job) => job.id !== message.job.id), message.job],
              };
            });
            setConnectionStatus(
              message.job.kind === "summary"
                ? `正在生成会议总结 ${message.job.progress}%`
                : message.job.kind === "overlap-enhancement"
                  ? `正在拆解多人同时发言 ${message.job.progress}%`
                : `正在校正发言人 ${message.job.progress}%`,
            );
          } else if (message.type === "speaker.corrected") {
            setMeeting(message.meeting);
            mergeMeetingList(message.meeting);
          } else if (message.type === "overlap.enhanced") {
            setMeeting(message.meeting);
            mergeMeetingList(message.meeting);
            setNotice(message.enhancedCount
              ? `已拆解 ${message.enhancedCount} 处多人同时发言${message.retainedCount ? `；另有 ${message.retainedCount} 处保留原记录待确认` : ""}`
              : "暂未找到足够可靠的双人拆解结果，已完整保留原记录");
          } else if (message.type === "session.completed") {
            const value = message.meeting as Meeting;
            setMeeting(value);
            mergeMeetingList(value);
            setProcessing(false);
            setConnectionStatus("处理完成");
            setNotice(message.summarySkipped
              ? message.summaryDisabled
                ? "会议和逐字稿已保存；本次按设置跳过了 AI 总结"
                : "会议和逐字稿已保存；配置 MiniMax 密钥后可生成 AI 总结"
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
          const opened = await openAudioPrivacySettings("microphone").catch(() => false);
          userMessage = opened
            ? "已打开麦克风权限设置，请允许拾音 AI 后返回应用"
            : "麦克风权限未开启，请在系统隐私设置中允许拾音 AI";
          setAudioWarning(userMessage);
        } else {
          const latestCapabilities = await refreshCaptureCapabilities().catch(() => null);
          if (["denied", "restricted"].includes(latestCapabilities?.microphonePermission || "")) {
            const opened = await openAudioPrivacySettings("microphone").catch(() => false);
            userMessage = opened
              ? "已打开麦克风权限设置，请允许拾音 AI 后返回应用"
              : "麦克风权限未开启，请在系统隐私设置中允许拾音 AI";
            setAudioWarning(userMessage);
          } else if (["denied", "restricted"].includes(latestCapabilities?.screenPermission || "")) {
            const opened = await openAudioPrivacySettings("screen").catch(() => false);
            userMessage = opened
              ? "已打开屏幕与系统音频录制设置，请允许拾音 AI 后返回应用"
              : "系统音频权限未开启，请在系统隐私设置中允许拾音 AI";
          } else {
            userMessage = "已取消电脑声音共享；重新开始后请选择会议所在屏幕并开启系统音频";
          }
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

  async function confirmSuggestedSpeaker(speaker: Speaker) {
    if (!speaker.suggestedName || speakerSuggestionSavingId) return;
    setSpeakerSuggestionSavingId(speaker.id);
    try {
      const updated = await api<Speaker>(`/api/speakers/${speaker.id}`, {
        method: "PATCH",
        body: JSON.stringify({ displayName: speaker.suggestedName }),
      });
      setMeeting((current) => current
        ? { ...current, speakers: current.speakers.map((item) => item.id === updated.id ? updated : item) }
        : current);
      setNotice(`已确认 ${updated.displayName}，后续会议会继续使用本机声纹匹配`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法确认声纹候选");
    } finally {
      setSpeakerSuggestionSavingId(null);
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

  async function enhanceOverlappingSpeech() {
    if (!meeting || meetingIsBusy(meeting.status) || !meeting.audioPath || !overlapCount) return;
    const meetingId = meeting.id;
    try {
      await api(`/api/meetings/${meetingId}/enhance-overlap`, { method: "POST" });
      setProcessing(true);
      setMeeting((current) => current?.id === meetingId ? { ...current, status: "enhancing", error: null } : current);
      setConnectionStatus("正在本地拆解多人同时发言…");
      setNotice("会后增强已开始；处理前的逐字稿已自动保留为版本");
      const poll = window.setInterval(async () => {
        const value = await loadMeeting(meetingId).catch(() => null);
        if (value && !meetingIsBusy(value.status)) {
          window.clearInterval(poll);
          setProcessing(false);
          mergeMeetingList(value);
          const remaining = value.segments.filter((segment) => segment.overlapSuspected).length;
          setNotice(remaining < overlapCount
            ? `多人发言拆解完成：成功处理 ${overlapCount - remaining} 处${remaining ? `，${remaining} 处仍需人工确认` : ""}`
            : value.error || "暂未找到足够可靠的拆解结果，原记录保持不变");
        }
      }, 1500);
    } catch (error) {
      setProcessing(false);
      setNotice(error instanceof Error ? error.message : "无法启动多人发言拆解");
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
      await openSettingsDialog("ai");
      return;
    }
    await regenerateSummary(meeting.id);
  }

  async function regenerateSummary(meetingId: string) {
    try {
      await api(`/api/meetings/${meetingId}/summarize`, {
        method: "POST",
        body: JSON.stringify({ autoTitle: autoTitleEnabled }),
      });
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
      setNotice(`新听记将使用“${summaryTemplateName(templateDraft)}”与${reportStyleDraft === "visual" ? "图文总结" : "深度纪要"}`);
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
        setNotice(`已切换为${reportStyleDraft === "visual" ? "图文总结" : "深度纪要"}，无需重新调用 MiniMax`);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法保存总结模板");
    }
  }

  function beginBriefEditing() {
    if (!generatedBrief || !finalSummary || !meeting) {
      setNotice("正式 AI 总结完成后即可编辑会议简报");
      return;
    }
    setBriefDraft(structuredClone(generatedBrief));
    setBriefEditing(true);
  }

  function cancelBriefEditing() {
    setBriefDraft(null);
    setBriefEditing(false);
  }

  async function saveBriefEditing() {
    if (!meeting || !finalSummary || !briefDraft || briefSaving) return;
    setBriefSaving(true);
    try {
      const updated = await api<Meeting>(`/api/meetings/${meeting.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          summary: {
            ...finalSummary,
            brief: {
              ...(finalSummary.brief || {}),
              subject: briefDraft.subject,
              participants: briefDraft.participants,
              sections: briefDraft.sections,
              aiSuggestions: briefDraft.aiSuggestions,
              userEdited: true,
            },
            actionItems: briefDraft.actionItems,
          },
        }),
      });
      setMeeting(updated);
      mergeMeetingList(updated);
      setBriefDraft(null);
      setBriefEditing(false);
      setNotice("会议简报已保存；现在可以导出完整图片");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法保存会议简报");
    } finally {
      setBriefSaving(false);
    }
  }

  function exportBriefImage() {
    if (!meeting || !usableSummary || !activeBrief) return;
    try {
      downloadBriefImage(meeting, usableSummary, activeBrief);
      setNotice("会议简报图片已导出");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法导出会议简报图片");
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

  async function autoNameMeeting() {
    if (!meeting || meetingAutoNaming || meetingIsBusy(meeting.status)) return;
    setMeetingAutoNaming(true);
    try {
      const result = await api<{ meeting: Meeting; changed: boolean }>(`/api/meetings/${meeting.id}/auto-title`, {
        method: "POST",
      });
      setMeeting(result.meeting);
      mergeMeetingList(result.meeting);
      setNotice(result.changed ? `已根据会议内容命名为“${result.meeting.title}”` : `当前名称“${result.meeting.title}”已经合适`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法智能命名会议");
    } finally {
      setMeetingAutoNaming(false);
    }
  }

  async function deleteMeeting() {
    if (!meeting || meeting.status === "recording") return;
    if (!window.confirm(`将“${meeting.title}”移入最近删除？之后可以恢复。`)) return;
    try {
      await api(`/api/meetings/${meeting.id}`, { method: "DELETE" });
      setMeeting(null);
      setSelectedId(null);
      await refreshMeetings();
      setNotice("会议已移入最近删除，录音和资料仍保存在本机");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "删除失败");
    }
  }

  async function openTrashDialog() {
    setTrashDialogOpen(true);
    setTrashLoading(true);
    try {
      const result = await api<{ meetings: MeetingBrief[] }>("/api/meetings/trash");
      setDeletedMeetings(result.meetings);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法读取最近删除");
    } finally {
      setTrashLoading(false);
    }
  }

  async function restoreDeletedMeeting(item: MeetingBrief) {
    setTrashLoading(true);
    try {
      const restored = await api<Meeting>(`/api/meetings/${item.id}/restore`, { method: "POST" });
      setDeletedMeetings((items) => items.filter((meetingItem) => meetingItem.id !== item.id));
      await refreshMeetings(restored.id);
      setMeeting(restored);
      setSelectedId(restored.id);
      setTrashDialogOpen(false);
      setNotice(`已恢复“${restored.title}”及其录音、资料和总结`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法恢复会议");
    } finally {
      setTrashLoading(false);
    }
  }

  async function permanentlyDeleteMeeting(item: MeetingBrief) {
    if (!window.confirm(`永久删除“${item.title}”及其录音和资料？此操作无法撤销。`)) return;
    setTrashLoading(true);
    try {
      await api(`/api/meetings/${item.id}/permanent`, { method: "DELETE" });
      setDeletedMeetings((items) => items.filter((meetingItem) => meetingItem.id !== item.id));
      setNotice("会议已永久删除，无法恢复");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法永久删除会议");
    } finally {
      setTrashLoading(false);
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

  async function confirmSegmentSpeaker(segment: Segment, speakerId: string) {
    if (!meeting || !speakerId || segmentSpeakerSavingId) return;
    setSegmentSpeakerSavingId(segment.id);
    try {
      const updated = await api<Meeting>(`/api/segments/${segment.id}/speaker`, {
        method: "PATCH",
        body: JSON.stringify({ speakerId }),
      });
      setMeeting(updated);
      mergeMeetingList(updated);
      setNotice("已确认该段发言人；AI 总结已标记为需要重新生成");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法确认该段发言人");
    } finally {
      setSegmentSpeakerSavingId(null);
    }
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
    const overlapTotal = sourceMeeting.segments.filter((segment) => segment.overlapSuspected).length;
    if (overlapTotal) lines.push("", `> ⚠ 检测到 ${overlapTotal} 处疑似重叠发言；相关内容没有强行归属给具体个人。`);
    for (const segment of sourceMeeting.segments) {
      const possibleNames = segment.overlapSpeakerIds.map((id) => names.get(id)).filter(Boolean).join(" / ");
      const name = segment.overlapSuspected
        ? `疑似重叠发言（归属待确认${possibleNames ? `：${possibleNames}` : ""}）`
        : names.get(segment.speakerId || "") || "待确认发言人";
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
      setSettingsSection("notebook");
      setSettingsPageOpen(true);
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
    const transcript = meeting.segments.map((segment) => {
      const possibleNames = segment.overlapSpeakerIds.map((id) => names.get(id)).filter(Boolean).join(" / ");
      const speakerName = segment.overlapSuspected
        ? `疑似重叠发言 · 归属待确认${possibleNames ? `（可能涉及：${possibleNames}）` : ""}`
        : names.get(segment.speakerId || "") || "待确认发言人";
      const confidence = segment.overlapSuspected && segment.overlapConfidence
        ? `<small class="overlap-note">重叠可能 ${Math.round(segment.overlapConfidence * 100)}%</small>`
        : "";
      return `
        <div class="transcript-row">
          <time>${formatClock(segment.startMs)}–${formatClock(segment.endMs)}</time>
          <div><b>${escapeHtml(speakerName)}</b>${confidence}<p>${escapeHtml(segment.cleanedText)}</p></div>
        </div>`;
    }).join("");
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

  const displayedAppVersion = applicationUpdate?.currentVersion || CURRENT_APP_VERSION;
  const currentVersionInfo = versionHistory.find((item) => item.version === displayedAppVersion) || versionHistory[0];
  const availableReleaseNotes = applicationUpdate?.releaseNotes || [];
  const isMacDesktop = audioCaptureCapabilities?.platform === "darwin";
  const isWindowsDesktop = audioCaptureCapabilities?.platform === "win32";
  const macScreenPermission = audioCaptureCapabilities?.screenPermission || "unknown";
  const macMicrophonePermission = audioCaptureCapabilities?.microphonePermission || "unknown";
  const macScreenPermissionBlocked = ["denied", "restricted"].includes(macScreenPermission);
  const macMicrophonePermissionBlocked = ["denied", "restricted"].includes(macMicrophonePermission);
  const recordingSourceCheck = meetingPreflight?.checks.find((item) => item.id === "recording-source");
  const microphonePermissionNeedsAction = audioSourceMode !== "system"
    && recordingSourceCheck?.status === "blocked"
    && recordingSourceCheck.detail.includes("麦克风权限未开启");
  const meetingBlockedForOtherReason = meetingPreflight?.status === "blocked" && !microphonePermissionNeedsAction;
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
    <main className={`app-shell recording-backdrop-${recordingBackdrop} ${recording ? "is-recording" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <header className="window-chrome" aria-label="拾音 AI 软件窗口">
        <div className="window-chrome-safe-area">
          <button type="button" className="window-chrome-brand" onClick={returnToCurrentMeeting} title="返回本次会议" aria-label="返回本次会议">
            <ShiyinMark className="window-chrome-mark" />
            <strong>拾音 AI</strong>
            <i />
            <span>会议听记工作台</span>
          </button>
          <div className="window-chrome-meta">
            <span className="window-version">v{displayedAppVersion}</span>
            <div className="window-chrome-state"><i /> 本地运行</div>
          </div>
        </div>
      </header>
      <input
        ref={attachmentInputRef}
        className="visually-hidden"
        type="file"
        multiple
        accept=".txt,.md,.markdown,.csv,.json,.log,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.heic"
        onChange={(event) => handleAttachmentFiles(event.target.files)}
      />
      <aside className="sidebar" id="app-sidebar">
        <div className="sidebar-brand-row">
          <button type="button" className="brand" onClick={returnToCurrentMeeting} title="返回本次会议" aria-label="返回本次会议">
            <ShiyinMark className="brand-mark" /><span>拾音</span><em>AI</em>
          </button>
          <button
            type="button"
            className="sidebar-collapse-toggle"
            onClick={toggleSidebarCollapsed}
            aria-controls="app-sidebar"
            aria-expanded={!sidebarCollapsed}
            aria-label={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
            title={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
          >
            <ArrowRight size={15} />
          </button>
        </div>
        <button className="new-note" disabled={processing} onClick={() => {
          if (!recording) {
            setSettingsPageOpen(false);
            setWorkspacePageOpen(false);
          }
          void toggleRecording();
        }}>
          <span>{recording ? "■" : "●"}</span>{recording ? "结束听记" : "开始新听记"}
        </button>
        <details className="sidebar-quick-settings">
          <summary>
            <span><Waveform size={16} weight="duotone" /><b>本次会议设置</b></span>
            <small>{audioSourceMode === "mixed" ? "混合录音" : audioSourceMode === "system" ? "电脑声音" : "麦克风"} · {speakerLimitMode === "auto" ? "自动识别人声" : `最多 ${speakerLimit} 人`}</small>
            <ArrowRight size={13} />
          </summary>
          <div className="sidebar-quick-settings-body">
        <button type="button" className="local-storage-note" onClick={() => void openSettingsDialog("data")}>
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
            <span><b id="speaker-limit-title">发言人数识别</b><small>默认自动检测，也可设置手动上限</small></span>
          </div>
          <div className="speaker-limit-options" role="radiogroup" aria-label="选择新会议的发言人数上限">
            <button
              type="button"
              className={speakerLimitMode === "auto" ? "active" : ""}
              aria-pressed={speakerLimitMode === "auto"}
              disabled={recording || processing}
              onClick={() => {
                setSpeakerLimitMode("auto");
                window.localStorage.setItem("shiyin.speakerLimitMode", "auto");
                setNotice("下一场会议将自动检测发言人数");
              }}
            >
              <b>自动</b><small>推荐</small>
            </button>
            {speakerLimitOptions.map((option) => (
              <button
                type="button"
                key={option.value}
                className={speakerLimitMode === "manual" && speakerLimit === option.value ? "active" : ""}
                aria-pressed={speakerLimitMode === "manual" && speakerLimit === option.value}
                disabled={recording || processing}
                onClick={() => {
                  setSpeakerLimit(option.value);
                  setSpeakerLimitMode("manual");
                  window.localStorage.setItem("shiyin.maxSpeakers", String(option.value));
                  window.localStorage.setItem("shiyin.speakerLimitMode", "manual");
                  setNotice(`下一场会议最多区分 ${option.value} 位发言人`);
                }}
              >
                <b>{option.label}</b><small>{option.detail}</small>
              </button>
            ))}
          </div>
          {speakerLimitMode === "auto"
            ? <p>先识别 6 位；持续检测到可信的新声纹后，再逐级扩展到 12、20 位。</p>
            : speakerLimit > 12 && <p>人数较多时，建议会后检查并合并误分的发言人。</p>}
        </section>
        <button className="template-quick-button" onClick={openTemplateDialog} disabled={recording || processing}>
          <span className={`template-quick-icon ${(meeting?.summaryTemplate || defaultSummaryTemplate).replace("meeting-", "")}`}>
            {summaryTemplateIcon(meeting?.summaryTemplate || defaultSummaryTemplate, 18)}
          </span>
          <span>
            <small>总结模板</small>
            <b>{summaryTemplateName(meeting?.summaryTemplate || defaultSummaryTemplate)}</b>
            <em>{(meeting?.reportStyle || defaultReportStyle) === "visual" ? "图文总结" : "深度纪要"}</em>
          </span>
          <ArrowRight size={15} />
        </button>
        <section className="appearance-picker" aria-labelledby="appearance-picker-title">
          <div className="appearance-picker-heading">
            <Palette size={15} weight="duotone" />
            <span id="appearance-picker-title">界面外观</span>
          </div>
          <div role="radiogroup" aria-label="界面颜色模式">
            <button type="button" className={themeMode === "system" ? "active" : ""} aria-pressed={themeMode === "system"} onClick={() => selectTheme("system")}><Desktop size={14} />系统</button>
            <button type="button" className={themeMode === "light" ? "active" : ""} aria-pressed={themeMode === "light"} onClick={() => selectTheme("light")}><Sun size={14} />浅色</button>
            <button type="button" className={themeMode === "dark" ? "active" : ""} aria-pressed={themeMode === "dark"} onClick={() => selectTheme("dark")}><Moon size={14} />深色</button>
          </div>
        </section>
        {globalShortcutStatus && (
          <div className={`shortcut-hint ${globalShortcutStatus.openWindow && globalShortcutStatus.toggleRecording ? "" : "warning"}`}>
            <span><b>{globalShortcutStatus.openLabel}</b><small>打开应用</small></span>
            <span><b>{globalShortcutStatus.recordingLabel}</b><small>开始 / 结束</small></span>
            <em>{globalShortcutStatus.openWindow && globalShortcutStatus.toggleRecording ? "桌面全局快捷键" : "快捷键被其他应用占用"}</em>
          </div>
        )}
          </div>
        </details>
        <div className="nav-label history-heading">
          <span>历史会议</span>
          <span><b>{meetings.length}</b><button type="button" onClick={() => void openTrashDialog()}><Trash size={12} /> 最近删除</button></span>
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
                onClick={() => {
                  setSettingsPageOpen(false);
                  setWorkspacePageOpen(false);
                  setSelectedId(item.id);
                }}
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
          <button className={`settings-button ${settingsPageOpen ? "active" : ""} ${miniMaxSettings?.configured ? "" : "needs-attention"}`} disabled={recording || processing} onClick={() => void openSettingsDialog("general")}>
            <GearSix size={17} weight="duotone" />
            <span><b>设置</b><small>{miniMaxSettings?.configured ? `v${displayedAppVersion} · 偏好、AI 与数据` : `v${displayedAppVersion} · 需要配置 MiniMax`}</small></span>
          </button>
          <button type="button" className={`profile workspace-entry ${workspacePageOpen ? "active" : ""}`} onClick={openLocalWorkspace} aria-label="打开本机工作区">
            <span>本</span><p><b>本机工作区</b><small>{meetings.length} 场会议 · {workspaceStats.attachmentCount} 份资料</small></p><ArrowRight size={14} />
          </button>
        </div>
      </aside>

      <section className={`workspace ${settingsPageOpen ? "settings-workspace" : ""} ${workspacePageOpen ? "workspace-hub-surface" : ""}`} ref={workspaceRef}>
        {settingsPageOpen ? (
          <div className="settings-page">
            <header className="settings-page-hero">
              <div>
                <span><GearSix size={16} weight="duotone" /> 个性化你的拾音工作流</span>
                <h1>设置</h1>
                <p>这里保存的是新会议的默认习惯；开始会议前仍可在左侧临时调整。</p>
              </div>
              <button type="button" onClick={() => setSettingsPageOpen(false)}><X size={17} /> 返回会议</button>
            </header>
            <div className="settings-page-layout">
              <nav className="settings-page-nav" aria-label="设置分类">
                <button className={settingsSection === "general" ? "active" : ""} onClick={() => setSettingsSection("general")}><Palette size={17} /><span><b>常规</b><small>外观与阅读习惯</small></span></button>
                <button className={settingsSection === "meeting" ? "active" : ""} onClick={() => setSettingsSection("meeting")}><Waveform size={17} /><span><b>会议与转写</b><small>录音和发言人默认值</small></span></button>
                <button className={settingsSection === "ai" ? "active" : ""} onClick={() => setSettingsSection("ai")}><Brain size={17} /><span><b>AI 与纪要</b><small>MiniMax 和整理方式</small></span></button>
                <button className={settingsSection === "notebook" ? "active" : ""} onClick={() => setSettingsSection("notebook")}><FileText size={17} /><span><b>笔记与导出</b><small>Obsidian 与 Markdown</small></span></button>
                <button className={settingsSection === "data" ? "active" : ""} onClick={() => setSettingsSection("data")}><HardDrives size={17} /><span><b>数据与隐私</b><small>本地文件和备份</small></span></button>
                <button className={settingsSection === "updates" ? "active" : ""} onClick={() => setSettingsSection("updates")}><ArrowClockwise size={17} /><span><b>更新与快捷键</b><small>版本和桌面操作</small></span></button>
              </nav>

              <div className="settings-page-content">
                {settingsSection === "general" && (
                  <section className="settings-panel" aria-labelledby="settings-general-title">
                    <header><span><Palette size={20} weight="duotone" /></span><div><h2 id="settings-general-title">常规</h2><p>调整界面外观和会议记录的阅读方式。</p></div></header>
                    <div className="settings-row">
                      <div><b>界面颜色</b><small>可固定主题，也可以跟随电脑系统。</small></div>
                      <div className="settings-segmented" role="radiogroup" aria-label="界面颜色模式">
                        <button className={themeMode === "system" ? "active" : ""} onClick={() => selectTheme("system")}><Desktop size={14} /> 系统</button>
                        <button className={themeMode === "light" ? "active" : ""} onClick={() => selectTheme("light")}><Sun size={14} /> 浅色</button>
                        <button className={themeMode === "dark" ? "active" : ""} onClick={() => selectTheme("dark")}><Moon size={14} /> 深色</button>
                      </div>
                    </div>
                    <div className="settings-row">
                      <div><b>逐字稿排列</b><small>设置打开会议记录时的默认顺序。</small></div>
                      <div className="settings-segmented">
                        <button className={transcriptOrder === "ascending" ? "active" : ""} onClick={() => { setTranscriptOrder("ascending"); window.localStorage.setItem("shiyin.transcriptOrder", "ascending"); }}>正序</button>
                        <button className={transcriptOrder === "descending" ? "active" : ""} onClick={() => { setTranscriptOrder("descending"); window.localStorage.setItem("shiyin.transcriptOrder", "descending"); }}>倒序</button>
                      </div>
                    </div>
                    <div className="settings-block">
                      <div><b>默认录音背景</b><small>只改变录音页面的视觉氛围，不影响录音质量。</small></div>
                      <div className="settings-backdrop-grid">
                        {recordingBackdrops.map((backdrop) => <button key={backdrop.id} className={`${backdrop.id} ${recordingBackdrop === backdrop.id ? "active" : ""}`} onClick={() => selectRecordingBackdrop(backdrop.id)}><i /><span><b>{backdrop.name}</b><small>{backdrop.detail}</small></span>{recordingBackdrop === backdrop.id && <CheckCircle size={16} weight="fill" />}</button>)}
                      </div>
                    </div>
                  </section>
                )}

                {settingsSection === "meeting" && (
                  <section className="settings-panel" aria-labelledby="settings-meeting-title">
                    <header><span><Waveform size={20} weight="duotone" /></span><div><h2 id="settings-meeting-title">会议与转写</h2><p>这些选项会作为下一场会议的默认值。</p></div></header>
                    <label className="settings-select-row"><span><b>默认录音来源</b><small>开始前仍可在侧边栏切换。</small></span><select value={audioSourceMode} disabled={recording} onChange={(event) => selectAudioSource(event.target.value as AudioSourceMode)}><option value="microphone">仅麦克风</option><option value="system" disabled={!systemAudioAvailable}>仅电脑声音</option><option value="mixed" disabled={!systemAudioAvailable}>电脑声音 + 麦克风</option></select></label>
                    <label className="settings-select-row"><span><b>默认麦克风</b><small>{audioSourceMode === "system" ? "仅电脑声音时不会启用麦克风。" : "使用系统当前可用的录音设备。"}</small></span><select value={selectedDeviceId} disabled={recording || audioSourceMode === "system"} onChange={(event) => { const deviceId = event.target.value; setSelectedDeviceId(deviceId); setActiveDeviceLabel(audioInputs.find((item) => item.deviceId === deviceId)?.label || "自动选择麦克风"); window.localStorage.setItem("shiyin.microphoneId", deviceId); }}>{audioInputs.map((input, index) => <option key={input.deviceId} value={input.deviceId}>{input.label || `麦克风 ${index + 1}`}</option>)}</select></label>
                    <div className="settings-block">
                      <div><b>发言人数识别</b><small>推荐自动检测；手动上限适合人数明确的固定会议。</small></div>
                      <div className="settings-choice-grid speaker-choices">
                        <button className={speakerLimitMode === "auto" ? "active" : ""} onClick={() => { setSpeakerLimitMode("auto"); window.localStorage.setItem("shiyin.speakerLimitMode", "auto"); }}><b>自动</b><small>从 6 人逐步扩展</small></button>
                        {speakerLimitOptions.map((option) => <button key={option.value} className={speakerLimitMode === "manual" && speakerLimit === option.value ? "active" : ""} onClick={() => { setSpeakerLimitMode("manual"); setSpeakerLimit(option.value); window.localStorage.setItem("shiyin.speakerLimitMode", "manual"); window.localStorage.setItem("shiyin.maxSpeakers", String(option.value)); }}><b>{option.label}</b><small>{option.detail}</small></button>)}
                      </div>
                    </div>
                    <section className={`settings-preflight meeting-preflight ${meetingPreflight?.status || "checking"}`} aria-label="会议前自检" aria-live="polite">
                      <header>
                        <span><ShieldCheck size={18} weight="duotone" /></span>
                        <div><b>会议前自检</b><small>{meetingPreflightLoading && !meetingPreflight ? "正在检查录音与本地环境…" : `${preflightReadyCount} 项正常${preflightAttentionCount ? ` · ${preflightAttentionCount} 项需要留意` : ""}`}</small></div>
                        <em>{preflightStatusLabel}</em>
                        <button type="button" disabled={meetingPreflightLoading} onClick={() => void refreshMeetingPreflight()}><ArrowClockwise size={14} className={meetingPreflightLoading ? "spinning" : ""} /> 重新检查</button>
                      </header>
                      {meetingPreflight?.checks.length ? (
                        <div className="meeting-preflight-grid">
                          {meetingPreflight.checks.map((item) => <article key={item.id} className={item.status}>{item.status === "ready" ? <CheckCircle size={15} weight="fill" /> : <WarningCircle size={15} weight="fill" />}<span><b>{item.label}</b><small>{item.detail}</small></span></article>)}
                        </div>
                      ) : <div className="meeting-preflight-loading"><i /><i /><i /></div>}
                    </section>
                    <div className="settings-info-note"><CheckCircle size={17} weight="fill" /><p><b>本地智能处理</b><span>标点恢复、实时声纹匹配和会后多人发言检查保持启用，原始识别文本不会被覆盖。</span></p></div>
                  </section>
                )}

                {settingsSection === "ai" && (
                  <section className="settings-panel" aria-labelledby="settings-ai-title">
                    <header><span><Brain size={20} weight="duotone" /></span><div><h2 id="settings-ai-title">AI 与纪要</h2><p>控制会议结束后的 MiniMax 整理流程。</p></div></header>
                    <div className="settings-switch-row"><div><b>会议结束后自动总结</b><small>关闭后只保存录音、逐字稿和发言人，可稍后手动总结。</small></div><button role="switch" aria-checked={autoSummaryEnabled} className={`settings-switch ${autoSummaryEnabled ? "on" : ""}`} onClick={() => selectAutoSummary(!autoSummaryEnabled)}><i /></button></div>
                    <div className="settings-switch-row"><div><b>总结后自动命名会议</b><small>按会议类型组合对方单位、联系人或项目、主题和日期；不猜测，也不覆盖手动名称。</small></div><button role="switch" aria-checked={autoTitleEnabled} disabled={!autoSummaryEnabled} className={`settings-switch ${autoTitleEnabled ? "on" : ""}`} onClick={() => selectAutoTitle(!autoTitleEnabled)}><i /></button></div>
                    <div className="settings-block"><div><b>默认总结方式</b><small>内容模板决定关注重点，报告样式只改变展示。</small></div><div className="settings-template-summary"><span><Sparkle size={17} weight="duotone" /><b>{summaryTemplateName(defaultSummaryTemplate)}</b><small>{defaultReportStyle === "visual" ? "图文总结" : "深度纪要"}</small></span><button onClick={openTemplateDialog}>选择模板</button></div></div>
                    <form className="settings-credentials" onSubmit={(event) => { event.preventDefault(); void saveSettings(); }}>
                      <div className="settings-section-title"><div><b>MiniMax 连接</b><small>密钥使用当前系统安全加密，只保存在这台电脑。</small></div><em className={miniMaxSettings?.configured ? "ready" : ""}>{miniMaxSettings?.configured ? "已配置" : "未配置"}</em></div>
                      <label><span>API Key</span><input type="password" autoComplete="off" value={miniMaxKeyDraft} disabled={!miniMaxSettings?.managedByApp || settingsSaving} onChange={(event) => setMiniMaxKeyDraft(event.target.value)} placeholder={miniMaxSettings?.configured ? "留空可保留当前密钥" : "请输入 MiniMax API Key"} /></label>
                      <label><span>模型</span><input value={miniMaxModelDraft} disabled={!miniMaxSettings?.managedByApp || settingsSaving} onChange={(event) => setMiniMaxModelDraft(event.target.value)} placeholder="MiniMax-M3" /></label>
                      {settingsError && <p className="settings-error"><WarningCircle size={14} />{settingsError}</p>}
                      <button className="settings-primary" type="submit" disabled={!miniMaxSettings?.managedByApp || settingsSaving}>{settingsSaving ? "正在保存…" : "保存 AI 配置"}</button>
                    </form>
                  </section>
                )}

                {settingsSection === "notebook" && (
                  <section className="settings-panel" aria-labelledby="settings-notebook-title">
                    <header><span><FileText size={20} weight="duotone" /></span><div><h2 id="settings-notebook-title">笔记与导出</h2><p>把会议纪要接入你习惯使用的知识库。</p></div></header>
                    <div className="settings-connect-card"><div><span><FileText size={22} weight="duotone" /></span><p><b>Obsidian AI 笔记本</b><small>{notebookSettings?.obsidianConfigured ? `已连接：${notebookSettings.obsidianVaultName || "当前 Vault"}` : "可选功能，未连接时不会自动同步或弹出错误。"}</small></p></div><button onClick={() => void connectNotebook()} disabled={notebookConnecting}>{notebookConnecting ? "正在选择…" : notebookSettings?.obsidianConfigured ? "更换 Vault" : "连接 Obsidian"}</button></div>
                    <div className="settings-switch-row"><div><b>会议结束后自动同步</b><small>只有连接 Obsidian 后才会生效，仍可从导出菜单手动同步。</small></div><button role="switch" aria-checked={obsidianAutoSave} disabled={!notebookSettings?.obsidianConfigured} className={`settings-switch ${obsidianAutoSave ? "on" : ""}`} onClick={toggleObsidianAutoSave}><i /></button></div>
                    <div className="settings-info-note neutral"><FileText size={17} weight="duotone" /><p><b>Markdown 是默认推荐格式</b><span>完整保留标题、摘要、行动项和逐字稿，适合直接交给其他 AI Agent 分析。</span></p></div>
                  </section>
                )}

                {settingsSection === "data" && (
                  <section className="settings-panel" aria-labelledby="settings-data-title">
                    <header><span><HardDrives size={20} weight="duotone" /></span><div><h2 id="settings-data-title">数据与隐私</h2><p>会议录音、逐字稿和声纹资料默认保存在本机。</p></div></header>
                    <div className="settings-storage-overview"><span><small>本机工作区</small><strong>{storageInfo ? formatBytes(storageInfo.totalBytes) : "正在读取…"}</strong><em>{storageInfo ? `${storageInfo.meetingCount} 场会议` : ""}</em></span><button onClick={() => void openStorageDialog()}>查看空间明细</button></div>
                    <div className="settings-action-grid"><button onClick={() => void openDataFolder()}><FolderOpen size={18} /><span><b>打开数据文件夹</b><small>查看本机保存位置</small></span></button><button onClick={() => void createBackup()} disabled={Boolean(backupBusy)}><HardDrives size={18} /><span><b>创建完整备份</b><small>录音、纪要和声纹一起保存</small></span></button><button onClick={() => void restoreBackup()} disabled={Boolean(backupBusy)}><ArrowClockwise size={18} /><span><b>恢复备份</b><small>安全合并，不覆盖已有会议</small></span></button><button onClick={() => void openTrashDialog()}><Trash size={18} /><span><b>最近删除</b><small>恢复误删除的会议</small></span></button></div>
                    {storageError && <p className="settings-error"><WarningCircle size={14} />{storageError}</p>}
                    <div className="settings-info-note"><CheckCircle size={17} weight="fill" /><p><b>隐私边界</b><span>本地转写、录音和声纹不会上传；只有生成 AI 纪要时，整理后的会议文字和可读取资料会发送给 MiniMax。</span></p></div>
                  </section>
                )}

                {settingsSection === "updates" && (
                  <section className="settings-panel" aria-labelledby="settings-updates-title">
                    <header><span><ArrowClockwise size={20} weight="duotone" /></span><div><h2 id="settings-updates-title">更新与快捷键</h2><p>检查新版本并确认桌面全局快捷键是否可用。</p></div></header>
                    <div className="settings-update-card">
                      <div><span><ArrowClockwise size={20} weight="duotone" /></span><p><b>拾音 AI v{displayedAppVersion}</b><small>{applicationUpdate?.message || "安装版会自动检查正式更新。"}</small></p></div>
                      {applicationUpdate?.supported && <button disabled={!applicationUpdate.canCheck && !applicationUpdate.canDownload && !applicationUpdate.canInstall} onClick={() => void handleApplicationUpdate()}>{applicationUpdate.canInstall ? "重启并安装" : applicationUpdate.canDownload ? "下载更新" : "检查更新"}</button>}
                    </div>
                    {currentVersionInfo && (
                      <article className="settings-current-release">
                        <div><span>当前版本</span><time>{currentVersionInfo.date}</time></div>
                        <h3>v{currentVersionInfo.version} · {currentVersionInfo.summary}</h3>
                        <ul>{currentVersionInfo.changes.map((change) => <li key={change}>{change}</li>)}</ul>
                      </article>
                    )}
                    {applicationUpdate?.availableVersion && (
                      <article className="settings-available-release">
                        <div><span>可用更新</span><b>v{applicationUpdate.availableVersion}</b></div>
                        <h3>{applicationUpdate.releaseName || `拾音 AI v${applicationUpdate.availableVersion}`}</h3>
                        {availableReleaseNotes.length
                          ? <ul>{availableReleaseNotes.map((note, index) => <li key={`${index}-${note}`}>{note}</li>)}</ul>
                          : <p>这个版本尚未提供更新说明，建议发布前补充 GitHub Release 内容。</p>}
                      </article>
                    )}
                    <details className="settings-version-history">
                      <summary>查看全部版本记录 <span>{versionHistory.length} 个版本</span></summary>
                      <div>{versionHistory.map((item) => (
                        <article key={item.version} className={item.version === displayedAppVersion ? "current" : ""}>
                          <div><b>v{item.version}</b><time>{item.date}</time></div>
                          <p>{item.summary}</p>
                          <ul>{item.changes.map((change) => <li key={change}>{change}</li>)}</ul>
                        </article>
                      ))}</div>
                    </details>
                    <div className="settings-shortcut-grid"><article><kbd>{globalShortcutStatus?.openLabel || "⌃⌥M"}</kbd><span><b>打开应用</b><small>{globalShortcutStatus?.openWindow === false ? "快捷键被其他应用占用" : "全局可用"}</small></span></article><article><kbd>{globalShortcutStatus?.recordingLabel || "⌃⌥R"}</kbd><span><b>开始 / 结束会议</b><small>{globalShortcutStatus?.toggleRecording === false ? "快捷键被其他应用占用" : "全局可用"}</small></span></article></div>
                    <div className="settings-info-note neutral"><CheckCircle size={17} weight="duotone" /><p><b>更新不会删除会议记录</b><span>应用程序和会议数据分开保存，覆盖安装或自动更新都会保留本机历史会议。</span></p></div>
                  </section>
                )}
              </div>
            </div>
          </div>
        ) : workspacePageOpen ? (
          <main className="workspace-hub" aria-labelledby="workspace-hub-title">
            <header className="workspace-hub-hero">
              <div>
                <span><HardDrives size={16} weight="duotone" /> 会议资产保存在这台电脑</span>
                <h1 id="workspace-hub-title">本机工作区</h1>
                <p>集中查看历史会议、累计时长和会议资料。这里会逐步成为你的个人会议知识库。</p>
              </div>
              <button type="button" onClick={returnToCurrentMeeting}><ArrowLeft size={17} /> 返回会议</button>
            </header>

            <section className="workspace-metrics" aria-label="工作区统计">
              <article><span><ChartBar size={19} weight="duotone" /></span><p><small>历史会议</small><strong>{meetings.length}</strong><em>场</em></p></article>
              <article><span><Clock size={19} weight="duotone" /></span><p><small>累计时长</small><strong>{formatWorkspaceDuration(workspaceStats.totalDurationMs)}</strong></p></article>
              <article><span><FileText size={19} weight="duotone" /></span><p><small>已生成纪要</small><strong>{workspaceStats.summarizedMeetings}</strong><em>场</em></p></article>
              <article><span><Paperclip size={19} weight="duotone" /></span><p><small>会议资料</small><strong>{workspaceStats.attachmentCount}</strong><em>份</em></p></article>
            </section>

            <div className="workspace-hub-grid">
              <section className="workspace-library" aria-labelledby="workspace-library-title">
                <header>
                  <div><span>会议档案</span><h2 id="workspace-library-title">全部历史会议</h2></div>
                  <label><MagnifyingGlass size={14} /><input type="search" value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder="搜索会议名称或日期" aria-label="搜索工作区会议" />{historyQuery && <button type="button" onClick={() => setHistoryQuery("")} aria-label="清空工作区搜索"><X size={12} /></button>}</label>
                </header>
                <div className="workspace-meeting-list">
                  {visibleMeetings.map((item) => (
                    <button type="button" key={item.id} onClick={() => openWorkspaceMeeting(item.id)}>
                      <span className="workspace-meeting-date"><b>{new Date(item.startedAt).getDate().toString().padStart(2, "0")}</b><small>{new Date(item.startedAt).toLocaleDateString("zh-CN", { month: "short" })}</small></span>
                      <span className="workspace-meeting-copy"><b>{item.title}</b><small>{formatMeetingDate(item.startedAt)} · {formatClock(item.durationMs)}{item.attachmentCount ? ` · ${item.attachmentCount} 份资料` : ""}</small></span>
                      <span className={`workspace-summary-state ${item.summary ? "ready" : ""}`}>{item.summary ? "已有纪要" : "仅记录"}</span>
                      <ArrowRight size={15} />
                    </button>
                  ))}
                  {!loading && !meetings.length && <div className="workspace-empty"><Waveform size={30} weight="duotone" /><b>还没有会议档案</b><p>开始第一次听记后，录音、逐字稿和纪要会出现在这里。</p></div>}
                  {!loading && Boolean(meetings.length) && !visibleMeetings.length && <div className="workspace-empty"><MagnifyingGlass size={28} /><b>没有找到匹配会议</b><p>换一个名称或日期再试试。</p></div>}
                </div>
              </section>

              <aside className="workspace-knowledge" aria-labelledby="workspace-knowledge-title">
                <header><span>资料库</span><h2 id="workspace-knowledge-title">会议相关资料</h2><p>资料跟随原会议保存，点击会议即可查看或继续补充。</p></header>
                {meetingsWithMaterials.length ? (
                  <div>{meetingsWithMaterials.slice(0, 8).map((item) => (
                    <button type="button" key={item.id} onClick={() => openWorkspaceMeeting(item.id)}><span><FileText size={17} weight="duotone" /></span><p><b>{item.title}</b><small>{item.attachmentCount} 份资料 · {formatMeetingDate(item.startedAt)}</small></p><ArrowRight size={14} /></button>
                  ))}</div>
                ) : (
                  <div className="workspace-material-empty"><Paperclip size={24} weight="duotone" /><b>还没有会议资料</b><p>可以在开始会议前或会议详情中添加 PDF、Office、Markdown 和图片。</p></div>
                )}
                <footer><Brain size={17} weight="duotone" /><p><b>会议知识问答</b><small>后续会在引用逐字稿与资料来源的基础上开放。</small></p></footer>
              </aside>
            </div>
          </main>
        ) : (
          <>
        <header className="topbar">
          <div>
            <div className="eyebrow">
              <span className={`status-dot ${meeting?.status === "recording" ? "recording" : ""}`} />
              {meeting ? `${statusLabel(meeting.status)} · ${formatMeetingDate(meeting.startedAt)}` : "准备开始本地听记"}
            </div>
            <h1>{meeting?.title || "拾音 AI 会议听记"}</h1>
            <p>
              {meeting
                ? `${meeting.speakers.length ? `已识别 ${meeting.speakers.length}` : "待识别"} 位发言人 · ${meeting.speakerLimitMode === "auto" ? "自动检测" : `上限 ${meeting.maxSpeakers} 人`} · ${formatClock(meeting.durationMs || seconds * 1000)}`
                : "选择录音来源，发言人数可自动检测，然后开始本地会议听记"}
            </p>
          </div>
          {meeting ? <div className="top-actions">
            <button disabled={attachmentUploading} onClick={() => attachmentInputRef.current?.click()}><Paperclip size={15} /> 资料 {meeting.attachments.length || ""}</button>
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
                      : void openSettingsDialog("notebook")}
                  ><b>{obsidianSaving ? "正在同步…" : notebookSettings?.obsidianConfigured ? "同步到 AI 笔记本" : "连接 AI 笔记本"}</b><span>{notebookSettings?.obsidianConfigured ? `Obsidian · ${notebookSettings.obsidianVaultName || "已连接"}` : "可选连接自己的 Obsidian 知识库"}</span></button>
                  <button onClick={toggleObsidianAutoSave}><b>结束后自动同步</b><span>{obsidianAutoSave ? "已开启 · 后续会议自动保存" : "默认关闭 · 用户可自行开启"}</span></button>
                  <button onClick={exportHtmlReport}><b>网页报告</b><span>适合浏览与打印</span></button>
                  <button onClick={downloadMarkdownReport}><b>Markdown 文件</b><span>适合 AI Agent 分析</span></button>
                  <button onClick={() => void copyMarkdownReport()}><b>复制 Markdown</b><span>直接粘贴给其他 AI</span></button>
                </div>
              )}
            </div>
            <div className="more-control">
              <button disabled={recording || processing} onClick={() => setMoreMenuOpen((open) => !open)} aria-expanded={moreMenuOpen}>··· 更多</button>
              {moreMenuOpen && (
                <div className="more-menu" role="menu">
                  <button onClick={() => { setMoreMenuOpen(false); openTemplateDialog(); }}><Compass size={15} /> 更换总结模板</button>
                  <button disabled={meetingIsBusy(meeting.status)} onClick={() => { setMoreMenuOpen(false); void rerunCorrection(); }}><ArrowClockwise size={15} /> 重新校正发言人</button>
                  <button disabled={meetingIsBusy(meeting.status)} onClick={() => { setMoreMenuOpen(false); void rerunSummary(); }}><Sparkle size={15} /> 重新生成总结</button>
                  <button disabled={meetingAutoNaming || meetingIsBusy(meeting.status)} onClick={() => { setMoreMenuOpen(false); void autoNameMeeting(); }}><PencilSimple size={15} /> {meetingAutoNaming ? "正在命名" : "智能命名会议"}</button>
                  <button disabled={meetingIsBusy(meeting.status)} onClick={() => { setMoreMenuOpen(false); setTranscriptionDialogOpen(true); }}><Waveform size={15} /> 查看转写版本</button>
                  <button className="danger" disabled={meetingIsBusy(meeting.status)} onClick={() => { setMoreMenuOpen(false); void deleteMeeting(); }}><Trash size={15} /> 删除会议</button>
                </div>
              )}
            </div>
          </div> : (
            <div className="top-actions start-top-actions">
              <button type="button" onClick={openLocalWorkspace}><HardDrives size={15} /> 本机工作区</button>
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
                <button className="audio-edit-button" type="button" disabled={processing || meetingIsBusy(meeting.status)} onClick={openAudioEditor}>
                  <Scissors size={15} /> 剪辑音频
                </button>
              </section>
            )}
            {meeting?.audioClips.length ? (
              <section className="audio-clip-shelf" aria-label="已保存的音频剪辑">
                <header><span><Scissors size={16} weight="duotone" /><b>已保存剪辑</b></span><small>{meeting.audioClips.length} 个 · 原始录音未修改</small></header>
                <div>
                  {meeting.audioClips.map((clip) => {
                    const speakerNames = meeting.speakers
                      .filter((speaker) => clip.speakerIds.includes(speaker.id))
                      .map((speaker) => speaker.displayName);
                    const clipUrl = `${apiBase}/api/meetings/${encodeURIComponent(meeting.id)}/audio-clips/${encodeURIComponent(clip.id)}/audio`;
                    return (
                      <article key={clip.id}>
                        <span><b>{clip.name}</b><small>{formatClock(clip.durationMs)} · {speakerNames.join("、") || "全部发言人"} · 原录音 {formatClock(clip.startMs)}–{formatClock(clip.endMs)}</small></span>
                        <audio controls preload="metadata" src={clipUrl}>当前系统不支持音频播放。</audio>
                        <a href={clipUrl} download={`${safeFilename(clip.name)}.wav`}><DownloadSimple size={14} /> 保存文件</a>
                        <button type="button" disabled={audioClipSaving} onClick={() => void deleteAudioClip(clip)} aria-label={`删除 ${clip.name}`}><Trash size={14} /></button>
                      </article>
                    );
                  })}
                </div>
              </section>
            ) : null}
            {meeting && (
              <section className="meeting-materials" aria-labelledby="meeting-materials-title">
                <div className="meeting-materials-heading">
                  <span><Paperclip size={17} weight="duotone" /><b id="meeting-materials-title">会议资料</b><small>{meeting.attachments.length} 份</small></span>
                  <button type="button" disabled={attachmentUploading} onClick={() => attachmentInputRef.current?.click()}>{attachmentUploading ? "正在保存…" : "+ 添加资料"}</button>
                </div>
                {meeting.attachments.length ? (
                  <div className="meeting-material-list">
                    {meeting.attachments.map((attachment) => (
                      <article key={attachment.id}>
                        <FileText size={16} weight="duotone" />
                        <span><b>{attachment.originalName}</b><small>{formatBytes(attachment.sizeBytes)} · {attachment.aiReadable ? "AI 可读取正文" : "作为本地附件保存"}</small></span>
                        <button type="button" disabled={attachmentUploading} onClick={() => void removeAttachment(attachment)} aria-label={`移除 ${attachment.originalName}`}><X size={12} /></button>
                      </article>
                    ))}
                  </div>
                ) : <p>可添加议程、方案或参考文档；文本类资料会参与下一次 AI 总结。</p>}
              </section>
            )}
            {!meeting ? (
              <section className="meeting-start-page" aria-labelledby="meeting-start-title">
                <div className="meeting-start-copy">
                  <span className={`meeting-start-kicker ${meetingPreflight?.status || "checking"}`}><i /> {meetingPreflightLoading && !meetingPreflight ? "正在执行会议前自检" : microphonePermissionNeedsAction ? "开始前需要麦克风权限" : meetingPreflight?.status === "blocked" ? "请先处理会议前检查项" : "本地听记已准备就绪"}</span>
                  <h2 id="meeting-start-title">听见讨论，看见下一步</h2>
                  <p>本地记录每一次发言，会议结束后自动整理会议简报与行动项。</p>
                  <button
                    type="button"
                    className="meeting-start-button"
                    aria-label="开始会议"
                    disabled={recording || processing || meetingPreflightLoading || !meetingPreflight || meetingBlockedForOtherReason}
                    onClick={() => void startRecording()}
                  >
                    <span>{microphonePermissionNeedsAction ? <ShieldCheck size={22} weight="fill" /> : <Waveform size={22} weight="fill" />}</span>
                    <strong>{recording ? "正在启动…" : meetingPreflightLoading ? "正在检查…" : microphonePermissionNeedsAction ? "打开麦克风权限" : meetingPreflight?.status === "blocked" ? "请先处理检查项" : "开始会议"}</strong>
                  </button>
                  <div className={`meeting-start-state ${meetingPreflight?.status || "checking"}`} aria-live="polite">
                    {meetingPreflight?.status === "blocked" ? <WarningCircle size={14} weight="fill" /> : <CheckCircle size={14} weight="fill" />}
                    <span>{microphonePermissionNeedsAction ? "点击上方按钮，授权后返回即可开始" : preflightStatusLabel}</span>
                    {microphonePermissionNeedsAction
                      ? <button onClick={() => void openAudioPrivacySettings("microphone")}>打开权限</button>
                      : (meetingPreflight?.status === "blocked" || meetingPreflight?.status === "warning") && <button onClick={() => void openSettingsDialog("meeting")}>查看原因</button>}
                  </div>
                  <div className="meeting-start-secondary" aria-label="其他会议操作">
                    <button
                      type="button"
                      className={audioImportDragActive ? "drag-active" : ""}
                      disabled={recording || processing || audioImportStarting}
                      onClick={() => void importMeetingAudio()}
                      onDragEnter={(event) => { event.preventDefault(); if (!processing) setAudioImportDragActive(true); }}
                      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }}
                      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setAudioImportDragActive(false); }}
                      onDrop={(event) => { event.preventDefault(); setAudioImportDragActive(false); const file = event.dataTransfer.files[0]; if (file) void importMeetingAudio(file); }}
                      title="导入 MP3、M4A、WAV、FLAC、MP4 等会议录音"
                    ><FolderOpen size={16} weight="duotone" /> {audioImportStarting ? "正在导入…" : "导入录音"}</button>
                    <button type="button" disabled={attachmentUploading} onClick={() => attachmentInputRef.current?.click()} title="添加 PDF、Office、Markdown 或图片资料"><Paperclip size={16} weight="duotone" />{pendingAttachments.length ? `资料 ${pendingAttachments.length}` : "会议资料"}</button>
                    <button type="button" onClick={() => void openSettingsDialog("meeting")}><GearSix size={16} weight="duotone" />会议设置</button>
                  </div>
                  {pendingAttachments.length > 0 && (
                    <div className="pending-materials meeting-start-pending" aria-label="待添加的会议资料">
                      {pendingAttachments.map((file, index) => (
                        <span key={`${file.name}-${file.lastModified}-${index}`}><FileText size={12} />{file.name}<button type="button" aria-label={`移除 ${file.name}`} onClick={() => setPendingAttachments((items) => items.filter((_, itemIndex) => itemIndex !== index))}><X size={10} /></button></span>
                      ))}
                    </div>
                  )}
                </div>
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
                {overlapCount > 0 && (
                  <div className="overlap-summary" role="status">
                    <WarningCircle size={19} weight="duotone" />
                    <p>
                      <b>发现 {overlapCount} 处疑似重叠发言</b>
                      <span>可先用本地模型尝试拆成两路并匹配声纹；不可靠的片段会保留原记录。</span>
                    </p>
                    <button
                      type="button"
                      disabled={!meeting?.audioPath || recording || processing || meetingIsBusy(meeting?.status)}
                      onClick={() => void enhanceOverlappingSpeech()}
                    >{meeting?.status === "enhancing" ? "正在拆解…" : "会后增强拆解 Beta"}</button>
                  </div>
                )}
                {filteredSegments.map((segment) => {
                  const speaker = segment.speakerId ? speakerMap.get(segment.speakerId) : null;
                  const name = segment.overlapSuspected ? "疑似重叠发言" : speaker?.displayName || "待确认发言人";
                  const possibleSpeakers = segment.overlapSpeakerIds
                    .map((id) => speakerMap.get(id)?.displayName)
                    .filter(Boolean) as string[];
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
                        <div className={`avatar ${segment.overlapSuspected ? "overlap" : speaker?.color || "neutral"}`}>
                          {segment.overlapSuspected ? "叠" : name.slice(0, 1)}
                        </div>
                        <div>
                          <div className="speaker">
                            {segment.overlapSuspected
                              ? <b className="overlap-speaker-name">{name}</b>
                              : speaker
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
                            {segment.source === "overlap-separated" && <em className="overlap-separated-badge">会后拆解</em>}
                            {speaker?.autoMatched && <em className="speaker-auto-match">声纹匹配</em>}
                            {speaker?.suggestedName && !speaker.autoMatched && !speaker.manuallyNamed && (
                              <button
                                type="button"
                                className="speaker-suggestion"
                                disabled={speakerSuggestionSavingId === speaker.id}
                                onClick={() => void confirmSuggestedSpeaker(speaker)}
                                title="声纹相似度尚不足以自动命名，点击确认后会记住"
                              >
                                {speakerSuggestionSavingId === speaker.id
                                  ? "正在确认…"
                                  : `可能是 ${speaker.suggestedName} ${Math.round((speaker.suggestedScore || 0) * 100)}% · 确认`}
                              </button>
                            )}
                            {segment.overlapSuspected && (
                              <em className="overlap-confidence">
                                {segment.overlapConfidence === null
                                  ? "重叠风险"
                                  : `重叠可能 ${Math.round(segment.overlapConfidence * 100)}%`}
                              </em>
                            )}
                          </div>
                          <p>{displayedSegmentText(segment, transcriptMode)}</p>
                          {segment.overlapSuspected && (
                            <div className="overlap-review">
                              <span>{possibleSpeakers.length ? `可能涉及：${possibleSpeakers.join(" / ")}` : "发言归属待确认"}</span>
                              <select
                                aria-label={`确认 ${formatClock(segment.startMs)} 的发言人`}
                                value=""
                                disabled={segmentSpeakerSavingId === segment.id || recording || processing}
                                onChange={(event) => void confirmSegmentSpeaker(segment, event.target.value)}
                              >
                                <option value="">{segmentSpeakerSavingId === segment.id ? "正在保存…" : "确认发言人"}</option>
                                {meeting.speakers.map((candidate) => (
                                  <option value={candidate.id} key={candidate.id}>{candidate.displayName}</option>
                                ))}
                              </select>
                            </div>
                          )}
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
                  <>
                  <div className="summary-mode-switch" role="tablist" aria-label="AI 总结查看方式">
                    <button className={summaryMode === "brief" ? "active" : ""} onClick={() => setSummaryMode("brief")}><FileText size={15} /> 会议简报</button>
                    <button className={summaryMode === "full" ? "active" : ""} onClick={() => setSummaryMode("full")}><ListChecks size={15} /> 完整总结</button>
                  </div>
                  {summaryMode === "brief" && activeBrief && meeting ? (
                    <section className="meeting-brief-workspace" aria-label="可编辑会议简报">
                      <header className="meeting-brief-toolbar">
                        <div>
                          <span>{meetingTypeNames[usableSummary.meetingType || "general"]}</span>
                          <small>{usableSummary.meetingTypeConfidence || "中"}可信度{usableSummary.meetingTypeReason ? ` · ${usableSummary.meetingTypeReason}` : " · AI 根据会议内容自动分类"}</small>
                        </div>
                        <div>
                          {briefEditing ? (
                            <>
                              <button onClick={cancelBriefEditing} disabled={briefSaving}>取消</button>
                              <button className="primary" onClick={() => void saveBriefEditing()} disabled={briefSaving}>{briefSaving ? "保存中…" : "保存修改"}</button>
                            </>
                          ) : <button onClick={beginBriefEditing} disabled={usingLiveSummary || processing}><PencilSimple size={15} /> 编辑内容</button>}
                          <button onClick={exportBriefImage}><DownloadSimple size={15} /> 导出图片</button>
                        </div>
                      </header>
                      <article className={`meeting-brief-canvas ${briefEditing ? "editing" : ""}`} onDoubleClick={() => !briefEditing && beginBriefEditing()}>
                        <header>
                          <p>会议简报</p>
                          {briefEditing ? (
                            <input aria-label="会议简报主题" value={activeBrief.subject} onChange={(event) => setBriefDraft((current) => current ? { ...current, subject: event.target.value } : current)} />
                          ) : <h2>{activeBrief.subject}</h2>}
                          <div className="meeting-brief-meta">
                            <span>{briefDate(meeting.startedAt)}</span><i />
                            <span>{formatClock(meeting.durationMs)}</span><i />
                            {briefEditing ? (
                              <input aria-label="会议简报参会人员" value={activeBrief.participants} onChange={(event) => setBriefDraft((current) => current ? { ...current, participants: event.target.value } : current)} />
                            ) : <span>{activeBrief.participants}</span>}
                          </div>
                        </header>
                        <div className="meeting-brief-timeline">
                          {activeBrief.sections.map((section, index) => (
                            <section key={`${section.id}-${index}`}>
                              <span>{String(index + 1).padStart(2, "0")}</span><i />
                              <div>
                                {briefEditing ? (
                                  <>
                                    <input aria-label={`第 ${index + 1} 个简报板块标题`} value={section.title} onChange={(event) => setBriefDraft((current) => current ? { ...current, sections: current.sections.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item) } : current)} />
                                    <textarea aria-label={`第 ${index + 1} 个简报板块内容`} value={section.content} onChange={(event) => setBriefDraft((current) => current ? { ...current, sections: current.sections.map((item, itemIndex) => itemIndex === index ? { ...item, content: event.target.value } : item) } : current)} />
                                    <div className="brief-section-actions">
                                      <button disabled={index === 0} onClick={() => setBriefDraft((current) => { if (!current || index === 0) return current; const sections = [...current.sections]; [sections[index - 1], sections[index]] = [sections[index], sections[index - 1]]; return { ...current, sections }; })}>上移</button>
                                      <button disabled={index === activeBrief.sections.length - 1} onClick={() => setBriefDraft((current) => { if (!current || index === current.sections.length - 1) return current; const sections = [...current.sections]; [sections[index], sections[index + 1]] = [sections[index + 1], sections[index]]; return { ...current, sections }; })}>下移</button>
                                      <button className="danger" onClick={() => setBriefDraft((current) => current ? { ...current, sections: current.sections.filter((_, itemIndex) => itemIndex !== index) } : current)}>隐藏此栏</button>
                                    </div>
                                  </>
                                ) : (
                                  <><h3>{section.title}</h3><p>{section.content}</p></>
                                )}
                              </div>
                            </section>
                          ))}
                          {briefEditing && (
                            <button className="brief-add-section" onClick={() => setBriefDraft((current) => current ? { ...current, sections: [...current.sections, { id: `custom-${Date.now()}`, title: "补充栏目", content: "请输入内容", evidenceSeqs: [] }] } : current)}>＋ 添加栏目</button>
                          )}
                        </div>
                        {(activeBrief.actionItems.length > 0 || briefEditing) && (
                          <section className="meeting-brief-actions">
                            <h3>会后推进</h3>
                            <div>
                              {activeBrief.actionItems.map((item, index) => briefEditing ? (
                                <div className="brief-action-edit" key={`${index}-${item.task}`}>
                                  <input aria-label="推进事项" value={item.task} onChange={(event) => setBriefDraft((current) => current ? { ...current, actionItems: current.actionItems.map((entry, itemIndex) => itemIndex === index ? { ...entry, task: event.target.value } : entry) } : current)} />
                                  <input aria-label="负责人" value={item.owner} onChange={(event) => setBriefDraft((current) => current ? { ...current, actionItems: current.actionItems.map((entry, itemIndex) => itemIndex === index ? { ...entry, owner: event.target.value } : entry) } : current)} />
                                  <input aria-label="截止时间" value={item.due} onChange={(event) => setBriefDraft((current) => current ? { ...current, actionItems: current.actionItems.map((entry, itemIndex) => itemIndex === index ? { ...entry, due: event.target.value } : entry) } : current)} />
                                  <button aria-label="删除推进事项" onClick={() => setBriefDraft((current) => current ? { ...current, actionItems: current.actionItems.filter((_, itemIndex) => itemIndex !== index) } : current)}><X size={13} /></button>
                                </div>
                              ) : (
                                <div key={`${item.task}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><p>{item.task}</p><small>{item.owner} · {item.due}</small></div>
                              ))}
                              {briefEditing && <button className="brief-add-action" onClick={() => setBriefDraft((current) => current ? { ...current, actionItems: [...current.actionItems, { owner: "待确认", task: "新的推进事项", due: "待确认", priority: "中", evidenceSeqs: [] }] } : current)}>＋ 添加推进事项</button>}
                            </div>
                          </section>
                        )}
                        {(activeBrief.aiSuggestions.length > 0 || briefEditing) && (
                          <aside className="meeting-brief-suggestion">
                            <h3>AI 推进建议</h3>
                            {briefEditing ? (
                              <textarea aria-label="AI 推进建议" value={activeBrief.aiSuggestions.join("\n")} onChange={(event) => setBriefDraft((current) => current ? { ...current, aiSuggestions: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean) } : current)} />
                            ) : <ul>{activeBrief.aiSuggestions.map((item) => <li key={item}>{item}</li>)}</ul>}
                          </aside>
                        )}
                        {!briefEditing && <small className="meeting-brief-edit-hint">双击内容或使用上方“编辑内容”进行修改</small>}
                      </article>
                    </section>
                  ) : meeting?.reportStyle === "visual" ? (
                    <div className="visual-report">
                      <header className="visual-report-hero">
                        <div className="visual-hero-topline">
                          <span><Sparkle size={13} weight="fill" /> MiniMax AI {usingLiveSummary ? "实时草稿" : "图文总结"}</span>
                          <button onClick={openTemplateDialog}>{summaryTemplateName(meeting?.summaryTemplate || DEFAULT_SUMMARY_TEMPLATE)} · 更换模板</button>
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
                  )}
                  </>
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
                      <button className="empty-summary-configure" onClick={() => void openSettingsDialog("ai")}>
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
                  <div className="speaker-list-item" key={speaker.id}>
                    <button className="speaker-list-main" onClick={() => beginRenameSpeaker(speaker)}>
                      <i className={`avatar ${speaker.color}`}>{speaker.displayName.slice(0, 1)}</i>
                      <span>{speaker.displayName}<small>{speaker.manuallyNamed ? "已确认并记住" : speaker.autoMatched ? "本机声纹自动匹配" : speaker.suggestedName ? `声纹候选：${speaker.suggestedName}` : "点击重命名"}</small></span>
                    </button>
                    {speaker.suggestedName && !speaker.autoMatched && !speaker.manuallyNamed && (
                      <button
                        className="speaker-list-confirm"
                        disabled={speakerSuggestionSavingId === speaker.id}
                        onClick={() => void confirmSuggestedSpeaker(speaker)}
                      >
                        {speakerSuggestionSavingId === speaker.id ? "确认中" : `确认是${speaker.suggestedName}`}
                      </button>
                    )}
                  </div>
                ))}
                {!meeting?.speakers.length && <p>有效语音出现后自动编号</p>}
              </div>
            </div>
            <button className="open-summary" onClick={() => summaryFailed ? rerunSummary() : setView("summary")}>
              {summaryFailed ? "重新生成 AI 总结" : usingLiveSummary ? "查看实时草稿" : "查看完整 AI 总结"} <span>→</span>
            </button>
          </aside>}
        </div>
          </>
        )}
      </section>
      {showBackToTop && (
        <button
          type="button"
          className="back-to-top"
          onClick={scrollWorkspaceToTop}
          aria-label="回到页面顶部"
          title="回到顶部"
        >
          <ArrowUp size={16} weight="bold" />
          <span>回到顶部</span>
        </button>
      )}
      {audioEditorOpen && meeting && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !audioClipSaving) setAudioEditorOpen(false);
          }}
        >
          <form
            className="audio-editor-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="audio-editor-title"
            onSubmit={(event) => {
              event.preventDefault();
              void saveAudioClip();
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !audioClipSaving) setAudioEditorOpen(false);
            }}
          >
            <header>
              <div><span><Scissors size={21} weight="duotone" /></span><div><h2 id="audio-editor-title">剪辑会议音频</h2><p>选择发言人与时间范围，另存为新音频；原始录音始终保留。</p></div></div>
              <button type="button" onClick={() => setAudioEditorOpen(false)} disabled={audioClipSaving} aria-label="关闭音频剪辑"><X size={17} /></button>
            </header>
            <label className="audio-clip-name"><span>剪辑名称</span><input autoFocus maxLength={80} value={audioClipName} disabled={audioClipSaving} onChange={(event) => setAudioClipName(event.target.value)} /></label>
            <section className="audio-speaker-picker">
              <div><span><b>保留哪些发言人</b><small>只选择部分人员时，会按时间顺序拼接他们的发言片段</small></span><button type="button" onClick={() => setAudioClipSpeakerIds(new Set(meeting.speakers.map((speaker) => speaker.id)))}>全选</button></div>
              <div>
                {meeting.speakers.map((speaker) => (
                  <label key={speaker.id} className={audioClipSpeakerIds.has(speaker.id) ? "selected" : ""}>
                    <input type="checkbox" checked={audioClipSpeakerIds.has(speaker.id)} onChange={() => toggleAudioClipSpeaker(speaker.id)} />
                    <i className={`avatar ${speaker.color}`}>{speaker.displayName.slice(0, 1)}</i>
                    <span>{speaker.displayName}</span>
                  </label>
                ))}
              </div>
            </section>
            <section className="audio-time-editor">
              <div><b>剪辑时间</b><span>{formatClock(audioClipStartMs)} – {formatClock(audioClipEndMs)}</span></div>
              <label><span>开始</span><input type="range" min={0} max={Math.max(0, meeting.durationMs - 250)} step={100} value={audioClipStartMs} onChange={(event) => setAudioClipStartMs(Math.min(Number(event.target.value), audioClipEndMs - 250))} /><input type="number" min={0} max={Math.max(0, audioClipEndMs / 1000 - 0.25)} step={0.1} value={(audioClipStartMs / 1000).toFixed(1)} onChange={(event) => setAudioClipStartMs(Math.max(0, Math.min(Number(event.target.value) * 1000, audioClipEndMs - 250)))} /><em>秒</em></label>
              <label><span>结束</span><input type="range" min={0} max={meeting.durationMs} step={100} value={audioClipEndMs} onChange={(event) => setAudioClipEndMs(Math.max(Number(event.target.value), audioClipStartMs + 250))} /><input type="number" min={audioClipStartMs / 1000 + 0.25} max={meeting.durationMs / 1000} step={0.05} value={(audioClipEndMs / 1000).toFixed(1)} onChange={(event) => setAudioClipEndMs(Math.min(meeting.durationMs, Math.max(Number(event.target.value) * 1000, audioClipStartMs + 250)))} /><em>秒</em></label>
              <audio controls preload="metadata" src={`${apiBase}/api/meetings/${encodeURIComponent(meeting.id)}/audio`}>当前系统不支持音频播放。</audio>
            </section>
            <footer><p><CheckCircle size={15} weight="fill" /> {meeting.speakers.length ? `已选 ${audioClipSpeakerIds.size} 位发言人` : "将保留所选时间内的全部声音"}，原始录音不会被覆盖。</p><div><button type="button" onClick={() => setAudioEditorOpen(false)} disabled={audioClipSaving}>取消</button><button className="primary" type="submit" disabled={audioClipSaving || !audioClipName.trim() || (meeting.speakers.length > 0 && !audioClipSpeakerIds.size) || audioClipEndMs <= audioClipStartMs}>{audioClipSaving ? "正在生成…" : "保存音频剪辑"}</button></div></footer>
          </form>
        </div>
      )}
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
                  <span><b>图文总结</b><small>让未参会者快速看懂问题、期望与下一步</small></span>
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
      {trashDialogOpen && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !trashLoading) setTrashDialogOpen(false); }}>
          <section className="trash-dialog" role="dialog" aria-modal="true" aria-labelledby="trash-dialog-title">
            <header>
              <div><span><Trash size={20} weight="duotone" /></span><div><h2 id="trash-dialog-title">最近删除</h2><p>录音、逐字稿、资料和总结会一直保留，直到你永久删除。</p></div></div>
              <button type="button" onClick={() => setTrashDialogOpen(false)} disabled={trashLoading} aria-label="关闭最近删除"><X size={17} /></button>
            </header>
            <div className="trash-meeting-list">
              {deletedMeetings.map((item) => (
                <article key={item.id}>
                  <span><b>{item.title}</b><small>{item.deletedAt ? `删除于 ${formatMeetingDate(item.deletedAt)}` : "已删除"} · {formatClock(item.durationMs)}</small></span>
                  <div><button type="button" disabled={trashLoading} onClick={() => void restoreDeletedMeeting(item)}><ArrowClockwise size={13} /> 恢复</button><button type="button" className="danger" disabled={trashLoading} onClick={() => void permanentlyDeleteMeeting(item)}>永久删除</button></div>
                </article>
              ))}
              {!trashLoading && !deletedMeetings.length && <div className="trash-empty"><CheckCircle size={24} weight="duotone" /><b>最近没有删除的会议</b><small>从历史列表删除的会议会出现在这里。</small></div>}
              {trashLoading && !deletedMeetings.length && <div className="trash-empty"><b>正在读取…</b></div>}
            </div>
            <footer><span>最近删除中的会议仍会占用本机存储空间。</span><button type="button" onClick={() => setTrashDialogOpen(false)}>完成</button></footer>
          </section>
        </div>
      )}
      {notice && <button className="toast" onClick={() => setNotice("")}>{notice}<i>×</i></button>}
    </main>
  );
}
