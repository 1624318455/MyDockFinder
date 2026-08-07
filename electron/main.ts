import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, nativeTheme, desktopCapturer } from "electron";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync, existsSync, readFileSync, statSync, writeFileSync, renameSync } from "node:fs";
import { homedir, hostname, totalmem, freemem, platform, arch, userInfo, release } from "node:os";
import { spawn } from "node:child_process";
import koffi from "koffi";
import { encodePs, runPsAsync, runPsAsyncWithTimeout } from "./ps.js";
import { getAppIconCached, getExeIconBase64Async, getIconsBatch, peekIcon } from "./icons.js";
import { applyAcrylic, applyCombinedRegion, applyRoundedRegion, clearWindowRegion, initAcrylic, removeAcrylic } from "./acrylic.js";
import { captureWindowPreviews } from "./preview.js";
import { collectProgressKoffi } from "./progress.js";
import { getStartAppsWithIcons } from "./uwp.js";
import { installGlobalErrorLogging, logInfo, logWarn } from "./log.js";
import { isElevated } from "./admin.js";

// 亚克力可用性（koffi 绑定成功才为 true）
const acrylicReady = initAcrylic();
// 当前亚克力/背景材质实际生效状态（供渲染层主动拉取，避免一次性推送时序丢事件）
let acrylicActive = false;

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV === "development";
let mainWindow: any = null, tray: any = null, settingsWindow: any = null;
const DOCK_BAR = 80; // dock 条厚度
// 顶部/底部 dock 的放大留白：图标 hover 放大时向上凸出的透明区（亚克力 region 裁掉，平时不可见）
const MAGNIFY_PAD = 24;

// 渲染 dock 条总高（与 src/App.css .dock-positioner margin + .dock-container 高度对齐）：
//   base = --dock-height 76px + positioner top/bottom margin 8px = 84px
//   hover 时渲染容器再增高 56×(magnification-1)（Dock.tsx 注入 --dock-mag-extra）
//   region 的 dock 条必须覆盖整个容器（含 hover 增高），否则容器顶会露出 region 外的白底。
const DOCK_CSS_HEIGHT = 76;
const DOCK_CSS_MARGIN = 8;
function dockStripHeight(): number {
  const base = DOCK_CSS_HEIGHT + DOCK_CSS_MARGIN;
  if (!hoverActive) return base;
  const mag = settings.magnification ?? 1.15;
  return base + Math.max(0, 56 * (mag - 1));
}

const SETTINGS_PATH = join(app.getPath("userData"), "settings.json");
interface AppSettings {
  dockPosition: 'bottom' | 'top' | 'left' | 'right';
  iconSize: number; magnification: number; autoHide: boolean;
  showWindowPreview: boolean; showWeather: boolean;
  autoStart: boolean; minimizeAnimation: 'fly' | 'genie' | 'scale' | 'off'; previewDelay: number; previewSize: number;
  blurIntensity: number;
  theme: 'dark' | 'light' | 'system';
  accentColor: string;
  tintColor: string;
  iconSpacing: number;
  dockRadius: number;
  badgeEnabled?: boolean;
  badgeApps?: string[];
  weatherCity?: string;
  weatherUnit?: 'c' | 'f';
  weatherRefreshMs?: number;
  minimizeDuration?: number;
  minimizeEasing?: string;
  backgroundMaterial?: 'auto' | 'mica' | 'acrylic';
  pinnedApps?: Array<{ name: string; path: string; isFolder?: boolean; iconType?: string }>;
}
const DEFAULT_SETTINGS: AppSettings = {
  dockPosition: 'bottom', iconSize: 48, magnification: 1.15,
  autoHide: false, showWindowPreview: true,
  showWeather: true, autoStart: false, minimizeAnimation: 'fly' as const,
  previewDelay: 300, previewSize: 240, blurIntensity: 70,
  theme: 'system', accentColor: '#007aff', tintColor: '',
  iconSpacing: 6, dockRadius: 18,
  badgeEnabled: true,
  weatherCity: '',
  weatherUnit: 'c',
  weatherRefreshMs: 600000,
  minimizeDuration: 500,
  minimizeEasing: 'easeOut',
  backgroundMaterial: 'acrylic',
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
    const excluded = new Set(["explorer", "shellexperiencehost", "searchhost", "dwm", "runtimebroker", "applicationframehost", "winlogon", "csrss", "smss", "lsass", "services", "svchost", "conhost", "textinputhost", "startmenuexperiencehost", "microsoft.edge", "msedgewebview2", "widgets", "securityhealthsystray", "sihost", "taskhostw", "taskhostex", "msofficebackground", "razerappengine", "nvidia overlay", "nvidia share", "overwolf", "qqliveservice", "heyboxchat", "cmd", "werfault", "wermgr", "rundll32", "dllhost", "computdefault", "electron", "mydockfinder", "reasonix-desktop"]);
    const visible = await getVisibleWindowProcesses();
    for (const v of visible) {
      const rawKey = v.name.toLowerCase();
      if (excluded.has(rawKey)) continue;
      const key = normalizeExeName(rawKey);
      const dispName = rawKey === key ? v.name : key;
      if (!activeApps.has(key)) {
        activeApps.set(key, { name: dispName, path: v.path, windowTitle: v.title });
      } else {
        const ex = activeApps.get(key)!;
        ex.path = v.path;
        ex.windowTitle = v.title;
      }
    }
    const dead: string[] = [];
    if (activeApps.size > 0) {
      const names = Array.from(activeApps.keys());
      // 展开别名（如 steam ↔ steamwebhelper），alive 查询与判断都要覆盖
      const qNames = [...new Set(names.flatMap(n => exeNameVariants(n)))];
      const q = qNames.map(n => "'" + n + "'").join(",");
      const aliveOut = await runPsAsync("Get-Process -Name @(" + q + ") -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProcessName | Sort-Object -Unique");

      const aliveSet = new Set<string>();
      aliveOut.split(/\r?\n/).forEach(nm => { const t = nm.trim().toLowerCase(); if (t) aliveSet.add(t); });
      for (const key of activeApps.keys()) {
        const variants = exeNameVariants(key);
        const aliveAny = variants.some(v => aliveSet.has(v));
        const visibleAny = visible.some(v => variants.includes(normalizeExeName(v.name)));
        if (!aliveAny && !visibleAny) dead.push(key);
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

// Dock 内容尺寸（渲染层测量上报；窗口只覆盖 dock 条 + 名称空间，其余区域鼠标穿透）
let dockContentWidth = 0;
let dockContentHeight = 0;
function getDockContentWidth(): number {
  if (dockContentWidth > 0) return dockContentWidth;
  // 估算：固定项 * 56 + 间距 + padding（渲染层首帧上报前）
  const n = Math.max(4, settings.pinnedApps?.length || 4);
  return Math.max(240, n * 56 + 40);
}
function getDockContentHeight(): number {
  if (dockContentHeight > 0) return dockContentHeight;
  const n = Math.max(4, settings.pinnedApps?.length || 4);
  return Math.max(200, n * 56 + 40);
}

// 名称/预览 popup 空间（left/right dock 时窗口在条带外侧留出，region 只裁剪条带，透明区鼠标穿透）
const NAME_PAD = 220;

function getDockBounds() {
  // 多显示器支持：Dock 跟随鼠标所在显示器（macOS 行为），坐标含显示器偏移
  let display = screen.getPrimaryDisplay();
  try {
    const mp = screen.getCursorScreenPoint();
    display = screen.getDisplayNearestPoint(mp);
  } catch {}
  const wa = display.workArea;
  const ox = wa.x, oy = wa.y;
  const pad = MAGNIFY_PAD;
  const cw = getDockContentWidth();
  const ch = getDockContentHeight();
  switch (settings.dockPosition) {
    // top：高度含 tooltip 下弹空间（hover 名称在图标下方，避免被窗口底裁切）
    case 'top': return { width: cw, height: DOCK_BAR + pad + 44, x: ox + (wa.width - cw) / 2, y: oy };
    // left/right：纵向条带 + 侧向名称空间（region 只裁剪条带，名称区透明 → 鼠标穿透）
    case 'left': return { width: DOCK_BAR + NAME_PAD, height: ch, x: ox, y: oy + (wa.height - ch) / 2 };
    case 'right': return { width: DOCK_BAR + NAME_PAD, height: ch, x: ox + wa.width - (DOCK_BAR + NAME_PAD), y: oy + (wa.height - ch) / 2 };
    default: return { width: cw, height: DOCK_BAR + pad, x: ox + (wa.width - cw) / 2, y: oy + wa.height - (DOCK_BAR + pad) };
  }
}

// 亚克力 tint：跟随主题（深色 0x1E1E1E / 浅色 0xF8F8FA），alpha 由 blurIntensity 映射
// intensity 1-100（默认 70）：越高越透、模糊越明显；alpha = 255 - intensity*1.8（下限 40 保底可读）
function getDockTint(): { tintRgb: number; alpha: number } {
  const dark = settings.theme === 'dark' || (settings.theme === 'system' && nativeTheme.shouldUseDarkColors);
  // 自定义 tint 色（如 #1E1E1E / #3A3A4A 等）优先；空则跟随主题默认
  let tintRgb = dark ? 0x1E1E1E : 0xF8F8FA;
  if (settings.tintColor) {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(settings.tintColor.trim());
    if (m) tintRgb = parseInt(m[1], 16);
  }
  const intensity = Math.min(100, Math.max(1, settings.blurIntensity ?? 70));
  const alpha = Math.max(40, Math.min(255, Math.round(255 - intensity * 1.8)));
  return { tintRgb, alpha };
}

// Win11 22H2+ 判断（Mica 硬性要求 build ≥ 22621；os.release() 形如 "10.0.26200.0"，build 在第三段）
function isWin11_22H2(): boolean {
  try {
    const r = /^(\d+)\.(\d+)\.(\d+)/.exec(release());
    return !!r && parseInt(r[3], 10) >= 22621;
  } catch { return false; }
}

// 解析背景材质模式：仅显式选择 'mica' 且在 Win11 22H2+ 时启用 Mica（DWM system backdrop）；
// Mica(DWM system backdrop) 会铺满整个窗口矩形，且不受 SetWindowRgn 裁剪 → 无法把亚克力裁成 dock 条，
// 浅色主题下整窗呈现白色背景块(hover 随窗口/容器一起扩大，用户实测问题)。统一走 ACCENT 亚克力，
// 它可被 region 精确裁成 dock 条 + 预览区，其余区域透明穿透，杜绝白色背景。
function resolveBackgroundMaterial(): undefined {
  return undefined;
}

// 对 Dock 窗口应用背景材质（Mica 走 DWM system backdrop，acrylic 走 SetWindowCompositionAttribute）+ 圆角 region
// region = 整窗圆角（内容宽窗口：左右两侧无窗口 → 鼠标穿透；顶部留白区在 tint 内，容器增高无需联动）
// 向渲染层广播亚克力生效状态。渲染层 App 的 useEffect 监听器是在 React 挂载后才注册，
// 若主进程仅 did-finish-load 时发一次，该一次性事件会丢失 → body 永不加 acrylic 类 →
// dock 渲染层 CSS 背景(浅色 rgba 0.92)而非系统亚克力，表现为 dock 永久不透明白。
// 因此延迟小幅重发多次，覆盖监听器就绪前的竞态窗口（幂等，重复 true 无副作用）。
function sendAcrylicState(active: boolean): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const push = () => { try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('acrylic-state', active); } catch { /* ignore */ } };
  push();
  for (const ms of [150, 500, 1500, 3500]) setTimeout(push, ms);
}

function applyAcrylicToWindow(): boolean {
  if (!mainWindow || mainWindow.isDestroyed() || !acrylicReady) return false;
  try {
    const mat = resolveBackgroundMaterial();
    const handleBuf = mainWindow.getNativeWindowHandle();
    const hwnd = handleBuf.length >= 8 ? handleBuf.readBigUInt64LE(0) : handleBuf.readUInt32LE(0);
    // 动态切换材质（backgroundMaterial 是构造选项，运行时用 setBackgroundMaterial 更新）
    try { (mainWindow as any).setBackgroundMaterial?.(mat || 'none'); } catch { /* 旧版本无此 API */ }
    if (mat) {
      // Mica（DWM system backdrop）：不叠加 ACCENT 亚克力（避免冲突），仅 region
      applyRoundedRegion(mainWindow, settings.dockRadius || 18, regionOpts());
      acrylicActive = true;
      sendAcrylicState(true);
      return true;
    }
    const { tintRgb, alpha } = getDockTint();
    // 判定实验：transparent 窗口 + ACCENT 亚克力存在已知冲突（透明窗口不受 DWM 亚克力合成，
    // 会呈现不透明白层）。先跳过 applyAcrylic，仅保留 region 裁剪 + 渲染层 CSS 透明，
    // 验证窗口是否真正 per-pixel 透明可见壁纸。若 dock 变透明见壁纸 → ACCENT 是罪魁。
    applyRoundedRegion(mainWindow, settings.dockRadius || 18, regionOpts());
    acrylicActive = true;
    sendAcrylicState(true);
    return true;
  } catch (e) {
    logWarn(`背景材质应用失败，降级 CSS 背景: ${String(e).slice(0, 120)}`);
    return false;
  }
}

// 诊断：抓取 Dock 窗口本体(带 alpha 透明通道)存 PNG，用于分析 dock 条的透明/圆角/背景。
// 仅开发环境生效，且每类只抓一次，避免影响正常运行。
let debugCaptureHoverDone = false;
let debugCaptureIdleDone = false;
async function debugCaptureDock(name: 'dock-hover' | 'dock-idle'): Promise<void> {
  if (!isDev || !mainWindow || mainWindow.isDestroyed()) return;
  if (debugCaptureHoverDone && name === 'dock-hover') return;
  if (debugCaptureIdleDone && name === 'dock-idle') return;
  try {
    // capturePage 对 transparent 窗口会把透明填成白，无法判断 dock 是否透明。
    // 改抓真实屏幕合成（含 dock 叠加桌面的 alpha），才能分析 dock 是否透明穿透。
    const disp = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()) || screen.getPrimaryDisplay();
    const size = disp.size;
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: size.width, height: size.height },
      fetchWindowIcons: false,
    });
    const src = sources.find(s => s.display_id === String(disp.id)) || sources[0];
    const img = src?.thumbnail;
    if (!img) throw new Error('no screen source');
    writeFileSync(join(__dirname, '..', 'screenshot', `screen-${name}.png`), img.toPNG());
    console.log(`[ACRYLIC-DIAG] captured ${name} (screen ${img.getSize().width}x${img.getSize().height})`);
    if (name === 'dock-hover') debugCaptureHoverDone = true; else debugCaptureIdleDone = true;
  } catch (e) { console.warn('[ACRYLIC-DIAG] capture fail', String(e).slice(0, 160)); }
}

// 亚克力 region 条带：按 dock 位置只裁剪 dock 条（left/right 窗口含名称空间，region 外透明 → 鼠标穿透）
function regionOpts(): { top?: number; height?: number; left?: number; width?: number } {
  const pos = settings.dockPosition;
  const [w, h] = mainWindow ? mainWindow.getSize() : [0, 0];
  if (pos === 'left') return { left: 0, width: DOCK_BAR };
  if (pos === 'right') return { left: Math.max(0, w - DOCK_BAR), width: DOCK_BAR };
  // top/bottom：高度必须覆盖渲染容器真实占位(76+margin+放大)，否则容器顶露出 region 外白底
  const strip = dockStripHeight();
  if (pos === 'top') return { top: 0, height: strip };
  return { top: Math.max(0, h - strip), height: Math.min(strip, h) };
}

function createWindow() {
  const b = getDockBounds();
  mainWindow = new BrowserWindow({
    width: b.width, height: b.height, x: b.x, y: b.y,
    frame: false, transparent: true, resizable: false,
    // 显式透明背景：transparent 窗口在 setBounds 扩容时，若不设背景会填充不透明白色，
    // 这正是 hover 扩容后出现"白色背景块"的根源。设 #00000000 保证 resize 新增区域保持透明。
    backgroundColor: "#00000000",
    skipTaskbar: true, alwaysOnTop: true, hasShadow: false, show: true,
    // focusable:false：Dock 作为工具条不抢键盘/前台焦点——点击图标时 GetForegroundWindow 保持目标应用，
    // 使「已在前台 → 最小化」的切换逻辑可命中（macOS 行为）
    focusable: false,
    backgroundMaterial: resolveBackgroundMaterial(),
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false,
    },
  });
  if (isDev) mainWindow.loadURL("http://localhost:5173");
  else mainWindow.loadFile(join(__dirname, "../dist/index.html"));
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // 启动诊断：判定问题1「白色背景」根因的关键运行时数据
  try {
    const releaseStr = process.versions.electron;
    console.log(`[ACRYLIC-DIAG] ready=${acrylicReady} win11_22H2=${isWin11_22H2()} material=${resolveBackgroundMaterial()} theme=${settings.theme} dark=${settings.theme === 'system' ? nativeTheme.shouldUseDarkColors : settings.theme === 'dark'} tint=${JSON.stringify(getDockTint())} hwndLoaded=true electron=${releaseStr}`);
  } catch { /* 诊断日志失败忽略 */ }
  // 亚克力需在窗口就绪后应用；加启动重试：首次 did-finish-load 时 DWM 合成可能尚未就绪，
  // 一次性失败会永久跳到 CSS 白色兜底（dock 周围出现白底）。短间隔重试直至成功或耗尽次数。
  let acrylicTries = 0;
  const tryAcrylic = (): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const ok = applyAcrylicToWindow();
    console.log(`[ACRYLIC-DIAG] try#${acrylicTries} ok=${ok}`);
    if (!ok && acrylicTries < 8) { acrylicTries++; setTimeout(tryAcrylic, 180); }
  };
  mainWindow.webContents.on('did-finish-load', tryAcrylic);
  // 诊断：窗口渲染稳定 + body 已设 acrylic 后抓 idle（避免抓到"未设类"的过渡帧）
  setTimeout(() => void debugCaptureDock('dock-idle'), 4000);
  // 诊断:取 body 是否带 acrylic + dock 容器"计算后"背景，一锤定音地判断渲染层实际设置
  [2200, 5000].forEach((ms) => setTimeout(() => {
    try {
      mainWindow?.webContents.executeJavaScript(`(() => {
        const bg = document.querySelector('.dock-container');
        const out = {
          bodyClass: document.body.className,
          dockHasAcrylicRule: !!bg && (getComputedStyle(bg).outlineStyle === 'solid'),
          dockBg: bg ? getComputedStyle(bg).backgroundColor : 'none',
        };
        return JSON.stringify(out);
      })()`)
        .then((s: string) => console.log('[ACRYLIC-DIAG] dockState=%s', s))
        .catch(() => {});
    } catch { /* ignore */ }
  }, ms));
}

function applySettings() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // hover 扩容期间：不重定位窗口（防 dock-content-size/display 事件把扩容窗口恢复回去，造成抖动循环）
  if (hoverActive) return;
  // 全屏弹层打开期间：不重定位窗口（否则 dock-content-size 上报会恢复 dock 尺寸，把弹层窗口裁回去）
  if (!overlayActive) {
    // dockPosition → 重新定位窗口
    const b = getDockBounds();
    mainWindow.setBounds({ ...b });
    // 尺寸/位置变化后重建圆角 region + 重应用亚克力（tint 跟随主题与强度）
    applyAcrylicToWindow();
  }
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
    // 展开别名（steam ↔ steamwebhelper），Get-Process 按进程名精确查询
    const variants = exeNameVariants(exeName);
    const namesArg = "@('" + variants.join("','") + "')";
    const script = [
      '$p = Get-Process -Name ' + namesArg + ' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1;',
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

// 点击运行中图标：已在前台 → 最小化（触发最小化动画）；否则聚焦恢复（macOS 切换行为）
// 返回 'minimize' | 'focus' | 'none'（无匹配窗口）
function toggleExistingWindow(exeName: string): Promise<'minimize' | 'focus' | 'none'> {
  return new Promise(resolve => {
    try {
      if (!exeName) return resolve('none');
      const target = enumVisibleWindowsKoffi().find(w => {
        if (w.minimized) return false; // 已最小化 → 走恢复
        const base = w.path.replace(/\\/g, '/').split('/').pop() || '';
        // 归一化匹配：steamwebhelper → steam（Steam 新 UI 主窗口是 CEF 进程）
        return normalizeExeName(base.replace(/\.exe$/i, '')) === normalizeExeName(exeName);
      });
      if (!target) return resolve('none');
      const fg = Number(_GetForegroundWindow());
      if (fg === target.hwnd) {
        // 已在前台 → 最小化：禁用系统过渡动画（否则 DWM 原生最小化动画抢先播放），
        // 并立即播放我们的飞入动画（不等 5s tick）
        disableWindowTransitions(target.hwnd);
        _ShowWindow(target.hwnd, 6); // SW_MINIMIZE
        const name = target.path.replace(/\\/g, '/').split('/').pop()?.replace(/\.exe$/i, '') || exeName;
        playMinimizeAnimation({
          name,
          path: target.path,
          rect: { left: target.left, top: target.top, right: target.right, bottom: target.bottom },
        });
        return resolve('minimize');
      }
      _ShowWindow(target.hwnd, 9); // SW_RESTORE
      _SetForegroundWindow(target.hwnd);
      return resolve('focus');
    } catch { resolve('none'); }
  });
}

// 通过 cmd start 启动（detached + unref，不阻塞主进程、不等待退出）
function startProcessDetached(cmdLine: string): boolean {
  try {
    spawn("cmd.exe", ["/c", cmdLine], { detached: true, stdio: "ignore" }).unref();
    return true;
  } catch { return false; }
}

// 统一启动应用：已运行则切换（前台→最小化 / 非前台→聚焦），否则新开（shell: 走 explorer.exe）
async function launchApp(appPath: string): Promise<{ success: boolean; focused: boolean }> {
  try {
    const p = String(appPath || '').trim();
    // 无效路径防御：避免 start "" "\" 这类报错
    if (!p || /^[\\/]+$/.test(p)) return { success: false, focused: false };
    const exeName = await resolveExeNameAsync(p);
    if (exeName) {
      const toggled = await toggleExistingWindow(exeName);
      if (toggled !== 'none') {
        return { success: true, focused: toggled === 'focus' };
      }
      if (await focusExistingWindow(exeName)) {
        return { success: true, focused: true };
      }
    }
    if (p.toLowerCase().startsWith("shell:")) {
      spawn("explorer.exe", [normalizeShellPath(p)], { detached: true, stdio: "ignore" }).unref();
    } else {
      startProcessDetached('start "" "' + p + '"');
    }
    return { success: true, focused: false };
  } catch {
    try { spawn(String(appPath || ''), [], { detached: true, stdio: "ignore" }).unref(); return { success: true, focused: false }; }
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
// 全部应用 = 开始菜单 Win32 快捷方式 + UWP/商店应用（Get-StartApps，图标预取）
ipcMain.handle("get-all-apps", async () => {
  const win32 = getStartMenuApps();
  let uwp: Array<{ name: string; path: string; icon: string }> = [];
  try { uwp = (await getStartAppsWithIcons()).map(a => ({ name: a.name, path: a.path, icon: a.icon })); } catch { /* 保持空 */ }
  const merged = [...win32, ...uwp];
  // 同 path 去重（UWP 与 Win32 理论上不冲突）
  const seen = new Set<string>();
  const uniq = merged.filter(a => { const k = a.path.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  return uniq.slice(0, 80).map((a, i) => ({ ...a, id: "app-" + i }));
});
ipcMain.handle("get-app-icon", async (e, p) => getExeIconBase64Async(p));

// 枚举当前所有【可见窗口】的进程 — koffi 原生（user32.dll 直接调用，~3ms，零 PowerShell）
// ===== koffi Win32 声明（模块级，只初始化一次） =====
const _u32 = koffi.load('user32.dll');
const _k32 = koffi.load('kernel32.dll');
const _dwm = koffi.load('dwmapi.dll');
// 类型幂等注册（koffi 全局注册表：preview/acrylic/admin 等模块可能已注册，必须跳过而非重复 alias）
const _kp = (name: string, def: () => any): any => { try { return koffi.type(name); } catch { return def(); } };
const _DWORD = _kp('DWORD', () => koffi.alias('DWORD', 'uint32_t'));
const _BOOL = _kp('BOOL', () => koffi.alias('BOOL', 'int32_t'));
const _INT = _kp('INT', () => koffi.alias('INT', 'int32_t'));
const _HWND = _kp('HWND', () => koffi.pointer('HWND', koffi.opaque()));
const _LONG = _kp('LONG', () => koffi.alias('LONG', 'int32_t'));
const _RECT = koffi.struct('RECT', { left: _LONG, top: _LONG, right: _LONG, bottom: _LONG });
const _HANDLE = _kp('HANDLE', () => koffi.pointer('HANDLE', koffi.opaque()));
// WNDENUMPROC 回调类型：幂等获取（preview.ts 等模块可能已注册同名类型，避免 Duplicate）
let _WNDENUMPROC: any = null;
try { _WNDENUMPROC = koffi.type('WNDENUMPROC'); } catch {
  _WNDENUMPROC = koffi.proto('bool __stdcall WNDENUMPROC(intptr hwnd, intptr lParam)');
}
const _CallbackPtr = koffi.pointer(_WNDENUMPROC);
const _EnumWindows = _u32.func('EnumWindows', 'bool', [_CallbackPtr, 'intptr']);
const _IsWindowVisible = _u32.func('BOOL __stdcall IsWindowVisible(HWND hWnd)');
const _IsIconic = _u32.func('BOOL __stdcall IsIconic(HWND hWnd)');
const _GetForegroundWindow = _u32.func('HWND __stdcall GetForegroundWindow()');
const _ShowWindow = _u32.func('BOOL __stdcall ShowWindow(HWND hWnd, INT nCmdShow)');
const _SetForegroundWindow = _u32.func('BOOL __stdcall SetForegroundWindow(HWND hWnd)');
// 禁用窗口过渡动画（最小化/还原时系统 DWM 不播放原生动画，让位给我们的飞入动画）
const _DwmSetWindowAttribute = _dwm.func('DwmSetWindowAttribute', 'int', ['HWND', 'DWORD', 'void *', 'DWORD']);
const DWMWA_TRANSITIONS_FORCEDISABLED = 3;
function disableWindowTransitions(hwnd: number): void {
  try {
    const v = Buffer.from([1, 0, 0, 0]); // TRUE
    _DwmSetWindowAttribute(hwnd, DWMWA_TRANSITIONS_FORCEDISABLED, v, 4);
  } catch { /* 老系统忽略 */ }
}
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
      // UWP：ApplicationFrameHost 的窗口标题即应用名（如“3D 查看器”），用于与固定项匹配
      if (name.toLowerCase() === 'applicationframehost' && w.title) name = w.title.slice(0, 60);
      // 更新器临时进程（战网 temp_a4x...）：显示窗口标题而非临时文件名（有可见窗口即有用户价值）
      if (/^temp_/i.test(name) && w.title) name = w.title.slice(0, 60);
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
    disableWindowTransitions(v.hwnd); // 禁用该窗口过渡，避免系统动画与我们的动画叠加
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

// 播放最小化动画（3 种可选）：fly 直线飞入缩小淡出 / genie Genie 式扭曲吸入 / scale 缩放吸入
// 兼容旧 boolean 设置：true→'fly'，false→'off'
async function playMinimizeAnimation(v: { name: string; path: string; rect?: { left: number; top: number; right: number; bottom: number } }) {
  try {
    let mode = settings.minimizeAnimation as unknown as 'fly' | 'genie' | 'scale' | 'off';
    if (mode === true as unknown) mode = 'fly';
    else if (mode === false as unknown) mode = 'off';
    if (mode === 'off') return;

    // 高级设置（7.3）：动画时长（ms）与缓动曲线
    const duration = Math.max(150, Math.min(2000, settings.minimizeDuration ?? 500));
    const easingMap: Record<string, string> = {
      ease: 'cubic-bezier(0.25,0.1,0.25,1)',
      easeIn: 'cubic-bezier(0.42,0,1,1)',
      easeOut: 'cubic-bezier(0,0,0.58,1)',
      easeInOut: 'cubic-bezier(0.42,0,0.58,1)',
      linear: 'linear',
    };
    const easing = easingMap[settings.minimizeEasing || 'easeOut'] || easingMap.easeOut;

    if (minimizeAnimWin && !minimizeAnimWin.isDestroyed()) minimizeAnimWin.destroy();
    const wa = (() => {
      try { return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea; }
      catch { return screen.getPrimaryDisplay().workArea; }
    })();
    // 起点：窗口原位置中心
    const r = v.rect;
    const sx = r && r.right > r.left ? (r.left + r.right) / 2 : wa.width / 2;
    const sy = r && r.bottom > r.top ? (r.top + r.bottom) / 2 : wa.height / 2;
    // 终点：按 dock 位置（官方行为：图标飞向 Dock 所在边）——bottom 底部中央 / top 顶部中央 / left 左侧中央 / right 右侧中央
    const pos = settings.dockPosition;
    const ex = pos === 'left' ? wa.x + 24 : pos === 'right' ? wa.x + wa.width - 24 : wa.x + wa.width / 2;
    const ey = pos === 'top' ? wa.y + 24 : pos === 'bottom' ? wa.y + wa.height - 20 : wa.y + wa.height / 2;

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
        overflow:hidden;transform:translate(-50%,-50%);transition:all ${duration * 0.84}ms ${easing};}
      #fly img{width:44px;height:44px;object-fit:contain;}
      #fly.genie{transform:translate(-50%,-50%);transition:all ${duration}ms ${easing};}
      #fly.scale{transform:translate(-50%,-50%) scale(1);transition:all ${duration}ms ${easing};}
    </style></head><body>
      <div id="fly" class="${mode === 'genie' ? 'genie' : mode === 'scale' ? 'scale' : ''}"
        style="left:${sx - wa.x}px;top:${sy - wa.y}px;opacity:1;">
        ${iconDataUrl ? '<img src="' + iconDataUrl + '">' : '<span style="font-size:28px;opacity:0.5;">⬜</span>'}
      </div>
    </body></html>`;
    await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    win.showInactive();
    // 动画差异：fly 直线缩小淡出 / genie 先拉长压缩再吸入 / scale 等比缩小平移
    const js = (() => {
      if (mode === 'genie') {
        const x0 = sx - wa.x, y0 = sy - wa.y, x1 = ex - wa.x, y1 = ey - wa.y;
        const c1x = Math.round(x0 + (x1 - x0) * 0.25);
        const c1y = Math.round(y0 - Math.max(120, Math.abs(y1 - y0) * 0.15));
        return `(function(){
          var el = document.getElementById('fly');
          el.style.transition = 'none';
          el.style.transform = 'translate(-50%,-50%)';
          el.animate([
            { transform: 'translate(-50%,-50%) scale(1,1)', opacity: 1, offset: 0 },
            { transform: 'translate(${c1x}px,${c1y}px) scale(1.15,0.85)', opacity: 1, offset: 0.55 },
            { transform: 'translate(${x1}px,${y1}px) scale(0.5,0.2)', opacity: 0.6, offset: 1 }
          ], { duration: ${Math.round(duration * 1.24)}, easing: '${easing}', fill: 'forwards' });
        })();`;
      }
      if (mode === 'scale') {
        return `(function(){
          var el = document.getElementById('fly');
          el.style.left = '${ex - wa.x}px';
          el.style.top = '${ey - wa.y}px';
          el.style.width = '36px';
          el.style.height = '36px';
          el.style.opacity = '0.9';
        })();`;
      }
      return `(function(){
        var el = document.getElementById('fly');
        el.style.left = '${ex - wa.x}px';
        el.style.top = '${ey - wa.y}px';
        el.style.width = '36px';
        el.style.height = '36px';
        el.style.opacity = '0';
      })();`;
    })();
    win.webContents.executeJavaScript(js);
    setTimeout(() => { if (!win.isDestroyed()) win.destroy(); }, mode === 'genie' ? Math.round(duration * 1.4) + 80 : Math.round(duration) + 100);
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

// 打开应用（带显示名）：运行中应用（含 temp_ 更新器/CEF 主窗口等进程名≠固定名的场景）
// 先按显示名匹配已运行窗口做切换，否则回退 launchApp 正常启动
ipcMain.handle("open-app-with-name", async (e, appPath: string, displayName?: string) => {
  const name = String(displayName || '').trim();
  if (name) {
    const target = findWindowByDisplayName(name);
    if (target) {
      const toggled = await toggleExistingWindowByHwnd(target);
      if (toggled !== 'none') return { success: true, focused: toggled === 'focus' };
    }
  }
  return launchApp(appPath);
});

// 按显示名找已运行窗口（activeApps 显示名 → 窗口 path → 枚举窗口匹配）
function findWindowByDisplayName(displayName: string) {
  const dn = displayName.toLowerCase();
  for (const [, app] of activeApps) {
    if (app.name.toLowerCase() === dn && app.path) {
      const win = enumVisibleWindowsKoffi().find(w => w.path === app.path);
      if (win) return win;
    }
  }
  return undefined;
}

// 对已知窗口做切换（前台→最小化+动画 / 非前台→聚焦），复用 toggle 核心逻辑
function toggleExistingWindowByHwnd(target: any): Promise<'minimize' | 'focus' | 'none'> {
  return new Promise(resolve => {
    try {
      if (target.minimized) {
        _ShowWindow(target.hwnd, 9);
        _SetForegroundWindow(target.hwnd);
        return resolve('focus');
      }
      const fg = Number(_GetForegroundWindow());
      if (fg === target.hwnd) {
        disableWindowTransitions(target.hwnd);
        _ShowWindow(target.hwnd, 6);
        const name = target.path.replace(/\\/g, '/').split('/').pop()?.replace(/\.exe$/i, '') || '';
        playMinimizeAnimation({ name, path: target.path, rect: { left: target.left, top: target.top, right: target.right, bottom: target.bottom } });
        return resolve('minimize');
      }
      _ShowWindow(target.hwnd, 9);
      _SetForegroundWindow(target.hwnd);
      return resolve('focus');
    } catch { resolve('none'); }
  });
}

// get-folder-contents（含图片缩略图：PowerShell System.Drawing 批量生成 ≤96px）
const IMAGE_EXT = [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".ico", ".svg"];

function isImageFile(name: string): boolean {
  const ext = name.toLowerCase().substring(name.lastIndexOf("."));
  return IMAGE_EXT.includes(ext);
}

/** 批量生成图片缩略图（≤96px PNG dataUrl），单次 PowerShell 调用，失败路径跳过 */
async function getThumbsBatch(filePaths: string[]): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  if (!filePaths.length) return result;
  const items = filePaths.map(p => "'" + p.replace(/'/g, "''") + "'").join(",");
  const script = `Add-Type -AssemblyName System.Drawing; $out=@{}; foreach($f in @(${items})){ try {
    $img=[System.Drawing.Image]::FromFile($f);
    $w=96; $h=[int]($img.Height*96/$img.Width); if($h -lt 1){$h=1}; if($h -gt 96){$h=96; $w=[int]($img.Width*96/$img.Height)};
    $bmp=New-Object System.Drawing.Bitmap($w,$h);
    $g=[System.Drawing.Graphics]::FromImage($bmp);
    $g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic;
    $g.DrawImage($img,0,0,$w,$h);
    $ms=New-Object System.IO.MemoryStream;
    $bmp.Save($ms,[System.Drawing.Imaging.ImageFormat]::Png);
    $out[$f]=[Convert]::ToBase64String($ms.ToArray());
    $g.Dispose(); $bmp.Dispose(); $img.Dispose(); $ms.Dispose();
  } catch {} }
  $out.GetEnumerator() | ForEach-Object { Write-Output ($_.Key + "\`t" + $_.Value) }`;
  const out = await runPsAsyncWithTimeout(script, 30000);
  for (const line of out.split(/\r?\n/)) {
    const tab = line.indexOf("\t");
    if (tab <= 0) continue;
    const p = line.slice(0, tab).trim();
    const b64 = line.slice(tab + 1).trim();
    if (b64) result[p] = "data:image/png;base64," + b64;
  }
  return result;
}

// 供端到端测试直接调用（与 IPC handler 同逻辑）
export async function getFolderContentsImpl(fp: string): Promise<Array<{ name: string; path: string; isDirectory: boolean; size: number; modifiedAt: number; thumbnail: string }>> {
  if (!existsSync(fp)) return [];
  const dirents = readdirSync(fp, { withFileTypes: true }).slice(0, 100);
  const items: Array<{ name: string; path: string; isDirectory: boolean; size: number; modifiedAt: number; thumbnail: string }> = [];
  for (const d of dirents) {
    try {
      const full = join(fp, d.name);
      const s = statSync(full);
      items.push({
        name: d.name,
        path: full,
        isDirectory: d.isDirectory(),
        size: s.size,
        modifiedAt: s.mtimeMs,
        thumbnail: "",
      });
    } catch { /* skip */ }
  }
  // 图片缩略图批量生成（异步，不阻塞响应主体）
  const imgPaths = items.filter(i => !i.isDirectory && isImageFile(i.name)).map(i => i.path);
  if (imgPaths.length) {
    try {
      const thumbs = await getThumbsBatch(imgPaths);
      for (const it of items) if (thumbs[it.path]) it.thumbnail = thumbs[it.path];
    } catch { /* 无缩略图不影响列表 */ }
  }
  return items;
}

ipcMain.handle("get-folder-contents", async (e, fp) => getFolderContentsImpl(fp));

// 文件拖出到系统（explorer/桌面）：渲染层 dragstart → 主进程 webContents.startDrag
ipcMain.on("start-drag", async (e, filePath: string) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win || !filePath || typeof filePath !== "string") return;
  try {
    let icon = nativeImage.createEmpty();
    const iconData = await getExeIconBase64Async(filePath);
    if (iconData) icon = nativeImage.createFromDataURL(iconData);
    win.webContents.startDrag({ file: filePath, icon });
  } catch { /* ignore */ }
});

ipcMain.handle("get-acrylic-state", () => acrylicActive);
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

// 窗口预览：koffi 枚举精确关联进程 → GDI 截取（最多 4 个窗口）
// 匹配增强：固定项 name（如 "Google Chrome"/"Steam"）与进程名（chrome/steam）不一致时，
// 先按显示名在 activeApps 中解析出真实进程 key/path，再交 captureWindowPreviews 多名字匹配
ipcMain.handle("get-window-previews", async (e, appName: string) => {
  if (!appName) return [];
  const names = new Set<string>([String(appName).toLowerCase()]);
  for (const [key, app] of activeApps) {
    if (app.name.toLowerCase() === String(appName).toLowerCase()) {
      names.add(key.toLowerCase());
      if (app.path) {
        const base = app.path.replace(/\\/g, '/').split('/').pop() || '';
        if (base) names.add(base.replace(/\.exe$/i, '').toLowerCase());
      }
    }
  }
  return captureWindowPreviews([...names]);
});

// 悬停放大联动已废弃（region 整窗圆角，容器增高在 tint 内）。
// 内容宽度上报：渲染层测量 dock 容器宽度 → 窗口收窄为内容宽 → 左右两侧鼠标穿透（不遮挡点击）
ipcMain.on("dock-content-size", (_e, w: number) => {
  const nw = Math.max(160, Math.min(2500, Math.round(Number(w)) || 0));
  if (!nw || nw === dockContentWidth) return;
  dockContentWidth = nw;
  if (!hoverActive) applySettings();
});

// 内容高度上报（left/right dock 窗口高度 = 内容高）
ipcMain.on("dock-content-height", (_e, h: number) => {
  const nh = Math.max(160, Math.min(2500, Math.round(Number(h)) || 0));
  if (!nh || nh === dockContentHeight) return;
  dockContentHeight = nh;
  if (!hoverActive) applySettings();
});

// ===== 系统图标库（原版：右键 Dock 空白区添加） =====
const SYSTEM_ICONS: Array<{ type: string; label: string; path: string; isFolder: boolean }> = [
// 直接存 CLSID 形式（explorer.exe 对 shell:RecycleBinFolder 无效，实测必须 CLSID）
  { type: 'trash', label: '回收站', path: 'shell:::{645FF040-5081-101B-9F08-00AA002F954E}', isFolder: false },
  { type: 'downloads', label: '下载', path: '', isFolder: true },
  { type: 'documents', label: '文档', path: '', isFolder: true },
  { type: 'pictures', label: '图片', path: '', isFolder: true },
  { type: 'music', label: '音乐', path: '', isFolder: true },
  { type: 'videos', label: '视频', path: '', isFolder: true },
  { type: 'computer', label: '此电脑', path: 'shell:::{20D04FE0-3AEA-1069-A2D8-08002B30309D}', isFolder: false },
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
// 注：explorer.exe 对 shell:RecycleBinFolder 等部分 shell: 路径无效，需用 CLSID 形式（实测验证）
const SHELL_CLSID_MAP: Record<string, string> = {
  'shell:recyclebinfolder': 'shell:::{645FF040-5081-101B-9F08-00AA002F954E}',   // 回收站
  'shell:mycomputerfolder': 'shell:::{20D04FE0-3AEA-1069-A2D8-08002B30309D}',   // 此电脑
};
function normalizeShellPath(path: string): string {
  const key = path.toLowerCase();
  return SHELL_CLSID_MAP[key] || path;
}
ipcMain.handle("open-path", async (e, path: string) => {
  try {
    const p = String(path || '').trim();
    if (!p || /^[\\/]+$/.test(p)) { logWarn(`open-path 无效路径: "${path}"`); return { success: false }; }
    if (p.startsWith("shell:")) {
      // explorer.exe 支持 shell: URI（cmd start 不支持）
      const normalized = normalizeShellPath(p);
      logInfo(`open-path shell: ${p} → ${normalized}`);
      spawn("explorer.exe", [normalized], { detached: true, stdio: "ignore" }).unref();
      return { success: true };
    }
    startProcessDetached('start "" "' + p + '"');
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
  if (!Array.isArray(arr)) return [];
  // 清洗：过滤临时进程固定项（如战网 temp_a4x...，进程消失后点击报错）
  return arr.filter((a) => {
    const n = String(a?.name || '');
    const p = String(a?.path || '');
    if (/^temp_/i.test(n)) return false;
    const base = p.replace(/\\/g, '/').split('/').pop() || '';
    if (/^temp_/i.test(base)) return false;
    return true;
  });
}

function savePinnedApps(list: Array<{ name: string; path: string; isFolder?: boolean; iconType?: string }>): void {
  settings = { ...settings, [PINNED_KEY]: list };
  try { writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf-8"); } catch {}
  // 广播到主窗口刷新
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("pinned-apps-changed", list);
  }
}

// 文件夹显示设置（缩略图开关 / 排序方式）— 持久化在 pin 条目 meta 字段（官方 3.4.2）
interface FolderMeta { thumbnails?: boolean; sortBy?: 'name' | 'time' | 'size' }

function getPinnedItem(name: string): { name: string; path: string; isFolder?: boolean; iconType?: string; meta?: FolderMeta } | undefined {
  const list = getPinnedApps();
  return list.find(a => a.name === name);
}

function getFolderMeta(name: string): FolderMeta {
  const item = getPinnedItem(name);
  return (item as any)?.meta || { thumbnails: true, sortBy: 'name' };
}

function setFolderMeta(name: string, patch: FolderMeta): void {
  const list = getPinnedApps();
  const next = list.map(a => {
    if (a.name !== name) return a;
    const cur = (a as any).meta || { thumbnails: true, sortBy: 'name' };
    return { ...a, meta: { ...cur, ...patch } };
  });
  savePinnedApps(next);
}

// 文件夹显示设置 IPC（渲染层 FolderView 也可调用）
ipcMain.handle("set-folder-options", async (e, args: { name: string; thumbnails?: boolean; sortBy?: 'name' | 'time' | 'size' }) => {
  if (!args || !args.name) return false;
  setFolderMeta(String(args.name), { thumbnails: args.thumbnails, sortBy: args.sortBy });
  return true;
});

// 重命名固定项（快捷方式/文件：同时重命名底层 .lnk 文件；其它条目仅改显示名）
ipcMain.handle("rename-pinned-item", async (e, args: { name: string; newName: string; path: string }) => {
  try {
    const newName = String(args.newName || '').trim();
    const oldName = String(args.name);
    if (!newName || !oldName || newName === oldName) return false;
    const list = getPinnedApps();
    let renamedPath = String(args.path || '');
    // 快捷方式：重命名实际 .lnk 文件（保留 .lnk 后缀）
    if (/\.lnk$/i.test(renamedPath) && existsSync(renamedPath)) {
      const dir = dirname(renamedPath);
      const newPath = join(dir, newName.toLowerCase().endsWith('.lnk') ? newName : newName + '.lnk');
      if (!existsSync(newPath)) {
        try {
          renameSync(renamedPath, newPath);
          renamedPath = newPath;
        } catch { /* 文件占用等 → 仅改显示名 */ }
      }
    }
    const next = list.map(a => {
      if (a.name !== oldName) return a;
      return { ...a, name: newName, path: renamedPath };
    });
    savePinnedApps(next);
    return true;
  } catch { return false; }
});

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

// 拖拽排序：按渲染层提交的顺序重排固定区并持久化（不在名单中的项防御性保留在原位）
ipcMain.handle("reorder-pinned-apps", async (e, names: string[]) => {
  const list = getPinnedApps();
  if (!Array.isArray(names)) return list;
  const byName = new Map(list.map(a => [a.name.toLowerCase(), a]));
  const next: typeof list = [];
  for (const n of names) {
    const item = n && byName.get(String(n).toLowerCase());
    if (item) { next.push(item); byName.delete(item.name.toLowerCase()); }
  }
  // 未提及的项（防御：名称变化/并发修改）按原顺序追加
  for (const a of list) {
    if (byName.has(a.name.toLowerCase())) next.push(a);
  }
  savePinnedApps(next);
  return next;
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

// 天气图标：wttr.in 条件文字 → emoji（中英文均覆盖）
function weatherIcon(cond: string): string {
  const c = String(cond || '').toLowerCase();
  if (c.includes('雷') || c.includes('thunder')) return '⛈️';
  if (c.includes('雨') || c.includes('rain') || c.includes('drizzle') || c.includes('shower')) return '🌧️';
  if (c.includes('雪') || c.includes('snow') || c.includes('sleet')) return '🌨️';
  if (c.includes('雾') || c.includes('fog') || c.includes('霾') || c.includes('haze')) return '🌫️';
  if (c.includes('阴') || c.includes('overcast')) return '☁️';
  if (c.includes('云') || c.includes('cloud')) return '☁️';
  if (c.includes('部分') || c.includes('partly') || c.includes('间') || c.includes('间晴')) return '⛅';
  if (c.includes('晴') || c.includes('sun') || c.includes('clear')) return '☀️';
  return '🌤️';
}

// 从 j1 JSON 取描述（wttr.in：lang_zh 优先，weatherDesc 兜底）
function weatherDesc(node: any): string {
  if (!node) return '';
  return String(node.lang_zh?.[0]?.value || node.weatherDesc?.[0]?.value || '');
}

// get-weather（j1 JSON：当前条件 + 未来 3 天预报；支持城市/单位设置 7.5；失败返回占位）
ipcMain.handle("get-weather", async () => {
  const city = String(settings.weatherCity || '').trim();
  const unit = settings.weatherUnit === 'f' ? 'f' : 'c';
  const url = 'https://wttr.in/' + encodeURIComponent(city) + '?format=j1&lang=zh';
  const r = await runPsAsync("try { $wc=New-Object System.Net.WebClient; $wc.Headers.Add('User-Agent','curl/7.0'); $d=$wc.DownloadString('" + url + "'); if($d){ Write-Output $d } } catch {}");
  const fallback = { temp: "--", condition: "未知", icon: "🌤️", forecast: [] as Array<{ date: string; icon: string; tempHigh: string; tempLow: string }> };
  if (!r) return fallback;
  try {
    const j = JSON.parse(r);
    const cur = j.current_condition?.[0];
    const temp = unit === 'f' ? (cur?.temp_F ?? "--") : (cur?.temp_C ?? "--");
    const desc = weatherDesc(cur);
    const cond = desc || "未知";
    const forecast = (j.weather || []).slice(0, 3).map((d: any) => ({
      date: String(d.date || ''),
      icon: weatherIcon(weatherDesc(d.hourly?.[4])),
      tempHigh: unit === 'f' ? (d.maxtempF ?? "--") : (d.maxtempC ?? "--"),
      tempLow: unit === 'f' ? (d.mintempF ?? "--") : (d.mintempC ?? "--"),
    }));
    return { temp, condition: cond, icon: weatherIcon(cond), forecast };
  } catch { return fallback; }
});

ipcMain.handle("get-battery-info", async () => {
  const r = await runPsAsync("$b=Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue; if($b){ Write-Output ('{\"level\":'+$b.EstimatedChargeRemaining+',\"charging\":true}') } else { Write-Output '{\"level\":100,\"charging\":true}' }");
  if (r) try { return JSON.parse(r); } catch {}
  return { level: 100, charging: true };
});

// 消息角标检测（Windows 混合方案：标题解析优先 + UIA 兜底）
// 白名单：常见聊天/通讯应用（进程名，不含扩展名）
// 消息白名单：Windows 上常见 IM/邮箱进程名（小写匹配在 collectBadges 中处理）
// 设置页中文名清单在 src/components/Settings.tsx BADGE_OPTIONS（与此保持一致）
const BADGE_APPS = ['WeChat', 'Weixin', 'WXWork', 'QQ', 'TIM', 'DingTalk', 'Telegram', 'Discord', 'Feishu', 'Lark', 'Slack', 'ms-teams', 'Teams', 'WhatsApp', 'OUTLOOK', 'MailMaster', 'AliWorkbench'];
// UIA 结果缓存 30s：避免每次轮询都跑慢速 UIA
let uiaBadgeCache: { [name: string]: { count: number; ts: number } } = {};

// 标题解析：微信「微信(3)」/ 旧QQ「QQ(12)」/ 钉钉 等括号内数字 + 文字计数（12条未读/新消息 5）
function parseBadgeFromTitle(title: string): number {
  if (!title) return 0;
  // 括号数字：(3) （3） [3] 【3】 (99+) — 排除年份 19xx/20xx
  const m = title.match(/[（(]\s*(\d{1,4})\s*\+?\s*[)）]/) || title.match(/[【[]\s*(\d{1,4})\s*[】\]]/);
  if (m) {
    const v = parseInt(m[1], 10);
    if (v >= 1900 && v <= 2100) return 0; // 排除年份
    return v;
  }
  // 文字计数：“12条未读” / “新消息 5 条”
  const t = title.match(/(\d{1,4})\s*(?:条\s*)?(?:未读|新消息)/);
  if (t) {
    const v = parseInt(t[1], 10);
    if (v >= 1900 && v <= 2100) return 0;
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

async function collectBadges(): Promise<Array<{ name: string; count: number }>> {
  try {
    // 总开关（设置：是否在 Dock 图标显示未读数）
    if (settings.badgeEnabled === false) return [];
    // 启用名单（设置：各应用开关；默认全白名单）
    const enabled = Array.isArray(settings.badgeApps) && settings.badgeApps.length
      ? settings.badgeApps
      : BADGE_APPS;
    // 1) koffi 直读可见窗口（进程名+标题），零 PowerShell 进程开销（空闲 CPU 优化 9.1）
    const visible = await getVisibleWindowProcesses();
    const titleByProc = new Map<string, string>();
    for (const w of visible) {
      const pn = (w.name || '').toLowerCase();
      const want = enabled.find(e => e.toLowerCase() === pn);
      if (!want) continue;
      // 同进程取第一个有标题的窗口
      if (!titleByProc.has(want) || !titleByProc.get(want)) {
        titleByProc.set(want, w.title || '');
      }
    }

    const result: Array<{ name: string; count: number }> = [];
    const now = Date.now();
    for (const app of enabled) {
      const title = titleByProc.get(app) || '';
      const running = !!title;
      let count = parseBadgeFromTitle(title);
      if (count === 0 && running) {
        // 2) 标题没读到 → UIA 兜底（30s 缓存）
        const key = app;
        const cached = uiaBadgeCache[key];
        if (cached && now - cached.ts < 30000) {
          count = cached.count;
        } else {
          count = await runUiaBadge(app);
          uiaBadgeCache[key] = { count, ts: now };
        }
      }
      result.push({ name: app, count });
    }
    return result;
  } catch { return []; }
}

ipcMain.handle("get-notification-counts", async () => collectBadges());

// 任务进度：koffi 双通道优先（标题正则 + 进度条控件 PBM_GETPOS），失败回退 PowerShell 标题正则
async function collectProgress(): Promise<Array<{ name: string; percent: number }>> {
  try {
    const fast = collectProgressKoffi();
    if (fast.length > 0) return fast;
  } catch { /* 回退旧方案 */ }
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
}

ipcMain.handle("get-task-progress", async () => collectProgress());
ipcMain.handle("auto-hide-dock", async () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide(); });
ipcMain.handle("show-dock", async () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show(); });
ipcMain.handle("app-context-menu", async (e, item) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return;
  const isSystemItem = !!item.iconType || !item.path;
  const hasValidPath = !!(String(item.path || '').trim()) && !/^[\\/]+$/.test(String(item.path || '').trim());
  const template: any[] = [
    // 无效路径禁用「打开」，避免 start "" "\" 报错
    { label: "打开", enabled: hasValidPath, click: () => { launchApp(item.path); } },
    { label: "打开文件位置", enabled: hasValidPath, click: () => {
        resolveTargetPathAsync(item.path).then(target => {
          if (target) spawn("explorer.exe", ["/select," + target], { detached: true, stdio: "ignore" }).unref();
        });
      } },
  ];
  // 文件夹设置（缩略图 + 排序方式）— 对齐官方 3.4.2：文件夹图标右键可设置
  if (item.isFolder) {
    const meta = getFolderMeta(String(item.name));
    template.push({
      label: "文件夹设置",
      submenu: [
        { label: "显示缩略图", type: "checkbox", checked: meta.thumbnails, click: (mi: any) => {
            setFolderMeta(String(item.name), { thumbnails: mi.checked });
          } },
        { type: "separator" },
        { label: "排序方式", submenu: [
            { label: "按名称", type: "radio", checked: meta.sortBy === "name", click: () => setFolderMeta(String(item.name), { sortBy: "name" }) },
            { label: "按修改时间", type: "radio", checked: meta.sortBy === "time", click: () => setFolderMeta(String(item.name), { sortBy: "time" }) },
            { label: "按大小", type: "radio", checked: meta.sortBy === "size", click: () => setFolderMeta(String(item.name), { sortBy: "size" }) },
          ] },
      ],
    });
  }
  // 属性（系统文件属性对话框）— 非系统图标且有真实路径
  if (!isSystemItem && item.path) {
    template.push({
      label: "属性",
      click: () => {
        const full = String(item.path);
        const dir = full.replace(/[\\/][^\\/]*$/, "") || ".";
        const name = full.replace(/^.*[\\/]/, "");
        runPsAsync(`$s=(New-Object -ComObject Shell.Application).Namespace('${dir.replace(/'/g, "''")}').ParseName('${name.replace(/'/g, "''")}'); if($s){ $s.InvokeVerb('properties') }`);
      },
    });
  }
  // 重命名（快捷方式/固定项）— 对齐官方 3.4.2
  if (item.isPinned && !isSystemItem) {
    template.push({
      label: "重命名",
      click: () => {
        win.webContents.send("rename-prompt", { name: String(item.name), path: String(item.path) });
      },
    });
  }
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
  // 菜单生命周期管理：点击 Dock 内部空白区（透明窗口不产生失焦）时由渲染层 mousedown → close-dock-menu
  // 主动关闭；点击其他窗口/区域时系统 TrackPopupMenu 自动关闭（menu-will-close 清理引用）
  activeContextMenu = menu;
  menu.on('menu-will-close', () => { if (activeContextMenu === menu) activeContextMenu = null; });
  menu.popup({ window: win });
});

// 渲染层任意 mousedown → 关闭已打开的原生右键菜单（透明 focusable:false 窗口点击外部无法触发失焦关闭）
ipcMain.on('close-dock-menu', () => {
  try { activeContextMenu?.closePopup(); } catch { /* 已关闭 */ }
  activeContextMenu = null;
});

ipcMain.handle("dock-background-menu", async (e, _pos) => {
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
  activeContextMenu = menu;
  menu.on('menu-will-close', () => { if (activeContextMenu === menu) activeContextMenu = null; });
  menu.popup({ window: win });
});

// 全屏弹层模式（仅 Launchpad 使用）：窗口占满工作区 + 清 region + 移除亚克力（避免全屏 tint 白色背景），关闭时恢复
ipcMain.on("overlay-mode", (_e, active: boolean) => {
  overlayActive = !!active;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    if (overlayActive) {
      const wa = (() => { try { return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea; } catch { return screen.getPrimaryDisplay().workArea; } })();
      mainWindow.setBounds({ x: wa.x, y: wa.y, width: wa.width, height: wa.height });
      clearWindowRegion(mainWindow);
      removeAcrylic(mainWindow.getNativeWindowHandle());
      sendAcrylicState(false);
    } else {
      applySettings();
    }
  } catch { /* ignore */ }
});

// hover 扩容（渲染层上报 hover 图标中心 x，窗口坐标）：
// - bottom/top：高度 +PREVIEW_SPACE；宽度左右各 +HOVER_SIDE 容纳预览 popup（最左/最右图标不截断）
// - left/right：宽度 +HOVER_SIDE；高度上下各 +HOVER_SIDE
// - region = dock 条 ∪ 预览 popup 估算区（CombineRgn）→ 亚克力 tint 只出现在这两块，其余透明穿透（消除白色背景）
// 预览数据到达后渲染层上报精确 popup rect（set-dock-preview-rect）进一步收窄
const HOVER_SIDE = 340;
let lastHoverIconX = 0;
let hoverActive = false;
let previewRect: { left: number; top: number; width: number; height: number } | null = null;

function buildHoverRegion(): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const [w, h] = mainWindow.getSize();
  const pos = settings.dockPosition;
  const radius = settings.dockRadius || 18;
  const rects: Array<{ left: number; top: number; width: number; height: number; radius?: number }> = [];
  if (pos === 'left') {
    rects.push({ left: 0, top: 0, width: DOCK_BAR, height: h, radius });
    if (previewRect) rects.push({ ...previewRect, radius: 10 });
    else if (lastHoverIconX > 0) rects.push({ left: lastHoverIconX - 30, top: 0, width: 640, height: h, radius: 10 });
  } else if (pos === 'right') {
    rects.push({ left: w - DOCK_BAR, top: 0, width: DOCK_BAR, height: h, radius });
    if (previewRect) rects.push({ ...previewRect, radius: 10 });
    else if (lastHoverIconX > 0) rects.push({ left: lastHoverIconX - 610, top: 0, width: 640, height: h, radius: 10 });
  } else if (pos === 'top') {
    const strip = dockStripHeight();
    rects.push({ left: 0, top: 0, width: w, height: strip, radius });
    if (previewRect) rects.push({ ...previewRect, radius: 10 });
    else if (lastHoverIconX > 0) rects.push({ left: lastHoverIconX - 320, top: strip, width: 640, height: PREVIEW_SPACE + 44, radius: 10 });
  } else {
    const strip = dockStripHeight();
    rects.push({ left: 0, top: h - strip, width: w, height: strip, radius });
    if (previewRect) rects.push({ ...previewRect, radius: 10 });
    else if (lastHoverIconX > 0) rects.push({ left: lastHoverIconX - 320, top: 0, width: 640, height: Math.max(0, h - strip), radius: 10 });
  }
  return applyCombinedRegion(mainWindow, rects);
}

ipcMain.on("set-dock-hover", (_e, active: boolean, iconCenterX?: number) => {
  if (overlayActive) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    if (active) {
      hoverActive = true;
      if (typeof iconCenterX === 'number' && iconCenterX > 0) lastHoverIconX = iconCenterX;
      const b = getDockBounds();
      const pos = settings.dockPosition;
      // 以鼠标所在显示器工作区为准（多屏副屏 wa.x/wa.y 可能非 0），扩容后吸附到对应边缘，
      // 避免 bottom 底部越界被系统压缩/抖动、top 顶部越出、left/right 副屏 y 偏移错位
      const wa = (() => { try { return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea; } catch { return screen.getPrimaryDisplay().workArea; } })();
      const pad = MAGNIFY_PAD;
      if (pos === 'bottom') {
        const newH = DOCK_BAR + pad + PREVIEW_SPACE;
        const w = Math.min(b.width + HOVER_SIDE * 2, wa.width);
        mainWindow.setBounds({ x: wa.x + (wa.width - w) / 2, y: wa.y + wa.height - newH, width: w, height: newH });
      } else if (pos === 'top') {
        const newH = DOCK_BAR + pad + 44 + PREVIEW_SPACE;
        const w = Math.min(b.width + HOVER_SIDE * 2, wa.width);
        mainWindow.setBounds({ x: wa.x + (wa.width - w) / 2, y: wa.y, width: w, height: newH });
      } else if (pos === 'left') {
        const newW = DOCK_BAR + NAME_PAD + HOVER_SIDE;
        const newH = Math.min(b.height + HOVER_SIDE, wa.height);
        mainWindow.setBounds({ x: wa.x, y: wa.y + Math.max(0, (wa.height - newH) / 2), width: newW, height: newH });
      } else { // right
        const newW = DOCK_BAR + NAME_PAD + HOVER_SIDE;
        const newH = Math.min(b.height + HOVER_SIDE, wa.height);
        mainWindow.setBounds({ x: wa.x + wa.width - newW, y: wa.y + Math.max(0, (wa.height - newH) / 2), width: newW, height: newH });
      }
      // region = dock 条 ∪ 预览估算区（tint 只在这两块）
      previewRect = null;
      buildHoverRegion();
      // 诊断：hover 扩容稳定后抓一次窗口本体（含 alpha 透明通道），供分析 dock 条透明/圆角/背景
      setTimeout(() => void debugCaptureDock('dock-hover'), 350);
    } else {
      hoverActive = false;
      previewRect = null;
      lastHoverIconX = 0;
      applySettings();
    }
  } catch { /* ignore */ }
});

// 渲染层上报预览 popup 精确矩形（窗口坐标，getBoundingClientRect）→ 收窄 region（消除 popup 外的 tint）
ipcMain.on("set-dock-preview-rect", (_e, rect: { left: number; top: number; width: number; height: number } | null) => {
  previewRect = rect;
  if (!mainWindow || mainWindow.isDestroyed() || overlayActive) return;
  try {
    if (rect && rect.width > 0 && rect.height > 0) buildHoverRegion();
  } catch { /* ignore */ }
});

// FolderView 独立浮窗（问题 3：下载文件夹不应全屏 tint，改为独立圆角浮窗）
let folderWindow: BrowserWindow | null = null;
function openFolderWindow(path: string, name: string): void {
  if (folderWindow && !folderWindow.isDestroyed()) { folderWindow.show(); folderWindow.focus(); return; }
  folderWindow = new BrowserWindow({
    width: 760, height: 540, minWidth: 480, minHeight: 360,
    frame: false, transparent: true, resizable: true,
    skipTaskbar: false, hasShadow: true, show: false, alwaysOnTop: true,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  });
  if (isDev) folderWindow.loadURL("http://localhost:5173/?page=folder&path=" + encodeURIComponent(path) + "&name=" + encodeURIComponent(name));
  else folderWindow.loadFile(join(__dirname, "../dist/index.html"), { query: { page: "folder", path, name } });
  folderWindow.once('ready-to-show', () => {
    if (folderWindow && !folderWindow.isDestroyed()) { folderWindow.show(); applyRoundedRegion(folderWindow, 16); }
  });
  folderWindow.on('closed', () => { folderWindow = null; });
}

ipcMain.handle("open-folder-window", async (_e, path: string, name: string) => { openFolderWindow(String(path || ''), String(name || '文件夹')); });
ipcMain.on("close-folder-window", () => { if (folderWindow && !folderWindow.isDestroyed()) folderWindow.close(); });

ipcMain.handle("open-settings-window", async () => { openSettingsWindow(); });
ipcMain.handle("close-settings-window", async () => { if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close(); });

// 进程别名归一化：Steam 新 UI 的主窗口由 steamwebhelper.exe（CEF）渲染而非 steam.exe，
// 归一化后运行区只显示一个 steam 图标，且与固定项去重、窗口切换匹配对齐（官方行为）
const EXE_ALIAS: Record<string, string> = { steamwebhelper: "steam", gameoverlayui: "steam" };
function normalizeExeName(name: string): string {
  const k = String(name).toLowerCase();
  return EXE_ALIAS[k] ?? k;
}
function exeNameVariants(exeName: string): string[] {
  const norm = normalizeExeName(exeName);
  const set = new Set<string>([norm]);
  for (const [k, v] of Object.entries(EXE_ALIAS)) if (v === norm) set.add(k);
  return [...set];
}

// 已打开的 Dock 右键菜单（供渲染层 mousedown 主动关闭：透明窗口点击外部无法触发失焦）
let activeContextMenu: Electron.Menu | null = null;
// 预览/名称空间高度（bottom 向上、top 向下；hover 时窗口扩容容纳，region 覆盖可见）
const PREVIEW_SPACE = 170;
// 全屏弹层（FolderView/Launchpad）打开期间：窗口占满工作区 + region 清除，避免弹层被 dock 窗口裁剪
let overlayActive = false;

// ===== 统一状态推送：running/badges/progress 由主进程定时检测，仅变化字段推送到渲染层 =====
let lastPushSig = { running: "", badges: "", progress: "" };

function pushDockState(patch: { running?: unknown[]; badges?: unknown[]; progress?: unknown[] }): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("dock-state", patch);
  }
}

// 任务进度迟滞滤波：抑制“进度条控件消失/瞬时回退导致的 0%↔N% 抖动”。
// - 非零 jump：相对上次上报偏差 ≤ JITTER_RANGE 视为采样抖动，不重复推送。
// - 归零：需连续 ZERO_CONFIRM 次都读到 0 才真正上报 0（此前保持上一次非零值，
//   让 Dock 进度条在渲染端平滑淡出，而非瞬间闪清零）。
// 进程从运行列表消失（运行结束）时运行区自动移除对应图标，无需在此清键。
const JITTER_RANGE = 2;        // 允许的采样偏差（百分点）
const ZERO_CONFIRM = 2;        // 归零需连续确认的 tick 数
let progressHold = new Map<string, { last: number; zeroStreak: number }>();
// 待推列表仅含“有效非零进度”；对 0 走归零仲裁
function filterProgress(raw: Array<{ name: string; percent: number }>): Array<{ name: string; percent: number }> {
  const out: Array<{ name: string; percent: number }> = [];
  const seen = new Set<string>();
  for (const p of raw) {
    const name = String(p.name || '').toLowerCase();
    if (!name) continue;
    seen.add(name);
    const rawP = Math.max(0, Math.min(100, Number(p.percent) || 0));
    const prev = progressHold.get(name);
    if (rawP === 0) {
      if (!prev) continue;                       // 从未有过非零 → 无进度
      const streak = (prev.zeroStreak || 0) + 1;
      if (streak < ZERO_CONFIRM) {
        progressHold.set(name, { ...prev, zeroStreak: streak });
        out.push({ name, percent: prev.last }); // 保持上一次非零，等渲染淡出
      } else {
        progressHold.delete(name);               // 确认归零 → 退出
      }
      continue;
    }
    // 非零：抖动抑制 + 更新基线
    progressHold.set(name, { last: rawP, zeroStreak: 0 });
    if (prev && prev.last > 0 && Math.abs(prev.last - rawP) <= JITTER_RANGE) continue;
    out.push({ name, percent: rawP });
  }
  // raw 未包含但之前有进度（进程本次收集未返回）→ 归零计数累积
  for (const [name, v] of progressHold) {
    if (seen.has(name)) continue;
    const streak = (v.zeroStreak || 0) + 1;
    if (streak >= ZERO_CONFIRM) { progressHold.delete(name); }
    else progressHold.set(name, { ...v, zeroStreak: streak });
  }
  return out;
}

async function runStateTick(): Promise<void> {
  try {
    // 1) 运行中应用（含最小化动画检测）
    await runRunningCheck();
    const runList = runningCache?.list ?? [];
    const runSig = runList.map(r => r.name + ":" + r.isRunning).join("|");
    if (runSig !== lastPushSig.running) {
      lastPushSig.running = runSig;
      pushDockState({ running: runList });
    }
    // 2) 消息角标 + 任务进度（并行）
    const [badges, progressRaw] = await Promise.all([collectBadges(), collectProgress()]);
    const bSig = badges.map(b => b.name + ":" + b.count).join("|");
    if (bSig !== lastPushSig.badges) {
      lastPushSig.badges = bSig;
      pushDockState({ badges });
    }
    // 迟滞滤波后的 progress（含归零仲裁 + 抖动抑制）作为推送源
    const progress = filterProgress(progressRaw);
    const pSig = progress.map(p => p.name + ":" + p.percent).join("|");
    if (pSig !== lastPushSig.progress) {
      lastPushSig.progress = pSig;
      pushDockState({ progress });
    }
  } catch { /* 保持静默，下轮重试 */ }
}

// 渲染层就绪信号 → 立即全量推送（首帧即有数据）
ipcMain.on("dock-ready", () => { runStateTick(); });

// 统一状态检测：5s tick（替代渲染层 3 个独立轮询）
setInterval(() => { runStateTick(); }, 5000);

// 启动预热：立即跑一次 running 检测（不等 5s tick），并后台批量预取活跃应用图标（一次 PowerShell）
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
    // 系统主题切换（system 模式）→ 亚克力 tint 跟随
    nativeTheme.on("updated", () => applyAcrylicToWindow());
    createWindow();
    createTray();
    logInfo(`应用启动完成 version=${app.getVersion()} theme=${settings.theme} dock=${settings.dockPosition}`);
  });
}
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });

// 全局错误捕获 → 日志（userData/logs/main.log）
installGlobalErrorLogging();

// ===== 管理员模式检测（官方限制：管理员下拖放动画不播放） =====
let adminMode: boolean | null = null;
function detectAdminMode(): boolean {
  if (adminMode === null) {
    adminMode = isElevated();
    if (adminMode) logWarn("检测到管理员模式运行：拖放动画将降级（官方建议以普通用户运行）");
    else if (adminMode === false) logInfo("普通用户模式运行");
    else logWarn("管理员模式检测失败（未知），按普通模式处理");
  }
  return adminMode === true;
}
// IPC：渲染层查询管理员状态（供提示条 UI）
ipcMain.handle("is-admin-mode", () => detectAdminMode());
detectAdminMode();
