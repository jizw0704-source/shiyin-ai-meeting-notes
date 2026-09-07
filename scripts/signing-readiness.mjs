import process from "node:process";

const requested = process.argv.find((item) => item.startsWith("--platform="))?.split("=")[1] || "all";
const requireReady = process.argv.includes("--require");
const has = (name) => Boolean(String(process.env[name] || "").trim());

const mac = {
  platform: "macOS",
  signingReady: has("CSC_LINK") && has("CSC_KEY_PASSWORD"),
  notarizationReady: has("APPLE_ID") && has("APPLE_APP_SPECIFIC_PASSWORD") && has("APPLE_TEAM_ID"),
  missing: ["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"].filter((name) => !has(name)),
};
const windows = {
  platform: "Windows",
  signingReady: has("CSC_LINK") && has("CSC_KEY_PASSWORD"),
  notarizationReady: null,
  missing: ["CSC_LINK", "CSC_KEY_PASSWORD"].filter((name) => !has(name)),
};
const results = requested === "mac" ? [mac] : requested === "win" ? [windows] : [mac, windows];
const ready = results.every((item) => item.signingReady && item.notarizationReady !== false);

console.log(JSON.stringify({ ready, results }, null, 2));
if (requireReady && !ready) process.exitCode = 1;
