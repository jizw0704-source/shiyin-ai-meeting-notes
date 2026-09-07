import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

async function sha256(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function snapshotName(date = new Date()) {
  return `database-${date.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)}-${randomUUID().slice(0, 6)}`;
}

export async function createDatabaseSnapshot({ storage, dataRoot, destinationRoot, appVersion = "unknown", keep = 5 }) {
  const destination = path.resolve(String(destinationRoot || ""));
  if (!destinationRoot) throw new Error("缺少数据库快照目录");
  await mkdir(destination, { recursive: true });
  const sourcePath = path.join(dataRoot, "shiyin.sqlite");
  const source = await stat(sourcePath).catch(() => null);
  if (!source?.isFile()) throw new Error("会议数据库不存在");
  storage.db.exec("PRAGMA wal_checkpoint(FULL)");
  const name = snapshotName();
  const temporaryPath = path.join(destination, `.${name}.tmp`);
  const finalPath = path.join(destination, `${name}.sqlite`);
  await copyFile(sourcePath, temporaryPath);
  await rename(temporaryPath, finalPath);
  const record = {
    format: "shiyin-ai-database-snapshot",
    formatVersion: 1,
    appVersion,
    createdAt: new Date().toISOString(),
    databaseFile: path.basename(finalPath),
    size: (await stat(finalPath)).size,
    sha256: await sha256(finalPath),
  };
  await writeFile(`${finalPath}.json`, `${JSON.stringify(record, null, 2)}\n`, "utf8");

  const files = (await readdir(destination))
    .filter((file) => /^database-.*\.sqlite$/.test(file))
    .sort()
    .reverse();
  for (const stale of files.slice(Math.max(1, Number(keep) || 5))) {
    await rm(path.join(destination, stale), { force: true });
    await rm(path.join(destination, `${stale}.json`), { force: true });
  }
  return { path: finalPath, ...record };
}

export async function inspectDatabaseSnapshot(snapshotPath) {
  const manifest = JSON.parse(await readFile(`${snapshotPath}.json`, "utf8"));
  const details = await stat(snapshotPath);
  if (manifest.format !== "shiyin-ai-database-snapshot" || details.size !== manifest.size
    || await sha256(snapshotPath) !== manifest.sha256) {
    throw new Error("数据库快照校验失败");
  }
  return manifest;
}
