import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { normalizeWindowsStaticCache } from "../server/vinext-windows-static-cache.mjs";

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
  assert.match(html, /开始一场新的会议/);
  assert.match(html, /开始会议/);
  assert.match(html, /本地听记已准备就绪/);
  assert.match(html, /本地实时转写/);
  assert.match(html, /录音来源/);
  assert.match(html, /电脑声音 \+ 麦克风/);
  assert.match(html, /MiniMax 设置/);
  assert.match(html, /管理录音与空间/);
  assert.match(html, /预计参会人数/);
  assert.match(html, /历史会议/);
  assert.match(html, /搜索历史会议/);
  assert.match(html, /12 人/);
  assert.match(html, /20 人/);
  assert.match(html, /录音和转写会保存在这台电脑/);
  assert.doesNotMatch(html, /录音和转写会保存在这台 Mac/);
  assert.doesNotMatch(html, /转写版本|完整记录|会议速览/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("normalizes vinext static asset cache keys on Windows", () => {
  const cssEntry = { type: "css" };
  const jsEntry = { type: "javascript" };
  const cache = {
    entries: new Map([
      ["/assets\\index-ABC123.css", cssEntry],
      ["/assets\\page-DEF456.js", jsEntry],
      ["/favicon.svg", { type: "svg" }],
    ]),
  };

  assert.equal(normalizeWindowsStaticCache(cache, "win32"), cache);
  assert.equal(cache.entries.get("/assets/index-ABC123.css"), cssEntry);
  assert.equal(cache.entries.get("/assets/page-DEF456.js"), jsEntry);
  assert.equal(cache.entries.has("/assets\\index-ABC123.css"), false);
  assert.equal(cache.entries.has("/assets\\page-DEF456.js"), false);
  assert.equal(cache.entries.has("/favicon.svg"), true);
});

test("supports local transcription and keeps cloud keys behind the realtime proxy", async () => {
  const [proxy, localAsr, page, worklet, envExample, desktopMain, preload, packageJson] = await Promise.all([
    readFile(new URL("../server/realtime-proxy.mjs", import.meta.url), "utf8"),
    readFile(new URL("../server/local-asr-engine.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/pcm-worklet.js", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../desktop/preload.cjs", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(proxy, /process\.env\.DASHSCOPE_API_KEY/);
  assert.match(proxy, /SHIYIN_ASR_MODE/);
  assert.match(proxy, /localAsrAvailable/);
  assert.match(proxy, /punctuationModelAvailable/);
  assert.match(localAsr, /sherpa-onnx-node/);
  assert.match(localAsr, /encoder\.int8\.onnx/);
  assert.match(localAsr, /decoder\.int8\.onnx/);
  assert.match(localAsr, /OnlineRecognizer/);
  assert.match(proxy, /paraformer-realtime-v2/);
  assert.match(proxy, /action: "run-task"/);
  assert.match(proxy, /action: "finish-task"/);
  assert.match(proxy, /streamMeetingAudio/);
  assert.match(proxy, /summarizeMeetingPreview/);
  assert.match(proxy, /summary\.preview/);
  assert.match(proxy, /liveSummaryStartMs/);
  assert.match(proxy, /status: "failed", error: `总结失败：\$\{error\.message\}`/);
  assert.match(page, /AudioWorkletNode/);
  assert.match(page, /getDisplayMedia/);
  assert.match(page, /createDynamicsCompressor/);
  assert.match(page, /"microphone" \| "system" \| "mixed"/);
  assert.match(page, /Mac 系统音频已就绪/);
  assert.match(page, /Windows 桌面版会直接采集系统播放声音/);
  assert.match(page, /正在连接 Windows 电脑声音/);
  assert.match(page, /只读取系统声音/);
  assert.match(page, /打开系统设置/);
  assert.match(page, /BlackHole/i);
  assert.match(page, /原始录音/);
  assert.match(page, /重新生成 AI 总结/);
  assert.match(page, /这次想怎么整理/);
  assert.match(page, /MiniMax 总结方式/);
  assert.match(page, /保存并重启/);
  assert.match(page, /不会写进安装包/);
  assert.match(page, /图文纪要/);
  assert.match(page, /切换不消耗额度/);
  assert.match(page, /socketUrl\.searchParams\.set\("template"/);
  assert.match(page, /原始内容已被安全隐藏/);
  assert.match(page, /实时草稿/);
  assert.match(page, /Markdown 文件/);
  assert.match(page, /复制 Markdown/);
  assert.match(page, /保存到 Obsidian/);
  assert.match(page, /AI 笔记本/);
  assert.match(page, /配置 MiniMax 并生成总结/);
  assert.match(page, /connectObsidianVault/);
  assert.match(page, /结束后自动同步/);
  assert.match(page, /saveMeetingToObsidian/);
  assert.match(page, /shiyin\.obsidianAutoSave/);
  assert.match(page, /开始 \/ 结束/);
  assert.match(page, /getGlobalShortcutStatus/);
  assert.match(page, /toggle-recording/);
  assert.match(page, /查找与全局替换/);
  assert.match(page, /过滤“嗯、啊、呃”/);
  assert.match(page, /原始记录/);
  assert.match(page, /记录排列顺序/);
  assert.match(page, /shiyin\.transcriptOrder/);
  assert.match(page, /声纹匹配/);
  assert.match(page, /本机发言人声纹库/);
  assert.match(page, /撤销上次替换/);
  assert.match(page, /重命名会议/);
  assert.match(page, /setSelectedId\(\(current\) => preferredId \|\| current \|\| null\)/);
  assert.doesNotMatch(page, /result\.meetings\[0\]\?\.id/);
  assert.match(page, /会议名称不能为空/);
  assert.match(page, /JSON\.stringify\(\{ title \}\)/);
  assert.match(page, /清理临时文件/);
  assert.match(page, /异常恢复已开启/);
  assert.match(page, /完整数据备份/);
  assert.match(page, /开始重新转写/);
  assert.match(page, /旧逐字稿始终保留/);
  assert.match(page, /searchParams\.set\("maxSpeakers"/);
  assert.match(page, /shiyin\.maxSpeakers/);
  assert.match(proxy, /transcriptActionMatch/);
  assert.match(proxy, /\/api\/storage\/cleanup/);
  assert.match(proxy, /recoverInterruptedMeetings/);
  assert.match(proxy, /runHistoricalRetranscription/);
  assert.match(proxy, /maxSpeakers: meeting\.maxSpeakers/);
  assert.match(proxy, /会议名称不能为空/);
  assert.match(proxy, /\/api\/backups\/create/);
  assert.match(page, /summary\.preview/);
  assert.match(page, /\/api\/meetings\/\$\{encodeURIComponent\(meeting\.id\)\}\/audio/);
  assert.doesNotMatch(page, /window\.prompt/);
  assert.match(page, /NEXT_PUBLIC_ASR_PROXY_URL/);
  assert.match(worklet, /Int16Array/);
  assert.match(worklet, /mixed \/ channels\.length/);
  assert.match(desktopMain, /setDisplayMediaRequestHandler/);
  assert.match(desktopMain, /audio: "loopback"/);
  assert.match(desktopMain, /useSystemPicker: process\.platform === "darwin"/);
  assert.match(desktopMain, /nativeSystemAudioPicker/);
  assert.match(desktopMain, /macOSMajorVersion\(\) >= 15/);
  assert.match(desktopMain, /Privacy_ScreenCapture/);
  assert.match(desktopMain, /shell\.openExternal/);
  assert.match(desktopMain, /application:relaunch/);
  assert.match(desktopMain, /titleBarStyle: process\.platform === "darwin" \? "hiddenInset" : "hidden"/);
  assert.match(desktopMain, /trafficLightPosition: \{ x: 18, y: 18 \}/);
  assert.match(desktopMain, /nativeTheme\.themeSource = "system"/);
  assert.match(desktopMain, /screen\.getPrimaryDisplay\(\)\.workAreaSize/);
  assert.match(desktopMain, /findAvailableLocalPort/);
  assert.match(desktopMain, /shiyinWebReady/);
  assert.match(desktopMain, /health\?\.service === "shiyin-ai-backend"/);
  assert.match(desktopMain, /safeStorage\.encryptString/);
  assert.match(desktopMain, /safeStorage\.decryptString/);
  assert.match(desktopMain, /path\.join\(runtimeRoot, "settings\.json"\)/);
  assert.match(desktopMain, /SHIYIN_PUNCTUATION_MODEL_PATH/);
  assert.match(desktopMain, /obsidian:save-meeting/);
  assert.match(desktopMain, /notebook-settings:get/);
  assert.match(desktopMain, /discoverObsidianVault/);
  assert.match(desktopMain, /globalShortcut\.register/);
  assert.match(desktopMain, /Control\+Alt\+M/);
  assert.match(desktopMain, /Control\+Alt\+R/);
  assert.match(desktopMain, /Ctrl\+Alt\+M/);
  assert.match(desktopMain, /Ctrl\+Alt\+R/);
  assert.match(desktopMain, /global-shortcuts:get/);
  assert.match(desktopMain, /globalShortcut\.unregisterAll/);
  assert.match(preload, /getAudioCaptureCapabilities/);
  assert.match(preload, /openAudioPrivacySettings/);
  assert.match(preload, /data-folder:open/);
  assert.match(preload, /workspace-backup:create/);
  assert.match(preload, /workspace-backup:restore/);
  assert.match(preload, /obsidian:save-meeting/);
  assert.match(preload, /notebook-settings:connect-obsidian/);
  assert.match(preload, /global-shortcuts:get/);
  assert.match(preload, /application:relaunch/);
  assert.match(preload, /platform-\$\{process\.platform\}/);
  assert.match(preload, /saveMiniMaxSettings/);
  assert.match(packageJson, /NSAudioCaptureUsageDescription/);
  assert.match(packageJson, /build\/icon\.icns/);
  assert.match(envExample, /DASHSCOPE_API_KEY=/);
  assert.match(envExample, /SHIYIN_ASR_MODE=local/);
  assert.match(envExample, /SHIYIN_LOCAL_ASR_MODEL_DIR=/);
  assert.match(envExample, /SHIYIN_PUNCTUATION_MODEL_PATH=/);
  assert.match(envExample, /MINIMAX_TIMEOUT_MS=180000/);
  assert.match(envExample, /MINIMAX_STREAM_IDLE_TIMEOUT_MS=60000/);
  assert.match(envExample, /LIVE_SUMMARY_START_MS=30000/);
  assert.match(envExample, /LIVE_SUMMARY_INTERVAL_MS=20000/);
  assert.match(proxy, /status: "failed"/);
  assert.match(proxy, /SHIYIN_BIND_HOST \|\| "127\.0\.0\.1"/);
  assert.match(proxy, /SHIYIN_APP_ORIGIN \|\| "http:\/\/127\.0\.0\.1:3000"/);
  assert.match(proxy, /service: "shiyin-ai-backend"/);
  assert.match(proxy, /appOrigin/);
  assert.doesNotMatch(proxy, /listen\(port, "0\.0\.0\.0"/);
  assert.doesNotMatch(proxy, /"Access-Control-Allow-Origin": "\*"/);
  assert.doesNotMatch(`${proxy}\n${localAsr}\n${page}`, /sk-[A-Za-z0-9]{16,}/);
});

test("downmixes stereo desktop audio before sending PCM", async () => {
  const source = await readFile(new URL("../public/pcm-worklet.js", import.meta.url), "utf8");
  let Processor = null;
  let output = null;
  class AudioWorkletProcessor {
    constructor() {
      this.port = {
        postMessage(buffer) {
          output = Int16Array.from(new Int16Array(buffer));
        },
      };
    }
  }
  runInNewContext(source, {
    AudioWorkletProcessor,
    registerProcessor(_name, value) { Processor = value; },
    Float32Array,
    Int16Array,
  });
  const processor = new Processor();
  assert.equal(processor.process([[
    Float32Array.from([1, 0]),
    Float32Array.from([0, 1]),
  ]]), true);
  assert.deepEqual([...output], [16383, 16383]);
});
