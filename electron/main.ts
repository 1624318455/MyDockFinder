import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, desktopCapturer, nativeTheme } from "electron";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, hostname, totalmem, freemem, platform, arch, userInfo } from "node:os";
import { spawn } from "node:child_process";
import koffi from "koffi";
import { encodePs, runPsAsync } from "./ps.js";
import { getAppIconCached, getExeIconBase64Async, getIconsBatch, peekIcon } from "./icons.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV === "development";
let mainWindow: any = null, tray: any = null, settingsWindow: any = null;
const DOCK_BAR = 80; // dock 条厚度

const SETTINGS_PATH = join(app.getPath("userData"), "settings.json");
interface AppSettings {
  dockPosition: 'bottom' | 'top' | 'left' | 'right';
  iconSize: number; magnification: number; autoHide: boolean;
  showWindowPreview: boolean; showWeather: boolean;
  autoStart: boolean; minimizeAnimation: boolean; previewDelay: number; previewSize: number;
  pinnedApps?: Array<{ name: string; path: string; isFolder?: boolean; iconType?: string }>;
}
const DEFAULT_SETTINGS: AppSettings = {
  dockPosition: 'bottom', iconSize: 48, magnification: 1.15,
  autoHide: false, showWindowPreview: true,
  showWeather: true, autoStart: false, minimizeAnimation: false,
  previewDelay: 300, previewSize: 240,
};
let settings: AppSettings = { ...DEFAULT_SETTINGS };
try { settings = { ...DEFAULT_SETTINGS, ...JSON.parse(readFileSync(SETTINGS_PATH, "utf-8")) }; } catch {}


// 活跃应用集合：窗口曾可见的应用进入，进程退出才移除（进程退出才消失）
// key: 进程名小写, value: { name, path, windowTitle }
const activeApps = new Map<string, { name: string; path: string; windowTitle: string }>();
// running 缓存：getRunningApps 命中短缓存直接秒回（避免启动时等 2 次 PowerShell）
let runningCache: { ts: number; list: Array<{ id: string; name: string; path: string; icon: string; isRunning: boolean; isPinned: boolean; windowTitle: string }> } | null = null;
const RUNNING_CACHE_MS = 5000;
async function runRunningCheck(): Promise<void> {
  try {
    const excluded = new Set(["explorer", "shellexperiencehost", "searchhost", "dwm", "runtimebroker", "applicationframehost", "winlogon", "csrss", "smss", "lsass", "services", "svchost", "conhost", "textinputhost", "startmenuexperiencehost", "microsoft.edge", "msedgewebview2", "widgets", "securityhealthsystray", "sihost", "taskhostw", "taskhostex", "msofficebackground", "razerappengine", "nvidia overlay", "nvidia share", "overwolf", "qqliveservice", "heyboxchat"]);
    const visible = await getVisibleWindowProcesses();
    for (const v of visible) {
      const key = v.name.toLowerCase();
      if (excluded.has(key)) continue;
      if (!activeApps.has(key)) {
        activeApps.set(key, { name: v.name, path: v.path, windowTitle: v.title });
      } else {
        const ex = activeApps.get(key)!;
        ex.path = v.path;
        ex.windowTitle = v.title;
      }
    }
    const dead: string[] = [];
    if (activeApps.size > 0) {
      const names = Array.from(activeApps.keys());
      const q = names.map(n => "'" + n + "'").join(",");
      const aliveOut = await runPsAsync("Get-Process -Name @(" + q + ") -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProcessName | Sort-Object -Unique");

      const aliveSet = new Set<string>();
      aliveOut.split(/\r?\n/).forEach(nm => { const t = nm.trim().toLowerCase(); if (t) aliveSet.add(t); });
      for (const key of activeApps.keys()) {
        if (!aliveSet.has(key) && !visible.some(v => v.name.toLowerCase() === key)) dead.push(key);
      }
    }
    for (const k of dead) activeApps.delete(k);
    // 最小化检测：窗口从非最小化 → 最小化 → 触发飞入动画
    for (const v of visible) {
      detectAndAnimateMinimize(v);
    }
    // 更新缓存（图标已缓存则直接带上，前端首帧即真实图标）
    let i = 0;
    runningCache = {
      ts: Date.now(),
      list: Array.from(activeApps.values()).slice(0, 30).map((app) => ({
        id: "run-" + (i++),
        name: app.name,
        path: app.path,
        icon: app.path ? peekIcon(app.path) : "",
        isRunning: true,
        isPinned: false,
        windowTitle: app.windowTitle || "",
      })),
    };
  } catch { /* 保持旧缓存 */ }
}

function getDockBounds() {
  // 多显示器支持：Dock 跟随鼠标所在显示器（macOS 行为），坐标含显示器偏移
  let display = screen.getPrimaryDisplay();
  try {
    const mp = screen.getCursorScreenPoint();
    display = screen.getDisplayNearestPoint(mp);
  } catch {}
  const wa = display.workArea;
  const ox = wa.x, oy = wa.y;
  switch (settings.dockPosition) {
    case 'top': return { width: wa.width, height: DOCK_BAR, x: ox, y: oy };
    case 'left': return { width: DOCK_BAR, height: wa.height, x: ox, y: oy };
    case 'right': return { width: DOCK_BAR, height: wa.height, x: ox + wa.width - DOCK_BAR, y: oy };
    default: return { width: wa.width, height: DOCK_BAR, x: ox, y: oy + wa.height - DOCK_BAR };
  }
}

function createWindow() {
  const b = getDockBounds();
  mainWindow = new BrowserWindow({
    width: b.width, height: b.height, x: b.x, y: b.y,
    frame: false, transparent: true, resizable: false,
    skipTaskbar: true, alwaysOnTop: true, hasShadow: false, show: true,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false,
    },
  });
  if (isDev) mainWindow.loadURL("http://localhost:5173");
  else mainWindow.loadFile(join(__dirname, "../dist/index.html"));
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
}

function applySettings() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // dockPosition → 重新定位窗口
  const b = getDockBounds();
  mainWindow.setBounds({ ...b });
  // 通知渲染进程刷新设置
  mainWindow.webContents.send('settings-changed', settings);
}

function openSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 500, height: 620, minWidth: 460, minHeight: 520,
    frame: false, transparent: true, resizable: true,
    skipTaskbar: false, hasShadow: true, show: false,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  });
  if (isDev) settingsWindow.loadURL("http://localhost:5173/?page=settings");
  else settingsWindow.loadFile(join(__dirname, "../dist/index.html"), { query: { page: "settings" } });
  settingsWindow.once('ready-to-show', () => settingsWindow?.show());
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

function createTray(): void {
  const ip = join(__dirname, "../public/icon.png");
  const ti = existsSync(ip)
    ? nativeImage.createFromPath(ip).resize({ width: 16, height: 16 })
    : nativeImage.createFromBuffer(createPlaceholderIcon(), { width: 16, height: 16 });
  tray = new Tray(ti);
  tray.setToolTip("MyDockFinder");
  const trayMenu = Menu.buildFromTemplate([
    { label: "显示/隐藏 Dock", click: () => mainWindow?.isVisible() ? mainWindow.hide() : mainWindow.show() },
    { type: "separator" },
    { label: "设置...", click: () => openSettingsWindow() },
    { type: "separator" },
    { label: "关于 MyDockFinder", click: () => app.showAboutPanel() },
    { type: "separator" },
    { label: "退出", click: () => { app.quit(); } },
  ]);
  tray.setContextMenu(trayMenu);
  // Windows 保险：右键显式弹出
  tray.on("right-click", () => tray.popUpContextMenu(trayMenu));
}

function createPlaceholderIcon(): Buffer {
  const s = 16, buf = Buffer.alloc(s * s * 4);
  for (let i = 0; i < s * s; i++) {
    const x = i % s, y = Math.floor(i / s), c = s / 2;
    const a = Math.sqrt((x - c) ** 2 + (y - c) ** 2) < c ? 255 : 0;
    buf[i * 4] = 100; buf[i * 4 + 1] = 100; buf[i * 4 + 2] = 255; buf[i * 4 + 3] = a;
  }
  return buf;
}

async function getLnkTargetAsync(lnkPath: string): Promise<string> {
  const r = await runPsAsync(
    "$ws=New-Object -ComObject WScript.Shell; $s=$ws.CreateShortcut('" + lnkPath.replace(/'/g, "''") + "'); Write-Output $s.TargetPath"
  );
  return r || "";
}

async function resolveTargetPathAsync(appPath: string): Promise<string> {
  if (appPath.toLowerCase().endsWith(".lnk")) {
    const t = await getLnkTargetAsync(appPath);
    if (t) return t;
  }
  return appPath;
}

async function resolveExeNameAsync(appPath: string): Promise<string> {
  const t = await resolveTargetPathAsync(appPath);
  return basename(t).replace(/\.exe$/i, "").toLowerCase();
}

// 检测应用是否已有窗口，有则聚焦（恢复+置前）；异步不阻塞主进程，超时 4s
function focusExistingWindow(exeName: string): Promise<boolean> {
  return new Promise(resolve => {
    if (!exeName) return resolve(false);
    const script = [
      '$p = Get-Process -Name "' + exeName + '" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1;',
      'if ($p) {',
      "  Add-Type @'",
      'using System;',
      'using System.Runtime.InteropServices;',
      'public class FW {',
      '  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);',
      '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);',
      '}',
      "'@;",
      '  [FW]::ShowWindow($p.MainWindowHandle, 9);',
      '  [FW]::SetForegroundWindow($p.MainWindowHandle);',
      '  Write-Output "FOCUSED";',
      '}',
    ].join('\n');
    const encoded = encodePs(script);
    const child = spawn("powershell", ["-NoProfile", "-EncodedCommand", encoded], { stdio: ["pipe", "pipe", "ignore"] });
    let out = "";
    child.stdout?.on("data", (d: Buffer) => { out += d.toString(); });
    const timer = setTimeout(() => { child.kill(); resolve(false); }, 4000);
    child.on("error", () => { clearTimeout(timer); resolve(false); });
    child.on("close", () => { clearTimeout(timer); resolve(out.includes("FOCUSED")); });
  });
}

// 通过 cmd start 启动（detached + unref，不阻塞主进程、不等待退出）
function startProcessDetached(cmdLine: string): boolean {
  try {
    spawn("cmd.exe", ["/c", cmdLine], { detached: true, stdio: "ignore" }).unref();
    return true;
  } catch { return false; }
}

// 统一启动应用：已运行则聚焦复用，否则新开（shell: 走 explorer.exe）
async function launchApp(appPath: string): Promise<{ success: boolean; focused: boolean }> {
  try {
    const exeName = await resolveExeNameAsync(appPath);
    if (exeName && await focusExistingWindow(exeName)) {
      return { success: true, focused: true };
    }
    if (appPath.toLowerCase().startsWith("shell:")) {
      spawn("explorer.exe", [appPath], { detached: true, stdio: "ignore" }).unref();
    } else {
      startProcessDetached('start "" "' + appPath + '"');
    }
    return { success: true, focused: false };
  } catch {
    try { spawn(appPath, [], { detached: true, stdio: "ignore" }).unref(); return { success: true, focused: false }; }
    catch { return { success: false, focused: false }; }
  }
}


ipcMain.handle("get-app-icons-batch", async (e, paths: string[]) => {
  if (!Array.isArray(paths)) return {};
  return getIconsBatch(paths.slice(0, 40));
});

function getStartMenuApps(): Array<{name:string;path:string;icon:string}> {
  const apps: Array<{name:string;path:string;icon:string}> = [];
  const seen = new Set();
  const skipDirs = ["Accessories","Accessibility","System Tools","Administrative Tools","Windows PowerShell","Windows System","Windows Administrative Tools","Startup","PowerShell 7"];
  const skipWords = ["unins","uninst","Uninstall","Help","Feedback","Readme","desktop.ini","OneDrive"];
  const dirs = [
    join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs"),
    join(process.env.ALLUSERSPROFILE || "C:\\ProgramData", "Microsoft", "Windows", "Start Menu", "Programs"),
  ];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    const scan = (d: string, depth: number): void => {
      if (depth > 2) return;
      let items;
      try { items = readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const item of items) {
        const fp = join(d, item.name);
        if (item.isDirectory()) { if (!skipDirs.includes(item.name)) scan(fp, depth + 1); }
        else if (item.name.endsWith(".lnk")) {
          const name = item.name.replace(".lnk", "");
          if (!seen.has(name) && !skipWords.some(k => name.includes(k)) && name.length >= 3) {
            seen.add(name);
            apps.push({ name, path: fp, icon: "" });
          }
        }
      }
    };
    scan(dir, 0);
  }
  return apps;
}

// IPC Handlers
ipcMain.handle("get-all-apps", async () => getStartMenuApps().slice(0, 60).map((a,i) => ({...a, id: "app-"+i})));
ipcMain.handle("get-app-icon", async (e, p) => getExeIconBase64Async(p));

// 枚举当前所有【可见窗口】的进程 — koffi 原生（user32.dll 直接调用，~3ms，零 PowerShell）
// ===== koffi Win32 声明（模块级，只初始化一次） =====
const _u32 = koffi.load('user32.dll');
const _k32 = koffi.load('kernel32.dll');
const _DWORD = koffi.alias('DWORD', 'uint32_t');
const _BOOL = koffi.alias('BOOL', 'int32_t');
const _INT = koffi.alias('INT', 'int32_t');
const _HWND = koffi.pointer('HWND', koffi.opaque());
const _LONG = koffi.alias('LONG', 'int32_t');
const _RECT = koffi.struct('RECT', { left: _LONG, top: _LONG, right: _LONG, bottom: _LONG });
const _HANDLE = koffi.pointer('HANDLE', koffi.opaque());
const _WNDENUMPROC = koffi.proto('bool __stdcall WNDENUMPROC(intptr hwnd, intptr lParam)');
const _CallbackPtr = koffi.pointer(_WNDENUMPROC);
const _EnumWindows = _u32.func('EnumWindows', 'bool', [_CallbackPtr, 'intptr']);
const _IsWindowVisible = _u32.func('BOOL __stdcall IsWindowVisible(HWND hWnd)');
const _IsIconic = _u32.func('BOOL __stdcall IsIconic(HWND hWnd)');
const _GetWindowTextLengthW = _u32.func('INT __stdcall GetWindowTextLengthW(HWND hWnd)');
const _GetWindowTextW = _u32.func('INT __stdcall GetWindowTextW(HWND hWnd, _Out_ char16_t *lpString, INT nMaxCount)');
const _GetWindowThreadProcessId = _u32.func('DWORD __stdcall GetWindowThreadProcessId(HWND hWnd, _Out_ DWORD *lpdwProcessId)');
const _GetWindowRect = _u32.func('BOOL __stdcall GetWindowRect(HWND hWnd, _Out_ RECT *lpRect)');
const _OpenProcess = _k32.func('HANDLE __stdcall OpenProcess(DWORD dwDesiredAccess, BOOL bInheritHandle, DWORD dwProcessId)');
const _QueryFullProcessImageNameW = _k32.func('BOOL __stdcall QueryFullProcessImageNameW(HANDLE hProcess, DWORD dwFlags, _Out_ char16_t *lpExeName, _Inout_ DWORD *lpdwSize)');
const _CloseHandle = _k32.func('BOOL __stdcall CloseHandle(HANDLE hObject)');
const _PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
function _koffiGetProcessPath(pid: number): string {
  try {
    const h = _OpenProcess(_PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
    if (!h) return '';
    try {
      const sizePtr = [1024];
      const buf = Buffer.allocUnsafe(1024 * 2);
      const ok = _QueryFullProcessImageNameW(h, 0, buf, sizePtr);
      if (ok && sizePtr[0] > 0) return koffi.decode(buf, 'char16_t', sizePtr[0]);
      return '';
    } finally { _CloseHandle(h); }
  } catch { return ''; }
}
function enumVisibleWindowsKoffi(): Array<{ hwnd: number; pid: number; path: string; title: string; minimized: boolean; left: number; top: number; right: number; bottom: number }> {
  // 每次枚举都重新 register（回调闭包捕获当次 wins），用完 unregister
  const wins: Array<{ hwnd: number; pid: number; path: string; title: string; minimized: boolean; left: number; top: number; right: number; bottom: number }> = [];
  const cb = koffi.register((hwnd: any, _lParam: any) => {
    if (!_IsWindowVisible(hwnd)) return true;
    const len = _GetWindowTextLengthW(hwnd);
    if (len <= 0) return true;
    let title = '';
    try {
      const buf = Buffer.allocUnsafe((len + 1) * 2);
      const n = _GetWindowTextW(hwnd, buf, len + 1);
      if (n > 0) title = koffi.decode(buf, 'char16_t', n);
    } catch { title = ''; }
    let pid = 0;
    try {
      const ptr = [null];
      _GetWindowThreadProcessId(hwnd, ptr);
      pid = ptr[0] || 0;
    } catch {}
    const rect = { left: 0, top: 0, right: 0, bottom: 0 };
    try { _GetWindowRect(hwnd, rect); } catch {}
    const path = _koffiGetProcessPath(pid);
    wins.push({ hwnd: Number(hwnd), pid, path, title, minimized: _IsIconic(hwnd), left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
    return true;
  }, _CallbackPtr);
  try {
    _EnumWindows(cb, 0);
  } catch { /* ignore */ }
  koffi.unregister(cb);
  return wins;
}

async function getVisibleWindowProcesses(): Promise<Array<{ hwnd?: number; name: string; path: string; title: string; minimized?: boolean; rect?: { left: number; top: number; right: number; bottom: number } }>> {
  try {
    const wins = enumVisibleWindowsKoffi();
    return wins.map((w) => {
      // 进程名：从路径取 basename 去扩展名；无路径则用 pid 兜底
      let name = '';
      if (w.path) {
        const base = w.path.replace(/\\/g, '/').split('/').pop() || '';
        name = base.replace(/\.exe$/i, '');
      }
      if (!name) name = 'proc' + w.pid;
      return {
        hwnd: w.hwnd,
        name,
        path: w.path,
        title: w.title,
        minimized: w.minimized,
        rect: { left: w.left, top: w.top, right: w.right, bottom: w.bottom },
      };
    });
  } catch { return []; }
}

// ===== 窗口最小化飞入动画 =====
// 记录窗口的最小化状态历史（hwnd -> {wasMinimized, lastRect}），避免重复触发 + 记住非最小化时的位置
const minimizeSeen = new Map<number, { wasMinimized: boolean; lastRect?: { left: number; top: number; right: number; bottom: number } }>();
// 动画窗口引用（同时只播一个）
let minimizeAnimWin: BrowserWindow | null = null;

function detectAndAnimateMinimize(v: { hwnd?: number; name: string; path: string; title: string; minimized?: boolean; rect?: { left: number; top: number; right: number; bottom: number } }) {
  if (!v.hwnd) return;
  const prev = minimizeSeen.get(v.hwnd);
  if (!v.minimized) {
    // 窗口恢复/可见 → 记录位置 + 重置标记，下次最小化可再次触发
    minimizeSeen.set(v.hwnd, { wasMinimized: false, lastRect: v.rect });
    return;
  }
  // 最小化：若上次可见，用上次的 rect 作为动画起点
  if (prev && !prev.wasMinimized) {
    const animRect = prev.lastRect;
    minimizeSeen.set(v.hwnd, { wasMinimized: true, lastRect: v.rect });
    playMinimizeAnimation({ ...v, rect: animRect });
    return;
  }
  if (!prev) {
    minimizeSeen.set(v.hwnd, { wasMinimized: true, lastRect: v.rect });
    // 首次见到就最小化（如启动时已最小化）→ 不触发
    return;
  }
  minimizeSeen.set(v.hwnd, { wasMinimized: true, lastRect: v.rect });
}

// 播放飞入动画：应用图标从窗口原位置飞到屏幕底部中央（Dock 位置）
async function playMinimizeAnimation(v: { name: string; path: string; rect?: { left: number; top: number; right: number; bottom: number } }) {
  try {
    if (minimizeAnimWin && !minimizeAnimWin.isDestroyed()) minimizeAnimWin.destroy();
    const wa = (() => {
      try { return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea; }
      catch { return screen.getPrimaryDisplay().workArea; }
    })();
    // 起点：窗口原位置中心
    const r = v.rect;
    const sx = r && r.right > r.left ? (r.left + r.right) / 2 : wa.width / 2;
    const sy = r && r.bottom > r.top ? (r.top + r.bottom) / 2 : wa.height / 2;
    // 终点：屏幕底部中央（Dock 位置）
    const ex = wa.x + wa.width / 2;
    const ey = wa.y + wa.height - 20;

    // 取应用图标（复用图标缓存，返回完整 dataUrl）
    const iconDataUrl = await getAppIconCached(v.path || v.name + ".exe");

    // 创建透明动画窗口（覆盖全屏，仅绘制飞行图标）
    const win = new BrowserWindow({
      width: wa.width, height: wa.height,
      x: wa.x, y: wa.y,
      transparent: true, frame: false, resizable: false,
      alwaysOnTop: true, skipTaskbar: true,
      hasShadow: false, focusable: false,
      webPreferences: { sandbox: true },
      show: false,
    });
    minimizeAnimWin = win;
    const html = `<!DOCTYPE html><html><head><style>
      html,body{margin:0;padding:0;overflow:hidden;background:transparent;width:100%;height:100%;}
      #fly{position:absolute;width:60px;height:60px;border-radius:14px;background:rgba(255,255,255,0.9);
        box-shadow:0 8px 24px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;
        overflow:hidden;transform:translate(-50%,-50%);transition:all 0.42s cubic-bezier(0.22,1,0.36,1);}
      #fly img{width:44px;height:44px;object-fit:contain;}
    </style></head><body>
      <div id="fly" style="left:${sx - wa.x}px;top:${sy - wa.y}px;opacity:1;">
        ${iconDataUrl ? '<img src="' + iconDataUrl + '">' : '<span style="font-size:28px;opacity:0.5;">⬜</span>'}
      </div>
    </body></html>`;
    await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    win.showInactive();
    // 动画：飞到 Dock 中心并缩小淡出
    win.webContents.executeJavaScript(`
      (function(){
        var el = document.getElementById('fly');
        el.style.left = '${ex - wa.x}px';
        el.style.top = '${ey - wa.y}px';
        el.style.width = '36px';
        el.style.height = '36px';
        el.style.opacity = '0';
      })();
    `);
    setTimeout(() => { if (!win.isDestroyed()) win.destroy(); }, 520);
  } catch { }
}


ipcMain.handle("get-running-apps", async () => {
  // 缓存命中（<5s）直接秒回，避免启动时等 2 次 PowerShell
  if (runningCache && Date.now() - runningCache.ts < RUNNING_CACHE_MS) {
    return runningCache.list;
  }
  await runRunningCheck();
  if (runningCache) return runningCache.list;
  return [];
});

ipcMain.handle("open-app", async (e, appPath) => launchApp(appPath));

// get-folder-contents（含图片缩略图预览）
const IMAGE_EXT = [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".ico", ".svg"];

function isImageFile(name: string): boolean {
  const ext = name.toLowerCase().substring(name.lastIndexOf("."));
  return IMAGE_EXT.includes(ext);
}

function getThumbnail(filePath: string): string {
  try {
    if (!isImageFile(filePath)) return "";
    const st = statSync(filePath);
    if (st.size > 300 * 1024) return ""; // 超大图不读
    const buf = readFileSync(filePath);
    const ext = filePath.toLowerCase().substring(filePath.lastIndexOf(".") + 1);
    return "data:image/" + (ext === "svg" ? "svg+xml" : ext) + ";base64," + buf.toString("base64");
  } catch { return ""; }
}

ipcMain.handle("get-folder-contents", async (e, fp) => {
  if (!existsSync(fp)) return [];
  return readdirSync(fp, { withFileTypes: true }).slice(0, 100).map(item => {
    try {
      const full = join(fp, item.name);
      const s = statSync(full);
      return {
        name: item.name,
        path: full,
        isDirectory: item.isDirectory(),
        size: s.size,
        thumbnail: item.isDirectory() ? "" : getThumbnail(full),
      };
    } catch { return null; }
  }).filter(Boolean);
});

ipcMain.handle("should-use-dark-colors", () => {
  return nativeTheme.shouldUseDarkColors;
});

// get-system-info（CPU/OSName 并行异步获取，不阻塞主进程）
ipcMain.handle("get-system-info", async () => {
  const [cpuOut, osOut] = await Promise.all([
    runPsAsync("Get-CimInstance Win32_Processor | Select-Object -ExpandProperty LoadPercentage"),
    runPsAsync("(Get-CimInstance Win32_OperatingSystem).Caption"),
  ]);
  return {
    hostname: hostname(), platform: platform(), arch: arch(), homeDir: homedir(),
    userName: userInfo().username,
    cpu: parseInt(cpuOut) || 0,
    osName: osOut || "Windows",
    memory: { total: totalmem(), free: freemem(), used: totalmem() - freemem() },
  };
});

ipcMain.handle("get-window-thumbnails", async () => {
  try {
    const sources = await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: 240, height: 180 }, fetchWindowIcons: true });
    return sources.slice(0, 30).map(s => ({ id: s.id, name: s.name, appIcon: s.appIcon ? s.appIcon.toDataURL() : "", thumbnail: s.thumbnail.toDataURL() }));
  } catch { return []; }
});

// ===== 系统图标库（原版：右键 Dock 空白区添加） =====
const SYSTEM_ICONS: Array<{ type: string; label: string; path: string; isFolder: boolean }> = [
  { type: 'trash', label: '回收站', path: 'shell:RecycleBinFolder', isFolder: false },
  { type: 'downloads', label: '下载', path: '', isFolder: true },
  { type: 'documents', label: '文档', path: '', isFolder: true },
  { type: 'pictures', label: '图片', path: '', isFolder: true },
  { type: 'music', label: '音乐', path: '', isFolder: true },
  { type: 'videos', label: '视频', path: '', isFolder: true },
  { type: 'computer', label: '此电脑', path: 'shell:MyComputerFolder', isFolder: false },
  { type: 'weather', label: '天气', path: '', isFolder: false },
];

function systemIconPath(type: string): string {
  const h = homedir();
  switch (type) {
    case 'downloads': return join(h, 'Downloads');
    case 'documents': return join(h, 'Documents');
    case 'pictures': return join(h, 'Pictures');
    case 'music': return join(h, 'Music');
    case 'videos': return join(h, 'Videos');
    default: return '';
  }
}

ipcMain.handle("get-system-icons", async () => SYSTEM_ICONS);

// 拖放辅助：判断拖入路径是文件还是文件夹
ipcMain.handle("inspect-dropped-path", async (e, path: string) => {
  try {
    const st = statSync(path);
    return { name: basename(path), path, isFolder: st.isDirectory(), exists: true };
  } catch {
    return { name: basename(path), path, isFolder: false, exists: false };
  }
});

// 打开任意路径（文件用默认程序，文件夹用资源管理器，shell: 用 explorer）
ipcMain.handle("open-path", async (e, path: string) => {
  try {
    if (path.startsWith("shell:")) {
      // explorer.exe 支持 shell: URI（cmd start 不支持）
      spawn("explorer.exe", [path], { detached: true, stdio: "ignore" }).unref();
      return { success: true };
    }
    startProcessDetached('start "" "' + path + '"');
    return { success: true };
  } catch { return { success: false }; }
});

ipcMain.handle("add-system-icon", async (e, type: string) => {
  const def = SYSTEM_ICONS.find(s => s.type === type);
  if (!def) return [];
  const list = getPinnedApps();
  if (list.some(a => a.name === def.label)) return list;
  const next = [...list, {
    name: def.label,
    path: def.path || systemIconPath(type),
    isFolder: def.isFolder,
    iconType: type,
  }];
  savePinnedApps(next);
  return next;
});

// ===== Pinned apps CRUD（用户手动固定，持久化到 settings.json） =====
const PINNED_KEY = "pinnedApps";

function getPinnedApps(): Array<{ name: string; path: string; isFolder?: boolean; iconType?: string }> {
  const arr = (settings as any)[PINNED_KEY];
  return Array.isArray(arr) ? arr : [];
}

function savePinnedApps(list: Array<{ name: string; path: string; isFolder?: boolean; iconType?: string }>): void {
  settings = { ...settings, [PINNED_KEY]: list };
  try { writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf-8"); } catch {}
  // 广播到主窗口刷新
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("pinned-apps-changed", list);
  }
}

ipcMain.handle("get-pinned-apps", async () => getPinnedApps());

ipcMain.handle("pin-app", async (e, app: { name: string; path: string; isFolder?: boolean; iconType?: string }) => {
  const list = getPinnedApps();
  if (!app || !app.name) return list;
  if (list.some(a => a.name.toLowerCase() === app.name.toLowerCase())) return list;
  const next = [...list, { name: app.name, path: app.path || "", isFolder: !!app.isFolder, iconType: app.iconType || (app.isFolder ? 'folder' : 'app') }];
  savePinnedApps(next);
  return next;
});

ipcMain.handle("unpin-app", async (e, name: string) => {
  const list = getPinnedApps().filter(a => a.name.toLowerCase() !== String(name).toLowerCase());
  savePinnedApps(list);
  return list;
});

ipcMain.handle("get-settings", async () => settings);
ipcMain.handle("set-settings", async (e, s) => {
  settings = { ...settings, ...s };
  try { writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf-8"); } catch {}
  // 开机自启
  try {
    app.setLoginItemSettings({ openAtLogin: settings.autoStart, path: process.execPath });
  } catch {}
  // 应用设置（重定位等）
  applySettings();
  return settings;
});

ipcMain.handle("get-weather", async () => {
  const r = await runPsAsync("try { $wc=New-Object System.Net.WebClient; $wc.Headers.Add('User-Agent','curl/7.0'); $d=$wc.DownloadString('https://wttr.in/?format=%25C+%25t&lang=zh'); if($d){ Write-Output $d } } catch {}");
  if (r) {
    const p = r.split(" "); const cond = p[0] || ""; const temp = p.slice(1).join(" ").replace("+","");
    return { temp, condition: cond, icon: "🌤️" };
  }
  return { temp: "--", condition: "未知", icon: "🌤️" };
});

ipcMain.handle("get-battery-info", async () => {
  const r = await runPsAsync("$b=Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue; if($b){ Write-Output ('{\"level\":'+$b.EstimatedChargeRemaining+',\"charging\":true}') } else { Write-Output '{\"level\":100,\"charging\":true}' }");
  if (r) try { return JSON.parse(r); } catch {}
  return { level: 100, charging: true };
});

// ===== 消息角标检测（Windows 混合方案：标题解析优先 + UIA 兜底） =====
// 白名单：常见聊天/通讯应用（进程名，不含扩展名）
const BADGE_APPS = ['WeChat', 'Weixin', 'QQ', 'TIM', 'DingTalk', 'Telegram', 'Discord', 'Feishu', 'Slack'];
// UIA 结果缓存 30s：避免每次轮询都跑慢速 UIA
let uiaBadgeCache: { [name: string]: { count: number; ts: number } } = {};

// 标题解析：微信「微信(3)」/ 旧QQ「QQ(12)」/ 钉钉 等括号内数字
function parseBadgeFromTitle(title: string): number {
  if (!title) return 0;
  // 括号数字：(3) （3） [3] 【3】 — 排除年份 19xx/20xx
  const m = title.match(/[（(]\s*(\d{1,4})\s*[)）]/) || title.match(/[【[]\s*(\d{1,4})\s*[】\]]/);
  if (m) {
    const v = parseInt(m[1], 10);
    if (v >= 1900 && v <= 2100) return 0; // 排除年份
    return v;
  }
  return 0;
}

// UIA 兜底：对单个应用进程跑 UIA 找未读数字元素（runPsAsync 异步执行，不阻塞主进程）
async function runUiaBadge(appName: string): Promise<number> {
  const script = [
    "Add-Type -AssemblyName UIAutomationClient;",
    "Add-Type -AssemblyName UIAutomationTypes;",
    "$p = Get-Process -Name '" + appName + "' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1;",
    "if (-not $p) { Write-Output '0'; exit };",
    "$el = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle);",
    "if (-not $el) { Write-Output '0'; exit };",
    "$max = 0;",
    "$all = $el.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition);",
    "foreach ($e in $all) {",
    "  $n = $e.Current.Name;",
    "  if ($n -and $n -match '^\\d{1,4}" + "') {",
    "    $v = [int]$n;",
    "    if ($v -gt 1900 -and $v -lt 2100) { continue };",
    "    if ($v -gt $max) { $max = $v };",
    "  }",
    "}",
    "Write-Output $max",
  ].join('\n');
  const r = await runPsAsync(script);
  const v = parseInt(r, 10);
  return isNaN(v) ? 0 : v;
}

ipcMain.handle("get-notification-counts", async () => {
  try {
    // 1) 批量拿白名单进程的标题（一次查询，快）
    const names = BADGE_APPS.join("','");
    const script = "$ProgressPreference='SilentlyContinue'; $r=@(); foreach($n in @('" + names + "')){ $p=Get-Process -Name $n -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1; if($p){ $r += [PSCustomObject]@{ name=$n; running=$true; title=$p.MainWindowTitle } } else { $r += [PSCustomObject]@{ name=$n; running=$false; title='' } } }; ConvertTo-Json $r -Compress";
    const out = await runPsAsync(script);
    const list = out ? JSON.parse(out) : [];
    const arr = Array.isArray(list) ? list : [list];

    const result: Array<{ name: string; count: number }> = [];
    const now = Date.now();
    for (const app of arr) {
      if (!app || !app.name) continue;
      let count = parseBadgeFromTitle(app.title);
      if (count === 0 && app.running) {
        // 2) 标题没读到 → UIA 兜底（30s 缓存）
        const key = app.name;
        const cached = uiaBadgeCache[key];
        if (cached && now - cached.ts < 30000) {
          count = cached.count;
        } else {
          count = await runUiaBadge(app.name);
          uiaBadgeCache[key] = { count, ts: now };
        }
      }
      result.push({ name: app.name, count });
    }
    return result;
  } catch { return []; }
});

// 任务进度：轮询可见窗口标题中的百分比（复制文件/下载/播放器等标题带 % 的应用）
ipcMain.handle("get-task-progress", async () => {
  try {
    const script = [
      "Add-Type @'",
      "using System;",
      "using System.Text;",
      "using System.Collections.Generic;",
      "using System.Runtime.InteropServices;",
      "public class ProgEnum {",
      '  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lp);',
      '  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);',
      '  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder t, int c);',
      '  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);',
      '  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);',
      '  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);',
      "  public static List<object> GetTitles() {",
      "    var list = new List<object>();",
      "    EnumWindows((h, l) => {",
      "      if (IsWindowVisible(h)) {",
      "        int len = GetWindowTextLength(h);",
      "        if (len > 0) {",
      "          var sb = new StringBuilder(len + 1);",
      "          GetWindowText(h, sb, len + 1);",
      "          uint pid;",
      "          GetWindowThreadProcessId(h, out pid);",
      "          list.Add(new { pid = pid, title = sb.ToString() });",
      "        }",
      "      }",
      "      return true;",
      "    }, IntPtr.Zero);",
      "    return list;",
      "  }",
      "}",
      "'@;",
      "$wins = [ProgEnum]::GetTitles();",
      "if ($wins.Count -eq 0) { Write-Output '[]'; exit; }",
      "$result = @();",
      "foreach ($w in $wins) {",
      "  if ($w.title -match '(\\d{1,3})\\s*%') {",
      "    $proc = Get-Process -Id $w.pid -ErrorAction SilentlyContinue;",
      "    if ($proc) {",
      "      $pct = [int]$Matches[1];",
      "      if ($pct -ge 0 -and $pct -le 100) {",
      "        $result += [PSCustomObject]@{ Name = $proc.ProcessName; Percent = $pct; Title = $w.title };",
      "      }",
      "    }",
      "  }",
      "}",
      "if ($result.Count -eq 0) { Write-Output '[]'; exit; }",
      "ConvertTo-Json $result -Compress",
    ].join('\n');
    const r = await runPsAsync(script);
    if (!r || r === "[]" || r === "null") return [];
    const parsed = JSON.parse(r);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    // 同名进程取最大进度
    const byName = new Map<string, number>();
    for (const item of list) {
      if (item && item.Name && typeof item.Percent === 'number') {
        const name = item.Name.toLowerCase();
        const prev = byName.get(name) || 0;
        if (item.Percent > prev) byName.set(name, item.Percent);
      }
    }
    return Array.from(byName.entries()).map(([name, percent]) => ({ name, percent }));
  } catch { return []; }
});
ipcMain.handle("auto-hide-dock", async () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide(); });
ipcMain.handle("show-dock", async () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show(); });
ipcMain.handle("app-context-menu", async (e, item) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return;
  // 渲染进程传来的屏幕坐标（缺省用当前鼠标位置）
  const pos = item.__pos || {};
  const template: any[] = [
    { label: "打开", click: () => { launchApp(item.path); } },
    { label: "打开文件位置", click: () => {
        resolveTargetPathAsync(item.path).then(target => {
          if (target) spawn("explorer.exe", ["/select," + target], { detached: true, stdio: "ignore" }).unref();
        });
      } },
  ];
  if (item.isPinned) {
    // 已固定：可从 Dock 移除（主进程直接处理 + 广播）
    template.push({ type: "separator" });
    template.push({ label: "从 Dock 移除", click: () => {
        const list = getPinnedApps().filter(a => a.name.toLowerCase() !== String(item.name).toLowerCase());
        savePinnedApps(list);
      } });
  } else {
    // 未固定：固定到 Dock
    template.push({ type: "separator" });
    template.push({ label: "固定到 Dock", click: () => {
        const list = getPinnedApps();
        if (!list.some(a => a.name.toLowerCase() === String(item.name).toLowerCase())) {
          savePinnedApps([...list, { name: String(item.name), path: String(item.path) }]);
        }
      } });
  }
  const menu = Menu.buildFromTemplate(template);
  // 显式指定弹出位置，避免透明窗口 popup 位置异常
  menu.popup({
    window: win,
    x: Math.round(pos.x ?? 0),
    y: Math.round(pos.y ?? 0),
  });
});

ipcMain.handle("dock-background-menu", async (e, pos) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return;
  const menu = Menu.buildFromTemplate([
    {
      label: "添加系统图标",
      submenu: SYSTEM_ICONS.map(s => ({
        label: s.label,
        click: () => {
          const list = getPinnedApps();
          if (list.some(a => a.name === s.label)) return;
          savePinnedApps([...list, {
            name: s.label,
            path: s.path || systemIconPath(s.type),
            isFolder: s.isFolder,
            iconType: s.type,
          }]);
        },
      })),
    },
  ]);
  menu.popup({ window: win, x: Math.round(pos?.x ?? 0), y: Math.round(pos?.y ?? 0) });
});

ipcMain.handle("open-settings-window", async () => { openSettingsWindow(); });
ipcMain.handle("close-settings-window", async () => { if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close(); });

// 启动预热：立即跑一次 running 检测（不等 5s 轮询），并后台批量预取活跃应用图标（一次 PowerShell）
setTimeout(() => {
  runRunningCheck().then(() => {
    if (runningCache && runningCache.list.length) {
      const paths = runningCache.list.map((it) => it.path).filter(Boolean);
      if (paths.length) getIconsBatch(paths).catch(() => {});
    }
  }).catch(() => {});
}, 300);

// ===== 单实例锁：避免多开 =====
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // 已有实例运行中：聚焦已有窗口而不是新建
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.focus();
  });
  app.whenReady().then(() => {
    // 多显示器：显示器变化时重新定位 Dock（必须在 ready 后注册 screen 事件）
    screen.on("display-added", () => applySettings());
    screen.on("display-removed", () => applySettings());
    screen.on("display-metrics-changed", () => applySettings());
    createWindow();
    createTray();
  });
}
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
