import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

function parseWav(buffer) {
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("原始录音不是有效的 WAV 文件");
  }
  let format = null;
  let data = null;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const length = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = Math.min(buffer.length, start + length);
    if (id === "fmt " && length >= 16) {
      format = {
        audioFormat: buffer.readUInt16LE(start),
        channels: buffer.readUInt16LE(start + 2),
        sampleRate: buffer.readUInt32LE(start + 4),
        byteRate: buffer.readUInt32LE(start + 8),
        blockAlign: buffer.readUInt16LE(start + 12),
        bitsPerSample: buffer.readUInt16LE(start + 14),
      };
    }
    if (id === "data") data = { offset: start, length: end - start };
    offset = start + length + (length % 2);
  }
  if (!format || !data || format.audioFormat !== 1 || !format.blockAlign || !format.byteRate) {
    throw new Error("当前只支持剪辑 PCM WAV 录音");
  }
  return { ...format, data };
}

function wavHeader(dataLength, format) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(format.channels, 22);
  header.writeUInt32LE(format.sampleRate, 24);
  header.writeUInt32LE(format.byteRate, 28);
  header.writeUInt16LE(format.blockAlign, 32);
  header.writeUInt16LE(format.bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataLength, 40);
  return header;
}

export function buildClipRanges({ startMs, endMs, segments = [], speakerIds = [] }) {
  const selected = new Set(speakerIds.map(String));
  if (!selected.size) return [{ startMs, endMs }];
  const ranges = segments
    .filter((segment) => segment.speakerId && selected.has(String(segment.speakerId)))
    .map((segment) => ({
      startMs: Math.max(startMs, Number(segment.startMs) || 0),
      endMs: Math.min(endMs, Number(segment.endMs ?? segment.startMs) || 0),
    }))
    .filter((range) => range.endMs > range.startMs)
    .sort((left, right) => left.startMs - right.startMs);
  const merged = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.startMs <= previous.endMs + 40) previous.endMs = Math.max(previous.endMs, range.endMs);
    else merged.push({ ...range });
  }
  return merged;
}

export async function createEditedWav({ sourcePath, outputPath, startMs, endMs, segments, speakerIds }) {
  const source = await readFile(sourcePath);
  const format = parseWav(source);
  const sourceDurationMs = Math.floor(format.data.length / format.byteRate * 1000);
  const safeStart = Math.max(0, Math.min(sourceDurationMs, Math.round(Number(startMs) || 0)));
  const safeEnd = Math.max(safeStart, Math.min(sourceDurationMs, Math.round(Number(endMs) || sourceDurationMs)));
  if (safeEnd - safeStart < 250) throw new Error("剪辑范围至少需要 0.25 秒");
  const ranges = buildClipRanges({ startMs: safeStart, endMs: safeEnd, segments, speakerIds });
  if (!ranges.length) throw new Error("所选时间内没有找到这些发言人的录音片段");

  const chunks = [];
  const silenceLength = Math.floor(format.byteRate * 0.12 / format.blockAlign) * format.blockAlign;
  const silence = Buffer.alloc(silenceLength);
  for (const [index, range] of ranges.entries()) {
    const startByte = Math.floor(range.startMs * format.byteRate / 1000 / format.blockAlign) * format.blockAlign;
    const endByte = Math.ceil(range.endMs * format.byteRate / 1000 / format.blockAlign) * format.blockAlign;
    chunks.push(source.subarray(format.data.offset + startByte, format.data.offset + Math.min(format.data.length, endByte)));
    if (index < ranges.length - 1) chunks.push(silence);
  }
  const pcm = Buffer.concat(chunks);
  const output = Buffer.concat([wavHeader(pcm.length, format), pcm]);
  const temporaryPath = `${outputPath}.tmp`;
  await mkdir(path.dirname(outputPath), { recursive: true });
  try {
    await writeFile(temporaryPath, output, { flag: "wx" });
    await rename(temporaryPath, outputPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
  return {
    durationMs: Math.round(pcm.length / format.byteRate * 1000),
    sizeBytes: output.length,
    sourceRanges: ranges,
  };
}
