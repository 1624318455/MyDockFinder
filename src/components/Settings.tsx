
import { useDockStore } from '../store/dockStore';

export function Settings() {
  const { settingsOpen, setSettingsOpen } = useDockStore();

  if (!settingsOpen) return null;

  return (
    <div className="settings-overlay" onClick={() => setSettingsOpen(false)}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>MyDockFinder 偏好设置</h2>
          <button className="settings-close" onClick={() => setSettingsOpen(false)}>
            ✕
          </button>
        </div>

        <div className="settings-content">
          <div className="settings-section">
            <h3>外观</h3>
            <div className="setting-row">
              <label>Dock 位置</label>
              <select defaultValue="bottom">
                <option value="bottom">底部</option>
                <option value="left">左侧</option>
                <option value="right">右侧</option>
              </select>
            </div>
            <div className="setting-row">
              <label>图标大小</label>
              <input type="range" min="32" max="96" defaultValue="56" />
            </div>
            <div className="setting-row">
              <label>放大效果</label>
              <input type="range" min="1" max="2" step="0.1" defaultValue="1.15" />
            </div>
          </div>

          <div className="settings-section">
            <h3>行为</h3>
            <div className="setting-row">
              <label>自动隐藏</label>
              <input type="checkbox" />
            </div>
            <div className="setting-row">
              <label>窗口预览</label>
              <input type="checkbox" defaultChecked />
            </div>
            <div className="setting-row">
              <label>显示最近文件</label>
              <input type="checkbox" defaultChecked />
            </div>
          </div>

          <div className="settings-section">
            <h3>系统</h3>
            <div className="setting-row">
              <label>开机启动</label>
              <input type="checkbox" />
            </div>
            <div className="setting-row">
              <label>显示天气</label>
              <input type="checkbox" defaultChecked />
            </div>
          </div>

          <div className="settings-footer">
            <p>MyDockFinder v1.0.0</p>
            <p className="settings-sub">macOS Dock 增强工具</p>
          </div>
        </div>
      </div>
    </div>
  );
}
