import { useEffect, useState } from 'react';
import { useDockStore } from '../store/dockStore';
import type { AppSettings } from '../types';

export function Settings({ standalone = false }: { standalone?: boolean }) {
  const { settingsOpen, setSettingsOpen, settings, setSettings } = useDockStore();
  const [saving, setSaving] = useState(false);

  // 打开时（overlay 模式）从主进程加载设置
  useEffect(() => {
    if (window.electronAPI?.getSettings) {
      window.electronAPI.getSettings().then(s => {
        if (s) setSettings(s);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsOpen]);

  const updateSetting = async <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    const updated = { ...settings, [key]: value };
    setSettings(updated); // 本地 store 立即生效
    setSaving(true);
    try {
      if (window.electronAPI?.setSettings) {
        await window.electronAPI.setSettings(updated);
      }
    } catch {}
    setSaving(false);
  };

  // overlay 模式：未打开时不渲染
  if (!standalone && !settingsOpen) return null;

  return (
    <div className={standalone ? 'settings-standalone' : 'settings-overlay'} onClick={() => !standalone && setSettingsOpen(false)}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>MyDockFinder 偏好设置</h2>
          <button
            className="settings-close"
            onClick={() => {
              if (standalone) window.electronAPI?.closeSettingsWindow();
              else setSettingsOpen(false);
            }}
          >
            ✕
          </button>
        </div>

        <div className="settings-content">
          <div className="settings-section">
            <h3>外观</h3>
            <div className="setting-row">
              <label>Dock 位置</label>
              <select
                value={settings.dockPosition}
                onChange={(e) => updateSetting('dockPosition', e.target.value as 'bottom' | 'left' | 'right')}
              >
                <option value="bottom">底部</option>
                <option value="top">顶部</option>
                <option value="left">左侧</option>
                <option value="right">右侧</option>
              </select>
            </div>
            <div className="setting-row">
              <label>图标大小</label>
              <input
                type="range" min="32" max="96"
                value={settings.iconSize}
                onChange={(e) => updateSetting('iconSize', parseInt(e.target.value))}
              />
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', minWidth: 30, textAlign: 'right' }}>
                {settings.iconSize}px
              </span>
            </div>
            <div className="setting-row">
              <label>放大效果</label>
              <input
                type="range" min="1" max="2" step="0.05"
                value={settings.magnification}
                onChange={(e) => updateSetting('magnification', parseFloat(e.target.value))}
              />
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', minWidth: 30, textAlign: 'right' }}>
                {settings.magnification.toFixed(2)}x
              </span>
            </div>
          </div>

          <div className="settings-section">
            <h3>行为</h3>
            <div className="setting-row">
              <label>自动隐藏</label>
              <input
                type="checkbox"
                checked={settings.autoHide}
                onChange={(e) => updateSetting('autoHide', e.target.checked)}
              />
            </div>
            <div className="setting-row">
              <label>窗口预览</label>
              <input
                type="checkbox"
                checked={settings.showWindowPreview}
                onChange={(e) => updateSetting('showWindowPreview', e.target.checked)}
              />
            </div>
            <div className="setting-row">
              <label>预览延迟 (ms)</label>
              <input
                type="number" min="100" max="2000" step="100"
                value={settings.previewDelay}
                onChange={(e) => updateSetting('previewDelay', parseInt(e.target.value))}
                style={{ width: 80, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: 8, padding: '4px 8px', color: 'white', fontSize: 12 }}
              />
            </div>
            <div className="setting-row">
              <label>最小化动画</label>
              <input
                type="checkbox"
                checked={settings.minimizeAnimation}
                onChange={(e) => updateSetting('minimizeAnimation', e.target.checked)}
              />
            </div>
          </div>

          <div className="settings-section">
            <h3>系统</h3>
            <div className="setting-row">
              <label>开机启动</label>
              <input
                type="checkbox"
                checked={settings.autoStart}
                onChange={(e) => updateSetting('autoStart', e.target.checked)}
              />
            </div>
            <div className="setting-row">
              <label>显示天气</label>
              <input
                type="checkbox"
                checked={settings.showWeather}
                onChange={(e) => updateSetting('showWeather', e.target.checked)}
              />
            </div>
            <div className="setting-row">
              <label>主题</label>
              <select
                value={settings.theme || 'system'}
                onChange={(e) => updateSetting('theme', e.target.value as any)}
              >
                <option value="system">跟随系统</option>
                <option value="dark">深色</option>
                <option value="light">浅色</option>
              </select>
            </div>
          </div>

          <div className="settings-footer">
            {saving && <p style={{ color: 'var(--accent)' }}>保存中...</p>}
            <p>MyDockFinder v1.0.0</p>
            <p className="settings-sub">Windows Dock 增强工具</p>
          </div>
        </div>
      </div>
    </div>
  );
}
