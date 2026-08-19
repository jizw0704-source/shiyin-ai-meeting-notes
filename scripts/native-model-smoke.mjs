import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { LocalAsrEngine } from "../server/local-asr-engine.mjs";
import { SpeakerEngine } from "../server/speaker-engine.mjs";

const require = createRequire(import.meta.url);
const sourceRoot = path.resolve(import.meta.dirname, "..");
const platformPackage = process.platform === "win32"
  ? `sherpa-onnx-win-${process.arch}`
  : `sherpa-onnx-${process.platform}-${process.arch}`;

assert.doesNotThrow(
  () => require.resolve(platformPackage),
  `缺少当前平台的 Sherpa-ONNX 原生包：${platformPackage}`,
);

const asrEngine = new LocalAsrEngine({
  modelDir: path.join(sourceRoot, "models", "asr"),
  punctuationModelPath: path.join(sourceRoot, "models", "punctuation", "model.int8.onnx"),
  numThreads: 1,
});
assert.equal(
  asrEngine.available,
  true,
  `Paraformer 本地转写模型加载失败：${asrEngine.error?.message || "模型文件不完整"}`,
);
assert.equal(
  asrEngine.punctuationAvailable,
  true,
  `本地标点模型加载失败：${asrEngine.punctuationError?.message || "模型文件不完整"}`,
);
assert.match(
  asrEngine.punctuation.addPunct("我们先确认方案然后安排负责人"),
  /[，。！？]/u,
  "本地标点模型已加载，但没有生成标点",
);

const sampleRate = 16000;
const durationSeconds = 1.6;
const pcm = Buffer.alloc(sampleRate * durationSeconds * 2);
for (let index = 0; index < sampleRate * durationSeconds; index += 1) {
  const sample = Math.round(Math.sin((2 * Math.PI * 220 * index) / sampleRate) * 2400);
  pcm.writeInt16LE(sample, index * 2);
}

const asrSession = asrEngine.createSession();
assert.doesNotThrow(() => {
  asrSession.acceptPcm(pcm);
  asrSession.finish();
}, "Paraformer 模型已加载，但无法完成一次本地解码");

const speakerEngine = new SpeakerEngine({
  modelPath: path.join(
    sourceRoot,
    "models",
    "speaker",
    "3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx",
  ),
  numThreads: 1,
});
assert.equal(speakerEngine.available, true, "CAM++ 发言人模型加载失败");
const embedding = speakerEngine.extractEmbedding(pcm);
assert.ok(embedding?.length, "CAM++ 模型未能生成声纹向量");
assert.ok(Array.from(embedding).every(Number.isFinite), "CAM++ 模型生成了无效声纹向量");

process.stdout.write(`${JSON.stringify({
  ok: true,
  platform: process.platform,
  arch: process.arch,
  nativePackage: platformPackage,
  asrAvailable: asrEngine.available,
  punctuationModelAvailable: asrEngine.punctuationAvailable,
  speakerModelAvailable: speakerEngine.available,
  speakerEmbeddingDimensions: embedding.length,
})}\n`);
