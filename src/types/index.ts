export interface AppInfo {
  name: string;
  path: string;
  icon: string;
}

export interface RunningAppInfo {
  id: string;
  name: string;
  path: string;
  icon: string;
  isRunning: boolean;
  isPinned: boolean;
}

export interface SystemInfo {
  hostname: string;
  platform: string;
  arch: string;
  homeDir: string;
  uptime?: number;
  cpu?: number;
  memory?: string;
}

export interface FileInfo {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  modifiedAt?: number;
}

export interface DockItem {
  id: string;
  name: string;
  path: string;
  icon: string;
  isRunning: boolean;
  isPinned: boolean;
}

export interface FolderInfo {
  name: string;
  path: string;
  exists: boolean;
}

declare global {
  interface Window {
    electronAPI: {
      getRunningApps: () => Promise<RunningAppInfo[]>;
      getAllApps: () => Promise<AppInfo[]>;
      getAppIcon: (appPath: string) => Promise<string>;
      openApp: (appPath: string) => Promise<{ success: boolean; error?: string }>;
      searchSpotlight: (query: string) => Promise<{ name: string; path: string }[]>;
      getRecentFiles: () => Promise<FileInfo[]>;
      getFolderContents: (folderPath: string) => Promise<FileInfo[]>;
      getUserFolders: () => Promise<FolderInfo[]>;
      getSystemInfo: () => Promise<SystemInfo>;
      getProcesses: () => Promise<{ pid: number; name: string }[]>;
      onOpenSettings: (callback: () => void) => () => void;
    };
  }
}
