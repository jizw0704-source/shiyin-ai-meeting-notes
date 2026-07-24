import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  powerSaveBlocker,
  Tray,
} from "electron";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(directory, "..");
const productionMode = app.isPackaged || process.argv.includes("--production");
const appRoot = app.isPackaged ? app.getAppPath() : sourceRoot;
const runtimeRoot = app.isPackaged ? app.getPath("userData") : sourceRoot;
const nodeEnvironment = {
  ...process.env,
  ELECTRON_RUN_AS_NODE: "1",
  SHIYIN_DATA_ROOT: app.isPackaged ? path.join(runtimeRoot, "data") : path.join(sourceRoot, "data"),
  SHIYIN_MODEL_PATH: app.isPackaged
    ? path.join(process.resourcesPath, "models", "speaker", "3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx")
    : path.join(sourceRoot, "models", "speaker", "3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx"),
};

let mainWindow = null;
let tray = null;
let quitting = false;
let powerBlockerId = null;
const managedServices = [];

app.setName("拾音 AI");
if (process.platform === "win32") app.setAppUserModelId("com.phenosola.shiyin");
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();

function trayIcon() {
  return nativeImage.createFromPath(path.join(appRoot, "build", "icon.ico")).resize({
    width: 20,
    height: 20,
  });
}

async function reachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1200) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitUntilReady(url, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await reachable(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

function spawnNode(script, args = [], extraEnvironment = {}) {
  const child = spawn(process.execPath, [script, ...args], {
    cwd: runtimeRoot,
    env: { ...nodeEnvironment, ...extraEnvironment },
    windowsHide: true,
    stdio: "ignore",
  });
  managedServices.push(child);
  return child;
}

async function ensureServices() {
  if (!await reachable("http://127.0.0.1:8788/health")) {
    spawnNode(path.join(appRoot, "server", "realtime-proxy.mjs"));
  }
  if (!await reachable("http://127.0.0.1:3000")) {
    spawnNode(
      path.join(appRoot, "node_modules", "vinext", "dist", "cli.js"),
      [productionMode ? "start" : "dev", "--hostname", "127.0.0.1"],
      { PORT: "3000" },
    );
  }
  const [backendReady, webReady] = await Promise.all([
    waitUntilReady("http://127.0.0.1:8788/health"),
    waitUntilReady("http://127.0.0.1:3000"),
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
      "百炼实时转写 · 本地发言人识别 · MiniMax 智能总结",
      "",
      "会议录音、逐字稿和声纹数据默认保存在本机。",
    ].join("\n"),
    buttons: ["确定"],
    defaultId: 0,
    noLink: true,
  });
}

function rebuildApplicationMenu() {
  const template = [
    {
      label: "文件",
      submenu: [
        { label: "打开主窗口", accelerator: "CmdOrCtrl+Shift+O", click: showWindow },
        { type: "separator" },
        { label: "退出拾音 AI", accelerator: "Alt+F4", click: quitApplication },
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
        { label: "切换全屏", role: "togglefullscreen", accelerator: "F11" },
        ...(!productionMode
          ? [{ type: "separator" }, { label: "开发者工具", role: "toggleDevTools", accelerator: "F12" }]
          : []),
      ],
    },
    {
      label: "帮助",
      submenu: [
        { label: "关于拾音 AI", click: showAbout },
      ],
    },
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
      label: "结束当前听记",
      click: () => mainWindow?.webContents.send("tray-command", "stop-recording"),
    },
    { type: "separator" },
    {
      label: "登录 Windows 后自动启动",
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1560,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    icon: path.join(appRoot, "build", "icon.ico"),
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
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
  mainWindow.loadURL(process.env.ELECTRON_START_URL || "http://127.0.0.1:3000");
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

ipcMain.on("recording-state", (_event, active) => {
  if (active && powerBlockerId === null) {
    powerBlockerId = powerSaveBlocker.start("prevent-app-suspension");
  } else if (!active && powerBlockerId !== null) {
    if (powerSaveBlocker.isStarted(powerBlockerId)) powerSaveBlocker.stop(powerBlockerId);
    powerBlockerId = null;
  }
});

app.on("second-instance", showWindow);
app.whenReady().then(async () => {
  try {
    await ensureServices();
    createWindow();
  } catch (error) {
    dialog.showErrorBox("拾音 AI 无法启动", error.message);
    quitting = true;
    app.quit();
  }
});
app.on("window-all-closed", () => {
  // Windows 托盘常驻：关闭窗口不结束会议或后台任务。
});
app.on("before-quit", () => {
  quitting = true;
  if (powerBlockerId !== null && powerSaveBlocker.isStarted(powerBlockerId)) {
    powerSaveBlocker.stop(powerBlockerId);
  }
  for (const service of managedServices) {
    if (!service.killed) service.kill();
  }
});
