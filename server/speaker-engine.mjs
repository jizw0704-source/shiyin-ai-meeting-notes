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
    this.autoConfirmationSamples = options.autoConfirmationSamples ?? 2;
    this.autoConfirmationDurationMs = options.autoConfirmationDurationMs ?? 2400;
    this.autoExpansionSamples = options.autoExpansionSamples ?? 4;
    this.autoExpansionDurationMs = options.autoExpansionDurationMs ?? 6000;
    this.autoExpansionSimilarity = options.autoExpansionSimilarity ?? 0.72;
    this.pendingVoiceLimit = options.pendingVoiceLimit ?? 4;
    this.pendingVoiceMaxGap = options.pendingVoiceMaxGap ?? 8;
    this.extractor = null;
    this.clusters = new Map();
    this.autoLimits = new Map();
    this.pendingNovelVoices = new Map();
    this.observationCounts = new Map();
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
    this.autoLimits.set(meetingId, count > 12 ? 20 : count > 6 ? 12 : count > 2 ? 6 : 2);
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

  trackNovelVoice(meetingId, embedding, durationMs, observationIndex) {
    const candidates = (this.pendingNovelVoices.get(meetingId) || [])
      .filter((candidate) => observationIndex - candidate.lastObservationIndex <= this.pendingVoiceMaxGap);
    let best = null;
    for (const candidate of candidates) {
      const score = cosineSimilarity(embedding, candidate.centroid);
      if (!best || score > best.score) best = { candidate, score };
    }
    if (!best || best.score < this.autoExpansionSimilarity) {
      const pending = {
        centroid: embedding,
        sampleCount: 1,
        durationMs: durationMs || 0,
        lastObservationIndex: observationIndex,
      };
      candidates.push(pending);
      candidates.sort((left, right) =>
        (right.sampleCount * 1000 + right.durationMs) - (left.sampleCount * 1000 + left.durationMs));
      this.pendingNovelVoices.set(meetingId, candidates.slice(0, this.pendingVoiceLimit));
      return pending;
    }
    const current = best.candidate;
    const count = current.sampleCount + 1;
    const weight = Math.min(0.34, 1 / count);
    current.centroid = normalize(Float32Array.from(current.centroid, (value, index) =>
      value * (1 - weight) + embedding[index] * weight));
    current.sampleCount = count;
    current.durationMs += durationMs || 0;
    current.lastObservationIndex = observationIndex;
    this.pendingNovelVoices.set(meetingId, candidates);
    return current;
  }

  removePendingVoice(meetingId, pending) {
    const remaining = (this.pendingNovelVoices.get(meetingId) || []).filter((candidate) => candidate !== pending);
    if (remaining.length) this.pendingNovelVoices.set(meetingId, remaining);
    else this.pendingNovelVoices.delete(meetingId);
  }

  prunePendingVoices(meetingId, observationIndex) {
    const remaining = (this.pendingNovelVoices.get(meetingId) || [])
      .filter((candidate) => observationIndex - candidate.lastObservationIndex <= this.pendingVoiceMaxGap);
    if (remaining.length) this.pendingNovelVoices.set(meetingId, remaining);
    else this.pendingNovelVoices.delete(meetingId);
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
    const observationIndex = (this.observationCounts.get(meetingId) || 0) + 1;
    this.observationCounts.set(meetingId, observationIndex);
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
      ? Math.min(maxSpeakers, this.autoLimits.get(meetingId) || 2)
      : maxSpeakers;
    const novelVoice = !best || best.score < this.threshold;
    if (novelVoice && clusters.length === 0) {
      const speaker = this.createCluster(meetingId, embedding, storage, options);
      return { speaker, score: 1, created: true, effectiveMaxSpeakers };
    }
    if (novelVoice && speakerLimitMode === "manual" && clusters.length < effectiveMaxSpeakers) {
      const speaker = this.createCluster(meetingId, embedding, storage, options);
      return { speaker, score: 1, created: true, effectiveMaxSpeakers };
    }
    if (novelVoice && speakerLimitMode === "auto") {
      const requiresExpansion = clusters.length >= effectiveMaxSpeakers;
      if (requiresExpansion && effectiveMaxSpeakers >= maxSpeakers) {
        return { speaker: null, score: best?.score ?? null, created: false, limitReached: true, effectiveMaxSpeakers };
      }
      const pending = this.trackNovelVoice(meetingId, embedding, options.durationMs, observationIndex);
      const requiredSamples = clusters.length === 1
        ? this.autoConfirmationSamples
        : this.autoExpansionSamples;
      const requiredDurationMs = clusters.length === 1
        ? this.autoConfirmationDurationMs
        : this.autoExpansionDurationMs;
      if (pending.sampleCount >= requiredSamples && pending.durationMs >= requiredDurationMs) {
        let expandedTo = effectiveMaxSpeakers;
        if (requiresExpansion) {
          expandedTo = effectiveMaxSpeakers < 6 ? 6 : effectiveMaxSpeakers < 12 ? 12 : 20;
          this.autoLimits.set(meetingId, Math.min(maxSpeakers, expandedTo));
        }
        this.removePendingVoice(meetingId, pending);
        const speaker = this.createCluster(meetingId, pending.centroid, storage, {
          durationMs: pending.durationMs,
          sampleCount: pending.sampleCount,
        });
        return {
          speaker,
          score: 1,
          created: true,
          expandedTo: requiresExpansion ? Math.min(maxSpeakers, expandedTo) : null,
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
    this.prunePendingVoices(meetingId, observationIndex);
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
    this.observationCounts.delete(meetingId);
  }
}
