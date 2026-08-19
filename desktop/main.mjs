import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  powerSaveBlocker,
  safeStorage,
  screen,
  session,
  shell,
  systemPreferences,
  Tray,
} from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { saveObsidianMeeting as writeObsidianMeeting } from "./obsidian-export.mjs";
import { findAvailableLocalPort } from "../server/local-port.mjs";

for (const file of [".env.local", ".env"]) {
  try { process.loadEnvFile?.(file); } catch { /* optional local env file */ }
}

app.setName("拾音 AI");
const userDataOverride = String(process.env.SHIYIN_USER_DATA_ROOT || "").trim();
if (userDataOverride) {
  app.setPath("userData", path.resolve(userDataOverride));
} else if (app.isPackaged) {
  app.setPath("userData", path.join(app.getPath("appData"), "拾音 AI"));
}

const directory = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(directory, "..");
const productionMode = app.isPackaged || process.argv.includes("--production");
const appRoot = app.isPackaged ? app.getAppPath() : sourceRoot;
const runtimeRoot = app.isPackaged ? app.getPath("userData") : sourceRoot;
const packagedWebRoot = app.isPackaged
  ? path.join(process.resourcesPath, "app.asar.unpacked")
  : runtimeRoot;
const settingsPath = path.join(runtimeRoot, "settings.json");
const dataFolderPath = path.join(runtimeRoot, "data");
const applicationIconPath = path.join(
  appRoot,
  "build",
  process.platform === "darwin" ? "icon.icns" : "icon.ico",
);
const nodeEnvironment = () => ({
  ...process.env,
  ELECTRON_RUN_AS_NODE: "1",
  SHIYIN_APP_VERSION: app.getVersion(),
  SHIYIN_DATA_ROOT: app.isPackaged ? path.join(runtimeRoot, "data") : path.join(sourceRoot, "data"),
  SHIYIN_MODEL_PATH: app.isPackaged
    ? path.join(process.resourcesPath, "models", "speaker", "3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx")
    : path.join(sourceRoot, "models", "speaker", "3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx"),
  SHIYIN_LOCAL_ASR_MODEL_DIR: app.isPackaged
    ? path.join(process.resourcesPath, "models", "asr")
    : path.join(sourceRoot, "models", "asr"),
  SHIYIN_PUNCTUATION_MODEL_PATH: app.isPackaged
    ? path.join(process.resourcesPath, "models", "punctuation", "model.int8.onnx")
    : path.join(sourceRoot, "models", "punctuation", "model.int8.onnx"),
});
const webHost = process.env.SHIYIN_WEB_HOST || "127.0.0.1";
const preferredWebPort = Number(process.env.SHIYIN_WEB_PORT || 3000);
let webPort = preferredWebPort;
let webUrl = `http://${webHost}:${webPort}`;
const backendPort = Number(process.env.ASR_PROXY_PORT || 8788);
const backendUrl = `http://127.0.0.1:${backendPort}`;
const openWindowShortcut = "Control+Alt+M";
const toggleRecordingShortcut = "Control+Alt+R";
const openWindowShortcutLabel = process.platform === "darwin" ? "⌃⌥M" : "Ctrl+Alt+M";
const toggleRecordingShortcutLabel = process.platform === "darwin" ? "⌃⌥R" : "Ctrl+Alt+R";

let mainWindow = null;
let tray = null;
let quitting = false;
let servicesReady = false;
let powerBlockerId = null;
let recordingActive = false;
let shortcutRegistration = { openWindow: false, toggleRecording: false };
const managedServices = [];

if (process.platform === "win32") app.setAppUserModelId("com.phenosola.shiyin");
const singleInstance = process.env.SHIYIN_ALLOW_MULTIPLE_INSTANCES === "1"
  || app.requestSingleInstanceLock();
if (!singleInstance) app.quit();

function trayIcon() {
  const icon = nativeImage.createFromPath(applicationIconPath).resize({
    width: 20,
    height: 20,
  });
  if (process.platform === "darwin") icon.setTemplateImage(true);
  return icon;
}

async function reachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1200) });
    return response.ok;
  } catch {
    return false;
  }
}

async function shiyinWebReady(url) {
  try {
    const response = await fetch(url, {
      headers: { Accept: "text/html" },
      signal: AbortSignal.timeout(1200),
    });
    if (!response.ok) return false;
    const html = await response.text();
    return /<title>拾音 AI(?:｜|<)/i.test(html);
  } catch {
    return false;
  }
}

async function backendHealth() {
  try {
    const response = await fetch(`${backendUrl}/health`, { signal: AbortSignal.timeout(1200) });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function backendCompatible() {
  const health = await backendHealth();
  return health?.service === "shiyin-ai-backend" && health.appOrigin === webUrl;
}

async function waitUntilReady(url, timeoutMs = 60000, checker = reachable) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await checker(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

async function postBackend(pathname, body) {
  const response = await fetch(`${backendUrl}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "本地后台操作失败");
  return result;
}

function spawnNode(script, args = [], extraEnvironment = {}, workingDirectory = runtimeRoot) {
  const child = spawn(process.execPath, [script, ...args], {
    cwd: workingDirectory,
    env: { ...nodeEnvironment(), ...extraEnvironment },
    windowsHide: true,
    stdio: "ignore",
  });
  managedServices.push(child);
  return child;
}

function readDesktopSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  } catch {
    return {};
  }
}

function writeDesktopSettings(settings) {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  const temporaryPath = `${settingsPath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, settingsPath);
}

function applyDesktopSettings() {
  const settings = readDesktopSettings();
  if (settings.miniMaxModel) process.env.MINIMAX_MODEL = String(settings.miniMaxModel);
  if (!settings.encryptedMiniMaxApiKey) return;
  try {
    process.env.MINIMAX_API_KEY = safeStorage.decryptString(
      Buffer.from(settings.encryptedMiniMaxApiKey, "base64"),
    );
  } catch {
    // A damaged or machine-bound credential is treated as unconfigured.
    delete process.env.MINIMAX_API_KEY;
  }
}

function publicMiniMaxSettings() {
  return {
    configured: Boolean(process.env.MINIMAX_API_KEY),
    model: process.env.MINIMAX_MODEL || "MiniMax-M2.7",
    managedByApp: app.isPackaged,
    storageLocation: settingsPath,
  };
}

function saveMiniMaxSettings(payload = {}) {
  const apiKey = String(payload.apiKey || "").trim();
  const model = String(payload.model || "MiniMax-M2.7").trim() || "MiniMax-M2.7";
  const existing = readDesktopSettings();
  if (!apiKey && !existing.encryptedMiniMaxApiKey && !process.env.MINIMAX_API_KEY) {
    throw new Error("请输入 MiniMax API Key");
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("当前系统暂时无法安全保存密钥，请稍后重试");
  }

  const next = {
    ...existing,
    miniMaxModel: model,
    ...(apiKey
      ? { encryptedMiniMaxApiKey: safeStorage.encryptString(apiKey).toString("base64") }
      : {}),
  };
  writeDesktopSettings(next);
  process.env.MINIMAX_MODEL = model;
  if (apiKey) process.env.MINIMAX_API_KEY = apiKey;
  return publicMiniMaxSettings();
}

function validObsidianVault(candidate) {
  if (!candidate) return null;
  const resolved = path.resolve(String(candidate));
  return fs.existsSync(resolved) && fs.existsSync(path.join(resolved, ".obsidian")) ? resolved : null;
}

function discoverObsidianVault() {
  const configPath = path.join(app.getPath("appData"), "obsidian", "obsidian.json");
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const candidates = Object.values(config.vaults || {})
      .filter((item) => validObsidianVault(item?.path))
      .sort((left, right) => (
        Number(Boolean(right.open)) - Number(Boolean(left.open))
        || Number(right.ts || 0) - Number(left.ts || 0)
      ));
    return validObsidianVault(candidates[0]?.path);
  } catch {
    return null;
  }
}

async function resolveObsidianVault(settings) {
  const configured = validObsidianVault(settings.obsidianVaultPath);
  if (configured) return configured;
  const discovered = discoverObsidianVault();
  if (discovered) return discovered;
  const selection = await dialog.showOpenDialog(mainWindow, {
    title: "选择 Obsidian Vault",
    defaultPath: app.getPath("documents"),
    message: "请选择包含 .obsidian 文件夹的 Obsidian Vault",
    buttonLabel: "使用这个 Vault",
    properties: ["openDirectory", "createDirectory"],
  });
  if (selection.canceled || !selection.filePaths[0]) return null;
  const selected = validObsidianVault(selection.filePaths[0]);
  if (!selected) throw new Error("所选文件夹不是 Obsidian Vault，请选择包含 .obsidian 的文件夹");
  return selected;
}

function publicNotebookSettings() {
  const vaultPath = validObsidianVault(readDesktopSettings().obsidianVaultPath);
  return {
    obsidianConfigured: Boolean(vaultPath),
    obsidianVaultName: vaultPath ? path.basename(vaultPath) : null,
  };
}

async function connectObsidianVault() {
  const selection = await dialog.showOpenDialog(mainWindow, {
    title: "连接 Obsidian AI 笔记本",
    defaultPath: app.getPath("documents"),
    message: "请选择包含 .obsidian 文件夹的 Obsidian Vault",
    buttonLabel: "连接这个 Vault",
    properties: ["openDirectory"],
  });
  if (selection.canceled || !selection.filePaths[0]) return { canceled: true, ...publicNotebookSettings() };
  const vaultPath = validObsidianVault(selection.filePaths[0]);
  if (!vaultPath) throw new Error("所选文件夹不是 Obsidian Vault，请选择包含 .obsidian 的文件夹");
  writeDesktopSettings({ ...readDesktopSettings(), obsidianVaultPath: vaultPath });
  return { canceled: false, ...publicNotebookSettings() };
}

async function ensureServices() {
  const preferredWebUrl = `http://${webHost}:${preferredWebPort}`;
  const reuseExistingWeb = await shiyinWebReady(preferredWebUrl);
  if (reuseExistingWeb) {
    webPort = preferredWebPort;
    webUrl = preferredWebUrl;
  } else {
    webPort = await findAvailableLocalPort({ host: webHost, preferredPort: preferredWebPort });
    webUrl = `http://${webHost}:${webPort}`;
  }

  const existingBackend = await backendHealth();
  if (existingBackend && !await backendCompatible()) {
    throw new Error("听记后台端口被其他程序占用，请退出旧版拾音 AI 后重试");
  }
  if (!existingBackend) {
    spawnNode(
      path.join(appRoot, "server", "realtime-proxy.mjs"),
      [],
      { SHIYIN_APP_ORIGIN: webUrl },
    );
  }
  if (!reuseExistingWeb) {
    if (productionMode) {
      spawnNode(
        path.join(appRoot, "server", "web-server.mjs"),
        [],
        { PORT: String(webPort), HOST: webHost },
        packagedWebRoot,
      );
    } else {
      spawnNode(
        path.join(appRoot, "node_modules", "vinext", "dist", "cli.js"),
        ["dev", "--hostname", webHost, "--port", String(webPort)],
        { PORT: String(webPort), HOST: webHost },
      );
    }
  }
  const [backendReady, webReady] = await Promise.all([
    waitUntilReady(`${backendUrl}/health`, 60000, backendCompatible),
    waitUntilReady(webUrl, 60000, shiyinWebReady),
  ]);
  if (!backendReady || !webReady) {
    throw new Error(`本地服务启动失败：${backendReady ? "" : "听记后台 "}${webReady ? "" : "界面服务"}`.trim());
  }
}

function showWindow() {
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.focus();
}

function sendWindowCommand(command) {
  showWindow();
  if (!mainWindow) return;
  if (mainWindow.webContents.isLoadingMainFrame()) {
    mainWindow.webContents.once("did-finish-load", () => mainWindow?.webContents.send("tray-command", command));
    return;
  }
  mainWindow.webContents.send("tray-command", command);
}

function toggleRecordingFromShortcut() {
  sendWindowCommand("toggle-recording");
}

function registerGlobalShortcuts() {
  globalShortcut.unregister(openWindowShortcut);
  globalShortcut.unregister(toggleRecordingShortcut);
  shortcutRegistration = {
    openWindow: globalShortcut.register(openWindowShortcut, showWindow),
    toggleRecording: globalShortcut.register(toggleRecordingShortcut, toggleRecordingFromShortcut),
  };
}

function quitApplication() {
  quitting = true;
  app.quit();
}

function showAbout() {
  dialog.showMessageBox(mainWindow, {
    type: "info",
    title: "关于拾音 AI",
    message: "拾音 AI",
    detail: [
      `版本 ${app.getVersion()}`,
      "本地实时转写 · 本地发言人识别 · MiniMax 智能总结",
      "",
      "会议录音、逐字稿和声纹数据默认保存在本机。",
    ].join("\n"),
    buttons: ["确定"],
    defaultId: 0,
    noLink: true,
  });
}

function openSettings() {
  sendWindowCommand("open-settings");
}

function rebuildApplicationMenu() {
  const template = [
    ...(process.platform === "darwin"
      ? [{
          label: app.name,
          submenu: [
            { label: "关于拾音 AI", click: showAbout },
            { type: "separator" },
            { role: "services" },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { role: "unhide" },
            { type: "separator" },
            { role: "quit" },
          ],
        }]
      : []),
    {
      label: "文件",
      submenu: [
        { label: `打开主窗口（${openWindowShortcutLabel}）`, click: showWindow },
        { label: `开始/结束听记（${toggleRecordingShortcutLabel}）`, click: toggleRecordingFromShortcut },
        { label: "设置…", accelerator: "CmdOrCtrl+,", click: openSettings },
        { type: "separator" },
        ...(process.platform === "darwin"
          ? [{ role: "close" }]
          : [{ label: "退出拾音 AI", accelerator: "Alt+F4", click: quitApplication }]),
      ],
    },
    {
      label: "编辑",
      submenu: [
        { label: "撤销", role: "undo", accelerator: "CmdOrCtrl+Z" },
        { label: "重做", role: "redo", accelerator: "CmdOrCtrl+Y" },
        { type: "separator" },
        { label: "剪切", role: "cut", accelerator: "CmdOrCtrl+X" },
        { label: "复制", role: "copy", accelerator: "CmdOrCtrl+C" },
        { label: "粘贴", role: "paste", accelerator: "CmdOrCtrl+V" },
        { label: "删除", role: "delete" },
        { type: "separator" },
        { label: "全选", role: "selectAll", accelerator: "CmdOrCtrl+A" },
      ],
    },
    {
      label: "视图",
      submenu: [
        { label: "重新加载", role: "reload", accelerator: "CmdOrCtrl+R" },
        { type: "separator" },
        { label: "恢复默认大小", role: "resetZoom", accelerator: "CmdOrCtrl+0" },
        { label: "放大", role: "zoomIn", accelerator: "CmdOrCtrl+=" },
        { label: "缩小", role: "zoomOut", accelerator: "CmdOrCtrl+-" },
        { type: "separator" },
        { label: "切换全屏", role: "togglefullscreen" },
        ...(!productionMode
          ? [{ type: "separator" }, { label: "开发者工具", role: "toggleDevTools", accelerator: "F12" }]
          : []),
      ],
    },
    ...(process.platform === "darwin"
      ? []
      : [{
          label: "帮助",
          submenu: [
            { label: "关于拾音 AI", click: showAbout },
          ],
        }]),
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function installChineseContextMenu(window) {
  window.webContents.on("context-menu", (_event, params) => {
    const template = [];
    if (params.isEditable) {
      template.push(
        { label: "撤销", role: "undo", enabled: params.editFlags.canUndo },
        { label: "重做", role: "redo", enabled: params.editFlags.canRedo },
        { type: "separator" },
        { label: "剪切", role: "cut", enabled: params.editFlags.canCut },
        { label: "复制", role: "copy", enabled: params.editFlags.canCopy },
        { label: "粘贴", role: "paste", enabled: params.editFlags.canPaste },
        { label: "删除", role: "delete", enabled: params.editFlags.canDelete },
        { type: "separator" },
        { label: "全选", role: "selectAll", enabled: params.editFlags.canSelectAll },
      );
    } else if (params.selectionText.trim()) {
      template.push(
        { label: "复制", role: "copy" },
        { type: "separator" },
        { label: "全选", role: "selectAll" },
      );
    } else {
      return;
    }
    Menu.buildFromTemplate(template).popup({ window });
  });
}

function loginSettings() {
  const pathValue = app.getPath("exe");
  const args = app.isPackaged ? [] : [path.join(directory, "main.mjs"), "--production"];
  return { path: pathValue, args };
}

function rebuildTrayMenu() {
  const options = loginSettings();
  const autoStart = app.getLoginItemSettings(options).openAtLogin;
  tray?.setContextMenu(Menu.buildFromTemplate([
    { label: "打开拾音 AI", click: showWindow },
    {
      label: recordingActive ? "结束当前听记" : "开始新听记",
      click: toggleRecordingFromShortcut,
    },
    { type: "separator" },
    {
      label: process.platform === "darwin" ? "登录时自动启动" : "登录 Windows 后自动启动",
      type: "checkbox",
      checked: autoStart,
      click: (item) => {
        app.setLoginItemSettings({ ...options, openAtLogin: item.checked });
        rebuildTrayMenu();
      },
    },
    { type: "separator" },
    {
      label: "退出",
      click: quitApplication,
    },
  ]));
}

function preferredWindowSize() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  return {
    width: Math.min(1500, Math.max(1040, Math.floor(width * 0.92))),
    height: Math.min(920, Math.max(720, Math.floor(height * 0.9))),
  };
}

function createWindow() {
  const initialSize = preferredWindowSize();
  mainWindow = new BrowserWindow({
    ...initialSize,
    minWidth: 940,
    minHeight: 680,
    center: true,
    show: false,
    icon: applicationIconPath,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    ...(process.platform === "darwin"
      ? {
          trafficLightPosition: { x: 18, y: 18 },
          vibrancy: "under-window",
          visualEffectState: "active",
        }
      : {}),
    ...(process.platform === "win32" ? { backgroundMaterial: "mica" } : {}),
    ...(process.platform !== "darwin"
      ? {
          titleBarOverlay: {
            color: "#00000000",
            symbolColor: "#434b5d",
            height: 44,
          },
        }
      : {}),
    backgroundColor: "#00000000",
    title: "拾音 AI",
    webPreferences: {
      preload: path.join(directory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  rebuildApplicationMenu();
  installChineseContextMenu(mainWindow);
  mainWindow.webContents.setUserAgent(
    mainWindow.webContents.getUserAgent().replaceAll("拾音AI", "ShiyinAI"),
  );
  mainWindow.loadURL(process.env.ELECTRON_START_URL || webUrl);
  mainWindow.once("ready-to-show", showWindow);
  mainWindow.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    mainWindow?.hide();
  });

  tray = new Tray(trayIcon());
  tray.setToolTip("拾音 AI 正在后台运行");
  tray.on("double-click", showWindow);
  rebuildTrayMenu();
}

function installDisplayMediaHandler() {
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 0, height: 0 },
      });
      const screen = sources[0];
      if (!screen) {
        callback({});
        return;
      }
      callback({
        video: screen,
        ...(request.audioRequested && process.platform === "win32" ? { audio: "loopback" } : {}),
      });
    } catch {
      callback({});
    }
  }, {
    // macOS 15+ uses the native picker, where the user explicitly chooses
    // the shared screen and whether its system audio is included.
    useSystemPicker: process.platform === "darwin",
  });
}

function macOSMajorVersion() {
  if (process.platform !== "darwin") return 0;
  const version = process.getSystemVersion?.() || "0";
  return Number.parseInt(version.split(".")[0], 10) || 0;
}

function audioCaptureCapabilities() {
  const nativeSystemAudioPicker = process.platform === "darwin" && macOSMajorVersion() >= 15;
  return {
    platform: process.platform,
    macOSVersion: process.platform === "darwin" ? process.getSystemVersion?.() || "" : "",
    nativeSystemAudioPicker,
    systemAudioSupported: process.platform === "win32" || nativeSystemAudioPicker,
    microphonePermission: process.platform === "darwin"
      ? systemPreferences.getMediaAccessStatus("microphone")
      : "granted",
    screenPermission: process.platform === "darwin"
      ? systemPreferences.getMediaAccessStatus("screen")
      : "granted",
  };
}

ipcMain.on("recording-state", (_event, active) => {
  recordingActive = Boolean(active);
  rebuildTrayMenu();
  if (active && powerBlockerId === null) {
    powerBlockerId = powerSaveBlocker.start("prevent-app-suspension");
  } else if (!active && powerBlockerId !== null) {
    if (powerSaveBlocker.isStarted(powerBlockerId)) powerSaveBlocker.stop(powerBlockerId);
    powerBlockerId = null;
  }
});

ipcMain.handle("audio-capture-capabilities", () => audioCaptureCapabilities());
ipcMain.handle("global-shortcuts:get", () => ({
  ...shortcutRegistration,
  openAccelerator: openWindowShortcut,
  recordingAccelerator: toggleRecordingShortcut,
  openLabel: openWindowShortcutLabel,
  recordingLabel: toggleRecordingShortcutLabel,
}));
ipcMain.handle("data-folder:open", async () => {
  fs.mkdirSync(dataFolderPath, { recursive: true });
  const error = await shell.openPath(dataFolderPath);
  if (error) throw new Error(error);
  return true;
});
ipcMain.handle("workspace-backup:create", async () => {
  const selection = await dialog.showOpenDialog(mainWindow, {
    title: "选择备份保存位置",
    defaultPath: app.getPath("documents"),
    buttonLabel: "保存到这里",
    properties: ["openDirectory", "createDirectory"],
  });
  if (selection.canceled || !selection.filePaths[0]) return { canceled: true };
  return {
    canceled: false,
    ...await postBackend("/api/backups/create", { destinationRoot: selection.filePaths[0] }),
  };
});
ipcMain.handle("workspace-backup:restore", async () => {
  const selection = await dialog.showOpenDialog(mainWindow, {
    title: "选择拾音 AI 备份文件夹",
    defaultPath: app.getPath("documents"),
    buttonLabel: "恢复此备份",
    properties: ["openDirectory"],
  });
  if (selection.canceled || !selection.filePaths[0]) return { canceled: true };
  return {
    canceled: false,
    ...await postBackend("/api/backups/restore", { backupPath: selection.filePaths[0] }),
  };
});
ipcMain.handle("obsidian:save-meeting", async (_event, payload = {}) => {
  const settings = readDesktopSettings();
  const vaultPath = await resolveObsidianVault(settings);
  if (!vaultPath) return { canceled: true };
  const meetingId = String(payload.meetingId || "");
  const previousRelativePath = settings.obsidianMeetingFiles?.[meetingId] || null;
  const result = await writeObsidianMeeting({
    vaultPath,
    existingRelativePath: previousRelativePath,
    meetingId,
    title: String(payload.title || "会议记录"),
    startedAt: String(payload.startedAt || new Date().toISOString()),
    markdown: String(payload.markdown || ""),
  });
  writeDesktopSettings({
    ...settings,
    obsidianVaultPath: vaultPath,
    obsidianMeetingFiles: {
      ...(settings.obsidianMeetingFiles || {}),
      [meetingId]: result.relativePath,
    },
  });
  if (payload.openAfterSave !== false) {
    const notePath = result.relativePath.replace(/\.md$/i, "");
    const url = `obsidian://open?vault=${encodeURIComponent(path.basename(vaultPath))}&file=${encodeURIComponent(notePath)}`;
    await shell.openExternal(url);
  }
  return { canceled: false, ...result };
});
ipcMain.handle("audio-privacy-settings:open", async (_event, kind) => {
  if (process.platform !== "darwin") return false;
  const privacyPane = kind === "microphone" ? "Privacy_Microphone" : "Privacy_ScreenCapture";
  await shell.openExternal(
    `x-apple.systempreferences:com.apple.preference.security?${privacyPane}`,
  );
  return true;
});
ipcMain.on("application:relaunch", () => {
  quitting = true;
  app.relaunch();
  app.exit(0);
});

ipcMain.handle("minimax-settings:get", () => publicMiniMaxSettings());
ipcMain.handle("minimax-settings:save", (_event, payload) => {
  const settings = saveMiniMaxSettings(payload);
  setTimeout(() => {
    app.relaunch();
    app.exit(0);
  }, 500);
  return settings;
});
ipcMain.handle("notebook-settings:get", () => publicNotebookSettings());
ipcMain.handle("notebook-settings:connect-obsidian", () => connectObsidianVault());

app.on("second-instance", showWindow);
app.on("activate", () => {
  // macOS keeps the process alive after Cmd+W; clicking the Dock icon should
  // always restore the existing meeting window.
  if (mainWindow) showWindow();
  else if (servicesReady) createWindow();
});
app.whenReady().then(async () => {
  try {
    nativeTheme.themeSource = "system";
    applyDesktopSettings();
    await ensureServices();
    servicesReady = true;
    installDisplayMediaHandler();
    if (!mainWindow) createWindow();
    registerGlobalShortcuts();
  } catch (error) {
    dialog.showErrorBox("拾音 AI 无法启动", error.message);
    quitting = true;
    app.quit();
  }
});
app.on("window-all-closed", () => {
  // Keep recording and post-processing alive in the tray on both platforms.
});
app.on("before-quit", () => {
  quitting = true;
  globalShortcut.unregisterAll();
  if (powerBlockerId !== null && powerSaveBlocker.isStarted(powerBlockerId)) {
    powerSaveBlocker.stop(powerBlockerId);
  }
  for (const service of managedServices) {
    if (!service.killed) service.kill();
  }
});
