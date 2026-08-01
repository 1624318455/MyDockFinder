import { useEffect, useState, useRef } from 'react';
import { useDockStore } from '../store/dockStore';

interface WeatherData {
  temp: string;
  condition: string;
  icon: string;
  forecast: Array<{ date: string; icon: string; tempHigh: string; tempLow: string }>;
}

interface BatteryInfo {
  level: number;
  charging: boolean;
}

// wttr.in 日期 "2024-08-01" → "周四 8/1"
function formatForecastDate(dateStr: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
  if (!m) return dateStr;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const weeks = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return `${weeks[d.getDay()]} ${Number(m[2])}/${Number(m[3])}`;
}

export function SystemTray() {
  const { systemTime, setSystemTime, settings } = useDockStore();
  const [weather, setWeather] = useState<WeatherData | null>(null);
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

  // Load weather — 跟随 showWeather 设置
  useEffect(() => {
    if (!settings?.showWeather) { setWeather(null); return; }
    const loadWeather = async () => {
      if (window.electronAPI?.getWeather) {
        try {
          const w = await window.electronAPI.getWeather();
          setWeather(w);
        } catch {}
      }
    };
    loadWeather();
    const interval = setInterval(loadWeather, 600000); // Refresh every 10 min
    return () => clearInterval(interval);
  }, [settings?.showWeather]);

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
      {/* Weather — 悬停显示未来 3 天预报 */}
      {settings?.showWeather !== false && weather && (
        <div
          className="tray-item weather-widget weather-with-popup"
          title={`${weather.condition} ${weather.temp}℃`}
        >
          <span className="weather-icon">{weather.icon}</span>
          <span className="weather-temp">{weather.temp}°</span>
          {weather.forecast && weather.forecast.length > 0 && (
            <div className="weather-popup">
              <div className="weather-popup-title">未来 3 天</div>
              {weather.forecast.map((f, i) => (
                <div key={i} className="weather-popup-row">
                  <span className="weather-popup-date">
                    {formatForecastDate(f.date)}
                  </span>
                  <span className="weather-popup-icon">{f.icon}</span>
                  <span className="weather-popup-temp">
                    {f.tempLow}° / {f.tempHigh}°
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Battery */}
      <div className="tray-item" title={`电量 ${battery.level}%${battery.charging ? ' (充电中)' : ''}`}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <rect x="1" y="3" width="10" height="8" rx="1.5" stroke="white" strokeWidth="1" opacity="0.6"/>
          <rect x="1.5" y="3.5" width={battery.level / 100 * 9} height="7" rx="0.8" fill="white" opacity="0.6"/>
          <rect x="11" y="5.5" width="2" height="3" rx="1" fill="white" opacity="0.4"/>
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
