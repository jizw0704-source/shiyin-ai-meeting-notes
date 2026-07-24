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
  assert.match(html, /百炼转写 · MiniMax M2\.7 总结/);
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
  assert.match(page, /AudioWorkletNode/);
  assert.match(page, /NEXT_PUBLIC_ASR_PROXY_URL/);
  assert.match(worklet, /Int16Array/);
  assert.match(envExample, /DASHSCOPE_API_KEY=/);
  assert.doesNotMatch(`${proxy}\n${page}`, /sk-[A-Za-z0-9]{16,}/);
});
