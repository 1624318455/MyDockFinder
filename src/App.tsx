import { useEffect, useMemo } from 'react';
import { Dock } from './components/Dock';
import { Settings } from './components/Settings';
import { FolderView } from './components/FolderView';
import { useDockStore } from './store/dockStore';
import './App.css';

// 独立设置窗口模式：通过 ?page=settings 打开
const isSettingsPage = new URLSearchParams(window.location.search).get('page') === 'settings';
// 独立文件夹浮窗模式：通过 ?page=folder&path=...&name=... 打开（问题 3：不再全屏 tint）
const isFolderPage = new URLSearchParams(window.location.search).get('page') === 'folder';

// 文件夹浮窗根组件：构造 folder 项并渲染 FolderView，关闭按钮 → IPC 关闭独立窗口
function FolderPage() {
  const params = new URLSearchParams(window.location.search);
  const path = params.get('path') || '';
  const name = params.get('name') || '文件夹';
  const folder = useMemo(() => ({
    id: 'folder-' + path, name, path, icon: 'folder',
    isRunning: false, isPinned: true,
  }), [path, name]);
  return (
    <div className="folder-page-root">
      <FolderView
        folder={folder}
        onClose={() => window.electronAPI?.closeFolderWindow?.()}
      />
    </div>
  );
}

function App() {
  useEffect(() => {
    if (window.electronAPI?.onOpenSettings) {
      const cleanup = window.electronAPI.onOpenSettings(() => {
        useDockStore.getState().setSettingsOpen(true);
      });
      return cleanup;
    }
  }, []);

  const { settingsOpen, settings } = useDockStore();

  // 亚克力状态：主进程应用成功后 body.acrylic → CSS 让出背景给系统模糊
  useEffect(() => {
    if (!window.electronAPI?.onAcrylicState) return;
    const unsub = window.electronAPI.onAcrylicState(active => {
      document.body.classList.toggle('acrylic', !!active);
    });
    return () => unsub();
  }, []);

  // 主题：system 跟随系统（nativeTheme.shouldUseDarkColors），否则手动
  useEffect(() => {
    // #RRGGBB → rgba 字符串（外观自定义的 CSS 兜底：亚克力不可用时 tint 仍可见）
    const hexToRgba = (hex: string, alpha: number): string => {
      const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
      if (!m) return '';
      const n = parseInt(m[1], 16);
      return `rgba(${(n >> 16) & 0xFF},${(n >> 8) & 0xFF},${n & 0xFF},${alpha})`;
    };
    const applyTheme = () => {
      const mode = settings?.theme || 'system';
      const dark = mode === 'dark' || (mode === 'system' && window.electronAPI?.shouldUseDarkColors?.());
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
      // 外观自定义：强调色 / 圆角 / 图标间距 / Dock 底色（CSS 变量注入）
      const root = document.documentElement;
      if (settings?.accentColor) root.style.setProperty('--accent', settings.accentColor);
      if (settings?.dockRadius) root.style.setProperty('--dock-radius', settings.dockRadius + 'px');
      if (settings?.iconSpacing) root.style.setProperty('--dock-gap', settings.iconSpacing + 'px');
      if (settings?.tintColor) {
        // 自定义 tint：覆盖 Dock 背景（亚克力合成 + CSS 兜底双路径）
        root.style.setProperty('--dock-bg', hexToRgba(settings.tintColor, dark ? 0.85 : 0.6));
      }
    };
    applyTheme();
    const t = setInterval(applyTheme, 3000); // 系统主题变化跟随（轮询轻量）
    return () => clearInterval(t);
  }, [settings?.theme, settings?.accentColor, settings?.dockRadius, settings?.iconSpacing, settings?.tintColor]);

  // 独立设置窗口：只渲染 Settings（standalone），不渲染 Dock
  if (isSettingsPage) {
    return <Settings standalone />;
  }

  // 独立文件夹浮窗：只渲染 FolderView（不渲染 Dock）
  if (isFolderPage) {
    return <FolderPage />;
  }

  return (
    <div className="app" style={{ opacity: settingsOpen ? 0.3 : 1 }}>
      <Dock />
      <Settings />
    </div>
  );
}

export default App;
