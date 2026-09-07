import { parseJsonContent } from "./summarizer.mjs";

function cleanText(value, limit = 5000) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, limit);
}

function tokens(value) {
  const normalized = cleanText(value, 500).toLocaleLowerCase("zh-CN");
  const words = normalized.match(/[a-z0-9][a-z0-9._+-]{1,}|[\u3400-\u9fff]{2,}/g) || [];
  const result = new Set(words);
  for (const word of words) {
    if (/^[\u3400-\u9fff]+$/.test(word) && word.length > 2) {
      for (let index = 0; index < word.length - 1; index += 1) result.add(word.slice(index, index + 2));
    }
  }
  return [...result].slice(0, 60);
}

function sourceScore(source, question, queryTokens) {
  const haystack = `${source.meetingTitle} ${source.text}`.toLocaleLowerCase("zh-CN");
  const exact = haystack.includes(question.toLocaleLowerCase("zh-CN")) ? 10 : 0;
  const matchingTokens = queryTokens.filter((token) => haystack.includes(token));
  const matches = matchingTokens.reduce((total, token) => total + Math.min(4, token.length), 0);
  if (!exact && !matchingTokens.length) return 0;
  const memoryBoost = source.sourceType === "memory" ? 3 : source.sourceType === "attachment" ? 1.5 : 0;
  const recency = Math.max(0, 1 - ((Date.now() - new Date(source.startedAt || 0).getTime()) / (1000 * 60 * 60 * 24 * 365)));
  return exact + matches + memoryBoost + (Number.isFinite(recency) ? recency : 0);
}

export function retrieveMeetingKnowledge(storage, question, options = {}) {
  const cleanQuestion = cleanText(question, 240);
  if (!cleanQuestion) throw new Error("请输入想了解的会议问题");
  const queryTokens = tokens(cleanQuestion);
  const rawSources = storage.listKnowledgeSources({
    meetingId: options.meetingId || null,
    limit: 1600,
  });
  const ranked = rawSources
    .map((source) => ({ ...source, score: sourceScore(source, cleanQuestion, queryTokens) }))
    .filter((source) => source.score > 0)
    .sort((left, right) => right.score - left.score);
  const minimumScore = Math.max(3, (ranked[0]?.score || 0) * 0.3);
  const seen = new Set();
  return ranked
    .filter((source) => source.score >= minimumScore)
    .filter((source) => {
      const fingerprint = `${source.meetingId}:${cleanText(source.text, 500).toLocaleLowerCase("zh-CN")}`;
      if (seen.has(fingerprint)) return false;
      seen.add(fingerprint);
      return true;
    })
    .slice(0, Math.min(18, Math.max(3, Number(options.limit) || 10)))
    .map((source, index) => ({ ...source, ref: `S${index + 1}` }));
}

function localEvidenceAnswer(question, sources) {
  if (!sources.length) {
    return {
      answer: "现有会议记录中没有找到足够相关的内容。可以换一个关键词，或先确认会议记忆。",
      citations: [],
      mode: "local-evidence",
    };
  }
  const highlights = sources.slice(0, 3).map((source) => source.text.replace(/[。！？!?]+$/g, ""));
  return {
    answer: `本机证据中与“${question}”最相关的内容包括：${highlights.join("；")}。`,
    citations: sources.slice(0, 3).map((source) => ({ ref: source.ref, quote: source.text.slice(0, 160) })),
    mode: "local-evidence",
  };
}

const KNOWLEDGE_PROMPT = `你是本机会议知识库问答助手。只能依据提供的sources回答，不得使用外部常识补写事实。
输出纯JSON：{"answer":"直接、完整的中文回答","citations":[{"ref":"S1","quote":"对应证据中的短句"}]}
要求：
1. 每个事实结论都必须由citation支持；ref只能使用输入中真实存在的编号。
2. 证据不足时明确写“现有会议记录中无法确认”，不要猜测。
3. 区分会议中已经决定的事项、参会者提出的设想和AI总结中的建议。
4. quote只摘录与回答直接相关的短句，不要改写成新的事实。
5. 回答优先综合多场会议，避免重复堆砌。`;

async function askMiniMax({ question, sources, apiKey, model }) {
  const response = await fetch("https://api.minimaxi.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(Math.max(30000, Number(process.env.MINIMAX_TIMEOUT_MS) || 120000)),
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_completion_tokens: 5000,
      reasoning_split: true,
      messages: [
        { role: "system", content: KNOWLEDGE_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            question,
            sources: sources.map(({ ref, sourceType, meetingTitle, startedAt, startMs, text }) => ({
              ref, sourceType, meetingTitle, startedAt, startMs, text,
            })),
          }),
        },
      ],
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.base_resp?.status_code) {
    throw new Error(data.base_resp?.status_msg || data.error?.message || "会议知识问答失败");
  }
  return parseJsonContent(data.choices?.[0]?.message?.content || "");
}

export async function answerMeetingKnowledge({ storage, question, apiKey, model = "MiniMax-M3", meetingId = null }) {
  const cleanQuestion = cleanText(question, 240);
  const sources = retrieveMeetingKnowledge(storage, cleanQuestion, { meetingId });
  if (!sources.length || !apiKey) {
    return { ...localEvidenceAnswer(cleanQuestion, sources), question: cleanQuestion, sources };
  }
  const raw = await askMiniMax({ question: cleanQuestion, sources, apiKey, model });
  const sourcesByRef = new Map(sources.map((source) => [source.ref, source]));
  const citations = (Array.isArray(raw.citations) ? raw.citations : [])
    .map((item) => ({ ref: String(item?.ref || ""), quote: cleanText(item?.quote, 220) }))
    .filter((item) => sourcesByRef.has(item.ref))
    .map((item) => {
      const source = sourcesByRef.get(item.ref);
      const quote = item.quote && source.text.includes(item.quote)
        ? item.quote
        : cleanText(source.text, 160);
      return { ref: item.ref, quote };
    })
    .slice(0, 8);
  return {
    question: cleanQuestion,
    answer: cleanText(raw.answer, 1800) || "现有会议记录中无法确认。",
    citations,
    sources,
    mode: "minimax",
  };
}
