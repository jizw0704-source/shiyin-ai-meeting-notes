import path from "node:path";
import process from "node:process";
import { startProdServer } from "vinext/server/prod-server";

for (const file of [".env.local", ".env"]) {
  try { process.loadEnvFile?.(file); } catch { /* optional local configuration */ }
}

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";

await startProdServer({
  port,
  host,
  outDir: path.resolve("dist"),
});
