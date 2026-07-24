import { readFileSync } from "node:fs";
import process from "node:process";
import { WebSocket } from "ws";

const inputPath = process.argv[2];
const endpoint = process.argv[3] || "ws://127.0.0.1:8788";
if (!inputPath) {
  console.error("用法：node scripts/live-asr-smoke.mjs <16k单声道PCM WAV>");
  process.exit(1);
}

function extractPcm(wav) {
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("输入文件不是 WAV");
  }
  const channels = wav.readUInt16LE(22);
  const sampleRate = wav.readUInt32LE(24);
  const bits = wav.readUInt16LE(34);
  if (channels !== 1 || sampleRate !== 16000 || bits !== 16) {
    throw new Error(`需要 16kHz/16bit/单声道，实际为 ${sampleRate}Hz/${bits}bit/${channels}声道`);
  }
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const chunk = wav.toString("ascii", offset, offset + 4);
    const length = wav.readUInt32LE(offset + 4);
    if (chunk === "data") return wav.subarray(offset + 8, offset + 8 + length);
    offset += 8 + length + (length % 2);
  }
  throw new Error("WAV 中没有 data 块");
}

const pcm = extractPcm(readFileSync(inputPath));
const socket = new WebSocket(`${endpoint}?title=${encodeURIComponent("自动语音链路测试")}`);
let finalSegments = 0;
let completed = false;

const timeout = setTimeout(() => {
  console.error("实时识别测试超时");
  socket.close();
  process.exitCode = 2;
}, 90000);

socket.on("message", async (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.type === "session.started") {
    console.log(`会议已创建：${message.meeting.id}`);
    for (let offset = 0; offset < pcm.length; offset += 3200) {
      socket.send(pcm.subarray(offset, Math.min(pcm.length, offset + 3200)));
      await new Promise((resolve) => setTimeout(resolve, 35));
    }
    socket.send(JSON.stringify({ type: "session.stop" }));
  } else if (message.type === "asr.partial" && message.text) {
    console.log(`实时：${message.text}`);
  } else if (message.type === "segment.final") {
    finalSegments += 1;
    console.log(`最终：${message.segment.text}`);
  } else if (message.type === "job.progress") {
    console.log(`${message.job.kind}：${message.job.progress}%`);
  } else if (message.type === "error") {
    console.error(message.message);
  } else if (message.type === "session.completed") {
    completed = true;
    clearTimeout(timeout);
    console.log(`完成：${message.meeting.segments.length} 段，${message.meeting.speakers.length} 位发言人`);
    socket.close();
    if (!finalSegments) process.exitCode = 3;
  }
});

socket.on("error", (error) => {
  clearTimeout(timeout);
  console.error(error.message);
  process.exitCode = 2;
});

socket.on("close", () => {
  if (!completed && process.exitCode === undefined) process.exitCode = 2;
});
