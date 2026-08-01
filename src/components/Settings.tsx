import { useEffect, useState } from 'react';
import { useDockStore } from '../store/dockStore';
import type { AppSettings } from '../types';

// 消息计数应用清单（与 electron/main.ts BADGE_APPS/BADGE_LABELS 保持一致）
const BADGE_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'WeChat', label: '微信' },
  { key: 'Weixin', label: '微信 (UWP)' },
  { key: 'WXWork', label: '企业微信' },
  { key: 'QQ', label: 'QQ' },
  { key: 'TIM', label: 'TIM' },
  { key: 'DingTalk', label: '钉钉' },
  { key: 'Feishu', label: '飞书' },
  { key: 'Lark', label: 'Lark' },
  { key: 'Slack', label: 'Slack' },
  { key: 'Teams', label: 'Teams' },
  { key: 'Telegram', label: 'Telegram' },
  { key: 'Discord', label: 'Discord' },
  { key: 'WhatsApp', label: 'WhatsApp' },
  { key: 'OUTLOOK', label: 'Outlook' },
  { key: 'MailMaster', label: '网易邮箱大师' },
  { key: 'AliWorkbench', label: '阿里旺旺' },
];

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
            <div className="setting-row">
              <label>强调色</label>
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(settings.accentColor) ? settings.accentColor : '#007aff'}
                onChange={(e) => updateSetting('accentColor', e.target.value)}
                style={{ width: 40, height: 26, padding: 0, border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, background: 'transparent', cursor: 'pointer' }}
              />
              <span style={{ fontSize: 11, color: 'var(--text-secondary, rgba(255,255,255,0.5))', marginLeft: 6 }}>{settings.accentColor || '#007aff'}</span>
            </div>
            <div className="setting-row">
              <label>Dock 底色</label>
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(settings.tintColor) ? settings.tintColor : '#1e1e1e'}
                onChange={(e) => updateSetting('tintColor', e.target.value)}
                style={{ width: 40, height: 26, padding: 0, border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, background: 'transparent', cursor: 'pointer' }}
              />
              <button
                onClick={() => updateSetting('tintColor', '')}
                style={{ marginLeft: 6, background: 'var(--dock-input-bg, rgba(255,255,255,0.06))', border: 'none', color: 'var(--text-secondary, rgba(255,255,255,0.5))', borderRadius: 6, padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}
              >
                跟随主题
              </button>
            </div>
            <div className="setting-row">
              <label>Dock 位置</label>
              <select
                value={settings.dockPosition}
                onChange={(e) => updateSetting('dockPosition', e.target.value as 'bottom' | 'top' | 'left' | 'right')}
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
              <span style={{ fontSize: 11, color: 'var(--text-secondary, rgba(255,255,255,0.5))', minWidth: 30, textAlign: 'right' }}>
                {settings.iconSize}px
              </span>
            </div>
            <div className="setting-row">
              <label>图标间距</label>
              <input
                type="range" min="0" max="20"
                value={settings.iconSpacing}
                onChange={(e) => updateSetting('iconSpacing', parseInt(e.target.value))}
              />
              <span style={{ fontSize: 11, color: 'var(--text-secondary, rgba(255,255,255,0.5))', minWidth: 30, textAlign: 'right' }}>
                {settings.iconSpacing}px
              </span>
            </div>
            <div className="setting-row">
              <label>圆角</label>
              <input
                type="range" min="0" max="32"
                value={settings.dockRadius}
                onChange={(e) => updateSetting('dockRadius', parseInt(e.target.value))}
              />
              <span style={{ fontSize: 11, color: 'var(--text-secondary, rgba(255,255,255,0.5))', minWidth: 30, textAlign: 'right' }}>
                {settings.dockRadius}px
              </span>
            </div>
            <div className="setting-row">
              <label>放大效果</label>
              <input
                type="range" min="1" max="2" step="0.05"
                value={settings.magnification}
                onChange={(e) => updateSetting('magnification', parseFloat(e.target.value))}
              />
              <span style={{ fontSize: 11, color: 'var(--text-secondary, rgba(255,255,255,0.5))', minWidth: 30, textAlign: 'right' }}>
                {settings.magnification.toFixed(2)}x
              </span>
            </div>
            <div className="setting-row">
              <label>背景材质</label>
              <select
                value={settings.backgroundMaterial ?? 'acrylic'}
                onChange={(e) => updateSetting('backgroundMaterial', e.target.value as 'auto' | 'mica' | 'acrylic')}
                style={{ background: 'var(--dock-input-bg, rgba(255,255,255,0.06))', border: '1px solid var(--dock-border, rgba(255,255,255,0.04))', borderRadius: 8, padding: '4px 8px', color: 'var(--text-primary, white)', fontSize: 12 }}
              >
                <option value="acrylic">亚克力 Acrylic（默认）</option>
                <option value="mica">云母 Mica（Win11 22H2+）</option>
                <option value="auto">自动</option>
              </select>
            </div>
            <div className="setting-row">
              <label>背景模糊强度</label>
              <input
                type="range" min="1" max="100"
                value={settings.blurIntensity ?? 70}
                onChange={(e) => updateSetting('blurIntensity', parseInt(e.target.value))}
              />
              <span style={{ fontSize: 11, color: 'var(--text-secondary, rgba(255,255,255,0.5))', minWidth: 30, textAlign: 'right' }}>
                {settings.blurIntensity ?? 70}%
              </span>
            </div>
            <p style={{ fontSize: 10.5, color: 'var(--text-secondary)', opacity: 0.7, margin: '4px 0 0' }}>
              云母为系统材质且铺满整个窗口区域（含两侧透明区）；亚克力仅覆盖 Dock 条并可调强度/底色
            </p>
          </div>

          <div className="settings-section">
            <h3>预览</h3>
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
                style={{ width: 80, background: 'var(--dock-input-bg, rgba(255,255,255,0.06))', border: '1px solid var(--dock-border, rgba(255,255,255,0.04))', borderRadius: 8, padding: '4px 8px', color: 'var(--text-primary, white)', fontSize: 12 }}
              />
            </div>
            <div className="setting-row">
              <label>预览大小</label>
              <input
                type="range" min="160" max="420" step="10"
                value={settings.previewSize}
                onChange={(e) => updateSetting('previewSize', parseInt(e.target.value))}
              />
              <span style={{ fontSize: 11, color: 'var(--text-secondary, rgba(255,255,255,0.5))', minWidth: 30, textAlign: 'right' }}>
                {settings.previewSize}px
              </span>
            </div>
          </div>

          <div className="settings-section">
            <h3>最小化</h3>
            <div className="setting-row">
              <label>最小化动画</label>
              <select
                value={settings.minimizeAnimation}
                onChange={(e) => updateSetting('minimizeAnimation', e.target.value as 'fly' | 'genie' | 'scale' | 'off')}
                style={{ background: 'var(--dock-input-bg, rgba(255,255,255,0.06))', border: '1px solid var(--dock-border, rgba(255,255,255,0.04))', borderRadius: 8, padding: '4px 8px', color: 'var(--text-primary, white)', fontSize: 12 }}
              >
                <option value="fly">飞入 Dock（默认）</option>
                <option value="genie">Genie 吸入</option>
                <option value="scale">缩放吸入</option>
                <option value="off">关闭</option>
              </select>
            </div>
            <div className="setting-row">
              <label>动画时长 (ms)</label>
              <input
                type="range" min="150" max="1500" step="50"
                value={settings.minimizeDuration ?? 500}
                onChange={(e) => updateSetting('minimizeDuration', parseInt(e.target.value))}
              />
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', minWidth: 30, textAlign: 'right' }}>
                {settings.minimizeDuration ?? 500}ms
              </span>
            </div>
            <div className="setting-row">
              <label>缓动曲线</label>
              <select
                value={settings.minimizeEasing ?? 'easeOut'}
                onChange={(e) => updateSetting('minimizeEasing', e.target.value)}
                style={{ background: 'var(--dock-input-bg, rgba(255,255,255,0.06))', border: '1px solid var(--dock-border, rgba(255,255,255,0.04))', borderRadius: 8, padding: '4px 8px', color: 'var(--text-primary, white)', fontSize: 12 }}
              >
                <option value="easeOut">先快后慢 (easeOut)</option>
                <option value="easeIn">先慢后快 (easeIn)</option>
                <option value="easeInOut">缓入缓出</option>
                <option value="ease">平滑 (ease)</option>
                <option value="linear">线性</option>
              </select>
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
              <label>显示天气</label>
              <input
                type="checkbox"
                checked={settings.showWeather}
                onChange={(e) => updateSetting('showWeather', e.target.checked)}
              />
            </div>
          </div>

          <div className="settings-section">
            <h3>天气</h3>
            <div className="setting-row">
              <label>城市</label>
              <input
                type="text"
                placeholder="留空 = 自动定位"
                value={settings.weatherCity ?? ''}
                onChange={(e) => updateSetting('weatherCity', e.target.value)}
                style={{ width: 140, background: 'var(--dock-input-bg, rgba(255,255,255,0.06))', border: '1px solid var(--dock-border, rgba(255,255,255,0.04))', borderRadius: 8, padding: '4px 8px', color: 'var(--text-primary, white)', fontSize: 12 }}
              />
            </div>
            <div className="setting-row">
              <label>温度单位</label>
              <select
                value={settings.weatherUnit ?? 'c'}
                onChange={(e) => updateSetting('weatherUnit', e.target.value as 'c' | 'f')}
                style={{ background: 'var(--dock-input-bg, rgba(255,255,255,0.06))', border: '1px solid var(--dock-border, rgba(255,255,255,0.04))', borderRadius: 8, padding: '4px 8px', color: 'var(--text-primary, white)', fontSize: 12 }}
              >
                <option value="c">摄氏 (°C)</option>
                <option value="f">华氏 (°F)</option>
              </select>
            </div>
            <div className="setting-row">
              <label>更新频率</label>
              <select
                value={settings.weatherRefreshMs ?? 600000}
                onChange={(e) => updateSetting('weatherRefreshMs', parseInt(e.target.value))}
                style={{ background: 'var(--dock-input-bg, rgba(255,255,255,0.06))', border: '1px solid var(--dock-border, rgba(255,255,255,0.04))', borderRadius: 8, padding: '4px 8px', color: 'var(--text-primary, white)', fontSize: 12 }}
              >
                <option value={600000}>10 分钟</option>
                <option value={1800000}>30 分钟</option>
                <option value={3600000}>1 小时</option>
              </select>
            </div>
            <p style={{ fontSize: 10.5, color: 'var(--text-secondary)', opacity: 0.7, margin: '4px 0 0' }}>
              Dock 图标为实时天气，预览窗口为未来天气，两者可能有出入（官方 5.2.2）
            </p>
          </div>

          <div className="settings-section">
            <h3>消息提示</h3>
            <div className="setting-row">
              <label>Dock 图标显示未读数</label>
              <input
                type="checkbox"
                checked={settings.badgeEnabled !== false}
                onChange={(e) => updateSetting('badgeEnabled', e.target.checked)}
              />
            </div>
            <div className="setting-row" style={{ alignItems: 'flex-start' }}>
              <label>应用</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
                {BADGE_OPTIONS.map(opt => {
                  const list = Array.isArray(settings.badgeApps) && settings.badgeApps.length
                    ? settings.badgeApps
                    : BADGE_OPTIONS.map(o => o.key);
                  const checked = list.includes(opt.key);
                  return (
                    <label key={opt.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const cur = Array.isArray(settings.badgeApps) && settings.badgeApps.length
                            ? [...settings.badgeApps]
                            : BADGE_OPTIONS.map(o => o.key);
                          const next = e.target.checked ? [...cur, opt.key] : cur.filter(k => k !== opt.key);
                          updateSetting('badgeApps', next);
                        }}
                      />
                      {opt.label}
                    </label>
                  );
                })}
              </div>
            </div>
            <p style={{ fontSize: 10.5, color: 'var(--text-secondary)', opacity: 0.7, margin: '4px 0 0' }}>
              仅统计未读数量，不读取聊天内容（官方 5.1：消息计数算法为原创，无公开接口）
            </p>
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
