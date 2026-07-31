import { create } from 'zustand';
import type { DockItem, AppSettings } from '../types';

const DEFAULT_SETTINGS: AppSettings = {
  dockPosition: 'bottom', iconSize: 48, magnification: 1.15,
  autoHide: false, showWindowPreview: true,
  showWeather: true, autoStart: false, minimizeAnimation: false,
  theme: 'system',
  previewDelay: 300, previewSize: 240, blurIntensity: 70,
};

interface DockState {
  items: DockItem[];
  pinnedApps: DockItem[];   // 用户手动固定的应用（持久化）
  runningApps: DockItem[];  // 运行中的应用（实时）
  settingsOpen: boolean;
  searchQuery: string;
  systemTime: string;
  settings: AppSettings;

  setItems: (items: DockItem[]) => void;
  setPinnedApps: (apps: DockItem[]) => void;
  setRunningApps: (apps: DockItem[]) => void;
  addItem: (item: DockItem) => void;
  removeItem: (id: string) => void;
  toggleRunning: (id: string, isRunning: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setSearchQuery: (query: string) => void;
  setSystemTime: (time: string) => void;
  setSettings: (settings: AppSettings) => void;
}

export const useDockStore = create<DockState>()((set) => ({
  items: [],
  pinnedApps: [],
  runningApps: [],
  settingsOpen: false,
  searchQuery: '',
  systemTime: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
  settings: DEFAULT_SETTINGS,

  setItems: (items: DockItem[]) => set({ items }),
  setPinnedApps: (apps: DockItem[]) => set({ pinnedApps: apps }),
  setRunningApps: (apps: DockItem[]) => set({ runningApps: apps }),
  addItem: (item: DockItem) => set((state: DockState) => ({ items: [...state.items, item] })),
  removeItem: (id: string) => set((state: DockState) => ({ items: state.items.filter((i) => i.id !== id) })),
  toggleRunning: (id: string, isRunning: boolean) =>
    set((state: DockState) => ({
      items: state.items.map((i) => (i.id === id ? { ...i, isRunning } : i)),
    })),
  setSettingsOpen: (open: boolean) => set({ settingsOpen: open }),
  setSearchQuery: (query: string) => set({ searchQuery: query }),
  setSystemTime: (time: string) => set({ systemTime: time }),
  setSettings: (settings: AppSettings) => set({ settings }),
}));
