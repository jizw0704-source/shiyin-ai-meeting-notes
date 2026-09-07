export const QUALITY_SCENARIOS = Object.freeze([
  { id: "two-person", label: "双人会议" },
  { id: "multi-person", label: "多人会议" },
  { id: "overlap", label: "重叠发言" },
  { id: "distant", label: "远距离收音" },
  { id: "online", label: "线上会议" },
  { id: "domain-terms", label: "行业术语" },
]);

const scenarioIds = new Set(QUALITY_SCENARIOS.map((item) => item.id));
const ratingKeys = [
  "transcriptionRating",
  "punctuationRating",
  "speakerRating",
  "summaryRating",
];

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function percentage(value) {
  return Math.round(clamp(value, 0, 1) * 100);
}

function normalizeRating(value) {
  if (value === null || value === undefined || value === "") return null;
  const rating = Number(value);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error("质量评分必须是 1 到 5 的整数");
  }
  return rating;
}

export function normalizeQualityReview(value = {}) {
  const scenarioTags = [...new Set((Array.isArray(value.scenarioTags) ? value.scenarioTags : [])
    .map(String)
    .filter((item) => scenarioIds.has(item)))]
    .slice(0, QUALITY_SCENARIOS.length);
  const result = {
    scenarioTags,
    notes: String(value.notes || "").trim().replace(/\s+/g, " ").slice(0, 600),
  };
  for (const key of ratingKeys) result[key] = normalizeRating(value[key]);
  if (!scenarioTags.length && !result.notes && ratingKeys.every((key) => result[key] === null)) {
    throw new Error("请至少选择一个测试场景或填写一项评分");
  }
  return result;
}

function summaryEvidenceCoverage(summary) {
  if (!summary || typeof summary !== "object") return null;
  let eligible = 0;
  let cited = 0;
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const hasReadableContent = ["content", "summary", "insight", "task", "conclusion", "text"]
      .some((key) => typeof value[key] === "string" && value[key].trim());
    if (hasReadableContent) {
      eligible += 1;
      if ((Array.isArray(value.evidenceSeqs) && value.evidenceSeqs.length)
        || Number.isInteger(value.evidenceSeq)) cited += 1;
    }
    Object.values(value).forEach(visit);
  };
  visit(summary);
  return eligible ? percentage(cited / eligible) : null;
}

function average(values) {
  const usable = values.filter(Number.isFinite);
  return usable.length ? usable.reduce((total, value) => total + value, 0) / usable.length : null;
}

export function buildMeetingQualitySnapshot(meeting, review = null, correctionCount = 0) {
  const segments = meeting?.segments || [];
  const spokenSegments = segments.filter((segment) => String(segment.text || "").trim());
  const punctuated = spokenSegments.filter((segment) => /[。！？!?；;：:]\s*$/.test(String(segment.text || "").trim())).length;
  const assigned = spokenSegments.filter((segment) => segment.speakerId && !segment.overlapSuspected).length;
  const lowConfidence = spokenSegments.filter((segment) =>
    Number.isFinite(segment.confidence) && segment.confidence < 0.65).length;
  const unresolvedOverlap = spokenSegments.filter((segment) => segment.overlapSuspected).length;
  const punctuationCoverage = spokenSegments.length ? percentage(punctuated / spokenSegments.length) : null;
  const speakerCoverage = spokenSegments.length ? percentage(assigned / spokenSegments.length) : null;
  const recognitionConfidence = spokenSegments.length
    ? percentage(1 - lowConfidence / spokenSegments.length)
    : null;
  const evidenceCoverage = summaryEvidenceCoverage(meeting?.summary);
  const observableScore = Math.round(average([
    punctuationCoverage,
    speakerCoverage,
    recognitionConfidence,
    evidenceCoverage,
  ]) ?? 0);
  const humanRatings = review ? ratingKeys.map((key) => review[key]).filter(Number.isFinite) : [];
  return {
    meetingId: meeting.id,
    title: meeting.title,
    startedAt: meeting.startedAt,
    durationMs: meeting.durationMs,
    speakerCount: meeting.speakers?.length || 0,
    segmentCount: spokenSegments.length,
    observableScore,
    metrics: {
      punctuationCoverage,
      speakerCoverage,
      recognitionConfidence,
      evidenceCoverage,
      unresolvedOverlap,
      correctionCount: Math.max(0, Number(correctionCount) || 0),
    },
    review,
    humanScore: humanRatings.length ? Math.round(average(humanRatings) * 20) : null,
  };
}

export function aggregateQualityReport(items = []) {
  const reviewed = items.filter((item) => item.review);
  const scenarioCounts = Object.fromEntries(QUALITY_SCENARIOS.map((item) => [item.id, 0]));
  for (const item of reviewed) {
    for (const scenario of item.review.scenarioTags || []) scenarioCounts[scenario] += 1;
  }
  const metricAverage = (key) => {
    const result = average(items.map((item) => item.metrics[key]).filter(Number.isFinite));
    return result === null ? null : Math.round(result);
  };
  return {
    generatedAt: new Date().toISOString(),
    meetingCount: items.length,
    reviewedCount: reviewed.length,
    observableScore: Math.round(average(items.map((item) => item.observableScore)) ?? 0),
    humanScore: reviewed.length
      ? Math.round(average(reviewed.map((item) => item.humanScore).filter(Number.isFinite)) ?? 0)
      : null,
    metrics: {
      punctuationCoverage: metricAverage("punctuationCoverage"),
      speakerCoverage: metricAverage("speakerCoverage"),
      recognitionConfidence: metricAverage("recognitionConfidence"),
      evidenceCoverage: metricAverage("evidenceCoverage"),
      unresolvedOverlap: items.reduce((total, item) => total + item.metrics.unresolvedOverlap, 0),
      correctionCount: items.reduce((total, item) => total + item.metrics.correctionCount, 0),
    },
    scenarioCounts,
    scenarios: QUALITY_SCENARIOS,
    meetings: items,
    note: "自动指标用于发现风险，不等同于人工标注后的准确率。",
  };
}
