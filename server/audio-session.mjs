import { createReadStream, createWriteStream, existsSync, mkdirSync, openSync, closeSync, readSync, rmSync, statSync, writeSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import path from "node:path";

function wavHeader(dataLength, sampleRate = 16000, channels = 1, bitsPerSample = 16) {
  const blockAlign = channels * bitsPerSample / 8;
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataLength, 40);
  return header;
}

export class AudioSession {
  constructor(root, meetingId, sampleRate = 16000) {
    this.sampleRate = sampleRate;
    this.bytesPerMs = sampleRate * 2 / 1000;
    this.directory = path.join(root, "meetings", meetingId);
    mkdirSync(this.directory, { recursive: true });
    this.pcmPath = path.join(this.directory, "audio.pcm.tmp");
    this.wavPath = path.join(this.directory, "audio.wav");
    this.fd = openSync(this.pcmPath, "a+");
    this.byteLength = statSync(this.pcmPath).size;
    this.closed = false;
  }

  append(buffer) {
    if (this.closed) return;
    const value = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    writeSync(this.fd, value);
    this.byteLength += value.length;
  }

  readRange(startMs, endMs) {
    const safeStart = Math.max(0, Math.floor(startMs * this.bytesPerMs));
    const safeEnd = Math.min(this.byteLength, Math.ceil(endMs * this.bytesPerMs));
    if (safeEnd <= safeStart) return Buffer.alloc(0);
    const output = Buffer.alloc(safeEnd - safeStart);
    readSync(this.fd, output, 0, output.length, safeStart);
    return output;
  }

  get durationMs() {
    return Math.round(this.byteLength / this.bytesPerMs);
  }

  async finalize() {
    if (this.closed) return this.wavPath;
    this.closed = true;
    closeSync(this.fd);
    const output = createWriteStream(this.wavPath);
    output.write(wavHeader(this.byteLength, this.sampleRate));
    await pipeline(createReadStream(this.pcmPath), output);
    rmSync(this.pcmPath, { force: true });
    return this.wavPath;
  }

  static isRecoverable(pcmPath) {
    return existsSync(pcmPath) && statSync(pcmPath).size > 0;
  }
}
