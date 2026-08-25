import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import path from "node:path";
import { normalizeMaxSpeakers } from "./speaker-settings.mjs";
import { cosineSimilarity, detectPotentialOverlap } from "./overlap-detection.mjs";

function normalize(vector) {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const scale = Math.sqrt(sum) || 1;
  return Float32Array.from(vector, (value) => value / scale);
}

function readPcmRange(fd, fileSize, dataOffset, startMs, endMs) {
  const start = Math.max(0, Math.floor(startMs * 32));
  const end = Math.min(fileSize, Math.ceil(endMs * 32));
  if (end <= start) return Buffer.alloc(0);
  const buffer = Buffer.alloc(end - start);
  readSync(fd, buffer, 0, buffer.length, dataOffset + start);
  return buffer;
}

function joinTimedWords(words) {
  return words.reduce((text, word) => {
    const value = `${word.text || ""}${word.punctuation || ""}`;
    const needsSpace = /[A-Za-z0-9]$/.test(text) && /^[A-Za-z0-9]/.test(value);
    return `${text}${needsSpace ? " " : ""}${value}`;
  }, "");
}

export function splitLongSegment(segment) {
  const duration = (segment.endMs ?? segment.startMs) - segment.startMs;
  const words = Array.isArray(segment.words) ? segment.words : [];
  if (duration < 8000 || words.length < 3) return [segment];

  const pieces = [];
  let wordStart = 0;
  for (let index = 0; index < words.length - 1; index += 1) {
    const word = words[index];
    const pieceStart = words[wordStart].begin_time ?? segment.startMs;
    const pieceEnd = word.end_time ?? pieceStart;
    const remaining = (segment.endMs ?? pieceEnd) - pieceEnd;
    if (
      /[。！？!?]/.test(word.punctuation || "")
      && pieceEnd - pieceStart >= 1200
      && remaining >= 1000
    ) {
      const pieceWords = words.slice(wordStart, index + 1);
      pieces.push({
        ...segment,
        id: `${segment.id}:${pieces.length}`,
        startMs: pieceWords[0].begin_time ?? segment.startMs,
        endMs: pieceWords.at(-1).end_time ?? pieceEnd,
        text: joinTimedWords(pieceWords),
        originalText: joinTimedWords(pieceWords),
        editedText: null,
        words: pieceWords,
      });
      wordStart = index + 1;
    }
  }
  if (!pieces.length) return [segment];
  const remainingWords = words.slice(wordStart);
  pieces.push({
    ...segment,
    id: `${segment.id}:${pieces.length}`,
    startMs: remainingWords[0]?.begin_time ?? segment.startMs,
    endMs: remainingWords.at(-1)?.end_time ?? segment.endMs,
    text: joinTimedWords(remainingWords) || segment.text,
    originalText: joinTimedWords(remainingWords) || segment.text,
    editedText: null,
    words: remainingWords,
  });
  return pieces;
}

function buildClusters(items, threshold = 0.64, maxSpeakers = 6) {
  const clusters = [];
  for (const item of items) {
    if (!item.embedding) continue;
    let best = null;
    for (const cluster of clusters) {
      const score = cosineSimilarity(item.embedding, cluster.centroid);
      if (!best || score > best.score) best = { cluster, score };
    }
    if ((!best || best.score < threshold) && clusters.length < maxSpeakers) {
      const cluster = { index: clusters.length, centroid: item.embedding, items: [item] };
      clusters.push(cluster);
      item.clusterIndex = cluster.index;
      continue;
    }
    if (!best) continue;
    best.cluster.items.push(item);
    item.clusterIndex = best.cluster.index;
    const count = best.cluster.items.length;
    best.cluster.centroid = normalize(Float32Array.from(best.cluster.centroid, (value, index) =>
      value * ((count - 1) / count) + item.embedding[index] / count));
  }
  // One refinement pass makes early, noisy assignments less sticky.
  for (const item of items) {
    if (!item.embedding || !clusters.length) continue;
    let best = { index: 0, score: -1 };
    for (const cluster of clusters) {
      const score = cosineSimilarity(item.embedding, cluster.centroid);
      if (score > best.score) best = { index: cluster.index, score };
    }
    item.clusterIndex = best.index;
    item.speakerConfidence = best.score;
  }
  return clusters;
}

export async function correctMeetingSpeakers({ meetingId, dataRoot, storage, speakerEngine, maxSpeakers = 6, onProgress = () => {} }) {
  const segments = storage.listSegments(meetingId).flatMap(splitLongSegment);
  if (!segments.length) return [];
  const directory = path.join(dataRoot, "meetings", meetingId);
  const wavPath = path.join(directory, "audio.wav");
  const pcmPath = path.join(directory, "audio.pcm.tmp");
  const audioPath = existsSync(wavPath) ? wavPath : pcmPath;
  const dataOffset = audioPath === wavPath ? 44 : 0;
  const fileSize = Math.max(0, statSync(audioPath).size - dataOffset);
  const fd = openSync(audioPath, "r");
  const items = [];
  try {
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const pcm = readPcmRange(fd, fileSize, dataOffset, segment.startMs, segment.endMs ?? segment.startMs + 1000);
      const embedding = pcm.length >= 16000 * 2 * 1.2 ? speakerEngine.extractEmbedding(pcm) : null;
      items.push({ ...segment, embedding, originalSpeakerId: segment.speakerId, clusterIndex: null });
      onProgress(Math.round(((index + 1) / segments.length) * 65));
      await new Promise((resolve) => setImmediate(resolve));
    }
  } finally {
    closeSync(fd);
  }

  const clusters = buildClusters(items, 0.64, normalizeMaxSpeakers(maxSpeakers));
  const usedSpeakerIds = new Set();
  const usedProfileIds = new Set();
  const clusterSpeaker = new Map();
  for (const cluster of clusters) {
    const counts = new Map();
    for (const item of items.filter((value) => value.clusterIndex === cluster.index)) {
      if (item.originalSpeakerId) counts.set(item.originalSpeakerId, (counts.get(item.originalSpeakerId) || 0) + 1);
    }
    const candidates = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    let speaker = candidates.map(([id]) => storage.getSpeaker(id)).find((value) => value && !usedSpeakerIds.has(value.id));
    if (!speaker) speaker = storage.createCandidateSpeaker(meetingId, cluster.centroid);
    storage.updateSpeakerCentroid(speaker.id, cluster.centroid, cluster.items.length);
    speaker = storage.getSpeaker(speaker.id);
    if (!speaker.manuallyNamed) {
      const profile = storage.matchSpeakerProfile(cluster.centroid, {
        threshold: 0.78,
        ambiguityMargin: 0.04,
        excludeProfileIds: [...usedProfileIds],
      });
      speaker = profile
        ? storage.applySpeakerProfile(speaker.id, profile)
        : storage.clearAutomaticSpeakerMatch(speaker.id);
    }
    if (speaker.profileId) usedProfileIds.add(speaker.profileId);
    usedSpeakerIds.add(speaker.id);
    clusterSpeaker.set(cluster.index, speaker);
  }

  // Short fragments inherit a neighboring speaker only when that choice is unambiguous.
  for (let index = 0; index < items.length; index += 1) {
    if (items[index].clusterIndex !== null) continue;
    const previous = items[index - 1]?.clusterIndex;
    const next = items[index + 1]?.clusterIndex;
    if (previous !== null && previous !== undefined && (next === previous || next === null || next === undefined)) {
      items[index].clusterIndex = previous;
    } else if (next !== null && next !== undefined) {
      items[index].clusterIndex = next;
    }
  }

  const overlapSpeakers = clusters.map((cluster) => ({
    id: clusterSpeaker.get(cluster.index)?.id,
    centroid: cluster.centroid,
  }));
  for (const item of items) {
    const overlap = item.embedding
      ? detectPotentialOverlap(item.embedding, overlapSpeakers)
      : {
          suspected: Boolean(item.overlapSuspected),
          confidence: item.overlapConfidence ?? null,
          candidateIds: item.overlapSpeakerIds || [],
        };
    item.overlapSuspected = overlap.suspected;
    item.overlapConfidence = overlap.confidence;
    item.overlapSpeakerIds = overlap.candidateIds;
  }

  const corrected = items.map((item, index) => {
    const next = items[index + 1];
    return {
      seq: index,
      startMs: item.startMs,
      endMs: item.endMs,
      pauseAfterMs: next && item.endMs !== null ? Math.max(0, next.startMs - item.endMs) : null,
      text: item.text,
      originalText: item.originalText,
      editedText: item.editedText,
      speakerId: item.overlapSuspected
        ? null
        : clusterSpeaker.get(item.clusterIndex)?.id || item.originalSpeakerId || null,
      confidence: item.speakerConfidence ?? item.confidence,
      words: item.words,
      overlapSuspected: item.overlapSuspected,
      overlapConfidence: item.overlapConfidence,
      overlapSpeakerIds: item.overlapSpeakerIds,
    };
  });
  onProgress(90);
  storage.replaceCorrectedSegments(meetingId, corrected);
  storage.reconcileSpeakers(
    meetingId,
    clusters.map((cluster) => clusterSpeaker.get(cluster.index)?.id).filter(Boolean),
  );
  storage.refineMeetingSpeakerProfiles(meetingId);
  onProgress(100);
  return storage.listSegments(meetingId);
}
