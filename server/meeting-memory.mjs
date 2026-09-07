import { createHash } from "node:crypto";

export const MEETING_MEMORY_KINDS = new Set([
  "person",
  "organization",
  "project",
  "decision",
  "need",
  "term",
]);

export const MEETING_MEMORY_STATUSES = new Set(["pending", "confirmed", "dismissed"]);

function cleanText(value, limit = 280) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, limit) : "";
}

function confidence(value) {
  const normalized = cleanText(value, 12).toLowerCase();
  if (["高", "high"].includes(normalized)) return "high";
  if (["低", "low"].includes(normalized)) return "low";
  return "medium";
}

function evidenceSeqs(value, validSeqs) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number)
    .filter((seq) => Number.isInteger(seq) && (!validSeqs || validSeqs.has(seq))))]
    .slice(0, 12);
}

function sourceKey(kind, content, seqs) {
  const fingerprint = createHash("sha256")
    .update(`${kind}\n${seqs.join(",")}\n${content.toLocaleLowerCase("zh-CN")}`)
    .digest("hex")
    .slice(0, 24);
  return `${kind}:${fingerprint}`;
}

function normalizeCandidate(value, validSeqs) {
  const kind = MEETING_MEMORY_KINDS.has(value?.kind) ? value.kind : null;
  const content = cleanText(value?.content);
  const seqs = evidenceSeqs(value?.evidenceSeqs, validSeqs);
  if (!kind || !content || !seqs.length) return null;
  return {
    sourceKey: sourceKey(kind, content, seqs),
    kind,
    content,
    confidence: confidence(value?.confidence),
    evidenceSeqs: seqs,
  };
}

function legacyCandidates(summary) {
  const result = [];
  const identity = summary?.meetingIdentity || {};
  const identityEvidence = identity.evidenceSeqs || [];
  if (identity.counterpartyOrganization) {
    result.push({ kind: "organization", content: identity.counterpartyOrganization, confidence: summary.meetingTypeConfidence, evidenceSeqs: identityEvidence });
  }
  if (identity.primaryContact) {
    const affiliation = identity.counterpartyOrganization ? `（${identity.counterpartyOrganization}）` : "";
    result.push({ kind: "person", content: `${identity.primaryContact}${affiliation}`, confidence: summary.meetingTypeConfidence, evidenceSeqs: identityEvidence });
  }
  if (identity.projectOrDepartment) {
    result.push({ kind: "project", content: identity.projectOrDepartment, confidence: summary.meetingTypeConfidence, evidenceSeqs: identityEvidence });
  }
  for (const section of summary?.brief?.sections || []) {
    if (/痛点|问题|期望|诉求|需求/.test(section.title || "")) {
      result.push({ kind: "need", content: section.content, confidence: "中", evidenceSeqs: section.evidenceSeqs });
    }
  }
  for (const topic of summary?.detailedTopics || []) {
    if (topic.conclusion) {
      result.push({ kind: "decision", content: topic.conclusion, confidence: "中", evidenceSeqs: topic.evidenceSeqs });
    }
  }
  return result;
}

export function deriveMeetingMemoryCandidates(summary, meeting = null) {
  if (!summary || typeof summary !== "object") return [];
  const validSeqs = meeting?.segments
    ? new Set(meeting.segments.map((segment) => Number(segment.seq)).filter(Number.isInteger))
    : null;
  const source = Array.isArray(summary.memoryCandidates) && summary.memoryCandidates.length
    ? summary.memoryCandidates
    : legacyCandidates(summary);
  const seen = new Set();
  const result = [];
  for (const item of source) {
    const candidate = normalizeCandidate(item, validSeqs);
    if (!candidate || seen.has(candidate.sourceKey)) continue;
    seen.add(candidate.sourceKey);
    result.push(candidate);
    if (result.length >= 24) break;
  }
  return result;
}

export function normalizeMeetingMemoryPatch(patch = {}) {
  const result = {};
  if (Object.hasOwn(patch, "content")) {
    const content = cleanText(patch.content);
    if (!content) throw new Error("记忆内容不能为空");
    result.content = content;
  }
  if (Object.hasOwn(patch, "status")) {
    if (!MEETING_MEMORY_STATUSES.has(patch.status) || patch.status === "dismissed") {
      throw new Error("无效的记忆状态");
    }
    result.status = patch.status;
  }
  return result;
}

function memoryTokens(value) {
  const normalized = cleanText(value, 280).toLocaleLowerCase("zh-CN").replace(/[\s，。；：、,.!?！？（）()\-]/g, "");
  if (!normalized) return new Set();
  const result = new Set([normalized]);
  for (let index = 0; index < normalized.length - 1; index += 1) result.add(normalized.slice(index, index + 2));
  return result;
}

function similarity(left, right) {
  const a = memoryTokens(left);
  const b = memoryTokens(right);
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const token of a) if (b.has(token)) common += 1;
  return common / (a.size + b.size - common);
}

const oppositeSignals = [
  ["继续", "停止"], ["保留", "取消"], ["赞成", "反对"], ["同意", "不同意"],
  ["可以", "不可以"], ["采用", "不采用"], ["提前", "延期"], ["增加", "减少"],
  ["线上", "线下"],
];

function containsSignal(value, signal, counterpart) {
  if (!value.includes(signal)) return false;
  return signal.length >= counterpart.length || !value.includes(counterpart);
}

function possiblyConflicting(left, right, score) {
  if (score < 0.22 || score > 0.72) return false;
  return oppositeSignals.some(([positive, negative]) =>
    (containsSignal(left, positive, negative) && left.includes(negative) === false && right.includes(negative))
      || (left.includes(negative) && containsSignal(right, positive, negative) && right.includes(negative) === false));
}

export function buildMeetingMemoryInsights(memories = []) {
  const active = memories.filter((item) => item.status !== "dismissed" && !item.mergedIntoId);
  const duplicates = [];
  const conflicts = [];
  for (let leftIndex = 0; leftIndex < active.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < active.length; rightIndex += 1) {
      const left = active[leftIndex];
      const right = active[rightIndex];
      if (left.kind !== right.kind || left.meetingId === right.meetingId) continue;
      const score = similarity(left.content, right.content);
      if (["decision", "need", "project"].includes(left.kind)
        && possiblyConflicting(left.content, right.content, score)) {
        conflicts.push({ left, right, similarity: Number(score.toFixed(2)) });
      } else if (score >= 0.48) {
        duplicates.push({ primary: left, duplicate: right, similarity: Number(score.toFixed(2)) });
      }
    }
  }
  return {
    duplicateCount: duplicates.length,
    conflictCount: conflicts.length,
    duplicates: duplicates.sort((a, b) => b.similarity - a.similarity).slice(0, 20),
    conflicts: conflicts.sort((a, b) => b.similarity - a.similarity).slice(0, 20),
  };
}
