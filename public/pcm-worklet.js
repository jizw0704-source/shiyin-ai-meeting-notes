class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channels = inputs[0];
    const sampleCount = channels?.[0]?.length || 0;
    if (!sampleCount) return true;
    const pcm = new Int16Array(sampleCount);
    for (let i = 0; i < sampleCount; i += 1) {
      let mixed = 0;
      for (const channel of channels) mixed += channel[i] || 0;
      const sample = Math.max(-1, Math.min(1, mixed / channels.length));
      pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    this.port.postMessage(pcm.buffer, [pcm.buffer]);
    return true;
  }
}
registerProcessor("pcm-capture", PcmCaptureProcessor);
