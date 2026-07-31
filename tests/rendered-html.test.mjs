import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the meeting transcription product", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>拾音 AI｜MiniMax 智能会议听记<\/title>/i);
  assert.match(html, /开始新听记/);
  assert.match(html, /百炼转写 · MiniMax M3 总结/);
  assert.match(html, /完整记录/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("keeps cloud keys behind the realtime proxy", async () => {
  const [proxy, page, worklet, envExample] = await Promise.all([
    readFile(new URL("../server/realtime-proxy.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/pcm-worklet.js", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);
  assert.match(proxy, /process\.env\.DASHSCOPE_API_KEY/);
  assert.match(proxy, /paraformer-realtime-v2/);
  assert.match(proxy, /action: "run-task"/);
  assert.match(proxy, /action: "finish-task"/);
  assert.match(proxy, /streamMeetingAudio/);
  assert.match(proxy, /summarizeMeetingPreview/);
  assert.match(proxy, /summary\.preview/);
  assert.match(proxy, /liveSummaryStartMs/);
  assert.match(proxy, /status: "failed", error: `总结失败：\$\{error\.message\}`/);
  assert.match(page, /AudioWorkletNode/);
  assert.match(page, /原始录音/);
  assert.match(page, /重新生成 AI 总结/);
  assert.match(page, /这次想怎么整理/);
  assert.match(page, /MiniMax M3 总结方式/);
  assert.match(page, /图文纪要/);
  assert.match(page, /切换不消耗额度/);
  assert.match(page, /socketUrl\.searchParams\.set\("template"/);
  assert.match(page, /原始内容已被安全隐藏/);
  assert.match(page, /实时草稿/);
  assert.match(page, /summary\.preview/);
  assert.match(page, /\/api\/meetings\/\$\{encodeURIComponent\(meeting\.id\)\}\/audio/);
  assert.doesNotMatch(page, /window\.prompt/);
  assert.match(page, /NEXT_PUBLIC_ASR_PROXY_URL/);
  assert.match(worklet, /Int16Array/);
  assert.match(envExample, /DASHSCOPE_API_KEY=/);
  assert.match(envExample, /MINIMAX_TIMEOUT_MS=180000/);
  assert.match(envExample, /MINIMAX_STREAM_IDLE_TIMEOUT_MS=60000/);
  assert.match(envExample, /LIVE_SUMMARY_START_MS=30000/);
  assert.match(envExample, /LIVE_SUMMARY_INTERVAL_MS=20000/);
  assert.match(proxy, /status: "failed"/);
  assert.doesNotMatch(`${proxy}\n${page}`, /sk-[A-Za-z0-9]{16,}/);
});
