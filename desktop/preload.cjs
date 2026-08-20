/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require("electron");

window.addEventListener("DOMContentLoaded", () => {
  document.documentElement.classList.add("desktop-app", `platform-${process.platform}`);
});

contextBridge.exposeInMainWorld("shiyinDesktop", {
  getAudioCaptureCapabilities() {
    return ipcRenderer.invoke("audio-capture-capabilities");
  },
  getGlobalShortcutStatus() {
    return ipcRenderer.invoke("global-shortcuts:get");
  },
  openAudioPrivacySettings(kind) {
    return ipcRenderer.invoke("audio-privacy-settings:open", kind);
  },
  openDataFolder() {
    return ipcRenderer.invoke("data-folder:open");
  },
  createWorkspaceBackup() {
    return ipcRenderer.invoke("workspace-backup:create");
  },
  restoreWorkspaceBackup() {
    return ipcRenderer.invoke("workspace-backup:restore");
  },
  saveMeetingToObsidian(meeting) {
    return ipcRenderer.invoke("obsidian:save-meeting", meeting);
  },
  getNotebookSettings() {
    return ipcRenderer.invoke("notebook-settings:get");
  },
  connectObsidianVault() {
    return ipcRenderer.invoke("notebook-settings:connect-obsidian");
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
  getApplicationUpdateState() {
    return ipcRenderer.invoke("application-update:get");
  },
  checkForApplicationUpdates() {
    return ipcRenderer.invoke("application-update:check");
  },
  downloadApplicationUpdate() {
    return ipcRenderer.invoke("application-update:download");
  },
  installApplicationUpdate() {
    return ipcRenderer.invoke("application-update:install");
  },
  onApplicationUpdateState(callback) {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("application-update-state", listener);
    return () => ipcRenderer.removeListener("application-update-state", listener);
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
