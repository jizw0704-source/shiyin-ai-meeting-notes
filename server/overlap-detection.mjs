function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function cosineSimilarity(left, right) {
  if (!left || !right || left.length !== right.length) return -1;
  let value = 0;
  for (let index = 0; index < left.length; index += 1) value += left[index] * right[index];
  return value;
}

export function detectPotentialOverlap(embedding, speakers, options = {}) {
  const candidates = (speakers || [])
    .filter((speaker) => speaker?.id && speaker?.centroid)
    .map((speaker) => ({ id: speaker.id, score: cosineSimilarity(embedding, speaker.centroid) }))
    .filter((candidate) => Number.isFinite(candidate.score))
    .sort((left, right) => right.score - left.score);
  const best = candidates[0];
  const runnerUp = candidates[1];
  if (!embedding || !best || !runnerUp) {
    return { suspected: false, confidence: null, candidateIds: [] };
  }

  const minimumRunnerUp = options.minimumRunnerUp ?? 0.68;
  const maximumBest = options.maximumBest ?? 0.88;
  const maximumMargin = options.maximumMargin ?? 0.05;
  const margin = best.score - runnerUp.score;
  const suspected = runnerUp.score >= minimumRunnerUp
    && best.score <= maximumBest
    && margin <= maximumMargin;
  if (!suspected) {
    return {
      suspected: false,
      confidence: null,
      candidateIds: [],
      bestScore: best.score,
      runnerUpScore: runnerUp.score,
    };
  }

  const runnerSignal = clamp((runnerUp.score - minimumRunnerUp) / Math.max(0.01, maximumBest - minimumRunnerUp), 0, 1);
  const marginSignal = clamp((maximumMargin - margin) / Math.max(0.01, maximumMargin), 0, 1);
  return {
    suspected: true,
    confidence: clamp(0.55 + runnerSignal * 0.22 + marginSignal * 0.18, 0.55, 0.92),
    candidateIds: [best.id, runnerUp.id],
    bestScore: best.score,
    runnerUpScore: runnerUp.score,
  };
}
