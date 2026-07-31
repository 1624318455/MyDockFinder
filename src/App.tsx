import { useEffect } from 'react';
import { Dock } from './components/Dock';
import { Settings } from './components/Settings';
import { useDockStore } from './store/dockStore';
import './App.css';

// 独立设置窗口模式：通过 ?page=settings 打开
const isSettingsPage = new URLSearchParams(window.location.search).get('page') === 'settings';

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

  // 主题：system 跟随系统（nativeTheme.shouldUseDarkColors），否则手动
  useEffect(() => {
    const applyTheme = () => {
      const mode = settings?.theme || 'system';
      const dark = mode === 'dark' || (mode === 'system' && window.electronAPI?.shouldUseDarkColors?.());
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    };
    applyTheme();
    const t = setInterval(applyTheme, 3000); // 系统主题变化跟随（轮询轻量）
    return () => clearInterval(t);
  }, [settings?.theme]);

  // 独立设置窗口：只渲染 Settings（standalone），不渲染 Dock
  if (isSettingsPage) {
    return <Settings standalone />;
  }

  return (
    <div className="app" style={{ opacity: settingsOpen ? 0.3 : 1 }}>
      <Dock />
      <Settings />
    </div>
  );
}

export default App;
