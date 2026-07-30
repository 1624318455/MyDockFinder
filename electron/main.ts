import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, Notification } from 'electron';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, existsSync, readFileSync, statSync, realpathSync } from 'node:fs';
import { homedir, hostname, uptime } from 'node:os';
import { exec, execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV === 'development';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

function createWindow() {
  const display = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = display.workAreaSize;

  mainWindow = new BrowserWindow({
    width: screenWidth,
    height: 80,
    x: 0,
    y: screenHeight - 80,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    type: 'panel',
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Keep dock visible on all workspaces
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
}

function createTray() {
  const icon = nativeImage.createFromPath(join(__dirname, '../public/icon.png'));
  const smallIcon = icon.isEmpty() 
    ? nativeImage.createFromBuffer(createPlaceholderIcon(), { width: 16, height: 16 })
    : icon.resize({ width: 16, height: 16 });

  tray = new Tray(smallIcon);
  tray.setToolTip('MyDockFinder');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示/隐藏 Dock',
      click: () => {
        if (mainWindow) {
          mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
        }
      },
    },
    { type: 'separator' },
    {
      label: '偏好设置...',
      click: () => mainWindow?.webContents.send('open-settings'),
    },
    { type: 'separator' },
    {
      label: '关于 MyDockFinder',
      click: () => {
        app.showAboutPanel();
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);
}

function createPlaceholderIcon(): Buffer {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const x = i % size, y = Math.floor(i / size);
    const center = size / 2;
    const dist = Math.sqrt((x - center) ** 2 + (y - center) ** 2);
    const alpha = dist < center ? 255 : 0;
    const offset = i * 4;
    buf[offset] = 100; buf[offset + 1] = 100; buf[offset + 2] = 255;
    buf[offset + 3] = alpha;
  }
  return buf;
}

// ========== Get app icon as base64 data URL ==========
function getAppIconBase64(appPath: string): string {
  try {
    const result = execSync(
      `osascript -e 'set iconPath to POSIX file "${appPath}" as alias' -e 'return iconPath' 2>/dev/null; ` +
      `sips -z 64 64 "${appPath}/Contents/Resources/"*.icns --out /tmp/mydockfinder-icon.png 2>/dev/null || true`,
      { timeout: 2000, encoding: 'utf-8' }
    );
    // Try reading the generated icon
    const iconPath = '/tmp/mydockfinder-icon.png';
    if (existsSync(iconPath)) {
      const data = readFileSync(iconPath);
      return `data:image/png;base64,${data.toString('base64')}`;
    }
  } catch {}
  return '';
}

// ========== Extract icon from .app bundle using AppleScript ==========
ipcMain.handle('get-app-icon', async (_event, appPath: string) => {
  try {
    if (!existsSync(appPath)) return '';
    // Use icns2png or sips to extract icon
    const icnsFiles = execSync(
      `find "${appPath}/Contents/Resources" -maxdepth 1 \\( -name "*.icns" -o -name "icon.icns" \\) 2>/dev/null | head -1`,
      { encoding: 'utf-8', timeout: 1000 }
    ).trim();
    
    if (icnsFiles) {
      const outPath = `/tmp/mydockfinder-icon-${Date.now()}.png`;
      execSync(`sips -s format png "${icnsFiles}" --out "${outPath}" 2>/dev/null || true`, { timeout: 2000 });
      if (existsSync(outPath)) {
        const data = readFileSync(outPath);
        try { execSync(`rm "${outPath}"`, { timeout: 500 }); } catch {}
        return `data:image/png;base64,${data.toString('base64')}`;
      }
    }
  } catch {}
  return '';
});

// ========== Get all apps with their icons ==========
ipcMain.handle('get-all-apps', async () => {
  const appDirs = ['/Applications', join(homedir(), 'Applications'), '/System/Applications'];
  const apps: Array<{ name: string; path: string; icon: string; category: string }> = [];
  const seen = new Set<string>();

  for (const dir of appDirs) {
    if (!existsSync(dir)) continue;
    try {
      const items = readdirSync(dir);
      for (const item of items) {
        if (!item.endsWith('.app')) continue;
        const name = item.replace('.app', '');
        if (seen.has(name)) continue;
        seen.add(name);
        const fullPath = join(dir, item);
        apps.push({ name, path: fullPath, icon: '', category: dir.includes('System') ? '系统' : '应用' });
      }
    } catch {}
  }
  return apps;
});

// ========== Get folder contents ==========
ipcMain.handle('get-folder-contents', async (_event, folderPath: string) => {
  try {
    if (!existsSync(folderPath)) return [];
    const items = readdirSync(folderPath).slice(0, 100);
    return items.map((name: string) => {
      const fullPath = join(folderPath, name);
      let stat;
      try { stat = statSync(fullPath); } catch { return null; }
      return {
        name,
        path: fullPath,
        isDirectory: stat.isDirectory(),
        size: stat.size,
        modifiedAt: stat.mtimeMs,
      };
    }).filter(Boolean);
  } catch {
    return [];
  }
});

// ========== Get running applications ==========
ipcMain.handle('get-running-apps', async () => {
  try {
    const result = execSync(
      `osascript -e 'tell application "System Events" to get name of every process whose background only is false'`,
      { encoding: 'utf-8', timeout: 3000 }
    ).trim();
    const names = result.split(', ').filter(Boolean);
    return names.map((name: string, i: number) => ({
      id: `run-${i}`,
      name,
      path: `/Applications/${name}.app`,
      icon: '',
      isRunning: true,
      isPinned: true,
    }));
  } catch {
    return [];
  }
});

// ========== Get system info ==========
ipcMain.handle('get-system-info', async () => {
  try {
    const memInfo = execSync('vm_stat | grep "Pages active"', { encoding: 'utf-8', timeout: 1000 }).trim();
    const cpuInfo = execSync('ps -A -o %cpu | awk "{s+=$1} END {print s}"', { encoding: 'utf-8', timeout: 1000 }).trim();
    return {
      hostname: hostname(),
      platform: process.platform,
      arch: process.arch,
      homeDir: homedir(),
      uptime: uptime(),
      cpu: Math.round(parseFloat(cpuInfo || '0')),
      memory: memInfo,
    };
  } catch {
    return {
      hostname: hostname(),
      platform: process.platform,
      arch: process.arch,
      homeDir: homedir(),
    };
  }
});

// ========== Open application ==========
ipcMain.handle('open-app', async (_event, appPath: string) => {
  try {
    exec(`open "${appPath}"`);
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

// ========== Get recent files ==========
ipcMain.handle('get-recent-files', async () => {
  try {
    const desktopPath = join(homedir(), 'Desktop');
    if (!existsSync(desktopPath)) return [];
    const items = readdirSync(desktopPath).slice(0, 30);
    return items.map((name: string) => {
      const fullPath = join(desktopPath, name);
      try {
        const stat = statSync(fullPath);
        return { name, path: fullPath, isDirectory: stat.isDirectory(), size: stat.size };
      } catch {
        return { name, path: fullPath, isDirectory: false, size: 0 };
      }
    });
  } catch {
    return [];
  }
});

// ========== Get processes list ==========
ipcMain.handle('get-processes', async () => {
  try {
    const result = execSync(
      `ps -eo pid,comm | sort -k2 | head -50`,
      { encoding: 'utf-8', timeout: 2000 }
    );
    const lines = result.trim().split('\n').slice(1);
    return lines.map((line: string) => {
      const parts = line.trim().split(/\s+/);
      return { pid: parseInt(parts[0]), name: parts.slice(1).join(' ') || 'unknown' };
    }).filter((p: { pid: number }) => !isNaN(p.pid));
  } catch {
    return [];
  }
});

// ========== Spotlight/Search ==========
ipcMain.handle('search-spotlight', async (_event, query: string) => {
  if (!query || query.length < 2) return [];
  try {
    const result = execSync(
      `mdfind "kMDItemKind == 'Application' && kMDItemDisplayName == '*${query}*'c" -max 10 2>/dev/null || true`,
      { encoding: 'utf-8', timeout: 3000 }
    );
    return result.trim().split('\n').filter(Boolean).map((p: string) => ({
      name: basename(p).replace('.app', ''),
      path: p,
    }));
  } catch {
    return [];
  }
});

// ========== Get user home folders ==========
ipcMain.handle('get-user-folders', async () => {
  const home = homedir();
  const folders = ['Desktop', 'Downloads', 'Documents', 'Pictures', 'Music', 'Movies', 'Applications'];
  return folders.map(f => ({
    name: f,
    path: join(home, f),
    exists: existsSync(join(home, f)),
  }));
});

// App lifecycle
app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Prevent dock icon from showing in macOS Dock
app.dock?.hide();
