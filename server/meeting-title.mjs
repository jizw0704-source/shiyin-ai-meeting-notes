const titlePrefixes = /^(?:会议主题|会议标题|标题|主题|本次会议)\s*[：:]?\s*/;
const genericTitles = /^(?:会议|会议总结|会议纪要|未命名会议|新会议)$/;

export function normalizeAutomaticMeetingTitle(value) {
  let title = String(value || "")
    .replace(/^#+\s*/, "")
    .replace(titlePrefixes, "")
    .replace(/^[“”"'《》]+|[“”"'《》]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const firstClause = title.split(/[，,；;。！？!?]/, 1)[0]?.trim();
  if (firstClause && Array.from(firstClause).length >= 6) title = firstClause;
  title = title.replace(/[，,；;。！？!?：:]+$/g, "").trim();
  if (genericTitles.test(title) || Array.from(title).length < 4) return "";
  const characters = Array.from(title);
  return characters.length > 24 ? `${characters.slice(0, 23).join("")}…` : title;
}

export function deriveAutomaticMeetingTitle(meeting, summary = null) {
  const source = summary || meeting?.summary || meeting?.liveSummary || {};
  const candidates = [source.headline];
  if (Array.isArray(source.detailedTopics)) candidates.push(source.detailedTopics[0]?.title);
  if (Array.isArray(source.topics) && source.topics.length) {
    candidates.push(`${source.topics.slice(0, 2).join("与")}讨论`);
  }
  if (Array.isArray(source.keywords) && source.keywords.length) {
    candidates.push(`${source.keywords.slice(0, 2).join("与")}讨论`);
  }
  for (const candidate of candidates) {
    const title = normalizeAutomaticMeetingTitle(candidate);
    if (title) return title;
  }
  return "";
}
