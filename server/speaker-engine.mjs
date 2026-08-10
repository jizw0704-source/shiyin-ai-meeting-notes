import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { normalizeMaxSpeakers } from "./speaker-settings.mjs";

const require = createRequire(import.meta.url);

function normalize(vector) {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const scale = Math.sqrt(sum) || 1;
  return Float32Array.from(vector, (value) => value / scale);
}

function cosine(a, b) {
  let value = 0;
  for (let i = 0; i < a.length; i += 1) value += a[i] * b[i];
  return value;
}

function pcmToFloat32(buffer) {
  const samples = new Float32Array(Math.floor(buffer.length / 2));
  for (let i = 0; i < samples.length; i += 1) samples[i] = buffer.readInt16LE(i * 2) / 32768;
  return samples;
}

export class SpeakerEngine {
  constructor(options = {}) {
    this.modelPath = options.modelPath || path.resolve("models", "speaker", "3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx");
    this.threshold = options.threshold ?? 0.62;
    this.maxSpeakers = options.maxSpeakers ?? 6;
    this.minDurationMs = options.minDurationMs ?? 1200;
    this.extractor = null;
    this.clusters = new Map();
    if (existsSync(this.modelPath)) {
      const sherpa = require("sherpa-onnx-node");
      this.extractor = new sherpa.SpeakerEmbeddingExtractor({
        model: this.modelPath,
        numThreads: Math.max(1, Math.min(4, Number(options.numThreads || 2))),
        debug: false,
        provider: "cpu",
      });
    }
  }

  get available() {
    return Boolean(this.extractor);
  }

  extractEmbedding(pcmBuffer) {
    if (!this.extractor || pcmBuffer.length < 16000 * 2 * 0.8) return null;
    const stream = this.extractor.createStream();
    stream.acceptWaveform({ samples: pcmToFloat32(pcmBuffer), sampleRate: 16000 });
    stream.inputFinished();
    if (!this.extractor.isReady(stream)) return null;
    return normalize(this.extractor.compute(stream, false));
  }

  seedMeeting(meetingId, speakers) {
    this.clusters.set(meetingId, speakers.filter((speaker) => speaker.centroid).map((speaker) => ({
      speakerId: speaker.id,
      label: speaker.label,
      centroid: normalize(speaker.centroid),
      sampleCount: speaker.sampleCount || 1,
    })));
  }

  assign(meetingId, embedding, storage, options = {}) {
    if (!embedding) return null;
    if (!this.clusters.has(meetingId)) this.seedMeeting(meetingId, storage.listSpeakers(meetingId));
    const clusters = this.clusters.get(meetingId);
    let best = null;
    for (const cluster of clusters) {
      const score = cosine(embedding, cluster.centroid);
      if (!best || score > best.score) best = { cluster, score };
    }
    const maxSpeakers = normalizeMaxSpeakers(options.maxSpeakers ?? this.maxSpeakers);
    if ((!best || best.score < this.threshold) && clusters.length < maxSpeakers) {
      const label = `发言人${clusters.length + 1}`;
      const usedProfileIds = storage.listSpeakers(meetingId)
        .map((speaker) => speaker.profileId)
        .filter(Boolean);
      const profile = storage.matchSpeakerProfile(embedding, {
        threshold: 0.84,
        ambiguityMargin: 0.05,
        excludeProfileIds: usedProfileIds,
      });
      const speaker = storage.ensureSpeaker(meetingId, label, embedding, { profile });
      const cluster = { speakerId: speaker.id, label, centroid: embedding, sampleCount: 1 };
      clusters.push(cluster);
      return { speaker, score: 1, created: true };
    }
    if (!best) return null;
    const cluster = best.cluster;
    const count = cluster.sampleCount + 1;
    const weight = Math.min(0.25, 1 / count);
    const updated = normalize(Float32Array.from(cluster.centroid, (value, index) =>
      value * (1 - weight) + embedding[index] * weight));
    cluster.centroid = updated;
    cluster.sampleCount = count;
    storage.updateSpeakerCentroid(cluster.speakerId, updated, count);
    return { speaker: storage.getSpeaker(cluster.speakerId), score: best.score, created: false };
  }

  classifySegment(meetingId, pcmBuffer, storage, options = {}) {
    const durationMs = pcmBuffer.length / 32;
    if (durationMs < this.minDurationMs) return null;
    return this.assign(meetingId, this.extractEmbedding(pcmBuffer), storage, options);
  }

  resetMeeting(meetingId) {
    this.clusters.delete(meetingId);
  }
}
