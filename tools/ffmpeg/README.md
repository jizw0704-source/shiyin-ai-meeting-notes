# Packaged audio converter

Release builds place a platform-specific `ffmpeg` executable and its LGPL license in this directory before Electron packaging. Binaries are deliberately not committed to Git.

The converter is a separate command-line component used only to decode imported audio/video into a mono 16 kHz PCM WAV working copy. It is not used for live recording or local speech recognition.
