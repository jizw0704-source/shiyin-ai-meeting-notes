"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Brain,
  ChartBar,
  CheckCircle,
  Clock,
  Compass,
  Flag,
  ListChecks,
  PushPin,
  Quotes,
  Sparkle,
  Target,
  UsersThree,
  Waveform,
  WarningCircle,
  X,
} from "@phosphor-icons/react";

type View = "transcript" | "summary" | "actions";
type MeetingStatus = "recording" | "correcting" | "summarizing" | "completed" | "failed";
type SummaryTemplateId = "meeting-minutes" | "daily-log" | "project-sync" | "brainstorm";
type ReportStyle = "detailed" | "visual";
type Speaker = {
  id: string;
  meetingId: string;
  label: string;
  displayName: string;
  color: string;
  manuallyNamed: boolean;
};
type Segment = {
  id: string;
  meetingId: string;
  seq: number;
  startMs: number;
  endMs: number | null;
  pauseAfterMs: number | null;
  text: string;
  speakerId: string | null;
  source: "realtime" | "corrected";
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
  kind: "speaker-correction" | "summary";
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
};
type Meeting = MeetingBrief & {
  speakers: Speaker[];
  segments: Segment[];
  jobs: Job[];
};

declare global {
  interface Window {
    shiyinDesktop?: {
      onCommand: (callback: (command: string) => void) => () => void;
      setRecording: (active: boolean) => void;
    };
  }
}

const websocketBase = process.env.NEXT_PUBLIC_ASR_PROXY_URL || "ws://127.0.0.1:8788";
const apiBase = process.env.NEXT_PUBLIC_API_URL || websocketBase.replace(/^ws/, "http");
const DEFAULT_SUMMARY_TEMPLATE: SummaryTemplateId = "meeting-minutes";
const DEFAULT_REPORT_STYLE: ReportStyle = "detailed";
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

function statusLabel(status: MeetingStatus) {
  return {
    recording: "正在听记",
    correcting: "正在校正发言人",
    summarizing: "正在生成总结",
    completed: "已完成",
    failed: "处理失败",
  }[status];
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
  if (/nahimic|vad|virtual|stereo mix|立体声混音|cable/.test(label)) score -= 1000;
  if (/realtek|麦克风阵列|microphone array/.test(label)) score += 120;
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [liveText, setLiveText] = useState("");
  const [connectionStatus, setConnectionStatus] = useState("百炼实时 ASR");
  const [loading, setLoading] = useState(true);
  const [completedActions, setCompletedActions] = useState<Set<number>>(new Set());
  const [audioInputs, setAudioInputs] = useState<AudioInput[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [activeDeviceLabel, setActiveDeviceLabel] = useState("自动选择麦克风");
  const [inputLevel, setInputLevel] = useState(0);
  const [audioWarning, setAudioWarning] = useState("");
  const [highlightedSeq, setHighlightedSeq] = useState<number | null>(null);
  const [renamingSpeaker, setRenamingSpeaker] = useState<Speaker | null>(null);
  const [speakerNameDraft, setSpeakerNameDraft] = useState("");
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [defaultSummaryTemplate, setDefaultSummaryTemplate] = useState<SummaryTemplateId>(DEFAULT_SUMMARY_TEMPLATE);
  const [defaultReportStyle, setDefaultReportStyle] = useState<ReportStyle>(DEFAULT_REPORT_STYLE);
  const [templateDraft, setTemplateDraft] = useState<SummaryTemplateId>(DEFAULT_SUMMARY_TEMPLATE);
  const [reportStyleDraft, setReportStyleDraft] = useState<ReportStyle>(DEFAULT_REPORT_STYLE);
  const socketRef = useRef<WebSocket | null>(null);
  const playbackRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingRef = useRef(false);
  const sessionPeakRef = useRef(0);
  const captureStartedAtRef = useRef(0);
  const lastLevelUpdateRef = useRef(0);
  const silenceWarningShownRef = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const savedTemplate = window.localStorage.getItem("shiyin.summaryTemplate") as SummaryTemplateId | null;
      const savedStyle = window.localStorage.getItem("shiyin.reportStyle");
      if (summaryTemplates.some((template) => template.id === savedTemplate)) {
        setDefaultSummaryTemplate(savedTemplate!);
      }
      if (savedStyle === "visual") setDefaultReportStyle("visual");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!templateDialogOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTemplateDialogOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [templateDialogOpen]);

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
    setSelectedId((current) => preferredId || current || result.meetings[0]?.id || null);
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
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    await audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
  }, []);

  const stopRecording = useCallback(async () => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setRecording(false);
    window.shiyinDesktop?.setRecording(false);
    setProcessing(true);
    setConnectionStatus("录音已保存，正在校正发言人…");
    await stopAudioCapture();
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "session.stop" }));
    }
  }, [stopAudioCapture]);

  useEffect(() => {
    const unsubscribe = window.shiyinDesktop?.onCommand((command) => {
      if (command === "stop-recording") stopRecording();
    });
    return () => unsubscribe?.();
  }, [stopRecording]);

  const filteredSegments = useMemo(() => {
    const segments = meeting?.segments || [];
    if (!query.trim()) return segments;
    const speakers = new Map(meeting?.speakers.map((speaker) => [speaker.id, speaker.displayName]));
    const term = query.toLowerCase();
    return segments.filter((segment) =>
      `${speakers.get(segment.speakerId || "") || ""}${segment.text}`.toLowerCase().includes(term));
  }, [meeting, query]);

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

  async function startRecording() {
    try {
      setNotice("");
      setConnectionStatus("正在连接百炼…");
      const socketUrl = new URL(websocketBase);
      socketUrl.searchParams.set("template", defaultSummaryTemplate);
      socketUrl.searchParams.set("reportStyle", defaultReportStyle);
      const socket = new WebSocket(socketUrl.toString());
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;

      await new Promise<void>((resolve, reject) => {
        let ready = false;
        const timeout = window.setTimeout(() => reject(new Error("连接百炼代理超时")), 12000);
        socket.onerror = () => {
          if (!ready) reject(new Error("无法连接拾音后台，请先启动本地服务"));
        };
        socket.onmessage = (event) => {
          const message = JSON.parse(event.data);
          if (message.type === "session.started") {
            ready = true;
            window.clearTimeout(timeout);
            const value = message.meeting as Meeting;
            setMeeting(value);
            setSelectedId(value.id);
            mergeMeetingList(value);
            setConnectionStatus(
              message.speakerModelAvailable ? "百炼转写 · 本地声纹分离" : "百炼转写 · 声纹模型不可用",
            );
            resolve();
          } else if (message.type === "asr.partial") {
            setLiveText(message.text || "");
          } else if (message.type === "segment.final") {
            setLiveText("");
            updateLiveSegment(message.segment, message.speakers);
          } else if (message.type === "summary.preview.started") {
            setConnectionStatus("MiniMax M3 正在整理实时草稿…");
          } else if (message.type === "summary.preview.progress") {
            const characters = Number(message.characters || 0);
            setConnectionStatus(
              characters > 0
                ? `MiniMax M3 正在生成实时草稿 · ${characters} 字`
                : "MiniMax M3 正在生成实时草稿…",
            );
          } else if (message.type === "summary.preview") {
            setMeeting((current) => {
              if (!current || current.id !== message.meetingId) return current;
              return { ...current, liveSummary: message.summary };
            });
            setMeetings((items) => items.map((item) => (
              item.id === message.meetingId ? { ...item, liveSummary: message.summary } : item
            )));
            setConnectionStatus("百炼转写 · 实时草稿已更新");
          } else if (message.type === "summary.preview.error") {
            setConnectionStatus("百炼转写 · 实时草稿稍后重试");
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
            setNotice(value.error || "会议已保存，发言人校正和 AI 总结已完成");
            window.shiyinDesktop?.setRecording(false);
            socket.close();
            socketRef.current = null;
          } else if (message.type === "error") {
            setNotice(message.message);
            if (!ready && !message.recoverable) reject(new Error(message.message));
          }
        };
      });

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
      let stream = await navigator.mediaDevices.getUserMedia(audioConstraints(selectedDeviceId));
      const refreshed = await refreshAudioInputs();
      const savedInput = refreshed.devices.find((input) => input.deviceId === selectedDeviceId);
      const targetInput = savedInput || refreshed.preferred;
      const currentDeviceId = stream.getAudioTracks()[0]?.getSettings().deviceId;
      if (targetInput && currentDeviceId !== targetInput.deviceId) {
        stream.getTracks().forEach((track) => track.stop());
        stream = await navigator.mediaDevices.getUserMedia(audioConstraints(targetInput.deviceId));
      }
      const track = stream.getAudioTracks()[0];
      const finalDeviceId = track?.getSettings().deviceId || targetInput?.deviceId || "";
      const finalLabel = track?.label || targetInput?.label || "当前麦克风";
      setSelectedDeviceId(finalDeviceId);
      setActiveDeviceLabel(finalLabel);
      if (finalDeviceId) window.localStorage.setItem("shiyin.microphoneId", finalDeviceId);
      mediaStreamRef.current = stream;
      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;
      await audioContext.audioWorklet.addModule("/pcm-worklet.js");
      const source = audioContext.createMediaStreamSource(stream);
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
          setAudioWarning(`“${finalLabel}”没有检测到声音，请切换输入设备`);
          setConnectionStatus("麦克风没有输入");
          setNotice(`当前“${finalLabel}”录到的是静音，请在左侧切换麦克风`);
        } else if (framePeak >= 64 && silenceWarningShownRef.current) {
          silenceWarningShownRef.current = false;
          setAudioWarning("");
          setConnectionStatus("百炼转写 · 本地声纹分离");
        }
        if (socket.readyState === WebSocket.OPEN) socket.send(event.data);
      };
      source.connect(capture).connect(silentGain).connect(audioContext.destination);
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
      setConnectionStatus("百炼实时 ASR");
      setNotice(error instanceof Error ? error.message : "无法启动实时听记，请检查麦克风权限");
    }
  }

  async function toggleRecording() {
    if (recording) await stopRecording();
    else await startRecording();
  }

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
      setNotice(`已将 ${renamingSpeaker.displayName} 重命名为 ${updated.displayName}`);
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

  async function rerunSummary() {
    if (!meeting || ["recording", "correcting", "summarizing"].includes(meeting.status)) return;
    await regenerateSummary(meeting.id);
  }

  async function regenerateSummary(meetingId: string) {
    try {
      await api(`/api/meetings/${meetingId}/summarize`, { method: "POST" });
      setProcessing(true);
      setConnectionStatus("正在重新生成 MiniMax M3 总结…");
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

  function exportNotes() {
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
        <div><b>${escapeHtml(names.get(segment.speakerId || "") || "待确认发言人")}</b><p>${escapeHtml(segment.text)}</p></div>
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
    const blob = new Blob([report], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${meeting.title.replace(/[\\/:*?"<>|]/g, "-")}-AI会议报告.html`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

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
        <div className="local-storage-note"><b>本机存储</b><span>录音与记录仅保存在这台电脑</span></div>
        <label className="microphone-picker">
          <span>输入设备</span>
          <select
            value={selectedDeviceId}
            disabled={recording}
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
            {audioWarning || (recording ? `正在使用：${activeDeviceLabel}` : "开始后可看到输入电平")}
          </small>
        </label>
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
        <div className="nav-label">会议记录</div>
        <div className="meeting-list">
          {meetings.map((item) => (
            <button
              className={`meeting ${selectedId === item.id ? "active" : ""}`}
              key={item.id}
              onClick={() => setSelectedId(item.id)}
            >
              <span className="meeting-icon">▥</span>
              <span>
                <strong>{item.title}</strong>
                <small>{formatMeetingDate(item.startedAt)} · {formatClock(item.durationMs)}</small>
              </span>
            </button>
          ))}
          {!loading && !meetings.length && <p className="no-meetings">还没有会议记录</p>}
        </div>
        <div className="sidebar-bottom">
          <div className="privacy-state"><span>●</span> 本地后台已连接</div>
          <div className="profile"><span>本</span><p><b>本机工作区</b><small>2–6 人会议模式</small></p></div>
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
                ? `${meeting.speakers.length || "待识别"} 位发言人 · ${formatClock(meeting.durationMs || seconds * 1000)}`
                : "百炼实时转写 · 本地发言人识别 · MiniMax 总结"}
            </p>
          </div>
          <div className="top-actions">
            <button disabled={recording || processing} onClick={openTemplateDialog}><Compass size={15} /> 模板</button>
            <button disabled={!meeting || processing || ["recording", "correcting", "summarizing"].includes(meeting.status)} onClick={rerunCorrection}>↻ 重新校正</button>
            <button disabled={!meeting || processing || ["recording", "correcting", "summarizing"].includes(meeting.status)} onClick={rerunSummary}>✦ 重新总结</button>
            <button className="primary" disabled={!meeting || summaryFailed || processing || meeting.status === "summarizing"} onClick={exportNotes}>⇩ 导出报告</button>
            <button className="more danger" disabled={!meeting || processing || ["recording", "correcting", "summarizing"].includes(meeting.status)} onClick={deleteMeeting}>删除</button>
          </div>
        </header>

        <div className={`content-grid ${view === "summary" ? "report-mode" : ""}`}>
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
            {liveText && <div className="live-caption"><span>实时</span>{liveText}</div>}
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
            <div className="tabs">
              <button className={view === "transcript" ? "active" : ""} onClick={() => setView("transcript")}>完整记录</button>
              <button className={view === "summary" ? "active" : ""} onClick={() => setView("summary")}>AI 总结 <span>✦</span></button>
              <button className={view === "actions" ? "active" : ""} onClick={() => setView("actions")}>行动项 <i>{actions.length}</i></button>
              <label className="search">⌕<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索记录" /></label>
            </div>

            {view === "transcript" && (
              <div className="transcript">
                {filteredSegments.map((segment) => {
                  const speaker = segment.speakerId ? speakerMap.get(segment.speakerId) : null;
                  const name = speaker?.displayName || "待确认发言人";
                  return (
                    <Fragment key={segment.id}>
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
                          </div>
                          <p>{segment.text}</p>
                        </div>
                      </div>
                      {(segment.pauseAfterMs || 0) >= 1000 && (
                        <div className="pause-marker"><span>停顿 {(segment.pauseAfterMs! / 1000).toFixed(1)} 秒</span></div>
                      )}
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
            )}

            {view === "summary" && (
              <div className="summary-pane">
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
                  meeting.reportStyle === "visual" ? (
                    <div className="visual-report">
                      <header className="visual-report-hero">
                        <div className="visual-hero-topline">
                          <span><Sparkle size={13} weight="fill" /> MiniMax AI {usingLiveSummary ? "实时草稿" : "图文纪要"}</span>
                          <button onClick={openTemplateDialog}>{summaryTemplateName(meeting.summaryTemplate)} · 更换模板</button>
                        </div>
                        <h2>{usableSummary.headline || meeting.title}</h2>
                        <p>{usableSummary.overview}</p>
                        <div className="visual-metrics">
                          <article><Clock size={18} weight="duotone" /><span><strong>{formatClock(meeting.durationMs)}</strong><small>会议时长</small></span></article>
                          <article><UsersThree size={19} weight="duotone" /><span><strong>{meeting.speakers.length}</strong><small>位发言人</small></span></article>
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
                        <span><Clock size={14} />{formatClock(meeting.durationMs)}</span>
                        <span><UsersThree size={15} />{meeting.speakers.length} 位发言人</span>
                        <span><Quotes size={15} />{meeting.segments.length} 段有效发言</span>
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
                          ? "MiniMax M3 正在流式生成正式报告，请稍候。"
                          : "结束听记后，会先在本地校正发言人，再用 MiniMax 生成完整会议报告。"}
                    </p>
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
          </article>

          <aside className="insight-card">
            <div className="insight-title"><span>✦</span><div><h2>会议速览</h2><p>{usingLiveSummary ? "百炼转写 · MiniMax M3 实时草稿" : "百炼转写 · MiniMax M3 总结"}</p></div><button disabled={!meeting || processing || ["recording", "correcting", "summarizing"].includes(meeting.status)} onClick={rerunSummary} aria-label="重新生成总结">↻</button></div>
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
                    <span>{speaker.displayName}<small>{speaker.manuallyNamed ? "已命名" : "点击重命名"}</small></span>
                  </button>
                ))}
                {!meeting?.speakers.length && <p>有效语音出现后自动编号</p>}
              </div>
            </div>
            <button className="open-summary" onClick={() => summaryFailed ? rerunSummary() : setView("summary")}>
              {summaryFailed ? "重新生成 AI 总结" : usingLiveSummary ? "查看实时草稿" : "查看完整 AI 总结"} <span>→</span>
            </button>
          </aside>
        </div>
      </section>
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
                <span className="template-eyebrow"><Sparkle size={13} weight="fill" /> MiniMax M3 总结方式</span>
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
                  ? `将以“${summaryTemplateName(templateDraft)}”提示词重新调用 MiniMax M3`
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
              <div><h2 id="rename-speaker-title">修改发言人姓名</h2><p>同一发言人的全部记录会一起更新。</p></div>
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
      {notice && <button className="toast" onClick={() => setNotice("")}>{notice}<i>×</i></button>}
    </main>
  );
}
