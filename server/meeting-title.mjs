const titlePrefixes = /^(?:会议主题|会议标题|标题|主题|本次会议)\s*[：:]?\s*/;
const genericTitles = /^(?:会议|会议总结|会议纪要|未命名会议|新会议)$/;

function normalizeTitlePart(value, maxLength = 28) {
  const part = String(value || "")
    .replace(/^#+\s*/, "")
    .replace(/^[“”"'《》]+|[“”"'《》]+$/g, "")
    .replace(/[｜|，,；;。！？!?：:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!part || /^(?:未明确|未知|无|暂无|待确认|不详)$/.test(part)) return "";
  const characters = Array.from(part);
  return characters.length > maxLength
    ? `${characters.slice(0, Math.max(1, maxLength - 1)).join("")}…`
    : part;
}

function meetingDateParts(startedAt) {
  const date = new Date(startedAt || "");
  if (Number.isNaN(date.getTime())) return null;
  const pad = (value) => String(value).padStart(2, "0");
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

function uniqueParts(parts) {
  return parts.filter(Boolean).filter((part, index, values) => values.indexOf(part) === index);
}

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
  return characters.length > 40 ? `${characters.slice(0, 39).join("")}…` : title;
}

export function deriveAutomaticMeetingTitle(meeting, summary = null, options = {}) {
  const source = summary || meeting?.summary || meeting?.liveSummary || {};
  const identity = source.meetingIdentity && typeof source.meetingIdentity === "object"
    ? source.meetingIdentity
    : {};
  const scope = ["external", "internal", "unknown"].includes(identity.scope)
    ? identity.scope
    : "unknown";
  const organization = normalizeTitlePart(identity.counterpartyOrganization, 18);
  const contact = normalizeTitlePart(identity.primaryContact, 12);
  const project = normalizeTitlePart(identity.projectOrDepartment, 18);
  const subject = normalizeTitlePart(identity.subject || source.brief?.subject, 28);
  const dateParts = meetingDateParts(meeting?.startedAt);
  const date = dateParts
    ? `${dateParts.date}${options.includeTime ? ` ${dateParts.time}` : ""}`
    : "";

  const structuredParts = scope === "external"
    ? uniqueParts([organization, contact, subject, date])
    : scope === "internal"
      ? uniqueParts([project, subject, date])
      : [];
  if (structuredParts.length > (date ? 1 : 0)) return structuredParts.join("｜");

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
    if (title) return uniqueParts([title, date]).join("｜");
  }
  return "";
}
