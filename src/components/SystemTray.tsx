import { useEffect, useState, useRef } from 'react';
import { useDockStore } from '../store/dockStore';

interface BatteryInfo {
  level: number;
  charging: boolean;
}

export function SystemTray() {
  const { systemTime, setSystemTime } = useDockStore();
  const [showMenu, setShowMenu] = useState(false);
  const [dateStr, setDateStr] = useState('');
  const [battery, setBattery] = useState<BatteryInfo>({ level: 100, charging: true });
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setSystemTime(now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
      setDateStr(
        now.toLocaleDateString('zh-CN', {
          month: 'numeric',
          day: 'numeric',
          weekday: 'short',
        })
      );
    };
    updateTime();
    const timer = setInterval(updateTime, 10000);
    return () => clearInterval(timer);
  }, [setSystemTime]);

  // Load battery info
  useEffect(() => {
    const loadBattery = async () => {
      if (window.electronAPI?.getBatteryInfo) {
        try {
          const b = await window.electronAPI.getBatteryInfo();
          setBattery(b);
        } catch {}
      }
    };
    loadBattery();
    const interval = setInterval(loadBattery, 30000);
    return () => clearInterval(interval);
  }, []);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    if (showMenu) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [showMenu]);

  return (
    <div className="system-tray">
      {/* 天气已移至 Dock 系统图标（对齐官方 3.2.1：添加系统图标-天气预报） */}

      {/* Battery */}
      <div className="tray-item" title={`电量 ${battery.level}%${battery.charging ? ' (充电中)' : ''}`}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ color: 'var(--text-secondary)' }}>
          <rect x="1" y="3" width="10" height="8" rx="1.5" stroke="currentColor" strokeWidth="1" opacity="0.6"/>
          <rect x="1.5" y="3.5" width={battery.level / 100 * 9} height="7" rx="0.8" fill="currentColor" opacity="0.6"/>
          <rect x="11" y="5.5" width="2" height="3" rx="1" fill="currentColor" opacity="0.4"/>
        </svg>
        {battery.charging && <span style={{ fontSize: 9, marginLeft: 2, opacity: 0.5 }}>⚡</span>}
      </div>

      {/* Date & Time */}
      <div className="tray-item clock-widget" onClick={() => setShowMenu(!showMenu)}>
        <div className="tray-date">{dateStr}</div>
        <div className="tray-time">{systemTime}</div>
      </div>

      {/* Quick Menu */}
      {showMenu && (
        <div className="tray-menu" ref={menuRef}>
          <div className="tray-menu-header">
            <span>快捷操作</span>
          </div>
          <div className="tray-menu-item" onClick={() => {
            window.electronAPI?.openApp('ms-settings:');
            setShowMenu(false);
          }}>
            <span className="menu-icon">⚙️</span>
            系统设置
          </div>
          <div className="tray-menu-item" onClick={() => {
            window.electronAPI?.openApp('taskmgr');
            setShowMenu(false);
          }}>
            <span className="menu-icon">📊</span>
            任务管理器
          </div>
          <div className="tray-menu-separator" />
          <div className="tray-menu-item" onClick={() => {
            window.electronAPI?.openSettingsWindow();
            setShowMenu(false);
          }}>
            <span className="menu-icon">🎨</span>
            MyDockFinder 偏好设置
          </div>
          <div className="tray-menu-separator" />
          <div className="tray-menu-item" onClick={() => {
            window.electronAPI?.openApp('cmd.exe /c rundll32.exe user32.dll,LockWorkStation');
            setShowMenu(false);
          }}>
            <span className="menu-icon">🔒</span>
            锁定屏幕
          </div>
        </div>
      )}
    </div>
  );
}
