const EMPTY_SUMMARY = {
  headline: "",
  overview: "",
  meetingBackground: "",
  overviewCards: [],
  keyFacts: [],
  decisions: [],
  topics: [],
  detailedTopics: [],
  risks: [],
  aiInsights: [],
  actionItems: [],
  chapters: [],
  speakerInsights: [],
  notableMoments: [],
  keywords: [],
};

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

export function parseJsonContent(content) {
  const cleaned = String(content || "").trim()
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        // Fall through to a readable plain-text summary.
      }
    }
    return { ...EMPTY_SUMMARY, overview: cleaned || "未生成有效总结" };
  }
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
    text: segment.text,
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

async function callMiniMax({ apiKey, model, system, payload, maxTokens }) {
  const response = await fetch("https://api.minimaxi.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.15,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(payload) },
      ],
    }),
  });
  const data = await response.json();
  if (!response.ok || data.base_resp?.status_code) {
    throw new Error(data.base_resp?.status_msg || data.error?.message || "MiniMax总结失败");
  }
  return parseJsonContent(data.choices?.[0]?.message?.content);
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

async function extractLongMeeting(transcript, apiKey, model) {
  const chunks = splitTranscript(transcript);
  const digests = [];
  for (let index = 0; index < chunks.length; index += 1) {
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
      maxTokens: 3200,
    }));
  }
  return digests;
}

export async function summarizeMeeting(meeting, apiKey, model = "MiniMax-M2.7") {
  if (!meeting.segments.length) {
    return normalizeMeetingSummary({
      headline: "本次会议未识别到有效内容",
      overview: "没有识别到有效语音",
      risks: ["请确认麦克风权限、输入设备和音量后重试"],
    }, meeting);
  }
  if (!apiKey) throw new Error("尚未配置 MINIMAX_API_KEY");

  const transcript = transcriptRows(meeting);
  const transcriptSize = JSON.stringify(transcript).length;
  const isLongMeeting = transcriptSize > 15000 || transcript.length > 100;
  const source = isLongMeeting
    ? {
      sourceType: "分段事实抽取结果",
      title: meeting.title,
      durationMs: meeting.durationMs,
      speakers: meeting.speakers.map((speaker) => speaker.displayName),
      chunkDigests: await extractLongMeeting(transcript, apiKey, model),
    }
    : {
      sourceType: "完整逐字稿",
      title: meeting.title,
      durationMs: meeting.durationMs,
      transcript,
    };

  const rawSummary = await callMiniMax({
    apiKey,
    model,
    system: FINAL_PROMPT,
    payload: source,
    maxTokens: 8000,
  });
  return normalizeMeetingSummary(rawSummary, meeting);
}
