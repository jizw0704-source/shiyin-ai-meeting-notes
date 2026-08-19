const terminalPunctuationPattern = /[。！？!?；;.]$/u;
const boundaryPunctuationPattern = /[。！？!?；;：:，,]$/u;

const discourseMarkers = [
  { value: "总的来说", punctuation: "。" },
  { value: "接下来", punctuation: "。" },
  { value: "除此之外", punctuation: "。" },
  { value: "换句话说", punctuation: "。" },
  { value: "然后", punctuation: "，" },
  { value: "所以", punctuation: "，" },
  { value: "但是", punctuation: "，" },
  { value: "不过", punctuation: "，" },
  { value: "另外", punctuation: "，" },
  { value: "同时", punctuation: "，" },
  { value: "因此", punctuation: "，" },
  { value: "而且", punctuation: "，" },
];

const markerPattern = new RegExp(
  discourseMarkers.map(({ value }) => value).join("|"),
  "gu",
);

const repeatedSentenceStartPattern = /我们|大家|现在|后续|今天|明天/gu;

function readableLength(value) {
  return Array.from(value.replace(/[\s，,。！？!?；;：:]/gu, "")).length;
}

function insertDiscoursePunctuation(value) {
  if (readableLength(value) < 16) return value;
  let output = "";
  let cursor = 0;
  let lastBoundary = 0;

  for (const match of value.matchAll(markerPattern)) {
    const index = match.index ?? 0;
    output += value.slice(cursor, index);
    const marker = match[0];
    const markerConfig = discourseMarkers.find(({ value: candidate }) => candidate === marker);
    const precedingText = output.slice(lastBoundary);
    const precedingCharacter = output.trimEnd().at(-1) || "";
    const remainingText = value.slice(index + marker.length);

    if (
      markerConfig
      && readableLength(precedingText) >= 7
      && readableLength(remainingText) >= 4
      && !boundaryPunctuationPattern.test(precedingCharacter)
    ) {
      output += markerConfig.punctuation;
      lastBoundary = output.length;
    }
    output += marker;
    cursor = index + marker.length;
  }

  return output + value.slice(cursor);
}

function insertRepeatedSentenceBoundaries(value) {
  if (readableLength(value) < 18) return value;
  let output = "";
  let cursor = 0;
  let clauseStart = 0;
  const seenInClause = new Set();

  for (const match of value.matchAll(repeatedSentenceStartPattern)) {
    const index = match.index ?? 0;
    output += value.slice(cursor, index);
    const marker = match[0];
    const precedingText = output.slice(clauseStart);
    const precedingCharacter = output.trimEnd().at(-1) || "";
    const remainingText = value.slice(index + marker.length);
    const hasStrongBoundary = /[。！？!?；;][^。！？!?；;]*$/u.test(precedingText);

    if (hasStrongBoundary) {
      seenInClause.clear();
      clauseStart = output.length;
    }
    if (
      seenInClause.has(marker)
      && readableLength(output.slice(clauseStart)) >= 10
      && readableLength(remainingText) >= 4
      && !boundaryPunctuationPattern.test(precedingCharacter)
    ) {
      output += "。";
      seenInClause.clear();
      clauseStart = output.length;
    }
    seenInClause.add(marker);
    output += marker;
    cursor = index + marker.length;
  }

  return output + value.slice(cursor);
}

function looksLikeQuestion(value) {
  const compact = value.replace(/\s+/gu, "");
  return /(?:吗|么|呢|嘛|是不是|有没有|能不能|可不可以|怎么样|怎么做|为什么|是否)$/u.test(compact);
}

export function normalizeTranscriptText(value) {
  return String(value || "").replace(/\s+/gu, " ").trim();
}

export function punctuateTranscriptText(value, options = {}) {
  const final = options.final !== false;
  const normalized = normalizeTranscriptText(value);
  if (!normalized) return "";

  const organized = insertRepeatedSentenceBoundaries(insertDiscoursePunctuation(normalized));
  if (!final || terminalPunctuationPattern.test(organized)) return organized;
  const terminal = looksLikeQuestion(organized) ? "？" : "。";
  return /[,，]$/u.test(organized) ? `${organized.slice(0, -1)}${terminal}` : `${organized}${terminal}`;
}
