import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AudioSession } from "../server/audio-session.mjs";
import { splitLongSegment } from "../server/correction.mjs";
import { MeetingStorage } from "../server/storage.mjs";
import { normalizeMeetingSummary, parseJsonContent, summarizeMeeting } from "../server/summarizer.mjs";

test("persists meetings, speakers, timestamps, pauses, and manual names", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "shiyin-storage-"));
  const storage = new MeetingStorage(root);
  try {
    const meeting = storage.createMeeting("测试会议");
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
    storage.updateMeeting(meeting.id, { status: "completed", durationMs: 4800 });

    const saved = storage.getMeeting(meeting.id);
    assert.equal(saved.title, "测试会议");
    assert.equal(saved.status, "completed");
    assert.equal(saved.segments.length, 2);
    assert.equal(saved.segments[0].pauseAfterMs, 1450);
    assert.equal(renamed.displayName, "王工");
    assert.equal(renamed.manuallyNamed, true);
  } finally {
    storage.close();
    rmSync(root, { recursive: true, force: true });
  }
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
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("extracts MiniMax JSON even when reasoning text surrounds it", () => {
  const parsed = parseJsonContent(`<think>internal reasoning</think>
  \`\`\`json
  {"overview":"完成接口联调","decisions":["周五交付"],"topics":[],"risks":[],"actionItems":[]}
  \`\`\``);
  assert.equal(parsed.overview, "完成接口联调");
  assert.deepEqual(parsed.decisions, ["周五交付"]);
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
