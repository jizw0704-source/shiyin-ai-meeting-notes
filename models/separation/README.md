# Local two-speaker separation model

`convtasnet_16k.onnx` is the FP32 ONNX export published at
`welcomyou/convtasnet-libri2mix-16k-onnx`, derived from
`JorisCos/ConvTasNet_Libri2Mix_sepclean_16k`.

- Purpose: offline separation of a 16 kHz mono, two-speaker overlap into two streams.
- Model license: CC BY-SA 4.0.
- Source: https://huggingface.co/welcomyou/convtasnet-libri2mix-16k-onnx
- SHA-256: `22185d8e13bf5251c0eeab09e52099ac76c063cd9a5e5df1f5c242f535f6f151`
- Limitations: trained primarily on clean English mixtures. Chinese meetings, reverberation,
  more than two simultaneous speakers, and distant microphones can reduce accuracy.

The application treats this as a conservative Beta enhancement. It keeps the original
recording and mixed transcript whenever two distinct sources cannot be verified.
