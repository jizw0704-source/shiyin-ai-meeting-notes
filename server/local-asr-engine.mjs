import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { normalizeTranscriptText, punctuateTranscriptText } from "./transcript-punctuation.mjs";

const require = createRequire(import.meta.url);
const SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 2;

function pcmToFloat32(buffer) {
  const sampleCount = Math.floor(buffer.length / BYTES_PER_SAMPLE);
  const samples = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = buffer.readInt16LE(index * BYTES_PER_SAMPLE) / 32768;
  }
  return samples;
}

class LocalAsrSession {
  constructor(recognizer, callbacks = {}, punctuate = null) {
    this.recognizer = recognizer;
    this.stream = recognizer.createStream();
    this.onPartial = callbacks.onPartial;
    this.onFinal = callbacks.onFinal;
    this.totalSamples = 0;
    this.segmentStartMs = 0;
    this.lastPartial = "";
    this.finished = false;
    this.trailingByte = null;
    this.punctuate = punctuate;
  }

  organizeFinalText(originalText) {
    let text = originalText;
    try {
      text = this.punctuate?.(originalText) || originalText;
    } catch {
      text = originalText;
    }
    return punctuateTranscriptText(text);
  }

  acceptPcm(value) {
    if (this.finished) return;
    let buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
    if (this.trailingByte) {
      buffer = Buffer.concat([this.trailingByte, buffer]);
      this.trailingByte = null;
    }
    if (buffer.length % BYTES_PER_SAMPLE !== 0) {
      this.trailingByte = buffer.subarray(buffer.length - 1);
      buffer = buffer.subarray(0, buffer.length - 1);
    }
    if (!buffer.length) return;

    const samples = pcmToFloat32(buffer);
    this.totalSamples += samples.length;
    this.stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples });
    this.decodeReadyFrames();

    const endpoint = this.recognizer.isEndpoint(this.stream);
    if (endpoint) {
      this.appendTailPadding();
      const originalText = normalizeTranscriptText(
        this.recognizer.getResult(this.stream).text || this.lastPartial,
      );
      const text = this.organizeFinalText(originalText);
      const endMs = this.currentTimeMs;
      if (text) {
        this.onFinal?.({ text, originalText, startMs: this.segmentStartMs, endMs, words: [] });
      }
      this.recognizer.reset(this.stream);
      this.segmentStartMs = endMs;
      this.lastPartial = "";
      return;
    }

    const originalText = normalizeTranscriptText(this.recognizer.getResult(this.stream).text);
    if (originalText && originalText !== this.lastPartial) {
      this.lastPartial = originalText;
      this.onPartial?.({
        text: punctuateTranscriptText(originalText, { final: false }),
        originalText,
        startMs: this.segmentStartMs,
        words: [],
      });
    }
  }

  finish() {
    if (this.finished) return;
    this.appendTailPadding();
    const originalText = normalizeTranscriptText(
      this.recognizer.getResult(this.stream).text || this.lastPartial,
    );
    const text = this.organizeFinalText(originalText);
    if (text) {
      this.onFinal?.({
        text,
        originalText,
        startMs: this.segmentStartMs,
        endMs: this.currentTimeMs,
        words: [],
      });
    }
    this.finished = true;
    this.lastPartial = "";
  }

  appendTailPadding() {
    const padding = new Float32Array(Math.round(SAMPLE_RATE * 0.4));
    this.stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples: padding });
    this.decodeReadyFrames();
  }

  decodeReadyFrames() {
    while (this.recognizer.isReady(this.stream)) this.recognizer.decode(this.stream);
  }

  get currentTimeMs() {
    return Math.round((this.totalSamples / SAMPLE_RATE) * 1000);
  }
}

export class LocalAsrEngine {
  constructor(options = {}) {
    this.modelDir = path.resolve(options.modelDir || path.join("models", "asr"));
    this.encoderPath = path.join(this.modelDir, "encoder.int8.onnx");
    this.decoderPath = path.join(this.modelDir, "decoder.int8.onnx");
    this.tokensPath = path.join(this.modelDir, "tokens.txt");
    this.punctuationModelPath = path.resolve(
      options.punctuationModelPath || path.join("models", "punctuation", "model.int8.onnx"),
    );
    this.recognizer = null;
    this.punctuation = null;
    this.error = null;
    this.punctuationError = null;

    if (![this.encoderPath, this.decoderPath, this.tokensPath].every(existsSync)) return;
    try {
      const sherpa = require("sherpa-onnx-node");
      const trailingSilenceSeconds = Math.max(
        0.5,
        Number(options.trailingSilenceMs || 1200) / 1000,
      );
      this.recognizer = new sherpa.OnlineRecognizer({
        featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
        modelConfig: {
          paraformer: {
            encoder: this.encoderPath,
            decoder: this.decoderPath,
          },
          tokens: this.tokensPath,
          numThreads: Math.max(1, Math.min(6, Number(options.numThreads || 2))),
          provider: "cpu",
          debug: false,
        },
        decodingMethod: "greedy_search",
        maxActivePaths: 4,
        enableEndpoint: true,
        rule1MinTrailingSilence: 2.4,
        rule2MinTrailingSilence: trailingSilenceSeconds,
        rule3MinUtteranceLength: 12,
      });
      if (existsSync(this.punctuationModelPath)) {
        try {
          this.punctuation = new sherpa.OfflinePunctuation({
            model: {
              ctTransformer: this.punctuationModelPath,
              numThreads: Math.max(1, Math.min(4, Number(options.numThreads || 2))),
              provider: "cpu",
              debug: false,
            },
          });
        } catch (error) {
          this.punctuationError = error;
        }
      }
    } catch (error) {
      this.error = error;
    }
  }

  get available() {
    return Boolean(this.recognizer);
  }

  get punctuationAvailable() {
    return Boolean(this.punctuation);
  }

  createSession(callbacks = {}) {
    if (!this.recognizer) {
      throw new Error(this.error?.message || `本地转写模型不可用：${this.modelDir}`);
    }
    return new LocalAsrSession(
      this.recognizer,
      callbacks,
      this.punctuation ? (text) => this.punctuation.addPunct(text) : null,
    );
  }
}
