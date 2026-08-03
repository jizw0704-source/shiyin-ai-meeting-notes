import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const file of [".env.local", ".env"]) {
  try { process.loadEnvFile?.(path.join(sourceRoot, file)); } catch { /* optional local env file */ }
}

const webHost = process.env.SHIYIN_WEB_HOST || "127.0.0.1";
const webPort = String(Number(process.env.SHIYIN_WEB_PORT || 3000));
const webOrigin = process.env.SHIYIN_APP_ORIGIN || `http://${webHost}:${webPort}`;
const environment = {
  ...process.env,
  SHIYIN_WEB_HOST: webHost,
  SHIYIN_WEB_PORT: webPort,
  SHIYIN_APP_ORIGIN: webOrigin,
};

const children = [
  spawn(process.execPath, [
    path.join(sourceRoot, "node_modules", "vinext", "dist", "cli.js"),
    "dev",
    "--hostname",
    webHost,
    "--port",
    webPort,
  ], { cwd: sourceRoot, env: environment, stdio: "inherit" }),
  spawn(process.execPath, [path.join(sourceRoot, "server", "realtime-proxy.mjs")], {
    cwd: sourceRoot,
    env: environment,
    stdio: "inherit",
  }),
];

let stopping = false;
function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

for (const child of children) {
  child.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
    stop();
  });
  child.on("exit", (code, signal) => {
    if (!stopping && code !== 0) {
      console.error(`开发服务异常退出：${signal || code}`);
      process.exitCode = code || 1;
      stop();
    }
  });
}

await Promise.all(children.map((child) => new Promise((resolve) => child.once("exit", resolve))));
