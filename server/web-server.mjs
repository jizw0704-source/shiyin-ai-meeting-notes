import path from "node:path";
import process from "node:process";
import { installVinextWindowsStaticCacheCompatibility } from "./vinext-windows-static-cache.mjs";

for (const file of [".env.local", ".env"]) {
  try { process.loadEnvFile?.(file); } catch { /* optional local configuration */ }
}

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";

await installVinextWindowsStaticCacheCompatibility();
const { startProdServer } = await import("vinext/server/prod-server");
await startProdServer({
  port,
  host,
  outDir: path.resolve("dist"),
});
