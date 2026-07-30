import { useEffect, useState, useRef } from 'react';
import { useDockStore } from '../store/dockStore';

interface WeatherData {
  temp: string;
  condition: string;
  icon: string;
}

export function SystemTray() {
  const { systemTime, setSystemTime, setSettingsOpen } = useDockStore();
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [dateStr, setDateStr] = useState('');
  const [batteryLevel, setBatteryLevel] = useState<number>(80);
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

  useEffect(() => {
    setWeather({ temp: '28°', condition: '晴', icon: '☀️' });
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
      {/* Weather */}
      {weather && (
        <div className="tray-item weather-widget" title={`${weather.condition} ${weather.temp}`}>
          <span className="weather-icon">{weather.icon}</span>
          <span className="weather-temp">{weather.temp}</span>
        </div>
      )}

      {/* System Status */}
      <div className="tray-item" title={`电量 ${batteryLevel}%`}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <rect x="1" y="3" width="10" height="8" rx="1.5" stroke="white" strokeWidth="1" opacity="0.6"/>
          <rect x="1.5" y="3.5" width={batteryLevel / 100 * 9} height="7" rx="0.8" fill="white" opacity="0.6"/>
          <rect x="11" y="5.5" width="2" height="3" rx="1" fill="white" opacity="0.4"/>
        </svg>
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
            window.electronAPI?.openApp('/System/Applications/System Settings.app');
            setShowMenu(false);
          }}>
            <span className="menu-icon">⚙️</span>
            系统设置
          </div>
          <div className="tray-menu-item" onClick={() => {
            window.electronAPI?.openApp('/System/Applications/Activity Monitor.app');
            setShowMenu(false);
          }}>
            <span className="menu-icon">📊</span>
            活动监视器
          </div>
          <div className="tray-menu-separator" />
          <div className="tray-menu-item" onClick={() => {
            setSettingsOpen(true);
            setShowMenu(false);
          }}>
            <span className="menu-icon">🎨</span>
            MyDockFinder 偏好设置
          </div>
          <div className="tray-menu-separator" />
          <div className="tray-menu-item" onClick={() => setShowMenu(false)}>
            <span className="menu-icon">🔒</span>
            锁定屏幕
          </div>
        </div>
      )}
    </div>
  );
}
