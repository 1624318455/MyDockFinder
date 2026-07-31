import { contextBridge, ipcRenderer, webUtils } from 'electron';

const api = {
  // Apps
  getRunningApps: () => ipcRenderer.invoke('get-running-apps'),
  getAllApps: () => ipcRenderer.invoke('get-all-apps'),
  getAppIcon: (appPath: string) => ipcRenderer.invoke('get-app-icon', appPath),
  getAppIconsBatch: (paths: string[]) => ipcRenderer.invoke('get-app-icons-batch', paths),
  openApp: (appPath: string) => ipcRenderer.invoke('open-app', appPath),

  // System
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),

  // Window preview
  getWindowThumbnails: () => ipcRenderer.invoke('get-window-thumbnails'),

  // Dock controls
  autoHideDock: () => ipcRenderer.invoke('auto-hide-dock'),
  showDock: () => ipcRenderer.invoke('show-dock'),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (s: any) => ipcRenderer.invoke('set-settings', s),

  // Pinned apps
  getPinnedApps: () => ipcRenderer.invoke('get-pinned-apps'),
  pinApp: (app: { name: string; path: string; isFolder?: boolean; iconType?: string }) => ipcRenderer.invoke('pin-app', app),
  unpinApp: (name: string) => ipcRenderer.invoke('unpin-app', name),
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
  showAppContextMenu: (item: { id: string; name: string; path: string; isPinned: boolean; isRunning: boolean }) =>
    ipcRenderer.invoke('app-context-menu', item),
  onDockRemoveItem: (callback: (id: string) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, id: string) => callback(id);
    ipcRenderer.on('dock-remove-item', listener);
    return () => ipcRenderer.removeListener('dock-remove-item', listener);
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;

