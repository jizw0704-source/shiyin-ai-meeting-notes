import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import process from "node:process";
import { HttpsProxyAgent } from "https-proxy-agent";
import { WebSocket, WebSocketServer } from "ws";
import { streamMeetingAudio } from "./audio-stream.mjs";
import { AudioSession } from "./audio-session.mjs";
import { correctMeetingSpeakers } from "./correction.mjs";
import { SpeakerEngine } from "./speaker-engine.mjs";
import { MeetingStorage } from "./storage.mjs";
import { summarizeMeeting, summarizeMeetingPreview } from "./summarizer.mjs";
import {
  SUMMARY_TEMPLATE_VERSION,
  normalizeReportStyle,
  normalizeSummaryTemplateId,
} from "./summary-templates.mjs";

for (const file of [".env.local", ".env"]) {
  try { process.loadEnvFile?.(file); } catch { /* optional local env file */ }
}

const port = Number(process.env.ASR_PROXY_PORT || 8788);
const apiKey = process.env.DASHSCOPE_API_KEY;
const miniMaxApiKey = process.env.MINIMAX_API_KEY;
const miniMaxModel = process.env.MINIMAX_MODEL || "MiniMax-M3";
const workspaceId = process.env.DASHSCOPE_WORKSPACE_ID;
const dataRoot = path.resolve(process.env.SHIYIN_DATA_ROOT || "data");
const liveSummaryStartMs = Math.max(15000, Number(process.env.LIVE_SUMMARY_START_MS) || 30000);
const liveSummaryIntervalMs = Math.max(10000, Number(process.env.LIVE_SUMMARY_INTERVAL_MS) || 20000);
const modelPath = path.resolve(process.env.SHIYIN_MODEL_PATH || path.join("models", "speaker", "3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx"));
const storage = new MeetingStorage(dataRoot);
const speakerEngine = new SpeakerEngine({ modelPath, maxSpeakers: 6, threshold: 0.62 });
const activeSessions = new Map();
const upstreamUrl = process.env.DASHSCOPE_WEBSOCKET_URL || (
  workspaceId
    ? `wss://${workspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference`
    : "wss://dashscope.aliyuncs.com/api-ws/v1/inference"
);

function getProxyUrl() {
  const configured = process.env.DASHSCOPE_PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  if (configured) return configured;
  if (process.platform !== "win32") return null;
  try {
    const output = execFileSync("reg.exe", [
      "query",
      "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
      "/v",
      "ProxyServer"
    ], { encoding: "utf8", windowsHide: true });
    const value = output.match(/ProxyServer\s+REG_SZ\s+([^\r\n]+)/i)?.[1]?.trim();
    if (!value) return null;
    const server = value.includes("=")
      ? value.split(";").find((item) => item.toLowerCase().startsWith("https="))?.split("=")[1]
        || value.split(";").find((item) => item.toLowerCase().startsWith("http="))?.split("=")[1]
      : value;
    return server ? `http://${server}` : null;
  } catch {
    return null;
  }
}

const proxyUrl = getProxyUrl();
const proxyAgent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;

function sendJson(socket, value) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
}

function jsonResponse(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function meetingTitle() {
  return `会议 ${new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date())}`;
}

async function runSummary(meetingId, client = null) {
  const summaryJob = storage.createJob(meetingId, "summary");
  storage.updateMeeting(meetingId, { status: "summarizing", error: null });
  storage.updateJob(summaryJob.id, { status: "running", progress: 10 });
  sendJson(client, { type: "job.progress", meetingId, job: storage.getJob(summaryJob.id) });
  try {
    let lastProgress = 10;
    let lastProgressSentAt = 0;
    const summary = await summarizeMeeting(storage.getMeeting(meetingId), miniMaxApiKey, miniMaxModel, {
      stream: true,
      onProgress(event) {
        const now = Date.now();
        const extractionProgress = event.phase === "extracting"
          ? 12 + Math.round(((event.chunk - 1) / Math.max(1, event.totalChunks)) * 30)
          : 45;
        const streamedProgress = Math.min(48, Math.floor(((event.characters || 0) + (event.events || 0) * 8) / 120));
        const progress = Math.min(96, Math.max(lastProgress, extractionProgress + streamedProgress));
        if (progress <= lastProgress && now - lastProgressSentAt < 1000) return;
        lastProgress = progress;
        lastProgressSentAt = now;
        storage.updateJob(summaryJob.id, { status: "running", progress });
        sendJson(client, { type: "job.progress", meetingId, job: storage.getJob(summaryJob.id) });
      },
    });
    storage.saveSummary(meetingId, summary);
    storage.updateJob(summaryJob.id, { status: "completed", progress: 100 });
    storage.updateMeeting(meetingId, { status: "completed", error: null });
  } catch (error) {
    const meeting = storage.getMeeting(meetingId);
    const fallbackAvailable = Boolean(meeting?.summary || meeting?.liveSummary);
    const fallbackLabel = meeting?.summary ? "上次正式报告" : "实时草稿";
    storage.updateJob(summaryJob.id, { status: "failed", error: error.message });
    storage.updateMeeting(meetingId, {
      status: fallbackAvailable ? "completed" : "failed",
      error: fallbackAvailable
        ? `最终定稿失败：${error.message}；当前保留${fallbackLabel}`
        : `总结失败：${error.message}`,
    });
    sendJson(client, {
      type: "error",
      recoverable: true,
      message: fallbackAvailable
        ? `最终定稿暂未完成，已保留${fallbackLabel}：${error.message}`
        : `总结失败：${error.message}`,
    });
  }
  return storage.getMeeting(meetingId);
}

async function runCorrectionAndSummary(meetingId, client = null) {
  const correctionJob = storage.createJob(meetingId, "speaker-correction");
  storage.updateMeeting(meetingId, { status: "correcting", error: null });
  storage.updateJob(correctionJob.id, { status: "running", progress: 0 });
  sendJson(client, { type: "job.progress", meetingId, job: storage.getJob(correctionJob.id) });
  try {
    if (!speakerEngine.available) throw new Error("本地声纹模型不可用");
    await correctMeetingSpeakers({
      meetingId,
      dataRoot,
      storage,
      speakerEngine,
      onProgress(progress) {
        storage.updateJob(correctionJob.id, { status: "running", progress });
        sendJson(client, { type: "job.progress", meetingId, job: storage.getJob(correctionJob.id) });
      },
    });
    storage.updateJob(correctionJob.id, { status: "completed", progress: 100 });
    sendJson(client, { type: "speaker.corrected", meeting: storage.getMeeting(meetingId) });
  } catch (error) {
    storage.updateJob(correctionJob.id, { status: "failed", error: error.message });
    storage.updateMeeting(meetingId, { error: `说话人校正失败：${error.message}` });
    sendJson(client, { type: "error", recoverable: true, message: `说话人校正失败：${error.message}` });
  }

  const meeting = await runSummary(meetingId, client);
  sendJson(client, { type: "session.completed", meeting });
  return meeting;
}

const httpServer = createServer(async (request, response) => {
  if (request.method === "OPTIONS") return jsonResponse(response, 204, {});
  const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
  try {
    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse(response, 200, {
        ok: true,
        asrConfigured: Boolean(apiKey),
        miniMaxConfigured: Boolean(miniMaxApiKey),
        speakerModelAvailable: speakerEngine.available,
        activeMeetings: activeSessions.size,
        liveSummaryStartMs,
        liveSummaryIntervalMs,
      });
    }
    if (request.method === "GET" && url.pathname === "/api/meetings") {
      return jsonResponse(response, 200, { meetings: storage.listMeetings() });
    }
    const audioMatch = url.pathname.match(/^\/api\/meetings\/([^/]+)\/audio$/);
    if ((request.method === "GET" || request.method === "HEAD") && audioMatch) {
      const meeting = storage.getMeeting(audioMatch[1]);
      if (!meeting) return jsonResponse(response, 404, { error: "会议不存在" });
      return streamMeetingAudio(request, response, { meeting, dataRoot });
    }
    const meetingMatch = url.pathname.match(/^\/api\/meetings\/([^/]+)$/);
    if (request.method === "GET" && meetingMatch) {
      const meeting = storage.getMeeting(meetingMatch[1]);
      return jsonResponse(response, meeting ? 200 : 404, meeting || { error: "会议不存在" });
    }
    if (request.method === "PATCH" && meetingMatch) {
      const body = await readJson(request);
      const patch = {};
      if (Object.hasOwn(body, "title")) patch.title = String(body.title || "").trim().slice(0, 80);
      if (Object.hasOwn(body, "summaryTemplate")) {
        patch.summaryTemplate = normalizeSummaryTemplateId(body.summaryTemplate);
        patch.templateVersion = SUMMARY_TEMPLATE_VERSION;
      }
      if (Object.hasOwn(body, "reportStyle")) patch.reportStyle = normalizeReportStyle(body.reportStyle);
      const meeting = storage.updateMeeting(meetingMatch[1], patch);
      return jsonResponse(response, meeting ? 200 : 404, meeting || { error: "会议不存在" });
    }
    if (request.method === "DELETE" && meetingMatch) {
      const meetingId = meetingMatch[1];
      if (activeSessions.has(meetingId)) return jsonResponse(response, 409, { error: "正在录音的会议不能删除" });
      const directory = path.resolve(dataRoot, "meetings", meetingId);
      if (!directory.startsWith(path.resolve(dataRoot, "meetings") + path.sep)) {
        return jsonResponse(response, 400, { error: "无效会议目录" });
      }
      storage.deleteMeeting(meetingId);
      if (existsSync(directory)) rmSync(directory, { recursive: true, force: true });
      return jsonResponse(response, 200, { ok: true });
    }
    const speakerMatch = url.pathname.match(/^\/api\/speakers\/([^/]+)$/);
    if (request.method === "PATCH" && speakerMatch) {
      const body = await readJson(request);
      const speaker = storage.renameSpeaker(speakerMatch[1], body.displayName);
      return jsonResponse(response, 200, speaker);
    }
    const actionMatch = url.pathname.match(/^\/api\/meetings\/([^/]+)\/(correct|summarize)$/);
    if (request.method === "POST" && actionMatch) {
      const meetingId = actionMatch[1];
      const currentMeeting = storage.getMeeting(meetingId);
      if (!currentMeeting) return jsonResponse(response, 404, { error: "会议不存在" });
      if (["recording", "correcting", "summarizing"].includes(currentMeeting.status)) {
        return jsonResponse(response, 409, { error: "会议仍在处理中，请稍后再试" });
      }
      if (actionMatch[2] === "correct") {
        runCorrectionAndSummary(meetingId).catch(() => undefined);
      } else {
        runSummary(meetingId).catch((error) => {
          storage.updateMeeting(meetingId, { status: "failed", error: `总结失败：${error.message}` });
        });
      }
      return jsonResponse(response, 202, { accepted: true });
    }
    return jsonResponse(response, 404, { error: "接口不存在" });
  } catch (error) {
    return jsonResponse(response, 500, { error: error.message });
  }
});

const websocketServer = new WebSocketServer({ server: httpServer });

websocketServer.on("connection", (client, request) => {
  if (!apiKey) {
    sendJson(client, { type: "error", message: "后台尚未配置 DASHSCOPE_API_KEY" });
    client.close(1011, "missing api key");
    return;
  }

  const requestUrl = new URL(request.url, "http://127.0.0.1");
  const meeting = storage.createMeeting(requestUrl.searchParams.get("title") || meetingTitle(), {
    summaryTemplate: requestUrl.searchParams.get("template"),
    reportStyle: requestUrl.searchParams.get("reportStyle"),
  });
  const meetingId = meeting.id;
  const audio = new AudioSession(dataRoot, meetingId);
  const taskId = randomUUID();
  let started = false;
  let finishing = false;
  let finalized = false;
  let sequence = 0;
  let previousSegment = null;
  let lastSpeakerId = null;
  let liveSummaryRunning = false;
  let liveSummaryTimer = null;
  let lastLiveSummaryAt = 0;
  let lastLiveSummarySeq = -1;
  const headers = { Authorization: `Bearer ${apiKey}`, "user-agent": "shiyin-ai/0.2" };
  if (workspaceId) headers["X-DashScope-WorkSpace"] = workspaceId;
  const upstream = new WebSocket(upstreamUrl, { headers, agent: proxyAgent });
  activeSessions.set(meetingId, { client, upstream, audio });

  async function runLiveSummary() {
    if (liveSummaryRunning || finishing || finalized || !miniMaxApiKey) return;
    const meetingSnapshot = storage.getMeeting(meetingId);
    if (!meetingSnapshot || !meetingSnapshot.segments.length) return;
    const throughSeq = meetingSnapshot.segments.at(-1)?.seq ?? -1;
    if (throughSeq <= lastLiveSummarySeq) return;

    liveSummaryRunning = true;
    lastLiveSummaryAt = Date.now();
    sendJson(client, {
      type: "summary.preview.started",
      meetingId,
      throughSeq,
    });
    let lastProgressSentAt = 0;
    try {
      const summary = await summarizeMeetingPreview({
        ...meetingSnapshot,
        durationMs: audio.durationMs,
      }, miniMaxApiKey, miniMaxModel, {
        stream: true,
        onProgress(progress) {
          const now = Date.now();
          if (now - lastProgressSentAt < 750) return;
          lastProgressSentAt = now;
          sendJson(client, {
            type: "summary.preview.progress",
            meetingId,
            characters: progress.characters || 0,
            events: progress.events || 0,
          });
        },
      });
      if (summary) {
        storage.saveLiveSummary(meetingId, summary);
        lastLiveSummarySeq = throughSeq;
        sendJson(client, {
          type: "summary.preview",
          meetingId,
          summary,
          throughSeq,
        });
      }
    } catch (error) {
      sendJson(client, {
        type: "summary.preview.error",
        meetingId,
        message: error.message,
      });
    } finally {
      liveSummaryRunning = false;
      if (!finishing && sequence - 1 > lastLiveSummarySeq) scheduleLiveSummary();
    }
  }

  function scheduleLiveSummary() {
    if (
      liveSummaryTimer
      || liveSummaryRunning
      || finishing
      || finalized
      || !miniMaxApiKey
      || audio.durationMs < liveSummaryStartMs
      || sequence < 4
    ) return;
    const waitMs = Math.max(0, liveSummaryIntervalMs - (Date.now() - lastLiveSummaryAt));
    liveSummaryTimer = setTimeout(() => {
      liveSummaryTimer = null;
      runLiveSummary().catch(() => undefined);
    }, waitMs);
    liveSummaryTimer.unref?.();
  }

  async function finalizeSession(asrError = null) {
    if (finalized) return;
    finalized = true;
    if (liveSummaryTimer) {
      clearTimeout(liveSummaryTimer);
      liveSummaryTimer = null;
    }
    try {
      const wavPath = await audio.finalize();
      storage.updateMeeting(meetingId, {
        endedAt: new Date().toISOString(),
        durationMs: audio.durationMs,
        audioPath: wavPath,
        status: "correcting",
        error: asrError,
      });
      activeSessions.delete(meetingId);
      await runCorrectionAndSummary(meetingId, client);
    } catch (error) {
      activeSessions.delete(meetingId);
      storage.updateMeeting(meetingId, { status: "failed", error: error.message });
      sendJson(client, { type: "error", message: `会议保存失败：${error.message}` });
    }
  }

  upstream.on("open", () => {
    upstream.send(JSON.stringify({
      header: { action: "run-task", task_id: taskId, streaming: "duplex" },
      payload: {
        task_group: "audio",
        task: "asr",
        function: "recognition",
        model: "paraformer-realtime-v2",
        parameters: {
          format: "pcm",
          sample_rate: 16000,
          language_hints: ["zh", "en"],
          semantic_punctuation_enabled: false,
          max_sentence_silence: 800,
          multi_threshold_mode_enabled: true,
          punctuation_prediction_enabled: true,
          inverse_text_normalization_enabled: true,
          heartbeat: true,
        },
        input: {},
      },
    }));
  });

  upstream.on("message", (raw, isBinary) => {
    if (isBinary) return;
    try {
      const event = JSON.parse(raw.toString());
      const eventName = event.header?.event;
      if (eventName === "task-started") {
        started = true;
        sendJson(client, {
          type: "session.started",
          taskId,
          meeting: storage.getMeeting(meetingId),
          speakerModelAvailable: speakerEngine.available,
        });
      } else if (eventName === "result-generated") {
        const sentence = event.payload?.output?.sentence;
        if (!sentence || sentence.heartbeat) return;
        if (!sentence.sentence_end) {
          sendJson(client, {
            type: "asr.partial",
            meetingId,
            text: sentence.text || "",
            startMs: sentence.begin_time ?? null,
            words: sentence.words || [],
          });
          return;
        }
        const startMs = sentence.begin_time ?? Math.max(0, audio.durationMs - 1000);
        const endMs = sentence.end_time ?? audio.durationMs;
        const pcm = audio.readRange(startMs, endMs);
        const assignment = speakerEngine.classifySegment(meetingId, pcm, storage);
        const speakerId = assignment?.speaker?.id || lastSpeakerId;
        if (speakerId) lastSpeakerId = speakerId;
        if (previousSegment && previousSegment.endMs !== null) {
          storage.setPauseAfter(previousSegment.id, Math.max(0, startMs - previousSegment.endMs));
        }
        const segment = storage.addSegment(meetingId, {
          seq: sequence++,
          startMs,
          endMs,
          text: sentence.text || "",
          speakerId,
          source: "realtime",
          confidence: assignment?.score ?? null,
          words: sentence.words || [],
        });
        previousSegment = segment;
        sendJson(client, {
          type: "segment.final",
          meetingId,
          segment,
          speaker: speakerId ? storage.getSpeaker(speakerId) : null,
          speakers: storage.listSpeakers(meetingId),
        });
        scheduleLiveSummary();
      } else if (eventName === "task-finished") {
        finalizeSession().catch(() => undefined);
      } else if (eventName === "task-failed") {
        const message = event.header?.error_message || "百炼识别任务失败";
        sendJson(client, { type: "error", recoverable: true, message });
        finalizeSession(`实时识别失败：${message}`).catch(() => undefined);
      }
    } catch (error) {
      sendJson(client, { type: "error", recoverable: true, message: `无法解析百炼结果：${error.message}` });
    }
  });

  upstream.on("error", (error) => {
    sendJson(client, { type: "error", recoverable: true, message: `百炼连接失败，录音仍会保存：${error.message}` });
  });

  upstream.on("close", (code) => {
    if (!finishing && code !== 1000) {
      sendJson(client, { type: "error", recoverable: true, message: `百炼连接已断开（${code}），录音仍会保存` });
    }
  });

  function finish() {
    if (finishing) return;
    finishing = true;
    if (started && upstream.readyState === WebSocket.OPEN) {
      upstream.send(JSON.stringify({
        header: { action: "finish-task", task_id: taskId, streaming: "duplex" },
        payload: { input: {} },
      }));
      setTimeout(() => finalizeSession("百炼结束响应超时").catch(() => undefined), 6000).unref();
    } else {
      finalizeSession("百炼连接未完成").catch(() => undefined);
    }
  }

  client.on("message", (data, isBinary) => {
    if (isBinary) {
      audio.append(data);
      if (started && !finishing && upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: true });
      return;
    }
    try {
      const command = JSON.parse(data.toString());
      if (command.type === "session.stop") finish();
    } catch { /* ignore unknown client messages */ }
  });

  client.on("close", finish);
});

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`拾音后台已启动：http://127.0.0.1:${port}`);
  console.log(`本地声纹模型：${speakerEngine.available ? "可用" : "不可用"}`);
  if (proxyUrl) console.log("百炼连接将使用系统网络代理");
});

function shutdown() {
  for (const session of activeSessions.values()) {
    sendJson(session.client, { type: "error", message: "后台正在退出，会议将保存" });
    session.client.close(1001, "server shutdown");
  }
  websocketServer.close();
  httpServer.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
