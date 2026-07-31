const ENDPOINT = "https://api.minimaxi.com/v1/chat/completions";

export async function POST(request: Request) {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "尚未配置 MINIMAX_API_KEY" }, { status: 503 });
  }

  const body = await request.json() as { transcript?: string };
  if (!body.transcript?.trim()) {
    return Response.json({ error: "transcript 不能为空" }, { status: 400 });
  }

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.MINIMAX_MODEL || "MiniMax-M3",
      temperature: 0.2,
      max_tokens: 1800,
      messages: [
        {
          role: "system",
          content: "你是专业的中文会议纪要助手。只依据原始记录输出：一句话总结、关键决策、讨论要点、行动项（责任人、任务、日期）。不确定的信息明确标注待确认，不要编造。",
        },
        { role: "user", content: body.transcript.slice(0, 120000) },
      ],
    }),
  });

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
    base_resp?: { status_code?: number; status_msg?: string };
    error?: { message?: string };
  };
  if (!response.ok || data.base_resp?.status_code) {
    return Response.json({ error: data.base_resp?.status_msg || data.error?.message || "MiniMax 请求失败" }, { status: response.status || 502 });
  }
  return Response.json({ summary: data.choices?.[0]?.message?.content || "" });
}
