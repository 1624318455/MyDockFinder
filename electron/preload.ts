import { contextBridge, ipcRenderer, webUtils } from 'electron';

const api = {
  // Apps
  getRunningApps: () => ipcRenderer.invoke('get-running-apps'),
  getAllApps: () => ipcRenderer.invoke('get-all-apps'),
  getAppIcon: (appPath: string) => ipcRenderer.invoke('get-app-icon', appPath),
  getAppIconsBatch: (paths: string[]) => ipcRenderer.invoke('get-app-icons-batch', paths),
  openApp: (appPath: string) => ipcRenderer.invoke('open-app', appPath),
  // 打开应用（带显示名）：先按显示名匹配已运行窗口切换，否则正常启动（战网 temp_ 等场景）
  openAppWithName: (appPath: string, displayName?: string) => ipcRenderer.invoke('open-app-with-name', appPath, displayName),
  // 文件夹独立浮窗（下载/文件夹图标点击 → 独立圆角窗口，避免全屏 tint）
  openFolderWindow: (path: string, name: string) => ipcRenderer.invoke('open-folder-window', path, name),
  closeFolderWindow: () => ipcRenderer.send('close-folder-window'),
  getFolderContents: (folderPath: string) => ipcRenderer.invoke('get-folder-contents', folderPath),
  // 文件拖出到系统桌面/资源管理器（webContents.startDrag）
  startDrag: (filePath: string) => ipcRenderer.send('start-drag', filePath),

  // System
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),

  // Window preview (process-title matched window thumbnails)
  getWindowPreviews: (appName: string) => ipcRenderer.invoke('get-window-previews', appName),
  // Dock 内容宽度上报（窗口收窄为内容宽，左右两侧鼠标穿透）
  setDockContentSize: (width: number) => ipcRenderer.send('dock-content-size', width),
  setDockContentHeight: (height: number) => ipcRenderer.send('dock-content-height', height),
  // 管理员模式检测（官方限制：管理员下拖放动画不播放）
  isAdminMode: () => ipcRenderer.invoke('is-admin-mode'),

  // Dock controls
  autoHideDock: () => ipcRenderer.invoke('auto-hide-dock'),
  showDock: () => ipcRenderer.invoke('show-dock'),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (s: any) => ipcRenderer.invoke('set-settings', s),

  // Pinned apps
  getPinnedApps: () => ipcRenderer.invoke('get-pinned-apps'),
  // 渲染层 mousedown → 关闭已打开的原生右键菜单（透明窗口点击外部无法触发失焦关闭）
  closeDockMenu: () => ipcRenderer.send('close-dock-menu'),
  // 全屏弹层（FolderView/Launchpad）开/关：窗口占满工作区 + 清 region，关闭恢复 dock 尺寸
  setOverlayMode: (active: boolean) => ipcRenderer.send('overlay-mode', active),
  // hover 扩容：hover 图标时窗口增高/加宽容纳名称与预览 popup；上报图标中心 x（窗口坐标）
  setDockHover: (active: boolean, iconCenterX?: number) => ipcRenderer.send('set-dock-hover', active, iconCenterX),
  pinApp: (app: { name: string; path: string; isFolder?: boolean; iconType?: string }) => ipcRenderer.invoke('pin-app', app),
  unpinApp: (name: string) => ipcRenderer.invoke('unpin-app', name),
  reorderPinnedApps: (names: string[]) => ipcRenderer.invoke('reorder-pinned-apps', names),
  onPinnedAppsChanged: (callback: (list: Array<{ name: string; path: string; isFolder?: boolean; iconType?: string }>) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, list: Array<{ name: string; path: string; isFolder?: boolean; iconType?: string }>) => callback(list);
    ipcRenderer.on('pinned-apps-changed', listener);
    return () => ipcRenderer.removeListener('pinned-apps-changed', listener);
  },

  // Drag & drop
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  inspectDroppedPath: (path: string) => ipcRenderer.invoke('inspect-dropped-path', path),
  openPath: (path: string) => ipcRenderer.invoke('open-path', path),

  // System icons
  getSystemIcons: () => ipcRenderer.invoke('get-system-icons'),
  addSystemIcon: (type: string) => ipcRenderer.invoke('add-system-icon', type),
  showSystemIconsMenu: (pos: { x: number; y: number }) => ipcRenderer.invoke('dock-background-menu', pos),

  // Weather
  getWeather: () => ipcRenderer.invoke('get-weather'),
  getBatteryInfo: () => ipcRenderer.invoke('get-battery-info'),

  // Notifications
  getNotificationCounts: () => ipcRenderer.invoke('get-notification-counts'),

  // Task progress
  getTaskProgress: () => ipcRenderer.invoke('get-task-progress'),

  // Events
  // Dock ready signal (prevents white flash)
  sendDockReady: () => ipcRenderer.send('dock-ready'),
  onDockState: (callback: (patch: any) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, patch: any) => callback(patch);
    ipcRenderer.on('dock-state', listener);
    return () => ipcRenderer.removeListener('dock-state', listener);
  },
  onAcrylicState: (callback: (active: boolean) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, active: boolean) => callback(active);
    ipcRenderer.on('acrylic-state', listener);
    return () => ipcRenderer.removeListener('acrylic-state', listener);
  },
  onOpenSettings: (callback: () => void) => {
    ipcRenderer.on('open-settings', callback);
    return () => ipcRenderer.removeListener('open-settings', callback);
  },
  onSettingsChanged: (callback: (settings: any) => void) => {
    ipcRenderer.on('settings-changed', (_e, s) => callback(s));
    return () => ipcRenderer.removeListener('settings-changed', callback);
  },
  closeSettingsWindow: () => ipcRenderer.invoke('close-settings-window'),
  openSettingsWindow: () => ipcRenderer.invoke('open-settings-window'),
  shouldUseDarkColors: () => ipcRenderer.invoke('should-use-dark-colors'),
  showAppContextMenu: (item: { id: string; name: string; path: string; isPinned: boolean; isRunning: boolean; isFolder?: boolean; iconType?: string }) =>
    ipcRenderer.invoke('app-context-menu', item),
  // 重命名快捷方式/固定项
  renamePinnedItem: (args: { name: string; newName: string; path: string }) => ipcRenderer.invoke('rename-pinned-item', args),
  // 文件夹显示设置（缩略图/排序）持久化
  setFolderOptions: (args: { name: string; thumbnails?: boolean; sortBy?: 'name' | 'time' | 'size' }) => ipcRenderer.invoke('set-folder-options', args),
  // 主进程 → 渲染层：请求重命名输入
  onRenamePrompt: (callback: (item: { name: string; path: string }) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, item: { name: string; path: string }) => callback(item);
    ipcRenderer.on('rename-prompt', listener);
    return () => ipcRenderer.removeListener('rename-prompt', listener);
  },
  onDockRemoveItem: (callback: (id: string) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, id: string) => callback(id);
    ipcRenderer.on('dock-remove-item', listener);
    return () => ipcRenderer.removeListener('dock-remove-item', listener);
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;

