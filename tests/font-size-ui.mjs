import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const modules = process.env.SHIYIN_QA_NODE_MODULES;
if (!modules) throw new Error("Set SHIYIN_QA_NODE_MODULES to an existing Playwright node_modules directory.");
const require = createRequire(path.join(modules, "..", "package.json"));
const { chromium } = require("playwright");
const origin = process.env.SHIYIN_FONT_TEST_URL || "http://127.0.0.1:3014";
const browser = await chromium.launch({ headless: true });
const artifacts = await mkdtemp(path.join(os.tmpdir(), "shiyin-font-size-"));
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
// Isolate reading-preference checks from real meetings, keys and microphone access.
await page.route("http://127.0.0.1:8788/**", async route => {
  if (route.request().method() !== "GET" && route.request().method() !== "OPTIONS") {
    await route.abort();
    return;
  }
  const pathname = new URL(route.request().url()).pathname;
  const data = pathname === "/health"
    ? { ok: true, service: "shiyin-ai-backend", appOrigin: origin, asrMode: "local", localAsrAvailable: true, punctuationModelAvailable: true, speakerModelAvailable: true, overlapSeparationModelAvailable: true, miniMaxConfigured: false }
    : pathname === "/api/meetings" ? { meetings: [] }
      : pathname === "/api/preflight" ? { status: "ready", checks: [{ id: "storage", label: "本机存储", status: "ready", detail: "测试工作区", blocking: false }] }
        : pathname === "/api/storage" ? { meetingCount: 0, totalBytes: 0 }
          : {};
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data), headers: { "access-control-allow-origin": origin, "access-control-allow-headers": "content-type" } });
});
async function settings() {
  await page.waitForFunction(() => Boolean(document.documentElement.dataset.fontSize));
  await page.locator(".settings-button:not(.update-button)").click();
  await page.getByRole("radiogroup", { name: "字体大小", exact: true }).waitFor();
}
async function choose(name, id) {
  await page.getByRole("radio", { name: new RegExp(`^${name}`) }).click();
  await page.waitForFunction(expected => document.documentElement.dataset.fontSize === expected, id);
}
async function font(selector) { return page.locator(selector).first().evaluate(el => parseFloat(getComputedStyle(el).fontSize)); }
async function overflow(label) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${label}: horizontal overflow`);
  const clipped = await page.locator(".settings-font-options button").evaluateAll(items => items.filter(el => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1).length);
  assert.equal(clipped, 0, `${label}: clipped font buttons`);
}
try {
  await page.goto(origin);
  await settings();
  const standard = await font(".settings-font-preview p");
  assert.equal(standard, 14);
  await choose("大", "large");
  assert.equal(await font(".settings-font-preview p"), 16.1);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.fontSize === "large");
  await settings();
  assert.equal(await page.getByRole("radio", { name: /^大/ }).getAttribute("aria-checked"), "true");
  await choose("特大", "extra-large");
  assert.equal(await font(".settings-font-preview p"), 18.2);
  await overflow("desktop extra large");
  await page.screenshot({ path: path.join(artifacts, "font-extra-large-desktop.png"), fullPage: true });
  await page.getByRole("radio", { name: /^特大/ }).press("Home");
  await page.waitForFunction(() => document.documentElement.dataset.fontSize === "small");
  assert.equal(await font(".settings-font-preview p"), 12.6);
  await page.getByRole("radio", { name: /^小/ }).press("ArrowRight");
  await page.waitForFunction(() => document.documentElement.dataset.fontSize === "standard");
  assert.equal(await font(".settings-font-preview p"), standard);
  await choose("特大", "extra-large");
  await page.emulateMedia({ media: "print" });
  assert.equal(await font(".settings-font-preview p"), standard, "print keeps canonical font size");
  await page.emulateMedia({ media: "screen" });
  await page.setViewportSize({ width: 390, height: 844 });
  await overflow("narrow extra large");
  assert.equal(await page.locator(".settings-font-options").evaluate(el => getComputedStyle(el).gridTemplateColumns.split(" ").length), 2);
  await page.screenshot({ path: path.join(artifacts, "font-extra-large-narrow.png"), fullPage: true });
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  await overflow("dark extra large");
  await page.screenshot({ path: path.join(artifacts, "font-extra-large-dark.png"), fullPage: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, persistedAfterReload: true, fourScales: [12.6,14,16.1,18.2], keyboardSelection: true, printUnchanged: true, desktopAndNarrow: true, browserErrors: errors, artifacts }, null, 2));
} finally { await browser.close(); }
