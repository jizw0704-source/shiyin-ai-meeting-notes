import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseByteRange } from "../server/audio-stream.mjs";
import { AudioSession } from "../server/audio-session.mjs";
import { correctMeetingSpeakers, splitLongSegment } from "../server/correction.mjs";
import { MeetingStorage } from "../server/storage.mjs";
import {
  cleanupTemporaryAudio,
  getStorageStats,
  recoverInterruptedMeetings,
} from "../server/storage-maintenance.mjs";
import { cleanTranscriptText, replaceTranscriptText } from "../server/transcript-cleaning.mjs";
import {
  normalizeMeetingSummary,
  parseJsonContent,
  summarizeMeeting,
  summarizeMeetingPreview,
} from "../server/summarizer.mjs";
import {
  normalizeReportStyle,
  normalizeSummaryTemplateId,
  summaryTemplatePrompt,
} from "../server/summary-templates.mjs";

test("persists meetings, speakers, timestamps, pauses, and manual names", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "shiyin-storage-"));
  const storage = new MeetingStorage(root);
  try {
    const meeting = storage.createMeeting("测试会议", {
      summaryTemplate: "project-sync",
      reportStyle: "visual",
    });
    const speaker = storage.ensureSpeaker(meeting.id, "发言人1", new Float32Array([1, 0, 0]));
    const first = storage.addSegment(meeting.id, {
      seq: 0,
      startMs: 100,
      endMs: 1800,
      text: "第一段",
      speakerId: speaker.id,
      source: "realtime",
    });
    storage.setPauseAfter(first.id, 1450);
    storage.addSegment(meeting.id, {
      seq: 1,
      startMs: 3250,
      endMs: 4800,
      text: "第二段",
      speakerId: speaker.id,
      source: "realtime",
    });
    const renamed = storage.renameSpeaker(speaker.id, "王工");
    storage.saveLiveSummary(meeting.id, {
      headline: "实时草稿",
      overview: "已讨论两项内容",
      decisions: [],
      topics: ["测试"],
      risks: [],
      actionItems: [],
      isLiveDraft: true,
      generatedAt: "2026-07-27T12:00:00.000Z",
      throughSeq: 1,
    });
    storage.updateMeeting(meeting.id, { status: "completed", durationMs: 4800 });

    const saved = storage.getMeeting(meeting.id);
    assert.equal(saved.title, "测试会议");
    assert.equal(saved.status, "completed");
    assert.equal(saved.summaryTemplate, "project-sync");
    assert.equal(saved.templateVersion, 1);
    assert.equal(saved.reportStyle, "visual");
    assert.equal(saved.segments.length, 2);
    assert.equal(saved.segments[0].pauseAfterMs, 1450);
    assert.equal(saved.liveSummary.headline, "实时草稿");
    assert.equal(saved.liveSummary.throughSeq, 1);
    assert.equal(renamed.displayName, "王工");
    assert.equal(renamed.manuallyNamed, true);
  } finally {
    storage.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("keeps original transcript while filtering, replacing, and undoing organized text", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "shiyin-transcript-edit-"));
  const storage = new MeetingStorage(root);
  try {
    const meeting = storage.createMeeting("术语整理测试");
    const speaker = storage.ensureSpeaker(meeting.id, "发言人1");
    storage.addSegment(meeting.id, {
      seq: 0,
      startMs: 0,
      endMs: 2000,
      text: "呃大家确认 POS 平台，嗯后续继续开发。",
      speakerId: speaker.id,
      source: "corrected",
    });
    storage.updateMeeting(meeting.id, { status: "completed" });
    storage.saveSummary(meeting.id, { overview: "旧总结" });

    const filtered = storage.setFillerFilterEnabled(meeting.id, true);
    assert.equal(filtered.segments[0].originalText, "呃大家确认 POS 平台，嗯后续继续开发。");
    assert.equal(filtered.segments[0].cleanedText, "大家确认 POS 平台，后续继续开发。");
    assert.equal(filtered.summaryStale, true);

    const replaced = storage.replaceTranscriptText(meeting.id, "POS", "PhenoSola OS", { wholeWord: true });
    assert.equal(replaced.count, 1);
    assert.match(replaced.meeting.segments[0].text, /PhenoSola OS/);
    assert.match(replaced.meeting.segments[0].originalText, /POS 平台/);
    assert.equal(replaced.meeting.canUndoTranscriptEdit, true);

    const undone = storage.undoLastTranscriptEdit(meeting.id);
    assert.equal(undone.restored, 1);
    assert.match(undone.meeting.segments[0].text, /POS 平台/);
    assert.equal(undone.meeting.canUndoTranscriptEdit, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("conservatively keeps affirmative fillers and supports whole-word replacement", () => {
  assert.equal(cleanTranscriptText("嗯"), "嗯");
  assert.equal(cleanTranscriptText("呃我们开始，啊下一项。"), "我们开始，下一项。");
  assert.deepEqual(
    replaceTranscriptText("POS 和 POSIX", "POS", "平台", { wholeWord: true }),
    { text: "平台 和 POSIX", count: 1 },
  );
});

test("normalizes template and report settings", () => {
  assert.equal(normalizeSummaryTemplateId("brainstorm"), "brainstorm");
  assert.equal(normalizeSummaryTemplateId("unknown"), "meeting-minutes");
  assert.equal(normalizeReportStyle("visual"), "visual");
  assert.equal(normalizeReportStyle("poster"), "detailed");
  assert.match(summaryTemplatePrompt("daily-log"), /日常记录/);
  assert.match(summaryTemplatePrompt("project-sync"), /项目进度/);
});

test("writes recoverable PCM and a valid mono 16 kHz WAV", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "shiyin-audio-"));
  try {
    const audio = new AudioSession(root, "meeting-a");
    const pcm = Buffer.alloc(32000);
    for (let index = 0; index < pcm.length; index += 2) pcm.writeInt16LE((index / 2) % 1200, index);
    audio.append(pcm);
    assert.equal(audio.durationMs, 1000);
    assert.deepEqual(audio.readRange(100, 200), pcm.subarray(3200, 6400));

    const wavPath = await audio.finalize();
    const wav = readFileSync(wavPath);
    assert.equal(wav.toString("ascii", 0, 4), "RIFF");
    assert.equal(wav.toString("ascii", 8, 12), "WAVE");
    assert.equal(wav.readUInt32LE(24), 16000);
    assert.equal(wav.readUInt16LE(22), 1);
    assert.equal(wav.readUInt16LE(34), 16);
    assert.equal(wav.readUInt32LE(40), pcm.length);
    assert.equal(statSync(wavPath).size, pcm.length + 44);
    assert.equal(existsSync(path.join(root, "meetings", "meeting-a", "audio.pcm.tmp")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("recovers an interrupted recording and safely cleans legacy duplicate audio", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "shiyin-recovery-"));
  const storage = new MeetingStorage(root);
  try {
    const meeting = storage.createMeeting("异常恢复测试");
    const directory = path.join(root, "meetings", meeting.id);
    const pcmPath = path.join(directory, "audio.pcm.tmp");
    const wavPath = path.join(directory, "audio.wav");
    writeFileSync(pcmPath, Buffer.alloc(64000, 1));

    const recovery = await recoverInterruptedMeetings({ storage, dataRoot: root });
    const recovered = storage.getMeeting(meeting.id);
    assert.equal(recovery.recoveredRecordings, 1);
    assert.equal(recovered.status, "completed");
    assert.equal(recovered.durationMs, 2000);
    assert.match(recovered.error, /录音已自动找回/);
    assert.equal(existsSync(wavPath), true);
    assert.equal(existsSync(pcmPath), false);

    writeFileSync(pcmPath, Buffer.alloc(32000, 2));
    const before = getStorageStats({ storage, dataRoot: root });
    assert.equal(before.temporaryBytes, 32000);
    const cleanup = cleanupTemporaryAudio({ storage, dataRoot: root });
    assert.equal(cleanup.filesRemoved, 1);
    assert.equal(cleanup.bytesFreed, 32000);
    assert.equal(cleanup.storage.temporaryBytes, 0);
    assert.equal(existsSync(pcmPath), false);
    assert.equal(existsSync(wavPath), true);
  } finally {
    storage.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("marks interrupted post-processing as retryable without losing meeting content", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "shiyin-task-recovery-"));
  const storage = new MeetingStorage(root);
  try {
    const meeting = storage.createMeeting("中断任务测试");
    storage.addSegment(meeting.id, {
      seq: 0,
      startMs: 0,
      endMs: 1600,
      text: "已保存的会议内容",
      source: "local-realtime",
    });
    const job = storage.createJob(meeting.id, "summary");
    storage.updateJob(job.id, { status: "running", progress: 35 });
    storage.updateMeeting(meeting.id, { status: "summarizing" });

    const recovery = await recoverInterruptedMeetings({ storage, dataRoot: root });
    const recovered = storage.getMeeting(meeting.id);
    assert.equal(recovery.interruptedTasks, 1);
    assert.equal(recovered.status, "completed");
    assert.match(recovered.error, /可重新执行/);
    assert.equal(recovered.segments[0].text, "已保存的会议内容");
    assert.equal(recovered.jobs[0].status, "failed");
  } finally {
    storage.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("corrects speakers from the finalized WAV after temporary PCM is removed", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "shiyin-wav-correction-"));
  const storage = new MeetingStorage(root);
  try {
    const meeting = storage.createMeeting("WAV 校正测试");
    const audio = new AudioSession(root, meeting.id);
    audio.append(Buffer.alloc(64000, 3));
    const wavPath = await audio.finalize();
    storage.updateMeeting(meeting.id, { audioPath: wavPath, durationMs: 2000, status: "correcting" });
    storage.addSegment(meeting.id, {
      seq: 0,
      startMs: 0,
      endMs: 2000,
      text: "这是一段用于发言人校正的语音。",
      source: "local-realtime",
    });

    const corrected = await correctMeetingSpeakers({
      meetingId: meeting.id,
      dataRoot: root,
      storage,
      speakerEngine: {
        extractEmbedding() { return new Float32Array([1, 0, 0]); },
      },
    });
    assert.equal(existsSync(path.join(root, "meetings", meeting.id, "audio.pcm.tmp")), false);
    assert.equal(corrected.length, 1);
    assert.ok(corrected[0].speakerId);
  } finally {
    storage.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("parses full and partial byte ranges for original recording playback", () => {
  assert.deepEqual(parseByteRange(undefined, 1000), { start: 0, end: 999, partial: false });
  assert.deepEqual(parseByteRange("bytes=100-249", 1000), { start: 100, end: 249, partial: true });
  assert.deepEqual(parseByteRange("bytes=900-", 1000), { start: 900, end: 999, partial: true });
  assert.deepEqual(parseByteRange("bytes=-200", 1000), { start: 800, end: 999, partial: true });
  assert.equal(parseByteRange("bytes=1000-", 1000), null);
  assert.equal(parseByteRange("bytes=300-200", 1000), null);
});

test("extracts MiniMax JSON even when reasoning text surrounds it", () => {
  const parsed = parseJsonContent(`<think>internal reasoning</think>
  \`\`\`json
  {"overview":"完成接口联调","decisions":["周五交付"],"topics":[],"risks":[],"actionItems":[]}
  \`\`\``);
  assert.equal(parsed.overview, "完成接口联调");
  assert.deepEqual(parsed.decisions, ["周五交付"]);
});

test("repairs unescaped quotes in MiniMax JSON strings", () => {
  const parsed = parseJsonContent(`\`\`\`json
  {"headline":"物业改进会","overview":"会议采用"逐个问题逐个解决"的方法推进","topics":["车辆管理"],"actionItems":[]}
  \`\`\``);
  assert.equal(parsed.headline, "物业改进会");
  assert.equal(parsed.overview, "会议采用\"逐个问题逐个解决\"的方法推进");
  assert.deepEqual(parsed.topics, ["车辆管理"]);
});

test("uses the final complete JSON object when MiniMax repeats a draft", () => {
  const parsed = parseJsonContent(`草稿：{"headline":"旧版本"}\n最终：{"headline":"新版本","overview":"采用最终结果"}`);
  assert.equal(parsed.headline, "新版本");
  assert.equal(parsed.overview, "采用最终结果");
});

test("rejects non-JSON summary output instead of displaying it as overview", () => {
  assert.throws(
    () => parseJsonContent("这不是JSON，也不能作为结构化会议总结"),
    /不是有效 JSON/,
  );
});

test("asks MiniMax to repair invalid JSON once before accepting the summary", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const content = calls === 1
      ? "invalid-json"
      : JSON.stringify({
        headline: "车辆管理专题会",
        overview: "会议讨论了小区车辆登记和外来车辆通行管理。",
        topics: ["车辆管理"],
        actionItems: [],
      });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const summary = await summarizeMeeting({
      title: "测试会议",
      durationMs: 1000,
      speakers: [{ id: "speaker-1", displayName: "发言人1" }],
      segments: [{
        seq: 0,
        speakerId: "speaker-1",
        startMs: 0,
        endMs: 1000,
        pauseAfterMs: 0,
        text: "讨论车辆登记和外来车辆管理。",
      }],
    }, "test-key");
    assert.equal(calls, 2);
    assert.equal(summary.headline, "车辆管理专题会");
    assert.deepEqual(summary.topics, ["车辆管理"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("uses a distinct MiniMax system prompt for the selected content template", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            headline: "头脑风暴形成三个候选方向",
            overview: "团队归纳了三个候选方向，并约定通过小规模实验验证关键假设。",
            topics: ["候选方向"],
            actionItems: [],
          }),
        },
      }],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    await summarizeMeeting({
      title: "创意讨论",
      summaryTemplate: "brainstorm",
      durationMs: 1000,
      speakers: [{ id: "speaker-1", displayName: "发言人1" }],
      segments: [{
        seq: 0,
        speakerId: "speaker-1",
        startMs: 0,
        endMs: 1000,
        pauseAfterMs: 0,
        text: "先提出三个方向，再分别验证关键假设。",
      }],
    }, "test-key");
    assert.match(requestBody.messages[0].content, /当前内容模板：头脑风暴/);
    assert.match(requestBody.messages[0].content, /候选方向、优缺点、关键假设/);
    assert.match(requestBody.messages[1].content, /"summaryTemplate":"brainstorm"/);
    assert.equal(requestBody.reasoning_split, true);
    assert.equal(requestBody.max_completion_tokens, 16000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("streams a live MiniMax draft and reports incremental progress", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  const progress = [];
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    const content = JSON.stringify({
      headline: "实时整理项目进展",
      overview: "团队正在核对当前进度和下一步任务。",
      overviewCards: [{
        title: "当前进度",
        summary: "已经完成接口联调。",
        points: ["下一步进行回归测试"],
        evidenceSeqs: [0],
      }],
      decisions: [],
      topics: ["项目进度"],
      risks: ["发布时间待确认"],
      actionItems: [{
        owner: "王工",
        task: "完成回归测试",
        due: "待确认",
        priority: "中",
        evidenceSeqs: [0],
      }],
      keywords: ["联调"],
    });
    const event = JSON.stringify({ choices: [{ delta: { content } }] });
    return new Response(`data: ${event}`, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  };
  try {
    const summary = await summarizeMeetingPreview({
      title: "项目周会",
      summaryTemplate: "project-sync",
      durationMs: 35000,
      liveSummary: null,
      speakers: [{ id: "speaker-1", displayName: "王工" }],
      segments: [{
        seq: 0,
        speakerId: "speaker-1",
        startMs: 0,
        endMs: 35000,
        pauseAfterMs: 0,
        text: "接口联调完成，下一步做回归测试。",
      }],
    }, "test-key", "MiniMax-M2.7", {
      stream: true,
      onProgress(value) {
        progress.push(value.characters);
      },
    });
    assert.equal(requestBody.stream, true);
    assert.equal(summary.isLiveDraft, true);
    assert.equal(summary.throughSeq, 0);
    assert.equal(summary.headline, "实时整理项目进展");
    assert.ok(progress.some((characters) => characters > 0));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("retries once with a larger budget when MiniMax reports truncation", async () => {
  const originalFetch = globalThis.fetch;
  const budgets = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    budgets.push(body.max_completion_tokens);
    if (budgets.length === 1) {
      return new Response(JSON.stringify({
        choices: [{ finish_reason: "length", message: { content: "{\"headline\":\"未完成" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({
      choices: [{
        finish_reason: "stop",
        message: {
          content: JSON.stringify({
            headline: "扩容后完成总结",
            overview: "第二次生成获得了完整的结构化结果。",
            topics: ["稳定性"],
          }),
        },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const summary = await summarizeMeeting({
      title: "截断重试测试",
      durationMs: 1000,
      speakers: [{ id: "speaker-1", displayName: "发言人1" }],
      segments: [{
        seq: 0,
        speakerId: "speaker-1",
        startMs: 0,
        endMs: 1000,
        pauseAfterMs: 0,
        text: "需要保证长会议总结稳定完成。",
      }],
    }, "test-key");
    assert.deepEqual(budgets, [16000, 32000]);
    assert.equal(summary.headline, "扩容后完成总结");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("returns a useful local result when no speech was recognized", async () => {
  const summary = await summarizeMeeting({ speakers: [], segments: [] }, null);
  assert.equal(summary.overview, "没有识别到有效语音");
  assert.equal(summary.actionItems.length, 0);
  assert.match(summary.risks[0], /麦克风/);
});

test("normalizes deep reports and removes invalid evidence references", () => {
  const meeting = {
    durationMs: 5000,
    segments: [
      { seq: 0, startMs: 0, endMs: 2000 },
      { seq: 1, startMs: 2500, endMs: 5000 },
    ],
  };
  const summary = normalizeMeetingSummary({
    overview: "形成详细纪要",
    overviewCards: [{ title: "产品", summary: "确定方向", points: ["先做MVP"], evidenceSeqs: [0, 99] }],
    keyFacts: [{ value: "12所", label: "调研高校", context: "访谈范围", evidenceSeqs: [1] }],
    detailedTopics: [{ title: "实施", points: ["先试用"], evidenceSeqs: [1] }],
    aiInsights: [{ title: "增长", insight: "需要先建立信任", confidence: "未知", evidenceSeqs: [0] }],
    actionItems: [{ owner: "", task: "完成原型", due: "", priority: "高", evidenceSeqs: [0] }],
    chapters: [{ title: "讨论", startMs: -10, endMs: 9000, summary: "讨论MVP", evidenceSeqs: [1] }],
  }, meeting);

  assert.deepEqual(summary.overviewCards[0].evidenceSeqs, [0]);
  assert.equal(summary.keyFacts[0].value, "12所");
  assert.equal(summary.aiInsights[0].confidence, "中");
  assert.equal(summary.actionItems[0].owner, "待确认");
  assert.equal(summary.chapters[0].startMs, 0);
  assert.equal(summary.chapters[0].endMs, 5000);
});

test("splits a long ASR sentence at strong punctuation for speaker correction", () => {
  const pieces = splitLongSegment({
    id: "segment-1",
    startMs: 0,
    endMs: 10000,
    text: "主持人介绍。另一位发言。",
    words: [
      { begin_time: 0, end_time: 2000, text: "主持人", punctuation: "" },
      { begin_time: 2000, end_time: 4500, text: "介绍", punctuation: "。" },
      { begin_time: 5000, end_time: 7000, text: "另一位", punctuation: "" },
      { begin_time: 7000, end_time: 10000, text: "发言", punctuation: "。" },
    ],
  });
  assert.equal(pieces.length, 2);
  assert.equal(pieces[0].text, "主持人介绍。");
  assert.equal(pieces[1].startMs, 5000);
});
