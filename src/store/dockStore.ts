import { create } from 'zustand';
import type { DockItem, AppSettings, WeatherData } from '../types';

const DEFAULT_SETTINGS: AppSettings = {
  dockPosition: 'bottom', iconSize: 48, magnification: 1.15,
  autoHide: false, showWindowPreview: true,
  showWeather: true, autoStart: false, minimizeAnimation: 'fly',
  theme: 'system',
  accentColor: '#007aff',
  tintColor: '',
  iconSpacing: 6,
  dockRadius: 18,
  previewDelay: 300, previewSize: 240, blurIntensity: 70,
  badgeEnabled: true,
  weatherCity: '',
  weatherUnit: 'c',
  weatherRefreshMs: 600000,
  minimizeDuration: 500,
  minimizeEasing: 'easeOut',
  backgroundMaterial: 'auto',
};

interface DockState {
  items: DockItem[];
  pinnedApps: DockItem[];   // 用户手动固定的应用（持久化）
  runningApps: DockItem[];  // 运行中的应用（实时）
  settingsOpen: boolean;
  searchQuery: string;
  systemTime: string;
  settings: AppSettings;
  weather: WeatherData | null; // 实时天气（Dock 天气图标数据源）

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
  setWeather: (w: WeatherData | null) => void;
}

export const useDockStore = create<DockState>()((set) => ({
  items: [],
  pinnedApps: [],
  runningApps: [],
  settingsOpen: false,
  searchQuery: '',
  systemTime: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
  settings: DEFAULT_SETTINGS,
  weather: null,

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
  setWeather: (weather: WeatherData | null) => set({ weather }),
}));
