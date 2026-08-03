function escapedPattern(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function cleanTranscriptText(value) {
  const original = String(value || "").trim();
  if (!original) return "";

  let cleaned = original
    .replace(/^(?:嗯+|呃+|啊+)(?=[\p{Script=Han}A-Za-z0-9])/u, "")
    .replace(/([，。！？!?；;：:\n]\s*)(?:嗯+|呃+|啊+)(?=[\p{Script=Han}A-Za-z0-9])/gu, "$1")
    .replace(/(^|[\s，。！？!?；;：:、])(?:嗯+|呃+|啊+)(?=$|[\s，。！？!?；;：:、])/gu, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/([，,])\s*[，,]+/g, "$1")
    .trim();

  // A standalone “嗯” can be an affirmative answer, so never erase a whole turn.
  if (!cleaned) cleaned = original;
  return cleaned;
}

export function replaceTranscriptText(value, search, replacement, options = {}) {
  const source = String(value || "");
  const term = String(search || "");
  if (!term) return { text: source, count: 0 };

  const escaped = escapedPattern(term);
  const useWordBoundary = Boolean(options.wholeWord) && /^[\p{L}\p{N}_]+$/u.test(term);
  const pattern = useWordBoundary
    ? `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`
    : escaped;
  const flags = `gu${options.caseSensitive ? "" : "i"}`;
  let count = 0;
  const text = source.replace(new RegExp(pattern, flags), () => {
    count += 1;
    return String(replacement ?? "");
  });
  return { text, count };
}
