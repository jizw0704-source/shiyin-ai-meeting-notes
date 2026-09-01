import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import { createServer } from "node:net";
import path from "node:path";
import test from "node:test";
import { saveObsidianMeeting } from "../desktop/obsidian-export.mjs";
import { parseByteRange } from "../server/audio-stream.mjs";
import { AudioSession } from "../server/audio-session.mjs";
import { importedMeetingTitle, normalizeImportedAudio, validateImportedMedia } from "../server/audio-import.mjs";
import { buildClipRanges, createEditedWav } from "../server/audio-editing.mjs";
import { buildSpeakerClusters, correctMeetingSpeakers, splitLongSegment } from "../server/correction.mjs";
import { inspectPcmWav, transcribeHistoricalWav } from "../server/historical-transcription.mjs";
import { MeetingStorage } from "../server/storage.mjs";
import {
  cleanupTemporaryAudio,
  getStorageStats,
  recoverInterruptedMeetings,
} from "../server/storage-maintenance.mjs";
import { createWorkspaceBackup, restoreWorkspaceBackup } from "../server/workspace-backup.mjs";
import { findAvailableLocalPort } from "../server/local-port.mjs";
import { deriveAutomaticMeetingTitle, normalizeAutomaticMeetingTitle } from "../server/meeting-title.mjs";
import {
  buildMeetingPreflight,
  inspectMeetingStorage,
  PREFLIGHT_MINIMUM_FREE_BYTES,
} from "../server/meeting-preflight.mjs";
import { normalizeMaxSpeakers, normalizeSpeakerLimitMode } from "../server/speaker-settings.mjs";
import { SpeakerEngine } from "../server/speaker-engine.mjs";
import { detectPotentialOverlap } from "../server/overlap-detection.mjs";
import { enhanceOverlappingSegments } from "../server/overlap-enhancement.mjs";
import { cleanTranscriptText, replaceTranscriptText } from "../server/transcript-cleaning.mjs";
import { punctuateTranscriptText } from "../server/transcript-punctuation.mjs";
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

test("blocks meetings when required preflight checks fail but keeps optional AI as a warning", () => {
  const storage = inspectMeetingStorage("/virtual-data", {
    mkdirSync() {},
    accessSync() {},
    statfsSync() { return { bavail: 10_000, bsize: 4096 }; },
  });
  assert.equal(storage.status, "blocked");
  assert.ok(storage.freeBytes < PREFLIGHT_MINIMUM_FREE_BYTES);

  const blocked = buildMeetingPreflight({
    asrMode: null,
    localAsrAvailable: false,
    punctuationModelAvailable: false,
    speakerModelAvailable: false,
    miniMaxConfigured: false,
    autoSummary: true,
    activeMeetings: 1,
    storage,
  });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.checks.find((item) => item.id === "transcription")?.blocking, true);
  assert.equal(blocked.checks.find((item) => item.id === "summary")?.status, "warning");
});

test("passes meeting preflight with local models, writable storage, and optional summary disabled", () => {
  const storage = inspectMeetingStorage("/virtual-data", {
    mkdirSync() {},
    accessSync() {},
    statfsSync() { return { bavail: 2_000_000, bsize: 4096 }; },
  });
  const result = buildMeetingPreflight({
    asrMode: "local",
    localAsrAvailable: true,
    punctuationModelAvailable: true,
    speakerModelAvailable: true,
    miniMaxConfigured: false,
    autoSummary: false,
    activeMeetings: 0,
    storage,
  });
  assert.equal(result.status, "ready");
  assert.equal(result.checks.every((item) => item.status === "ready"), true);
});

test("selects another local port when the preferred desktop port is occupied", async () => {
  const blocker = createServer();
  await new Promise((resolve, reject) => {
    blocker.once("error", reject);
    blocker.listen({ host: "127.0.0.1", port: 0 }, resolve);
  });
  try {
    const address = blocker.address();
    assert.equal(typeof address, "object");
    const selected = await findAvailableLocalPort({
      host: "127.0.0.1",
      preferredPort: address.port,
      attempts: 10,
    });
    assert.notEqual(selected, address.port);
  } finally {
    await new Promise((resolve) => blocker.close(resolve));
  }
});

test("imports a compatible WAV without modifying the selected source file", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "shiyin-audio-import-"));
  try {
    const sourceSession = new AudioSession(root, "source-meeting");
    sourceSession.append(Buffer.alloc(64000, 9));
    const sourcePath = await sourceSession.finalize();
    const sourceBefore = readFileSync(sourcePath);
    const destinationPath = path.join(root, "meetings", "imported-meeting", "audio.wav");
    const progress = [];
    const imported = await normalizeImportedAudio({
      sourcePath,
      destinationPath,
      onProgress(value) { progress.push(value); },
    });
    assert.equal(imported.durationMs, 2000);
    assert.equal(inspectPcmWav(destinationPath).durationMs, 2000);
    assert.deepEqual(readFileSync(sourcePath), sourceBefore);
    assert.deepEqual(progress, [1, 100]);
    assert.equal(importedMeetingTitle("项目周会 2026-08-31.m4a"), "项目周会 2026-08-31");
    assert.throws(() => validateImportedMedia(path.join(root, "missing.mp3")), /没有找到/);

    const storage = new MeetingStorage(path.join(root, "database"));
    const meeting = storage.createMeeting("项目周会", {
      status: "importing",
      sourceType: "imported",
      sourceName: "项目周会.m4a",
    });
    assert.equal(meeting.status, "importing");
    assert.equal(meeting.sourceType, "imported");
    assert.equal(meeting.sourceName, "项目周会.m4a");
    storage.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("exposes meeting material counts in workspace meeting lists", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "shiyin-workspace-"));
  const storage = new MeetingStorage(root);
  try {
    const meeting = storage.createMeeting("资料统计会议");
    storage.addAttachment(meeting.id, {
      originalName: "调研提纲.md",
      storedName: "outline.md",
      mimeType: "text/markdown",
      sizeBytes: 18,
      extractedText: "# 调研提纲",
    });
    const listed = storage.listMeetings().find((item) => item.id === meeting.id);
    assert.equal(listed.attachmentCount, 1);
    assert.equal(storage.getMeeting(meeting.id).attachmentCount, 1);
  } finally {
    storage.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("automatically names summarized meetings without overwriting manual titles", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "shiyin-title-"));
  const storage = new MeetingStorage(root);
  try {
    const meeting = storage.createMeeting("会议 08/27 16:20");
    assert.equal(meeting.titleSource, "default");
    const summary = {
      headline: "Pulse 项目竞标流程与界面设计讨论，明确下一阶段安排",
      topics: ["竞标流程", "界面设计"],
    };
    const automatic = storage.applyAutomaticTitle(meeting.id, summary);
    assert.equal(automatic.changed, true);
    assert.match(automatic.meeting.title, /^Pulse 项目竞标流程与界面设计讨论｜\d{4}-\d{2}-\d{2}$/);
    assert.equal(automatic.meeting.titleSource, "automatic");

    const manual = storage.renameMeeting(meeting.id, "我自己确定的会议名称");
    assert.equal(manual.titleSource, "manual");
    const protectedResult = storage.applyAutomaticTitle(meeting.id, { headline: "新的 AI 标题" });
    assert.equal(protectedResult.changed, false);
    assert.equal(protectedResult.reason, "manual");
    assert.equal(protectedResult.meeting.title, "我自己确定的会议名称");

    const forced = storage.applyAutomaticTitle(meeting.id, { headline: "产品发布计划讨论" }, { force: true });
    assert.equal(forced.changed, true);
    assert.match(forced.meeting.title, /^产品发布计划讨论｜\d{4}-\d{2}-\d{2}$/);
    assert.equal(normalizeAutomaticMeetingTitle("会议主题：供应链风险复盘。"), "供应链风险复盘");
    assert.equal(deriveAutomaticMeetingTitle({}, { topics: ["预算", "交付"] }), "预算与交付讨论");
  } finally {
    storage.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("adapts automatic meeting titles to external and internal meetings", () => {
  const startedAt = "2026-09-01T04:30:00.000Z";
  const date = new Date(startedAt);
  const pad = (value) => String(value).padStart(2, "0");
  const localDate = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const meeting = { startedAt };

  assert.equal(deriveAutomaticMeetingTitle(meeting, {
    meetingIdentity: {
      scope: "external",
      counterpartyOrganization: "清华大学",
      primaryContact: "王老师",
      subject: "实验室数字化流程调研",
    },
  }), `清华大学｜王老师｜实验室数字化流程调研｜${localDate}`);

  assert.equal(deriveAutomaticMeetingTitle(meeting, {
    meetingIdentity: {
      scope: "internal",
      projectOrDepartment: "Pulse 项目",
      subject: "知识库下一阶段规划",
    },
  }), `Pulse 项目｜知识库下一阶段规划｜${localDate}`);

  assert.equal(deriveAutomaticMeetingTitle(meeting, {
    meetingIdentity: {
      scope: "external",
      counterpartyOrganization: "某研究院",
      primaryContact: "未明确",
      subject: "联合测试方案",
    },
  }), `某研究院｜联合测试方案｜${localDate}`);
});

test("adds the meeting time only when an automatic title collides", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "shiyin-title-collision-"));
  const storage = new MeetingStorage(root);
  try {
    const summary = {
      meetingIdentity: {
        scope: "external",
        counterpartyOrganization: "材料研究院",
        primaryContact: "李工",
        subject: "中试验证安排",
      },
    };
    const first = storage.createMeeting("第一次会议");
    const second = storage.createMeeting("第二次会议");
    const firstResult = storage.applyAutomaticTitle(first.id, summary);
    const secondResult = storage.applyAutomaticTitle(second.id, summary);
    assert.match(firstResult.meeting.title, /^材料研究院｜李工｜中试验证安排｜\d{4}-\d{2}-\d{2}$/);
    assert.match(secondResult.meeting.title, /^材料研究院｜李工｜中试验证安排｜\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  } finally {
    storage.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("saves an Obsidian meeting note atomically and preserves the user notes area", async () => {
  const vault = mkdtempSync(path.join(os.tmpdir(), "shiyin-obsidian-"));
  mkdirSync(path.join(vault, ".obsidian"));
  try {
    const first = await saveObsidianMeeting({
      vaultPath: vault,
      meetingId: "meeting-obsidian-1",
      title: "产品 / 周会",
      startedAt: "2026-08-10T02:00:00.000Z",
      markdown: "# 产品周会\n\n第一版总结。\n",
      savedAt: "2026-08-10T03:00:00.000Z",
    });
    assert.equal(first.updated, false);
    assert.match(first.relativePath, /^20 会议\/拾音 AI\/2026-08-10 产品 - 周会 \[meeting-\]\.md$/);
    let content = readFileSync(first.path, "utf8");
    assert.match(content, /type: meeting-note/);
    assert.match(content, /shiyin_meeting_id: "meeting-obsidian-1"/);
    assert.match(content, /第一版总结/);
    assert.match(content, /<!-- shiyin-user-notes -->/);

    writeFileSync(first.path, `${content}这里是用户在 Obsidian 中补充的内容。\n`);
    const second = await saveObsidianMeeting({
      vaultPath: vault,
      existingRelativePath: first.relativePath,
      meetingId: "meeting-obsidian-1",
      title: "产品周会（已更新）",
      startedAt: "2026-08-10T02:00:00.000Z",
      markdown: "# 产品周会\n\n第二版总结。\n",
      savedAt: "2026-08-10T04:00:00.000Z",
    });
    assert.equal(second.updated, true);
    assert.equal(second.path, first.path);
    content = readFileSync(second.path, "utf8");
    assert.match(content, /第二版总结/);
    assert.doesNotMatch(content, /第一版总结/);
    assert.match(content, /这里是用户在 Obsidian 中补充的内容/);

    const protectedFolder = path.join(vault, "10 项目", "拾音 AI");
    const protectedNote = path.join(protectedFolder, "拾音 AI 项目总览.md");
    mkdirSync(protectedFolder, { recursive: true });
    writeFileSync(protectedNote, "这篇项目笔记不能被会议同步覆盖。\n");
    const guarded = await saveObsidianMeeting({
      vaultPath: vault,
      existingRelativePath: "10 项目/拾音 AI/拾音 AI 项目总览.md",
      meetingId: "meeting-obsidian-2",
      title: "安全路径测试",
      startedAt: "2026-08-10T02:00:00.000Z",
      markdown: "# 安全路径测试\n",
    });
    assert.match(guarded.relativePath, /^20 会议\/拾音 AI\//);
    assert.equal(readFileSync(protectedNote, "utf8"), "这篇项目笔记不能被会议同步覆盖。\n");
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test("normalizes supported meeting sizes without allowing unbounded speaker clusters", () => {
  assert.equal(normalizeMaxSpeakers(6), 6);
  assert.equal(normalizeMaxSpeakers("12"), 12);
  assert.equal(normalizeMaxSpeakers(20), 20);
  assert.equal(normalizeMaxSpeakers(99), 6);
});

test("conservatively detects an embedding between two established speakers", () => {
  const overlap = detectPotentialOverlap(
    new Float32Array([Math.SQRT1_2, Math.SQRT1_2]),
    [
      { id: "speaker-a", centroid: new Float32Array([1, 0]) },
      { id: "speaker-b", centroid: new Float32Array([0, 1]) },
    ],
  );
  assert.equal(overlap.suspected, true);
  assert.deepEqual(overlap.candidateIds, ["speaker-a", "speaker-b"]);
  assert.ok(overlap.confidence >= 0.55 && overlap.confidence <= 0.92);

  const clearVoice = detectPotentialOverlap(
    new Float32Array([0.995, 0.1]),
    [
      { id: "speaker-a", centroid: new Float32Array([1, 0]) },
      { id: "speaker-b", centroid: new Float32Array([0, 1]) },
    ],
  );
  assert.equal(clearVoice.suspected, false);
});

test("persists overlap warnings and clears them after manual speaker confirmation", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "shiyin-overlap-"));
  const storage = new MeetingStorage(root);
  try {
    const meeting = storage.createMeeting("重叠发言测试");
    const first = storage.ensureSpeaker(meeting.id, "发言人1", new Float32Array([1, 0]));
    const second = storage.ensureSpeaker(meeting.id, "发言人2", new Float32Array([0, 1]));
    const segment = storage.addSegment(meeting.id, {
      seq: 0,
      startMs: 1200,
      endMs: 3600,
      text: "两个人同时回应了这个问题",
      speakerId: null,
      overlapSuspected: true,
      overlapConfidence: 0.76,
      overlapSpeakerIds: [first.id, second.id],
    });
    const saved = storage.getSegment(segment.id);
    assert.equal(saved.overlapSuspected, true);
    assert.equal(saved.overlapConfidence, 0.76);
    assert.deepEqual(saved.overlapSpeakerIds, [first.id, second.id]);

    const updated = storage.assignSegmentSpeaker(segment.id, second.id);
    assert.equal(updated.segments[0].speakerId, second.id);
    assert.equal(updated.segments[0].overlapSuspected, false);
    assert.equal(updated.segments[0].overlapConfidence, null);
    assert.deepEqual(updated.segments[0].overlapSpeakerIds, []);
    assert.equal(updated.summaryStale, true);
  } finally {
    storage.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("persists meetings, speakers, timestamps, pauses, and manual names", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "shiyin-storage-"));
  const storage = new MeetingStorage(root);
  try {
    const meeting = storage.createMeeting("测试会议", {
      summaryTemplate: "project-sync",
      reportStyle: "visual",
      maxSpeakers: 12,
      speakerLimitMode: "manual",
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
    storage.updateMeeting(meeting.id, { title: "设计周会", status: "completed", durationMs: 4800 });

    const saved = storage.getMeeting(meeting.id);
    assert.equal(saved.title, "设计周会");
    assert.equal(saved.status, "completed");
    assert.equal(saved.summaryTemplate, "project-sync");
    assert.equal(saved.templateVersion, 2);
    assert.equal(saved.reportStyle, "visual");
    assert.equal(saved.maxSpeakers, 12);
    assert.equal(saved.speakerLimitMode, "manual");
    assert.equal(saved.segments.length, 2);
    assert.equal(saved.segments[0].pauseAfterMs, 1450);
    assert.equal(saved.liveSummary.headline, "实时草稿");
    assert.equal(saved.liveSummary.throughSeq, 1);
    assert.equal(renamed.displayName, "王工");
    assert.equal(renamed.manuallyNamed, true);
    assert.equal(renamed.autoMatched, false);
    assert.ok(renamed.profileId);
    assert.equal(storage.listSpeakerProfiles().length, 1);
  } finally {
    storage.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("defaults new meetings to automatic speaker detection with a 20-person safety ceiling", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "shiyin-auto-speakers-"));
  const storage = new MeetingStorage(root);
  try {
    const meeting = storage.createMeeting("自动识别会议");
    assert.equal(meeting.speakerLimitMode, "auto");
    assert.equal(meeting.maxSpeakers, 20);
    assert.equal(meeting.summaryTemplate, "meeting-brief");
    assert.equal(meeting.reportStyle, "visual");
    assert.equal(meeting.templateVersion, 2);
    assert.equal(normalizeSpeakerLimitMode("unexpected", "manual"), "manual");
  } finally {
    storage.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("automatic speaker detection confirms a second voice but ignores transient fragments", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "shiyin-auto-expansion-"));
  const storage = new MeetingStorage(root);
  try {
    const meeting = storage.createMeeting("自动扩容会议");
    const engine = new SpeakerEngine({
      modelPath: path.join(root, "missing-speaker-model.onnx"),
      autoConfirmationSamples: 2,
      autoConfirmationDurationMs: 2400,
      autoExpansionSamples: 4,
      autoExpansionDurationMs: 6000,
    });
    const firstVoice = new Float32Array([1, 0, 0, 0]);
    const secondVoice = new Float32Array([0, 1, 0, 0]);
    const transientVoice = new Float32Array([0, 0, 1, 0]);
    const first = engine.assign(meeting.id, firstVoice, storage, {
      durationMs: 1500,
      maxSpeakers: 20,
      speakerLimitMode: "auto",
    });
    const transient = engine.assign(meeting.id, transientVoice, storage, {
      durationMs: 1500,
      maxSpeakers: 20,
      speakerLimitMode: "auto",
    });
    engine.assign(meeting.id, firstVoice, storage, {
      durationMs: 1500,
      maxSpeakers: 20,
      speakerLimitMode: "auto",
    });
    const secondEvidence = engine.assign(meeting.id, secondVoice, storage, {
      durationMs: 1500,
      maxSpeakers: 20,
      speakerLimitMode: "auto",
    });
    engine.assign(meeting.id, firstVoice, storage, {
      durationMs: 1500,
      maxSpeakers: 20,
      speakerLimitMode: "auto",
    });
    const confirmedSecond = engine.assign(meeting.id, secondVoice, storage, {
      durationMs: 1500,
      maxSpeakers: 20,
      speakerLimitMode: "auto",
    });
    assert.equal(first.created, true);
    assert.equal(first.effectiveMaxSpeakers, 2);
    assert.equal(transient.pendingNewSpeaker, true);
    assert.equal(secondEvidence.pendingNewSpeaker, true);
    assert.equal(confirmedSecond.created, true);
    assert.equal(confirmedSecond.expandedTo, null);
    assert.equal(storage.listSpeakers(meeting.id).length, 2);
  } finally {
    storage.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("automatic speaker detection expands beyond two only after stable repeated evidence", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "shiyin-auto-third-speaker-"));
  const storage = new MeetingStorage(root);
  try {
    const meeting = storage.createMeeting("三人自动扩容会议");
    const engine = new SpeakerEngine({
      modelPath: path.join(root, "missing-speaker-model.onnx"),
      autoConfirmationSamples: 2,
      autoConfirmationDurationMs: 2400,
      autoExpansionSamples: 4,
      autoExpansionDurationMs: 6000,
    });
    const firstVoice = new Float32Array([1, 0, 0]);
    const secondVoice = new Float32Array([0, 1, 0]);
    const thirdVoice = new Float32Array([0, 0, 1]);
    engine.assign(meeting.id, firstVoice, storage, { durationMs: 1500, maxSpeakers: 20, speakerLimitMode: "auto" });
    engine.assign(meeting.id, secondVoice, storage, { durationMs: 1500, maxSpeakers: 20, speakerLimitMode: "auto" });
    engine.assign(meeting.id, secondVoice, storage, { durationMs: 1500, maxSpeakers: 20, speakerLimitMode: "auto" });
    const evidence = [];
    for (let index = 0; index < 4; index += 1) {
      evidence.push(engine.assign(meeting.id, thirdVoice, storage, {
        durationMs: 1500,
        maxSpeakers: 20,
        speakerLimitMode: "auto",
      }));
      if (index < 3) engine.assign(meeting.id, firstVoice, storage, {
        durationMs: 1500,
        maxSpeakers: 20,
        speakerLimitMode: "auto",
      });
    }
    assert.equal(evidence.slice(0, 3).every((item) => item.pendingNewSpeaker), true);
    assert.equal(evidence[3].created, true);
    assert.equal(evidence[3].expandedTo, 6);
    assert.equal(storage.listSpeakers(meeting.id).length, 3);
  } finally {
    storage.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("speaker correction discards short singleton acoustic fragments", () => {
  const items = [
    { startMs: 0, endMs: 1600, embedding: new Float32Array([1, 0, 0]), clusterIndex: null },
    { startMs: 1700, endMs: 3400, embedding: new Float32Array([0.99, 0.04, 0]), clusterIndex: null },
    { startMs: 3500, endMs: 5100, embedding: new Float32Array([0, 1, 0]), clusterIndex: null },
    { startMs: 5200, endMs: 6900, embedding: new Float32Array([0.04, 0.99, 0]), clusterIndex: null },
    { startMs: 7000, endMs: 8300, embedding: new Float32Array([0, 0, 1]), clusterIndex: null },
  ];
  const clusters = buildSpeakerClusters(items, { maxSpeakers: 6 });
  assert.equal(clusters.length, 2);
  assert.equal(items.at(-1).clusterIndex, null);
});

test("remembers manually named voices and conservatively matches them across meetings", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "shiyin-speaker-profiles-"));
  const storage = new MeetingStorage(root);
  try {
    const firstMeeting = storage.createMeeting("第一次会议");
    const wang = storage.ensureSpeaker(firstMeeting.id, "发言人1", new Float32Array([1, 0, 0]));
    const namedWang = storage.renameSpeaker(wang.id, "王工");
    assert.ok(namedWang.profileId);

    const confident = storage.matchSpeakerProfile(new Float32Array([0.99, 0.08, 0]), {
      threshold: 0.8,
      ambiguityMargin: 0.04,
    });
    assert.equal(confident.displayName, "王工");

    const secondMeeting = storage.createMeeting("第二次会议");
    const matched = storage.ensureSpeaker(
      secondMeeting.id,
      "发言人1",
      new Float32Array([0.99, 0.08, 0]),
      { profile: confident },
    );
    assert.equal(matched.displayName, "王工");
    assert.equal(matched.autoMatched, true);
    assert.equal(matched.manuallyNamed, false);

    const li = storage.ensureSpeaker(firstMeeting.id, "发言人2", new Float32Array([0.99, 0.1, 0]));
    storage.renameSpeaker(li.id, "李工");
    const ambiguous = storage.matchSpeakerProfile(new Float32Array([1, 0.04, 0]), {
      threshold: 0.8,
      ambiguityMargin: 0.04,
    });
    assert.equal(ambiguous, null);
  } finally {
    storage.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("progressively matches a known voice during the meeting and performs a lightweight final retry", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "shiyin-progressive-speaker-"));
  const storage = new MeetingStorage(root);
  try {
    const knownMeeting = storage.createMeeting("已知发言人");
    const known = storage.ensureSpeaker(knownMeeting.id, "发言人1", new Float32Array([1, 0, 0]));
    storage.renameSpeaker(known.id, "王工");

    const activeMeeting = storage.createMeeting("实时匹配");
    const engine = new SpeakerEngine({
      modelPath: path.join(root, "missing-speaker-model.onnx"),
      profileMinimumSamples: 3,
      profileMinimumDurationMs: 6000,
    });
    const voice = new Float32Array([0.99, 0.08, 0]);
    const first = engine.assign(activeMeeting.id, voice, storage, { durationMs: 2500 });
    assert.equal(first.speaker.displayName, "发言人1");
    const second = engine.assign(activeMeeting.id, voice, storage, { durationMs: 2500 });
    assert.equal(second.speaker.displayName, "发言人1");
    const third = engine.assign(activeMeeting.id, voice, storage, { durationMs: 2500 });
    assert.equal(third.speaker.displayName, "王工");
    assert.equal(third.speaker.autoMatched, true);

    const finalMeeting = storage.createMeeting("结束时复核");
    const finalEngine = new SpeakerEngine({ modelPath: path.join(root, "missing-final-model.onnx") });
    const plausibleVoice = new Float32Array([0.8, 0.6, 0]);
    finalEngine.assign(finalMeeting.id, plausibleVoice, storage, { durationMs: 2200 });
    finalEngine.assign(finalMeeting.id, plausibleVoice, storage, { durationMs: 2200 });
    const suggested = finalEngine.assign(finalMeeting.id, plausibleVoice, storage, { durationMs: 2200 });
    assert.equal(suggested.speaker.suggestedName, "王工");
    finalEngine.assign(finalMeeting.id, voice, storage, { durationMs: 2200 });
    assert.equal(storage.listSpeakers(finalMeeting.id)[0].displayName, "发言人1");
    const finalized = finalEngine.finalizeProfileMatches(finalMeeting.id, storage);
    assert.equal(finalized[0].displayName, "王工");
    assert.equal(finalized[0].autoMatched, true);
  } finally {
    storage.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("offers a one-click candidate when a voice is plausible but not safe to auto-name", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "shiyin-speaker-suggestion-"));
  const storage = new MeetingStorage(root);
  try {
    const knownMeeting = storage.createMeeting("候选声纹来源");
    const known = storage.ensureSpeaker(knownMeeting.id, "发言人1", new Float32Array([1, 0]));
    storage.renameSpeaker(known.id, "李工");

    const meeting = storage.createMeeting("候选匹配");
    const engine = new SpeakerEngine({ modelPath: path.join(root, "missing-speaker-model.onnx") });
    const plausibleVoice = new Float32Array([0.8, 0.6]);
    engine.assign(meeting.id, plausibleVoice, storage, { durationMs: 2500 });
    engine.assign(meeting.id, plausibleVoice, storage, { durationMs: 2500 });
    const candidate = engine.assign(meeting.id, plausibleVoice, storage, { durationMs: 2500 }).speaker;
    assert.equal(candidate.displayName, "发言人1");
    assert.equal(candidate.autoMatched, false);
    assert.equal(candidate.suggestedName, "李工");
    assert.ok(candidate.suggestedScore >= 0.78 && candidate.suggestedScore < 0.84);

    const confirmed = storage.renameSpeaker(candidate.id, candidate.suggestedName);
    assert.equal(confirmed.displayName, "李工");
    assert.equal(confirmed.manuallyNamed, true);
    assert.equal(confirmed.suggestedProfileId, null);
  } finally {
    storage.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("builds the local voice library from names saved by an older app version", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "shiyin-speaker-bootstrap-"));
  let storage = new MeetingStorage(root);
  try {
    const meeting = storage.createMeeting("旧版会议");
    const speaker = storage.ensureSpeaker(meeting.id, "发言人1", new Float32Array([1, 0, 0]));
    storage.db.prepare(`
      UPDATE speakers SET display_name = '王工', manually_named = 1, profile_id = NULL WHERE id = ?
    `).run(speaker.id);
    storage.db.prepare("DELETE FROM speaker_profiles").run();
    storage.close();

    storage = new MeetingStorage(root);
    const migrated = storage.getSpeaker(speaker.id);
    assert.equal(migrated.displayName, "王工");
    assert.ok(migrated.profileId);
    assert.equal(storage.listSpeakerProfiles()[0].displayName, "王工");
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
    storage.close();
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

test("adds conservative punctuation to local realtime transcript", () => {
  assert.equal(
    punctuateTranscriptText("我们先确认第一件事情然后讨论第二件事情最后再安排负责人"),
    "我们先确认第一件事情，然后讨论第二件事情最后再安排负责人。",
  );
  assert.equal(punctuateTranscriptText("这个方案为什么"), "这个方案为什么？");
  assert.equal(punctuateTranscriptText("已经有标点。"), "已经有标点。");
  assert.equal(punctuateTranscriptText("这句话暂时以逗号结尾，"), "这句话暂时以逗号结尾。");
  assert.equal(punctuateTranscriptText("正在识别然后继续", { final: false }), "正在识别然后继续");
  assert.equal(
    punctuateTranscriptText("现在可以增加一些标点符号里面有现在在做这个测试"),
    "现在可以增加一些标点符号里面有。现在在做这个测试。",
  );
});

test("stores organized punctuation without overwriting original ASR text", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "shiyin-punctuation-storage-"));
  const storage = new MeetingStorage(root);
  try {
    const meeting = storage.createMeeting("断句测试");
    storage.addSegment(meeting.id, {
      seq: 0,
      startMs: 0,
      endMs: 2000,
      text: "我们先确认方案然后安排负责人",
      editedText: "我们先确认方案，然后安排负责人。",
      source: "local-realtime",
    });
    const [segment] = storage.getMeeting(meeting.id).segments;
    assert.equal(segment.originalText, "我们先确认方案然后安排负责人");
    assert.equal(segment.text, "我们先确认方案，然后安排负责人。");
    assert.equal(segment.cleanedText, "我们先确认方案，然后安排负责人。");
  } finally {
    storage.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("normalizes template and report settings", () => {
  assert.equal(normalizeSummaryTemplateId("meeting-brief"), "meeting-brief");
  assert.equal(normalizeSummaryTemplateId("brainstorm"), "brainstorm");
  assert.equal(normalizeSummaryTemplateId("unknown"), "meeting-brief");
  assert.equal(normalizeReportStyle("visual"), "visual");
  assert.equal(normalizeReportStyle("poster"), "visual");
  assert.match(summaryTemplatePrompt("daily-log"), /日常记录/);
  assert.match(summaryTemplatePrompt("project-sync"), /项目进度/);
  assert.match(summaryTemplatePrompt("meeting-brief"), /自动判断会议类型/);
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

test("creates non-destructive audio clips by speaker and time range", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "shiyin-audio-edit-"));
  const storage = new MeetingStorage(root);
  try {
    const meeting = storage.createMeeting("剪辑测试");
    const first = storage.ensureSpeaker(meeting.id, "发言人1");
    const second = storage.ensureSpeaker(meeting.id, "发言人2");
    storage.addSegment(meeting.id, { seq: 0, startMs: 0, endMs: 1000, text: "第一段", speakerId: first.id });
    storage.addSegment(meeting.id, { seq: 1, startMs: 1000, endMs: 2000, text: "第二段", speakerId: second.id });
    storage.addSegment(meeting.id, { seq: 2, startMs: 2500, endMs: 3500, text: "第三段", speakerId: first.id });
    const audio = new AudioSession(root, meeting.id);
    audio.append(Buffer.alloc(128000, 7));
    const sourcePath = await audio.finalize();
    storage.updateMeeting(meeting.id, { status: "completed", durationMs: 4000, audioPath: sourcePath });

    const ranges = buildClipRanges({
      startMs: 500,
      endMs: 3000,
      segments: storage.listSegments(meeting.id),
      speakerIds: [first.id],
    });
    assert.deepEqual(ranges, [{ startMs: 500, endMs: 1000 }, { startMs: 2500, endMs: 3000 }]);
    assert.deepEqual(buildClipRanges({ startMs: 500, endMs: 3000, segments: [], speakerIds: [] }), [
      { startMs: 500, endMs: 3000 },
    ]);
    const outputPath = path.join(root, "meetings", meeting.id, "clips", "selected.wav");
    const edited = await createEditedWav({
      sourcePath,
      outputPath,
      startMs: 500,
      endMs: 3000,
      segments: storage.listSegments(meeting.id),
      speakerIds: [first.id],
    });
    assert.equal(edited.durationMs, 1120);
    assert.equal(existsSync(sourcePath), true);
    assert.equal(existsSync(outputPath), true);
    const clip = storage.addAudioClip(meeting.id, {
      name: "发言人1精选",
      storedName: "selected.wav",
      startMs: 500,
      endMs: 3000,
      durationMs: edited.durationMs,
      sizeBytes: edited.sizeBytes,
      speakerIds: [first.id],
      sourceRanges: edited.sourceRanges,
    });
    assert.equal(storage.getMeeting(meeting.id).audioClips[0].id, clip.id);
    assert.equal(storage.getMeeting(meeting.id).audioClips[0].speakerIds[0], first.id);
  } finally {
    storage.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("separates a verified two-speaker overlap and keeps a restorable transcript version", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "shiyin-overlap-enhance-"));
  const storage = new MeetingStorage(root);
  try {
    const meeting = storage.createMeeting("多人发言拆解测试");
    const first = storage.ensureSpeaker(meeting.id, "发言人1", new Float32Array([1, 0]));
    const second = storage.ensureSpeaker(meeting.id, "发言人2", new Float32Array([0, 1]));
    storage.addSegment(meeting.id, {
      seq: 0,
      startMs: 0,
      endMs: 2000,
      text: "两个人同时说话的原记录",
      overlapSuspected: true,
      overlapConfidence: 0.8,
      overlapSpeakerIds: [first.id, second.id],
    });
    const audio = new AudioSession(root, meeting.id);
    audio.append(Buffer.alloc(64000, 3));
    const sourcePath = await audio.finalize();
    storage.updateMeeting(meeting.id, { audioPath: sourcePath, durationMs: 2000, status: "completed" });

    const positive = Buffer.alloc(64000);
    const negative = Buffer.alloc(64000);
    for (let offset = 0; offset < positive.length; offset += 2) {
      positive.writeInt16LE(1200, offset);
      negative.writeInt16LE(-1200, offset);
    }
    const fakeAsrEngine = {
      available: true,
      createSession(callbacks) {
        let firstSample = 0;
        let bytes = 0;
        return {
          acceptPcm(chunk) {
            if (!bytes) firstSample = chunk.readInt16LE(0);
            bytes += chunk.length;
          },
          finish() {
            callbacks.onFinal({
              startMs: 0,
              endMs: bytes / 32,
              originalText: firstSample > 0 ? "第一位发言人的内容" : "第二位发言人的内容",
              text: firstSample > 0 ? "第一位发言人的内容。" : "第二位发言人的内容。",
              words: [],
            });
          },
        };
      },
    };
    const result = await enhanceOverlappingSegments({
      meetingId: meeting.id,
      dataRoot: root,
      storage,
      separationEngine: { available: true, async separatePcm() { return [positive, negative]; } },
      asrEngine: fakeAsrEngine,
      speakerEngine: {
        available: true,
        extractEmbedding(pcm) {
          return pcm.readInt16LE(0) > 0 ? new Float32Array([1, 0]) : new Float32Array([0, 1]);
        },
      },
    });
    assert.equal(result.enhancedCount, 1);
    assert.equal(result.retainedCount, 0);
    assert.equal(result.meeting.segments.length, 2);
    assert.deepEqual(new Set(result.meeting.segments.map((segment) => segment.speakerId)), new Set([first.id, second.id]));
    assert.equal(result.meeting.segments.every((segment) => segment.source === "overlap-separated"), true);
    assert.equal(result.meeting.segments.every((segment) => !segment.overlapSuspected), true);
    assert.equal(result.meeting.transcriptVersions.length, 1);
    assert.equal(existsSync(sourcePath), true);

    const restored = storage.restoreTranscriptVersion(meeting.id, result.meeting.transcriptVersions[0].id);
    assert.equal(restored.segments.length, 1);
    assert.equal(restored.segments[0].overlapSuspected, true);
    assert.equal(restored.segments[0].text, "两个人同时说话的原记录");
  } finally {
    storage.close();
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
    const previousMeeting = storage.createMeeting("已命名会议");
    const knownSpeaker = storage.ensureSpeaker(previousMeeting.id, "发言人1", new Float32Array([1, 0, 0]));
    storage.renameSpeaker(knownSpeaker.id, "王工");
    const meeting = storage.createMeeting("WAV 校正测试");
    const audio = new AudioSession(root, meeting.id);
    audio.append(Buffer.alloc(64000, 3));
    const wavPath = await audio.finalize();
    storage.updateMeeting(meeting.id, { audioPath: wavPath, durationMs: 2000, status: "correcting" });
    storage.addSegment(meeting.id, {
      seq: 0,
      startMs: 0,
      endMs: 2000,
      text: "这是一段用于发言人校正的语音",
      editedText: "这是一段用于发言人校正的语音。",
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
    assert.equal(corrected[0].originalText, "这是一段用于发言人校正的语音");
    assert.equal(corrected[0].text, "这是一段用于发言人校正的语音。");
    const correctedSpeaker = storage.getSpeaker(corrected[0].speakerId);
    assert.equal(correctedSpeaker.displayName, "王工");
    assert.equal(correctedSpeaker.autoMatched, true);
  } finally {
    storage.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("keeps transcript versions and restores an older version without losing history", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "shiyin-transcript-version-"));
  const storage = new MeetingStorage(root);
  try {
    const meeting = storage.createMeeting("版本测试");
    const speaker = storage.ensureSpeaker(meeting.id, "发言人1");
    storage.renameSpeaker(speaker.id, "王工");
    storage.addSegment(meeting.id, {
      seq: 0,
      startMs: 0,
      endMs: 1500,
      text: "这是最初的转写。",
      speakerId: speaker.id,
      source: "local-realtime",
    });
    storage.saveSummary(meeting.id, { overview: "最初总结", decisions: [], topics: [], risks: [], actionItems: [] });
    storage.updateMeeting(meeting.id, { status: "completed" });
    const original = storage.createTranscriptVersion(meeting.id, {
      label: "初始转写",
      engine: "test-engine",
      active: true,
    });

    storage.replaceRetranscribedSegments(meeting.id, [{
      seq: 0,
      startMs: 0,
      endMs: 1600,
      text: "这是新的转写。",
    }]);
    const latest = storage.createTranscriptVersion(meeting.id, {
      label: "重新转写",
      engine: "new-engine",
      active: true,
    });
    assert.equal(storage.getMeeting(meeting.id).segments[0].text, "这是新的转写。");
    assert.equal(storage.getMeeting(meeting.id).activeTranscriptVersionId, latest.id);

    const restored = storage.restoreTranscriptVersion(meeting.id, original.id);
    assert.equal(restored.segments[0].text, "这是最初的转写。");
    assert.equal(restored.speakers[0].displayName, "王工");
    assert.equal(restored.summary.overview, "最初总结");
    assert.equal(restored.activeTranscriptVersionId, original.id);
    assert.equal(restored.transcriptVersions.length, 3);
  } finally {
    storage.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("creates a verified workspace backup and safely merges it into another workspace", async () => {
  const sourceRoot = mkdtempSync(path.join(os.tmpdir(), "shiyin-backup-source-"));
  const targetRoot = mkdtempSync(path.join(os.tmpdir(), "shiyin-backup-target-"));
  const destinationRoot = mkdtempSync(path.join(os.tmpdir(), "shiyin-backup-output-"));
  const sourceStorage = new MeetingStorage(sourceRoot);
  const targetStorage = new MeetingStorage(targetRoot);
  try {
    const meeting = sourceStorage.createMeeting("需要备份的会议", { maxSpeakers: 20 });
    const backedUpSpeaker = sourceStorage.ensureSpeaker(meeting.id, "发言人1", new Float32Array([1, 0, 0]));
    const namedSpeaker = sourceStorage.renameSpeaker(backedUpSpeaker.id, "王工");
    const candidateSpeaker = sourceStorage.ensureSpeaker(meeting.id, "发言人2", new Float32Array([0.8, 0.6, 0]));
    sourceStorage.setSpeakerProfileSuggestion(
      candidateSpeaker.id,
      sourceStorage.getSpeakerProfile(namedSpeaker.profileId),
      0.8,
    );
    sourceStorage.addSegment(meeting.id, {
      seq: 0,
      startMs: 0,
      endMs: 1000,
      text: "备份需要保留这段文字。",
      speakerId: null,
      source: "local-realtime",
      overlapSuspected: true,
      overlapConfidence: 0.76,
      overlapSpeakerIds: [backedUpSpeaker.id],
    });
    sourceStorage.saveSummary(meeting.id, {
      overview: "备份总结",
      decisions: [],
      topics: [],
      risks: [],
      actionItems: [],
    });
    const audio = new AudioSession(sourceRoot, meeting.id);
    audio.append(Buffer.alloc(32000, 4));
    const audioPath = await audio.finalize();
    sourceStorage.updateMeeting(meeting.id, {
      status: "completed",
      durationMs: 1000,
      audioPath,
    });
    const attachmentId = "attachment-backup-1";
    const attachmentDirectory = path.join(sourceRoot, "meetings", meeting.id, "attachments");
    mkdirSync(attachmentDirectory, { recursive: true });
    writeFileSync(path.join(attachmentDirectory, `${attachmentId}.md`), "# 会前方案\n\n预算上限为 20 万元。\n");
    sourceStorage.addAttachment(meeting.id, {
      id: attachmentId,
      originalName: "会前方案.md",
      storedName: `${attachmentId}.md`,
      mimeType: "text/markdown",
      sizeBytes: 37,
      extractedText: "# 会前方案\n\n预算上限为 20 万元。",
    });
    const clipDirectory = path.join(sourceRoot, "meetings", meeting.id, "clips");
    mkdirSync(clipDirectory, { recursive: true });
    writeFileSync(path.join(clipDirectory, "backup-clip.wav"), Buffer.alloc(144, 3));
    sourceStorage.addAudioClip(meeting.id, {
      id: "backup-clip",
      name: "王工发言精选",
      storedName: "backup-clip.wav",
      startMs: 100,
      endMs: 900,
      durationMs: 800,
      sizeBytes: 144,
      speakerIds: [backedUpSpeaker.id],
      sourceRanges: [{ startMs: 100, endMs: 900 }],
    });
    sourceStorage.createTranscriptVersion(meeting.id, { label: "备份版本", active: true });
    const deletedMeeting = sourceStorage.createMeeting("误删除但仍需备份的会议");
    sourceStorage.updateMeeting(deletedMeeting.id, { status: "completed", durationMs: 2400 });
    sourceStorage.softDeleteMeeting(deletedMeeting.id);

    const backup = await createWorkspaceBackup({
      storage: sourceStorage,
      dataRoot: sourceRoot,
      destinationRoot,
      appVersion: "test",
    });
    assert.equal(backup.meetingCount, 2);
    assert.equal(existsSync(path.join(backup.path, "manifest.json")), true);
    assert.equal(existsSync(path.join(backup.path, "speaker-profiles.json")), true);

    const restored = await restoreWorkspaceBackup({
      storage: targetStorage,
      dataRoot: targetRoot,
      backupPath: backup.path,
    });
    assert.equal(restored.importedMeetings, 2);
    assert.equal(restored.skippedMeetings, 0);
    const restoredMeeting = targetStorage.getMeeting(meeting.id);
    assert.equal(restoredMeeting.title, "需要备份的会议");
    assert.equal(restoredMeeting.segments[0].text, "备份需要保留这段文字。");
    assert.equal(restoredMeeting.segments[0].overlapSuspected, true);
    assert.equal(restoredMeeting.segments[0].overlapConfidence, 0.76);
    assert.deepEqual(restoredMeeting.segments[0].overlapSpeakerIds, [backedUpSpeaker.id]);
    assert.equal(restoredMeeting.summary.overview, "备份总结");
    assert.equal(restoredMeeting.maxSpeakers, 20);
    assert.equal(restoredMeeting.transcriptVersions.length, 1);
    assert.equal(restoredMeeting.attachments.length, 1);
    assert.equal(restoredMeeting.attachments[0].originalName, "会前方案.md");
    assert.equal(restoredMeeting.attachments[0].aiReadable, true);
    assert.equal(restoredMeeting.audioClips.length, 1);
    assert.equal(restoredMeeting.audioClips[0].name, "王工发言精选");
    assert.equal(restoredMeeting.speakers[0].displayName, "王工");
    assert.equal(restoredMeeting.speakers[1].suggestedName, "王工");
    assert.equal(restoredMeeting.speakers[1].suggestedScore, 0.8);
    assert.equal(targetStorage.listSpeakerProfiles()[0].displayName, "王工");
    assert.equal(existsSync(path.join(targetRoot, "meetings", meeting.id, "audio.wav")), true);
    assert.equal(existsSync(path.join(targetRoot, "meetings", meeting.id, "attachments", `${attachmentId}.md`)), true);
    assert.equal(existsSync(path.join(targetRoot, "meetings", meeting.id, "clips", "backup-clip.wav")), true);
    assert.equal(targetStorage.listMeetings().length, 1);
    assert.equal(targetStorage.listDeletedMeetings().length, 1);
    assert.equal(targetStorage.listDeletedMeetings()[0].title, "误删除但仍需备份的会议");
    assert.ok(targetStorage.listDeletedMeetings()[0].deletedAt);

    const duplicate = await restoreWorkspaceBackup({
      storage: targetStorage,
      dataRoot: targetRoot,
      backupPath: backup.path,
    });
    assert.equal(duplicate.importedMeetings, 0);
    assert.equal(duplicate.skippedMeetings, 2);
    assert.equal(targetStorage.listSpeakerProfiles().length, 1);
    assert.equal(targetStorage.listSpeakerProfiles()[0].sampleCount, 1);
  } finally {
    sourceStorage.close();
    targetStorage.close();
    rmSync(sourceRoot, { recursive: true, force: true });
    rmSync(targetRoot, { recursive: true, force: true });
    rmSync(destinationRoot, { recursive: true, force: true });
  }
});

test("moves meetings to recently deleted and restores all meeting content", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "shiyin-trash-"));
  const storage = new MeetingStorage(root);
  try {
    const meeting = storage.createMeeting("可恢复的会议");
    storage.addSegment(meeting.id, {
      seq: 0,
      startMs: 0,
      endMs: 1200,
      text: "这段逐字稿不能丢失。",
      speakerId: null,
      source: "local-realtime",
    });
    storage.saveSummary(meeting.id, {
      overview: "这份总结也需要保留。",
      decisions: [],
      topics: [],
      risks: [],
      actionItems: [],
    });
    storage.updateMeeting(meeting.id, { status: "completed", durationMs: 1200 });

    const deleted = storage.softDeleteMeeting(meeting.id);
    assert.ok(deleted.deletedAt);
    assert.equal(storage.listMeetings().length, 0);
    assert.equal(storage.listDeletedMeetings().length, 1);
    assert.equal(storage.getMeeting(meeting.id).segments[0].text, "这段逐字稿不能丢失。");
    assert.equal(storage.getMeeting(meeting.id).summary.overview, "这份总结也需要保留。");

    const restored = storage.restoreMeeting(meeting.id);
    assert.equal(restored.deletedAt, null);
    assert.equal(storage.listMeetings().length, 1);
    assert.equal(storage.listDeletedMeetings().length, 0);
    assert.equal(restored.segments[0].text, "这段逐字稿不能丢失。");

    storage.softDeleteMeeting(meeting.id);
    storage.deleteMeeting(meeting.id);
    assert.equal(storage.getMeeting(meeting.id), null);
  } finally {
    storage.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects a workspace backup when a protected meeting file is modified", async () => {
  const sourceRoot = mkdtempSync(path.join(os.tmpdir(), "shiyin-backup-tamper-source-"));
  const targetRoot = mkdtempSync(path.join(os.tmpdir(), "shiyin-backup-tamper-target-"));
  const destinationRoot = mkdtempSync(path.join(os.tmpdir(), "shiyin-backup-tamper-output-"));
  const sourceStorage = new MeetingStorage(sourceRoot);
  const targetStorage = new MeetingStorage(targetRoot);
  try {
    const meeting = sourceStorage.createMeeting("校验测试");
    sourceStorage.updateMeeting(meeting.id, { status: "completed" });
    const backup = await createWorkspaceBackup({
      storage: sourceStorage,
      dataRoot: sourceRoot,
      destinationRoot,
    });
    writeFileSync(path.join(backup.path, "meetings", meeting.id, "meeting.json"), "{}\n");
    await assert.rejects(
      restoreWorkspaceBackup({ storage: targetStorage, dataRoot: targetRoot, backupPath: backup.path }),
      /校验失败/,
    );
  } finally {
    sourceStorage.close();
    targetStorage.close();
    rmSync(sourceRoot, { recursive: true, force: true });
    rmSync(targetRoot, { recursive: true, force: true });
    rmSync(destinationRoot, { recursive: true, force: true });
  }
});

test("streams a saved WAV through the local recognizer for historical retranscription", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "shiyin-historical-asr-"));
  try {
    const audio = new AudioSession(root, "historical-meeting");
    audio.append(Buffer.alloc(64000, 5));
    const wavPath = await audio.finalize();
    const info = inspectPcmWav(wavPath);
    assert.equal(info.durationMs, 2000);

    let acceptedBytes = 0;
    const progress = [];
    const engine = {
      available: true,
      createSession(callbacks) {
        return {
          acceptPcm(chunk) { acceptedBytes += chunk.length; },
          finish() {
            callbacks.onFinal({ text: "历史录音重新转写成功。", startMs: 0, endMs: 2000, words: [] });
          },
        };
      },
    };
    const result = await transcribeHistoricalWav({
      filePath: wavPath,
      asrEngine: engine,
      onProgress(value) { progress.push(value); },
    });
    assert.equal(acceptedBytes, 64000);
    assert.equal(result.segments[0].text, "历史录音重新转写成功。");
    assert.equal(result.durationMs, 2000);
    assert.equal(progress.at(-1), 100);
  } finally {
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
      speakers: [
        { id: "speaker-1", displayName: "发言人1" },
        { id: "speaker-2", displayName: "发言人2" },
      ],
      segments: [{
        seq: 0,
        speakerId: null,
        startMs: 0,
        endMs: 1000,
        pauseAfterMs: 0,
        text: "先提出三个方向，再分别验证关键假设。",
        overlapSuspected: true,
        overlapConfidence: 0.74,
        overlapSpeakerIds: ["speaker-1", "speaker-2"],
      }],
    }, "test-key");
    assert.match(requestBody.messages[0].content, /当前内容模板：头脑风暴/);
    assert.match(requestBody.messages[0].content, /候选方向、优缺点、关键假设/);
    assert.match(requestBody.messages[0].content, /speaker_uncertain为true/);
    assert.match(requestBody.messages[1].content, /"summaryTemplate":"brainstorm"/);
    assert.match(requestBody.messages[1].content, /"speaker":"疑似重叠发言（归属待确认）"/);
    assert.match(requestBody.messages[1].content, /"speaker_uncertain":true/);
    assert.match(requestBody.messages[1].content, /"overlap_confidence":0.74/);
    assert.match(requestBody.messages[1].content, /"possible_speakers":\["发言人1","发言人2"\]/);
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
    }, "test-key", "MiniMax-M3", {
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
    meetingType: "research",
    meetingTypeReason: "以访谈提问和被调研方反馈为主",
    meetingTypeConfidence: "高",
    meetingIdentity: {
      scope: "external",
      counterpartyOrganization: "某高校",
      primaryContact: "周老师",
      projectOrDepartment: "",
      subject: "高校实验流程调研",
      evidenceSeqs: [0, 99],
    },
    brief: {
      subject: "高校实验流程调研",
      participants: "调研组 · 被调研高校",
      sections: [{ id: "pain-points", title: "核心痛点", content: "重复录入较多", evidenceSeqs: [0, 99] }],
      aiSuggestions: ["下一轮确认验收指标"],
    },
    overviewCards: [{ title: "产品", summary: "确定方向", points: ["先做MVP"], evidenceSeqs: [0, 99] }],
    keyFacts: [{ value: "12所", label: "调研高校", context: "访谈范围", evidenceSeqs: [1] }],
    detailedTopics: [{ title: "实施", points: ["先试用"], evidenceSeqs: [1] }],
    aiInsights: [{ title: "增长", insight: "需要先建立信任", confidence: "未知", evidenceSeqs: [0] }],
    actionItems: [{ owner: "", task: "完成原型", due: "", priority: "高", evidenceSeqs: [0] }],
    chapters: [{ title: "讨论", startMs: -10, endMs: 9000, summary: "讨论MVP", evidenceSeqs: [1] }],
  }, meeting);

  assert.deepEqual(summary.overviewCards[0].evidenceSeqs, [0]);
  assert.equal(summary.meetingType, "research");
  assert.equal(summary.meetingTypeConfidence, "高");
  assert.equal(summary.meetingIdentity.scope, "external");
  assert.equal(summary.meetingIdentity.primaryContact, "周老师");
  assert.deepEqual(summary.meetingIdentity.evidenceSeqs, [0]);
  assert.equal(summary.brief.sections[0].title, "核心痛点");
  assert.deepEqual(summary.brief.sections[0].evidenceSeqs, [0]);
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
