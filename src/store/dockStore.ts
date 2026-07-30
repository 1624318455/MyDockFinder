import { create } from 'zustand';
import type { DockItem, FileInfo } from '../types';

interface DockState {
  items: DockItem[];
  settingsOpen: boolean;
  searchQuery: string;
  recentFiles: FileInfo[];
  systemTime: string;

  setItems: (items: DockItem[]) => void;
  addItem: (item: DockItem) => void;
  removeItem: (id: string) => void;
  toggleRunning: (id: string, isRunning: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setSearchQuery: (query: string) => void;
  setRecentFiles: (files: FileInfo[]) => void;
  setSystemTime: (time: string) => void;
}

export const useDockStore = create<DockState>()((set) => ({
  items: [],
  settingsOpen: false,
  searchQuery: '',
  recentFiles: [],
  systemTime: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),

  setItems: (items: DockItem[]) => set({ items }),
  addItem: (item: DockItem) => set((state: DockState) => ({ items: [...state.items, item] })),
  removeItem: (id: string) => set((state: DockState) => ({ items: state.items.filter((i) => i.id !== id) })),
  toggleRunning: (id: string, isRunning: boolean) =>
    set((state: DockState) => ({
      items: state.items.map((i) => (i.id === id ? { ...i, isRunning } : i)),
    })),
  setSettingsOpen: (open: boolean) => set({ settingsOpen: open }),
  setSearchQuery: (query: string) => set({ searchQuery: query }),
  setRecentFiles: (files: FileInfo[]) => set({ recentFiles: files }),
  setSystemTime: (time: string) => set({ systemTime: time }),
}));
