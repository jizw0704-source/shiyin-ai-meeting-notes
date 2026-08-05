import { createReadStream, openSync, closeSync, readSync, statSync } from "node:fs";

export function inspectPcmWav(filePath) {
  const size = statSync(filePath).size;
  const headerLength = Math.min(size, 1024 * 1024);
  const header = Buffer.alloc(headerLength);
  const fd = openSync(filePath, "r");
  try {
    readSync(fd, header, 0, header.length, 0);
  } finally {
    closeSync(fd);
  }
  if (header.toString("ascii", 0, 4) !== "RIFF" || header.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("原始录音不是有效的 WAV 文件");
  }

  let format = null;
  let data = null;
  let offset = 12;
  while (offset + 8 <= header.length) {
    const chunkId = header.toString("ascii", offset, offset + 4);
    const chunkSize = header.readUInt32LE(offset + 4);
    const chunkDataOffset = offset + 8;
    if (chunkId === "fmt " && chunkSize >= 16 && chunkDataOffset + 16 <= header.length) {
      format = {
        audioFormat: header.readUInt16LE(chunkDataOffset),
        channels: header.readUInt16LE(chunkDataOffset + 2),
        sampleRate: header.readUInt32LE(chunkDataOffset + 4),
        bitsPerSample: header.readUInt16LE(chunkDataOffset + 14),
      };
    }
    if (chunkId === "data") {
      data = { offset: chunkDataOffset, length: Math.min(chunkSize, size - chunkDataOffset) };
      break;
    }
    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }
  if (!format || !data || data.length <= 0) throw new Error("WAV 文件缺少可识别的音频数据");
  if (format.audioFormat !== 1 || format.channels !== 1 || format.sampleRate !== 16000 || format.bitsPerSample !== 16) {
    throw new Error("历史重新转写目前支持拾音 AI 生成的单声道 16 kHz WAV 录音");
  }
  return {
    ...format,
    dataOffset: data.offset,
    dataLength: data.length,
    durationMs: Math.round(data.length / 32),
  };
}

export async function transcribeHistoricalWav({ filePath, asrEngine, onProgress = () => {} }) {
  if (!asrEngine?.available) throw new Error("本地转写模型不可用");
  const wav = inspectPcmWav(filePath);
  const segments = [];
  const session = asrEngine.createSession({
    onFinal(result) {
      const text = String(result.text || "").trim();
      if (!text) return;
      segments.push({
        seq: segments.length,
        startMs: Math.max(0, Number(result.startMs) || 0),
        endMs: Math.min(wav.durationMs, Math.max(0, Number(result.endMs) || 0)),
        text,
        speakerId: null,
        confidence: null,
        words: result.words || [],
        source: "local-retranscribed",
      });
    },
  });

  let processedBytes = 0;
  let lastProgress = -1;
  const stream = createReadStream(filePath, {
    start: wav.dataOffset,
    end: wav.dataOffset + wav.dataLength - 1,
    highWaterMark: 32000,
  });
  for await (const chunk of stream) {
    session.acceptPcm(chunk);
    processedBytes += chunk.length;
    const progress = Math.min(99, Math.round((processedBytes / wav.dataLength) * 100));
    if (progress !== lastProgress) {
      lastProgress = progress;
      onProgress(progress);
    }
  }
  session.finish();
  for (let index = 0; index < segments.length; index += 1) {
    const next = segments[index + 1];
    segments[index].pauseAfterMs = next
      ? Math.max(0, next.startMs - segments[index].endMs)
      : null;
  }
  onProgress(100);
  return { segments, durationMs: wav.durationMs };
}
