export interface AppInfo {
  name: string;
  path: string;
  icon: string;
  category?: string;
}

export interface RunningAppInfo {
  id: string;
  name: string;
  path: string;
  icon: string;
  isRunning: boolean;
  isPinned: boolean;
  windowTitle?: string;
}

export interface SystemInfo {
  hostname: string;
  platform: string;
  arch: string;
  homeDir: string;
  userName?: string;
  uptime?: number;
  cpu?: number;
  cpuCores?: number;
  memory?: { total: number; free: number; used: number };
  osName?: string;
}

export interface FileInfo {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  modifiedAt?: number;
  thumbnail?: string;
}

export interface DockItem {
  id: string;
  name: string;
  path: string;
  icon: string;
  isRunning: boolean;
  isPinned: boolean;
  windowTitle?: string;
  isFolder?: boolean;
  iconType?: string;
  progress?: number;
}

export interface AppSettings {
  dockPosition: 'bottom' | 'left' | 'right';
  iconSize: number;
  magnification: number;
  autoHide: boolean;
  showWindowPreview: boolean;
  showWeather: boolean;
  autoStart: boolean;
  minimizeAnimation: boolean;
  previewDelay: number;
  previewSize: number;
  blurIntensity: number;
  theme: 'dark' | 'light' | 'system';
}

export interface NotificationCounts {
  name: string;
  count: number;
}

export interface DockStatePatch {
  running?: RunningAppInfo[];
  badges?: NotificationCounts[];
  progress?: Array<{ name: string; percent: number }>;
}

declare global {
  interface Window {
    electronAPI: {
      getRunningApps: () => Promise<RunningAppInfo[]>;
      getAllApps: () => Promise<(AppInfo & { id: string; category: string })[]>;
      getAppIcon: (appPath: string) => Promise<string>;
      getAppIconsBatch: (paths: string[]) => Promise<Record<string, string>>;
      openApp: (appPath: string) => Promise<{ success: boolean; error?: string }>;

      getFolderContents: (folderPath: string) => Promise<FileInfo[]>;

      getSystemInfo: () => Promise<SystemInfo>;

      getWindowPreviews: (appName: string) => Promise<Array<{ title: string; dataUrl: string }>>;

      autoHideDock: () => Promise<void>;
      showDock: () => Promise<void>;

      getSettings: () => Promise<AppSettings>;
      setSettings: (s: Partial<AppSettings>) => Promise<AppSettings>;
      getPinnedApps: () => Promise<Array<{ name: string; path: string; isFolder?: boolean; iconType?: string }>>;
      pinApp: (app: { name: string; path: string; isFolder?: boolean; iconType?: string }) => Promise<Array<{ name: string; path: string; isFolder?: boolean; iconType?: string }>>;
      unpinApp: (name: string) => Promise<Array<{ name: string; path: string; isFolder?: boolean; iconType?: string }>>;
      reorderPinnedApps: (names: string[]) => Promise<Array<{ name: string; path: string; isFolder?: boolean; iconType?: string }>>;
      onPinnedAppsChanged: (callback: (list: Array<{ name: string; path: string; isFolder?: boolean; iconType?: string }>) => void) => () => void;
      getPathForFile: (file: File) => string;
      inspectDroppedPath: (path: string) => Promise<{ name: string; path: string; isFolder: boolean; exists: boolean }>;
      openPath: (path: string) => Promise<{ success: boolean }>;
      getSystemIcons: () => Promise<Array<{ type: string; label: string; path: string; isFolder: boolean }>>;
      addSystemIcon: (type: string) => Promise<Array<{ name: string; path: string; isFolder?: boolean; iconType?: string }>>;
      showSystemIconsMenu: (pos: { x: number; y: number }) => Promise<void>;

      getWeather: () => Promise<{
        temp: string;
        condition: string;
        icon: string;
        forecast: Array<{ date: string; icon: string; tempHigh: string; tempLow: string }>;
      }>;
      getBatteryInfo: () => Promise<{ level: number; charging: boolean }>;
      getNotificationCounts: () => Promise<NotificationCounts[]>;
      getTaskProgress: () => Promise<Array<{ name: string; percent: number }>>;

      sendDockReady: () => void;
      onDockState: (callback: (patch: DockStatePatch) => void) => () => void;
      onAcrylicState: (callback: (active: boolean) => void) => () => void;
      onOpenSettings: (callback: () => void) => () => void;
      onSettingsChanged: (callback: (settings: AppSettings) => void) => () => void;
      closeSettingsWindow: () => Promise<void>;
      openSettingsWindow: () => Promise<void>;
      shouldUseDarkColors: () => Promise<boolean>;
      showAppContextMenu: (item: { id: string; name: string; path: string; isPinned: boolean; isRunning: boolean }) => Promise<void>;
      onDockRemoveItem: (callback: (id: string) => void) => () => void;
    };
  }
}

