/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require("electron");

window.addEventListener("DOMContentLoaded", () => {
  document.documentElement.classList.add("desktop-app", `platform-${process.platform}`);
});

contextBridge.exposeInMainWorld("shiyinDesktop", {
  getAudioCaptureCapabilities() {
    return ipcRenderer.invoke("audio-capture-capabilities");
  },
  openAudioPrivacySettings(kind) {
    return ipcRenderer.invoke("audio-privacy-settings:open", kind);
  },
  relaunch() {
    ipcRenderer.send("application:relaunch");
  },
  getMiniMaxSettings() {
    return ipcRenderer.invoke("minimax-settings:get");
  },
  saveMiniMaxSettings(settings) {
    return ipcRenderer.invoke("minimax-settings:save", settings);
  },
  onCommand(callback) {
    const listener = (_event, command) => callback(command);
    ipcRenderer.on("tray-command", listener);
    return () => ipcRenderer.removeListener("tray-command", listener);
  },
  setRecording(active) {
    ipcRenderer.send("recording-state", Boolean(active));
  },
});
