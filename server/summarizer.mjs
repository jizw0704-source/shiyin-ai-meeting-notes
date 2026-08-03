import { normalizeSummaryTemplateId, summaryTemplatePrompt } from "./summary-templates.mjs";

export class SummaryFormatError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "SummaryFormatError";
    this.code = "SUMMARY_FORMAT_INVALID";
  }
}

class SummaryTruncatedError extends Error {
  constructor(message = "MiniMax 生成内容达到长度上限") {
    super(message);
    this.name = "SummaryTruncatedError";
    this.code = "SUMMARY_TRUNCATED";
  }
}

function text(value, fallback = "") {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || fallback;
}

function strings(value, limit = 20) {
  return Array.isArray(value)
    ? value.map((item) => text(item)).filter(Boolean).slice(0, limit)
    : [];
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function evidence(value, validSeqs) {
  if (!Array.isArray(value)) return [];
  const result = value
    .map(Number)
    .filter((seq) => Number.isInteger(seq) && (!validSeqs || validSeqs.has(seq)));
  return [...new Set(result)].slice(0, 12);
}

function cleanModelContent(content) {
  return String(content || "").trim()
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^\uFEFF/, "")
    .trim();
}

function balancedJsonObjects(content) {
  const objects = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "\"") inString = false;
      continue;
    }
    if (character === "\"") {
      inString = true;
      continue;
    }
    if (character === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push(content.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return objects;
}

function jsonCandidates(content) {
  const withoutFence = cleanModelContent(content)
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const objects = balancedJsonObjects(withoutFence);
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  const broadCandidate = start >= 0 && end > start
    ? withoutFence.slice(start, end + 1)
    : withoutFence;
  return [...new Set([
    ...objects.reverse(),
    broadCandidate,
    withoutFence,
  ].filter(Boolean))];
}

function repairJsonStringCharacters(candidate) {
  let result = "";
  let inString = false;
  for (let index = 0; index < candidate.length; index += 1) {
    const character = candidate[index];
    if (!inString) {
      result += character;
      if (character === "\"") inString = true;
      continue;
    }

    if (character === "\\") {
      const next = candidate[index + 1];
      if (/["\\/bfnrt]/.test(next || "")) {
        result += character + next;
        index += 1;
      } else if (next === "u" && /^[0-9a-f]{4}$/i.test(candidate.slice(index + 2, index + 6))) {
        result += candidate.slice(index, index + 6);
        index += 5;
      } else {
        result += "\\\\";
      }
      continue;
    }

    if (character === "\"") {
      let lookahead = index + 1;
      while (/\s/.test(candidate[lookahead] || "")) lookahead += 1;
      const next = candidate[lookahead];
      if (!next || [":", ",", "}", "]"].includes(next)) {
        result += character;
        inString = false;
      } else {
        result += "\\\"";
      }
      continue;
    }

    if (character === "\n") result += "\\n";
    else if (character === "\r") result += "\\r";
    else if (character === "\t") result += "\\t";
    else result += character;
  }
  return result.replace(/,\s*([}\]])/g, "$1");
}

export function parseJsonContent(content) {
  const attempts = [...new Set(jsonCandidates(content).flatMap((candidate) => [
    candidate,
    repairJsonStringCharacters(candidate),
  ]))];
  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
        throw new SummaryFormatError("MiniMax 返回的总结不是 JSON 对象");
      }
      return parsed;
    } catch (error) {
      if (error instanceof SummaryFormatError) throw error;
    }
  }
  throw new SummaryFormatError("MiniMax 返回的总结不是有效 JSON");
}

export function normalizeMeetingSummary(value, meeting = null) {
  const source = value && typeof value === "object" ? value : {};
  const validSeqs = meeting ? new Set(meeting.segments.map((segment) => segment.seq)) : null;
  const maxTime = meeting
    ? Math.max(meeting.durationMs || 0, ...meeting.segments.map((segment) => segment.endMs || segment.startMs || 0))
    : Number.MAX_SAFE_INTEGER;
  const clampTime = (value, fallback = 0) => Math.min(maxTime, Math.max(0, number(value, fallback)));

  return {
    headline: text(source.headline),
    overview: text(source.overview, "未生成有效总结"),
    meetingBackground: text(source.meetingBackground),
    overviewCards: (Array.isArray(source.overviewCards) ? source.overviewCards : []).map((item) => ({
      title: text(item?.title, "会议要点"),
      summary: text(item?.summary),
      points: strings(item?.points, 6),
      evidenceSeqs: evidence(item?.evidenceSeqs, validSeqs),
    })).filter((item) => item.summary || item.points.length).slice(0, 8),
    keyFacts: (Array.isArray(source.keyFacts) ? source.keyFacts : []).map((item) => ({
      value: text(item?.value),
      label: text(item?.label),
      context: text(item?.context),
      evidenceSeqs: evidence(item?.evidenceSeqs, validSeqs),
    })).filter((item) => item.value && item.label).slice(0, 10),
    decisions: strings(source.decisions, 12),
    topics: strings(source.topics, 12),
    detailedTopics: (Array.isArray(source.detailedTopics) ? source.detailedTopics : []).map((item) => ({
      title: text(item?.title, "讨论主题"),
      summary: text(item?.summary),
      points: strings(item?.points, 10),
      conclusion: text(item?.conclusion),
      evidenceSeqs: evidence(item?.evidenceSeqs, validSeqs),
    })).filter((item) => item.summary || item.points.length || item.conclusion).slice(0, 12),
    risks: strings(source.risks, 16),
    aiInsights: (Array.isArray(source.aiInsights) ? source.aiInsights : []).map((item) => ({
      title: text(item?.title, "AI 洞察"),
      insight: text(item?.insight),
      basis: text(item?.basis),
      confidence: ["高", "中", "低"].includes(text(item?.confidence)) ? text(item?.confidence) : "中",
      evidenceSeqs: evidence(item?.evidenceSeqs, validSeqs),
    })).filter((item) => item.insight).slice(0, 8),
    actionItems: (Array.isArray(source.actionItems) ? source.actionItems : []).map((item) => ({
      owner: text(item?.owner, "待确认"),
      task: text(item?.task),
      due: text(item?.due, "待确认"),
      priority: ["高", "中", "低"].includes(text(item?.priority)) ? text(item?.priority) : "中",
      evidenceSeqs: evidence(item?.evidenceSeqs, validSeqs),
    })).filter((item) => item.task).slice(0, 20),
    chapters: (Array.isArray(source.chapters) ? source.chapters : []).map((item) => {
      const startMs = clampTime(item?.startMs);
      const endMs = Math.max(startMs, clampTime(item?.endMs, startMs));
      return {
        title: text(item?.title, "会议章节"),
        startMs,
        endMs,
        summary: text(item?.summary),
        highlights: strings(item?.highlights, 8),
        evidenceSeqs: evidence(item?.evidenceSeqs, validSeqs),
      };
    }).filter((item) => item.summary || item.highlights.length).sort((a, b) => a.startMs - b.startMs).slice(0, 18),
    speakerInsights: (Array.isArray(source.speakerInsights) ? source.speakerInsights : []).map((item) => ({
      speaker: text(item?.speaker, "待确认发言人"),
      contribution: text(item?.contribution),
      keyPoints: strings(item?.keyPoints, 8),
      evidenceSeqs: evidence(item?.evidenceSeqs, validSeqs),
    })).filter((item) => item.contribution || item.keyPoints.length).slice(0, 12),
    notableMoments: (Array.isArray(source.notableMoments) ? source.notableMoments : []).map((item) => ({
      timeMs: clampTime(item?.timeMs),
      speaker: text(item?.speaker, "待确认发言人"),
      text: text(item?.text),
      reason: text(item?.reason),
      evidenceSeq: evidence([item?.evidenceSeq], validSeqs)[0] ?? null,
    })).filter((item) => item.text && item.evidenceSeq !== null).slice(0, 8),
    keywords: strings(source.keywords, 16),
  };
}

function transcriptRows(meeting) {
  const speakers = new Map(meeting.speakers.map((speaker) => [speaker.id, speaker.displayName]));
  return meeting.segments.map((segment) => ({
    seq: segment.seq,
    speaker: speakers.get(segment.speakerId) || "待确认发言人",
    start_ms: segment.startMs,
    end_ms: segment.endMs,
    pause_after_ms: segment.pauseAfterMs,
    text: meeting.fillerFilterEnabled ? (segment.cleanedText || segment.text) : segment.text,
  }));
}

function splitTranscript(transcript, maxCharacters = 12000) {
  const chunks = [];
  let current = [];
  let size = 0;
  for (const row of transcript) {
    const rowSize = JSON.stringify(row).length;
    if (current.length && size + rowSize > maxCharacters) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(row);
    size += rowSize;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

async function readMiniMaxStream(response, { idleTimeoutMs, onProgress }) {
  if (!response.body) throw new Error("MiniMax 流式响应缺少内容");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let idleTimer = null;
  let buffer = "";
  let content = "";
  let eventCount = 0;
  let finishReason = null;

  const processLine = (line) => {
    const value = line.trim();
    if (!value.startsWith("data:")) return;
    const data = value.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let event;
    try {
      event = JSON.parse(data);
    } catch {
      return;
    }
    if (event.base_resp?.status_code) {
      throw new Error(event.base_resp.status_msg || "MiniMax 流式总结失败");
    }
    const choice = event.choices?.[0];
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    const deltaContent = choice?.delta?.content;
    const messageContent = choice?.message?.content;
    if (typeof deltaContent === "string") {
      content += deltaContent;
    } else if (typeof messageContent === "string") {
      content = messageContent.startsWith(content) ? messageContent : content + messageContent;
    }
    eventCount += 1;
    onProgress?.({ characters: content.length, events: eventCount });
  };

  try {
    while (true) {
      const result = await Promise.race([
        reader.read(),
        new Promise((_, reject) => {
          idleTimer = setTimeout(() => {
            const error = new Error(`MiniMax 流式响应连续 ${Math.round(idleTimeoutMs / 1000)} 秒没有新数据`);
            error.name = "MiniMaxStreamIdleError";
            reject(error);
          }, idleTimeoutMs);
        }),
      ]);
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = null;
      if (result.done) break;
      buffer += decoder.decode(result.value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) processLine(line);
    }
    const tail = decoder.decode();
    if (tail) buffer += tail;
    if (buffer.trim()) processLine(buffer);
  } catch (error) {
    await reader.cancel(error.message).catch(() => undefined);
    throw error;
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    reader.releaseLock();
  }
  if (finishReason === "length") throw new SummaryTruncatedError();
  return content.trim();
}

async function requestMiniMax({
  apiKey,
  model,
  system,
  payload,
  maxTokens,
  stream = false,
  onProgress,
  timeoutMs,
}) {
  const requestTimeoutMs = Math.max(30000, Number(timeoutMs || process.env.MINIMAX_TIMEOUT_MS) || 180000);
  const streamIdleTimeoutMs = Math.max(
    30000,
    Number(timeoutMs || process.env.MINIMAX_STREAM_IDLE_TIMEOUT_MS) || 60000,
  );
  const streamController = stream ? new AbortController() : null;
  const streamConnectTimer = stream
    ? setTimeout(() => streamController.abort(), streamIdleTimeoutMs)
    : null;
  let response;
  try {
    response = await fetch("https://api.minimaxi.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: stream ? streamController.signal : AbortSignal.timeout(requestTimeoutMs),
      body: JSON.stringify({
        model,
        temperature: 0.15,
        max_completion_tokens: maxTokens,
        reasoning_split: true,
        stream,
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(payload) },
        ],
      }),
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new Error(stream
        ? `MiniMax 流式总结连接超过 ${Math.round(streamIdleTimeoutMs / 1000)} 秒`
        : `MiniMax 总结请求超过 ${Math.round(requestTimeoutMs / 1000)} 秒`);
    }
    throw error;
  } finally {
    if (streamConnectTimer) clearTimeout(streamConnectTimer);
  }
  if (stream) {
    if (!response.ok) {
      const message = await response.text().catch(() => "");
      throw new Error(message || `MiniMax 流式总结失败（${response.status}）`);
    }
    return readMiniMaxStream(response, {
      idleTimeoutMs: streamIdleTimeoutMs,
      onProgress,
    });
  }
  const data = await response.json();
  if (!response.ok || data.base_resp?.status_code) {
    throw new Error(data.base_resp?.status_msg || data.error?.message || "MiniMax总结失败");
  }
  if (data.choices?.[0]?.finish_reason === "length") throw new SummaryTruncatedError();
  return String(data.choices?.[0]?.message?.content || "").trim();
}

async function requestMiniMaxWithTruncationRetry(options) {
  try {
    return await requestMiniMax(options);
  } catch (error) {
    if (!(error instanceof SummaryTruncatedError)) throw error;
    const nextMaxTokens = Math.min(Math.max(options.maxTokens * 2, 8000), 48000);
    if (nextMaxTokens <= options.maxTokens) {
      throw new SummaryTruncatedError("MiniMax 两次生成均达到长度上限，请缩短逐字稿后重试");
    }
    return requestMiniMax({ ...options, maxTokens: nextMaxTokens });
  }
}

const JSON_REPAIR_PROMPT = `你是JSON格式修复器。输入是另一模型生成的中文会议总结，内容可能被Markdown代码围栏包裹、字符串内部引号未转义、存在尾逗号或缺失字段。
只修复JSON语法和结构，不得增加、删除、概括或改写任何会议事实。顶层必须是JSON对象；缺失的数组字段填[]，缺失的字符串字段填""。
只输出修复后的纯JSON，不要Markdown、解释或思考过程。`;

async function callMiniMax({
  apiKey,
  model,
  system,
  payload,
  maxTokens,
  stream = false,
  onProgress,
  timeoutMs,
}) {
  const content = await requestMiniMaxWithTruncationRetry({
    apiKey,
    model,
    system,
    payload,
    maxTokens,
    stream,
    onProgress,
    timeoutMs,
  });
  try {
    return parseJsonContent(content);
  } catch {
    const repaired = await requestMiniMaxWithTruncationRetry({
      apiKey,
      model,
      system: JSON_REPAIR_PROMPT,
      payload: { malformedJson: content },
      maxTokens,
      stream,
      onProgress,
      timeoutMs,
    });
    try {
      return parseJsonContent(repaired);
    } catch (secondError) {
      throw new SummaryFormatError("MiniMax 总结格式异常，自动修复一次后仍无法解析", { cause: secondError });
    }
  }
}

const EXTRACTION_PROMPT = `你是中文会议纪要的事实抽取员。只能依据提供的逐字稿，保留所有重要数字、名称、案例、限制条件、方案理由和未解决问题，不得补写常识。
输出纯JSON，不要Markdown：
{
  "range":{"startMs":0,"endMs":1000},
  "backgroundSignals":["背景信息"],
  "topicSections":[{"title":"主题","summary":"详细讨论内容","points":["具体事实、数字、案例或论据"],"conclusion":"本段结论或空字符串","evidenceSeqs":[0]}],
  "decisions":[{"text":"明确决策","evidenceSeqs":[0]}],
  "risks":[{"text":"风险或待确认","evidenceSeqs":[0]}],
  "actionItems":[{"owner":"责任人或待确认","task":"任务","due":"时间或待确认","priority":"高/中/低","evidenceSeqs":[0]}],
  "quotes":[{"speaker":"发言人","timeMs":0,"text":"短句原文","reason":"价值","evidenceSeq":0}],
  "speakerViews":[{"speaker":"发言人","contribution":"观点或贡献","keyPoints":["要点"],"evidenceSeqs":[0]}],
  "facts":[{"value":"数字或关键名词","label":"含义","context":"上下文","evidenceSeqs":[0]}],
  "chapters":[{"title":"时间段标题","startMs":0,"endMs":1000,"summary":"详细摘要","highlights":["具体要点"],"evidenceSeqs":[0]}]
}
每个topicSections保留2到8条具体要点；quotes必须逐字复制；没有明确结论或任务时留空，不得虚构。`;

const LIVE_SUMMARY_PROMPT = `你是正在旁听会议的中文记录员。根据截至当前的逐字稿生成“实时草稿”，只写已经出现的信息，不预测会议后续，不把提议写成已决定事项。
输出纯JSON，不要Markdown或解释：
{
  "headline":"20到45字的当前进展标题",
  "overview":"80到160字，说明截至当前讨论了什么、进展到哪里",
  "overviewCards":[{"title":"当前议题","summary":"一句概括","points":["1到3个事实"],"evidenceSeqs":[0]}],
  "decisions":["已经明确形成的决定"],
  "topics":["3到8个主题标签"],
  "risks":["当前分歧、阻塞或待确认"],
  "actionItems":[{"owner":"责任人或待确认","task":"明确提出的后续任务","due":"时间或待确认","priority":"高/中/低","evidenceSeqs":[0]}],
  "keywords":["关键词"]
}
overviewCards最多4个；没有决定或任务时返回空数组。evidenceSeqs只能引用输入中的真实seq。`;

const FINAL_PROMPT = `你是资深中文会议分析师，要制作接近钉钉AI听记深度的专业会议报告。只能依据输入材料，不得编造；模型推断必须放进aiInsights并写明依据，不能冒充会议原话。
输出纯JSON，不要Markdown或思考过程，严格使用：
{
  "headline":"25到55字、准确概括会议成果的标题",
  "overview":"150到300字的会议全貌，交代背景、重点、分歧和结果",
  "meetingBackground":"100到220字，说明召开背景、目标和讨论范围",
  "overviewCards":[{"title":"总览板块名","summary":"一句概括","points":["2到5个浓缩要点"],"evidenceSeqs":[0]}],
  "keyFacts":[{"value":"12所","label":"已调研高校","context":"数字的具体含义","evidenceSeqs":[0]}],
  "decisions":["完整、可独立阅读的关键决策"],
  "topics":["用于检索的主题标签"],
  "detailedTopics":[{"title":"主题标题","summary":"完整讨论综述","points":["保留数字、例子、方案、理由和约束"],"conclusion":"该主题的共识或下一步；没有则空字符串","evidenceSeqs":[0]}],
  "risks":["具体风险、分歧或待确认事项"],
  "aiInsights":[{"title":"洞察标题","insight":"从多条会议事实归纳出的洞察","basis":"会议中哪些事实支持它","confidence":"高/中/低","evidenceSeqs":[0]}],
  "actionItems":[{"owner":"责任人或待确认","task":"可执行任务","due":"明确日期或待确认","priority":"高/中/低","evidenceSeqs":[0]}],
  "chapters":[{"title":"章节标题","startMs":0,"endMs":10000,"summary":"该时段的详细摘要","highlights":["2到6个具体要点"],"evidenceSeqs":[0]}],
  "speakerInsights":[{"speaker":"逐字稿中的发言人姓名","contribution":"主要观点或贡献","keyPoints":["具体要点"],"evidenceSeqs":[0]}],
  "notableMoments":[{"timeMs":0,"speaker":"发言人","text":"逐字稿短句原文","reason":"值得关注的原因","evidenceSeq":0}],
  "keywords":["关键词"]
}
质量要求：
1. overviewCards生成4到8个板块，形成一页式会议地图；detailedTopics生成4到12个主题，每个主题尽量保留3到8条具体信息。
2. chapters按时间顺序生成6到16章；不足6章仅限会议确实很短。时间必须来自材料。
3. decisions只写真正形成的决定；建议、设想和争议放入detailedTopics或risks。
4. actionItems必须能在材料中找到责任人或任务证据；未明确负责人写“待确认”。
5. keyFacts优先保留人数、金额、日期、时长、数量、版本和命名机制，最多10条。
6. notableMoments最多8条，text必须是材料中的短句原文，不得润色伪造。
7. evidenceSeqs只能引用输入中真实出现的seq；所有板块都要尽量提供原文证据。
8. 信息密度优先，不要把不同主题压成空泛短句，不要重复同一内容凑数。`;

async function extractLongMeeting(transcript, apiKey, model, options = {}) {
  const chunks = splitTranscript(transcript);
  const digests = [];
  for (let index = 0; index < chunks.length; index += 1) {
    options.onProgress?.({
      phase: "extracting",
      chunk: index + 1,
      totalChunks: chunks.length,
      characters: 0,
    });
    const rows = chunks[index];
    digests.push(await callMiniMax({
      apiKey,
      model,
      system: EXTRACTION_PROMPT,
      payload: {
        chunk: index + 1,
        totalChunks: chunks.length,
        transcript: rows,
      },
      maxTokens: 12000,
      stream: options.stream,
      timeoutMs: options.timeoutMs,
      onProgress(progress) {
        options.onProgress?.({
          ...progress,
          phase: "extracting",
          chunk: index + 1,
          totalChunks: chunks.length,
        });
      },
    }));
  }
  return digests;
}

export async function summarizeMeetingPreview(meeting, apiKey, model = "MiniMax-M2.7", options = {}) {
  if (!meeting.segments.length) return null;
  if (!apiKey) throw new Error("尚未配置 MINIMAX_API_KEY");
  const summaryTemplate = normalizeSummaryTemplateId(meeting.summaryTemplate);
  const transcript = transcriptRows(meeting).slice(-120);
  const rawSummary = await callMiniMax({
    apiKey,
    model,
    system: `${LIVE_SUMMARY_PROMPT}\n\n${summaryTemplatePrompt(summaryTemplate)}`,
    payload: {
      sourceType: "会议进行中的实时逐字稿",
      title: meeting.title,
      durationMs: meeting.durationMs,
      summaryTemplate,
      previousDraft: meeting.liveSummary || null,
      transcript,
    },
    maxTokens: 6000,
    stream: options.stream ?? true,
    timeoutMs: options.timeoutMs,
    onProgress: options.onProgress,
  });
  const summary = normalizeMeetingSummary(rawSummary, meeting);
  return {
    ...summary,
    isLiveDraft: true,
    generatedAt: new Date().toISOString(),
    throughSeq: transcript.at(-1)?.seq ?? null,
  };
}

export async function summarizeMeeting(meeting, apiKey, model = "MiniMax-M2.7", options = {}) {
  if (!meeting.segments.length) {
    return normalizeMeetingSummary({
      headline: "本次会议未识别到有效内容",
      overview: "没有识别到有效语音",
      risks: ["请确认麦克风权限、输入设备和音量后重试"],
    }, meeting);
  }
  if (!apiKey) throw new Error("尚未配置 MINIMAX_API_KEY");

  const transcript = transcriptRows(meeting);
  const summaryTemplate = normalizeSummaryTemplateId(meeting.summaryTemplate);
  const transcriptSize = JSON.stringify(transcript).length;
  const isLongMeeting = transcriptSize > 15000 || transcript.length > 100;
  const source = isLongMeeting
    ? {
      sourceType: "分段事实抽取结果",
      title: meeting.title,
      durationMs: meeting.durationMs,
      summaryTemplate,
      speakers: meeting.speakers.map((speaker) => speaker.displayName),
      previousLiveDraft: meeting.liveSummary || null,
      chunkDigests: await extractLongMeeting(transcript, apiKey, model, options),
    }
    : {
      sourceType: "完整逐字稿",
      title: meeting.title,
      durationMs: meeting.durationMs,
      summaryTemplate,
      previousLiveDraft: meeting.liveSummary || null,
      transcript,
    };

  const rawSummary = await callMiniMax({
    apiKey,
    model,
    system: `${FINAL_PROMPT}\n\n${summaryTemplatePrompt(summaryTemplate)}`,
    payload: source,
    maxTokens: 16000,
    stream: options.stream,
    timeoutMs: options.timeoutMs,
    onProgress(progress) {
      options.onProgress?.({ ...progress, phase: "finalizing" });
    },
  });
  const summary = normalizeMeetingSummary(rawSummary, meeting);
  const structuredSections = [
    summary.overviewCards,
    summary.keyFacts,
    summary.decisions,
    summary.topics,
    summary.detailedTopics,
    summary.risks,
    summary.aiInsights,
    summary.actionItems,
    summary.chapters,
    summary.speakerInsights,
    summary.notableMoments,
    summary.keywords,
  ].reduce((total, section) => total + section.length, 0);
  if (!summary.headline || !summary.overview || structuredSections === 0) {
    throw new SummaryFormatError("MiniMax 总结缺少标题、总览或结构化内容");
  }
  return summary;
}
