import { existsSync, openSync, closeSync, readSync, statSync } from "node:fs";
import path from "node:path";
import * as ort from "onnxruntime-node";
import { inspectPcmWav } from "./historical-transcription.mjs";
import { cosineSimilarity } from "./overlap-detection.mjs";

const SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 2;
const MAX_SEGMENT_MS = 30000;

function pcmToFloat32(buffer) {
  const samples = new Float32Array(Math.floor(buffer.length / BYTES_PER_SAMPLE));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = buffer.readInt16LE(index * BYTES_PER_SAMPLE) / 32768;
  }
  return samples;
}

function float32ToPcm(samples) {
  const output = Buffer.alloc(samples.length * BYTES_PER_SAMPLE);
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, Number(samples[index]) || 0));
    output.writeInt16LE(Math.round(value < 0 ? value * 32768 : value * 32767), index * 2);
  }
  return output;
}

function rms(samples) {
  if (!samples.length) return 0;
  let total = 0;
  for (const value of samples) total += value * value;
  return Math.sqrt(total / samples.length);
}

function normalizeSeparatedSources(mixture, rawSources) {
  const sourceLength = mixture.length;
  const first = rawSources.subarray(0, sourceLength);
  const second = rawSources.subarray(sourceLength, sourceLength * 2);
  let dot = 0;
  let sumSquares = 0;
  for (let index = 0; index < sourceLength; index += 1) {
    const combined = first[index] + second[index];
    dot += mixture[index] * combined;
    sumSquares += combined * combined;
  }
  const scale = sumSquares > 1e-12 ? dot / sumSquares : 1;
  return [first, second].map((source) => Float32Array.from(source, (value) => value * scale));
}

function readPcmRange(filePath, wav, startMs, endMs) {
  const startByte = Math.max(0, Math.floor(startMs * 32 / 2) * 2);
  const endByte = Math.min(wav.dataLength, Math.ceil(endMs * 32 / 2) * 2);
  if (endByte <= startByte) return Buffer.alloc(0);
  const buffer = Buffer.alloc(endByte - startByte);
  const fd = openSync(filePath, "r");
  try {
    readSync(fd, buffer, 0, buffer.length, wav.dataOffset + startByte);
  } finally {
    closeSync(fd);
  }
  return buffer;
}

function transcribePcm(pcm, asrEngine) {
  const results = [];
  const session = asrEngine.createSession({
    onFinal(result) {
      const text = String(result.text || "").trim();
      if (!text) return;
      const originalText = String(result.originalText || text).trim();
      results.push({
        startMs: Math.max(0, Number(result.startMs) || 0),
        endMs: Math.max(0, Number(result.endMs) || 0),
        text: originalText,
        editedText: text === originalText ? null : text,
        words: result.words || [],
      });
    },
  });
  for (let offset = 0; offset < pcm.length; offset += 32000) {
    session.acceptPcm(pcm.subarray(offset, Math.min(pcm.length, offset + 32000)));
  }
  session.finish();
  return results;
}

function matchSeparatedSpeakers(embeddings, candidates, threshold = 0.48) {
  if (embeddings.length !== 2 || embeddings.some((value) => !value) || candidates.length < 2) return null;
  let best = null;
  for (const left of candidates) {
    for (const right of candidates) {
      if (left.id === right.id) continue;
      const leftScore = cosineSimilarity(embeddings[0], left.centroid);
      const rightScore = cosineSimilarity(embeddings[1], right.centroid);
      const score = leftScore + rightScore;
      if (!best || score > best.score) best = { score, matches: [
        { speakerId: left.id, confidence: leftScore },
        { speakerId: right.id, confidence: rightScore },
      ] };
    }
  }
  if (!best || best.matches.some((match) => match.confidence < threshold)) return null;
  return best.matches;
}

export class OverlapSeparationEngine {
  constructor(options = {}) {
    this.modelPath = path.resolve(
      options.modelPath || path.join("models", "separation", "convtasnet_16k.onnx"),
    );
    this.numThreads = Math.max(1, Math.min(4, Number(options.numThreads || 2)));
    this.session = null;
  }

  get available() {
    return existsSync(this.modelPath);
  }

  async ensureSession() {
    if (!this.available) throw new Error("本地双人语音分离模型不可用");
    if (!this.session) {
      this.session = await ort.InferenceSession.create(this.modelPath, {
        executionProviders: ["cpu"],
        intraOpNumThreads: this.numThreads,
        interOpNumThreads: 1,
      });
    }
    return this.session;
  }

  async separatePcm(pcm) {
    const mixture = pcmToFloat32(pcm);
    if (mixture.length < SAMPLE_RATE * 0.8) throw new Error("重叠片段过短，暂不拆解");
    const session = await this.ensureSession();
    const output = await session.run({
      mixture: new ort.Tensor("float32", mixture, [1, mixture.length]),
    });
    const tensor = output.sources || output[session.outputNames[0]];
    if (!tensor || tensor.dims[1] !== 2) throw new Error("双人语音分离模型返回了异常结果");
    const sources = normalizeSeparatedSources(mixture, tensor.data);
    const minimumEnergy = Math.max(0.001, rms(mixture) * 0.06);
    if (sources.some((source) => rms(source) < minimumEnergy)) {
      throw new Error("没有检测到两路足够清晰的独立人声");
    }
    return sources.map(float32ToPcm);
  }
}

export async function enhanceOverlappingSegments({
  meetingId,
  dataRoot,
  storage,
  separationEngine,
  asrEngine,
  speakerEngine,
  onProgress = () => {},
}) {
  if (!separationEngine?.available) throw new Error("本地双人语音分离模型不可用");
  if (!asrEngine?.available) throw new Error("本地转写模型不可用");
  if (!speakerEngine?.available) throw new Error("本地声纹模型不可用");
  const meeting = storage.getMeeting(meetingId);
  if (!meeting) throw new Error("会议不存在");
  const targets = meeting.segments.filter((segment) => segment.overlapSuspected);
  if (!targets.length) return { meeting, enhancedCount: 0, retainedCount: 0 };

  const audioPath = path.join(dataRoot, "meetings", meetingId, "audio.wav");
  if (!existsSync(audioPath) || statSync(audioPath).size <= 44) throw new Error("会议原始录音不可用");
  const wav = inspectPcmWav(audioPath);
  const targetIds = new Set(targets.map((segment) => segment.id));
  const replacements = new Map();
  let processed = 0;

  for (const segment of targets) {
    const startMs = Math.max(0, segment.startMs);
    const endMs = Math.min(wav.durationMs, segment.endMs ?? startMs);
    const durationMs = endMs - startMs;
    try {
      if (durationMs < 800 || durationMs > MAX_SEGMENT_MS) throw new Error("片段时长不适合自动拆解");
      const mixturePcm = readPcmRange(audioPath, wav, startMs, endMs);
      const sources = await separationEngine.separatePcm(mixturePcm);
      const embeddings = sources.map((source) => speakerEngine.extractEmbedding(source));
      const requestedCandidates = new Set(segment.overlapSpeakerIds || []);
      const candidatePool = meeting.speakers
        .filter((speaker) => speaker.centroid && (!requestedCandidates.size || requestedCandidates.has(speaker.id)))
        .map((speaker) => ({ id: speaker.id, centroid: speaker.centroid }));
      const matches = matchSeparatedSpeakers(embeddings, candidatePool);
      if (!matches) throw new Error("两路声音尚不能可靠匹配到不同发言人");

      const separated = sources.flatMap((source, sourceIndex) => transcribePcm(source, asrEngine).map((result) => ({
        ...result,
        startMs: Math.min(endMs, startMs + result.startMs),
        endMs: Math.min(endMs, Math.max(startMs, startMs + result.endMs)),
        speakerId: matches[sourceIndex].speakerId,
        confidence: matches[sourceIndex].confidence,
        source: "overlap-separated",
        overlapSuspected: false,
        overlapConfidence: null,
        overlapSpeakerIds: [],
      }))).filter((result) => result.text && result.endMs > result.startMs);
      const representedSpeakers = new Set(separated.map((result) => result.speakerId));
      if (representedSpeakers.size !== 2) throw new Error("拆解后只有一路产生了有效文字");
      replacements.set(segment.id, separated.sort((left, right) => left.startMs - right.startMs));
    } catch {
      // A conservative fallback keeps the original mixed transcript untouched.
    }
    processed += 1;
    onProgress(Math.round((processed / targets.length) * 90));
    await new Promise((resolve) => setImmediate(resolve));
  }

  const nextSegments = [];
  for (const segment of meeting.segments) {
    const replacement = replacements.get(segment.id);
    if (replacement?.length) nextSegments.push(...replacement);
    else nextSegments.push(segment);
  }
  nextSegments.sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  for (let index = 0; index < nextSegments.length; index += 1) {
    nextSegments[index] = {
      ...nextSegments[index],
      seq: index,
      pauseAfterMs: nextSegments[index + 1]
        ? Math.max(0, nextSegments[index + 1].startMs - nextSegments[index].endMs)
        : null,
    };
  }

  if (replacements.size) {
    storage.createTranscriptVersion(meetingId, {
      label: "会后重叠拆解前",
      engine: "local-overlap-separation",
    });
    storage.replaceEnhancedSegments(meetingId, nextSegments);
  }
  onProgress(100);
  return {
    meeting: storage.getMeeting(meetingId),
    enhancedCount: replacements.size,
    retainedCount: targetIds.size - replacements.size,
  };
}
