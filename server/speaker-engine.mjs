import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { normalizeMaxSpeakers, normalizeSpeakerLimitMode } from "./speaker-settings.mjs";
import { cosineSimilarity, detectPotentialOverlap } from "./overlap-detection.mjs";

const require = createRequire(import.meta.url);

function normalize(vector) {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const scale = Math.sqrt(sum) || 1;
  return Float32Array.from(vector, (value) => value / scale);
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
    this.profileMinimumSamples = options.profileMinimumSamples ?? 3;
    this.profileMinimumDurationMs = options.profileMinimumDurationMs ?? 6000;
    this.profileRetryInterval = options.profileRetryInterval ?? 2;
    this.profileAutoThreshold = options.profileAutoThreshold ?? 0.84;
    this.profileAutoMargin = options.profileAutoMargin ?? 0.05;
    this.profileSuggestionThreshold = options.profileSuggestionThreshold ?? 0.78;
    this.profileSuggestionMargin = options.profileSuggestionMargin ?? 0.025;
    this.autoExpansionSamples = options.autoExpansionSamples ?? 3;
    this.autoExpansionDurationMs = options.autoExpansionDurationMs ?? 3600;
    this.autoExpansionSimilarity = options.autoExpansionSimilarity ?? 0.72;
    this.extractor = null;
    this.clusters = new Map();
    this.autoLimits = new Map();
    this.pendingNovelVoices = new Map();
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
      speechDurationMs: 0,
      lastProfileCheckCount: speaker.profileId || speaker.manuallyNamed ? speaker.sampleCount || 1 : 0,
    })));
    const count = speakers.length;
    this.autoLimits.set(meetingId, count > 12 ? 20 : count > 6 ? 12 : 6);
  }

  createCluster(meetingId, embedding, storage, options = {}) {
    const clusters = this.clusters.get(meetingId);
    const label = `发言人${clusters.length + 1}`;
    const speaker = storage.ensureSpeaker(meetingId, label, embedding);
    const sampleCount = options.sampleCount || 1;
    clusters.push({
      speakerId: speaker.id,
      label,
      centroid: embedding,
      sampleCount,
      speechDurationMs: options.durationMs || 0,
      lastProfileCheckCount: 0,
    });
    if (sampleCount > 1) storage.updateSpeakerCentroid(speaker.id, embedding, sampleCount);
    return speaker;
  }

  trackNovelVoice(meetingId, embedding, durationMs) {
    const current = this.pendingNovelVoices.get(meetingId);
    const similar = current && cosineSimilarity(embedding, current.centroid) >= this.autoExpansionSimilarity;
    if (!similar) {
      const pending = { centroid: embedding, sampleCount: 1, durationMs: durationMs || 0 };
      this.pendingNovelVoices.set(meetingId, pending);
      return pending;
    }
    const count = current.sampleCount + 1;
    const weight = Math.min(0.34, 1 / count);
    current.centroid = normalize(Float32Array.from(current.centroid, (value, index) =>
      value * (1 - weight) + embedding[index] * weight));
    current.sampleCount = count;
    current.durationMs += durationMs || 0;
    return current;
  }

  evaluateProfileMatch(meetingId, cluster, storage, options = {}) {
    const speaker = storage.getSpeaker(cluster.speakerId);
    if (!speaker || speaker.manuallyNamed || speaker.profileId) return speaker;
    const force = Boolean(options.force);
    if (cluster.sampleCount < this.profileMinimumSamples
      || cluster.speechDurationMs < this.profileMinimumDurationMs) return speaker;
    if (!force && cluster.lastProfileCheckCount
      && cluster.sampleCount - cluster.lastProfileCheckCount < this.profileRetryInterval) return speaker;
    cluster.lastProfileCheckCount = cluster.sampleCount;

    const usedProfileIds = storage.listSpeakers(meetingId)
      .filter((item) => item.id !== speaker.id)
      .map((item) => item.profileId)
      .filter(Boolean);
    const ranked = storage.rankSpeakerProfiles(cluster.centroid, { excludeProfileIds: usedProfileIds });
    const best = ranked.best;
    if (best
      && best.score >= this.profileAutoThreshold
      && (!ranked.runnerUp || ranked.margin >= this.profileAutoMargin)) {
      return storage.applySpeakerProfile(speaker.id, best.profile);
    }
    if (best
      && best.score >= this.profileSuggestionThreshold
      && (!ranked.runnerUp || ranked.margin >= this.profileSuggestionMargin)) {
      return storage.setSpeakerProfileSuggestion(speaker.id, best.profile, best.score);
    }
    return storage.clearSpeakerProfileSuggestion(speaker.id);
  }

  assign(meetingId, embedding, storage, options = {}) {
    if (!embedding) return null;
    if (!this.clusters.has(meetingId)) this.seedMeeting(meetingId, storage.listSpeakers(meetingId));
    const clusters = this.clusters.get(meetingId);
    let best = null;
    for (const cluster of clusters) {
      const score = cosineSimilarity(embedding, cluster.centroid);
      if (!best || score > best.score) best = { cluster, score };
    }
    const overlap = detectPotentialOverlap(embedding, clusters.map((cluster) => ({
      id: cluster.speakerId,
      centroid: cluster.centroid,
    })));
    if (overlap.suspected) return { speaker: null, score: null, created: false, overlap };
    const maxSpeakers = normalizeMaxSpeakers(options.maxSpeakers ?? this.maxSpeakers);
    const speakerLimitMode = normalizeSpeakerLimitMode(options.speakerLimitMode, "manual");
    const effectiveMaxSpeakers = speakerLimitMode === "auto"
      ? Math.min(maxSpeakers, this.autoLimits.get(meetingId) || 6)
      : maxSpeakers;
    if ((!best || best.score < this.threshold) && clusters.length < effectiveMaxSpeakers) {
      this.pendingNovelVoices.delete(meetingId);
      const speaker = this.createCluster(meetingId, embedding, storage, options);
      return { speaker, score: 1, created: true, effectiveMaxSpeakers };
    }
    if ((!best || best.score < this.threshold) && speakerLimitMode === "auto") {
      if (effectiveMaxSpeakers >= maxSpeakers) {
        return { speaker: null, score: best?.score ?? null, created: false, limitReached: true, effectiveMaxSpeakers };
      }
      const pending = this.trackNovelVoice(meetingId, embedding, options.durationMs);
      if (pending.sampleCount >= this.autoExpansionSamples
        && pending.durationMs >= this.autoExpansionDurationMs) {
        const expandedTo = effectiveMaxSpeakers < 12 ? 12 : 20;
        this.autoLimits.set(meetingId, Math.min(maxSpeakers, expandedTo));
        this.pendingNovelVoices.delete(meetingId);
        const speaker = this.createCluster(meetingId, pending.centroid, storage, {
          durationMs: pending.durationMs,
          sampleCount: pending.sampleCount,
        });
        return {
          speaker,
          score: 1,
          created: true,
          expandedTo: Math.min(maxSpeakers, expandedTo),
          effectiveMaxSpeakers: Math.min(maxSpeakers, expandedTo),
        };
      }
      return {
        speaker: null,
        score: best?.score ?? null,
        created: false,
        pendingNewSpeaker: true,
        effectiveMaxSpeakers,
      };
    }
    if (!best) return null;
    this.pendingNovelVoices.delete(meetingId);
    const cluster = best.cluster;
    const count = cluster.sampleCount + 1;
    const weight = Math.min(0.25, 1 / count);
    const updated = normalize(Float32Array.from(cluster.centroid, (value, index) =>
      value * (1 - weight) + embedding[index] * weight));
    cluster.centroid = updated;
    cluster.sampleCount = count;
    cluster.speechDurationMs += options.durationMs || 0;
    storage.updateSpeakerCentroid(cluster.speakerId, updated, count);
    const speaker = this.evaluateProfileMatch(meetingId, cluster, storage);
    return { speaker, score: best.score, created: false };
  }

  classifySegment(meetingId, pcmBuffer, storage, options = {}) {
    const durationMs = pcmBuffer.length / 32;
    if (durationMs < this.minDurationMs) return null;
    return this.assign(meetingId, this.extractEmbedding(pcmBuffer), storage, { ...options, durationMs });
  }

  finalizeProfileMatches(meetingId, storage) {
    if (!this.clusters.has(meetingId)) this.seedMeeting(meetingId, storage.listSpeakers(meetingId));
    for (const cluster of this.clusters.get(meetingId) || []) {
      this.evaluateProfileMatch(meetingId, cluster, storage, { force: true });
    }
    return storage.listSpeakers(meetingId);
  }

  resetMeeting(meetingId) {
    this.clusters.delete(meetingId);
    this.autoLimits.delete(meetingId);
    this.pendingNovelVoices.delete(meetingId);
  }
}
