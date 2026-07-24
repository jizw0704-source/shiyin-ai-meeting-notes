/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require("electron");

window.addEventListener("DOMContentLoaded", () => {
  document.documentElement.classList.add("desktop-app");
});

contextBridge.exposeInMainWorld("shiyinDesktop", {
  onCommand(callback) {
    const listener = (_event, command) => callback(command);
    ipcRenderer.on("tray-command", listener);
    return () => ipcRenderer.removeListener("tray-command", listener);
  },
  setRecording(active) {
    ipcRenderer.send("recording-state", Boolean(active));
  },
});
