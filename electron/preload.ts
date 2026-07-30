import { contextBridge, ipcRenderer } from 'electron';

const api = {
  // Apps
  getRunningApps: () => ipcRenderer.invoke('get-running-apps'),
  getAllApps: () => ipcRenderer.invoke('get-all-apps'),
  getAppIcon: (appPath: string) => ipcRenderer.invoke('get-app-icon', appPath),
  openApp: (appPath: string) => ipcRenderer.invoke('open-app', appPath),
  searchSpotlight: (query: string) => ipcRenderer.invoke('search-spotlight', query),

  // Files & Folders
  getRecentFiles: () => ipcRenderer.invoke('get-recent-files'),
  getFolderContents: (folderPath: string) => ipcRenderer.invoke('get-folder-contents', folderPath),
  getUserFolders: () => ipcRenderer.invoke('get-user-folders'),

  // System
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  getProcesses: () => ipcRenderer.invoke('get-processes'),

  // Events
  onOpenSettings: (callback: () => void) => {
    ipcRenderer.on('open-settings', callback);
    return () => ipcRenderer.removeListener('open-settings', callback);
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;
