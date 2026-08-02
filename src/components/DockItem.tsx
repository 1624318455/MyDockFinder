import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { DockItem as DockItemType, AppSettings, WeatherData } from '../types';

// 图标缓存：同一路径只向主进程请求一次（主进程侧也有缓存，双保险）
const iconRequestCache = new Map<string, Promise<string>>();

function requestIcon(path: string): Promise<string> {
  let req = iconRequestCache.get(path);
  if (!req) {
    req = window.electronAPI
      ? window.electronAPI.getAppIcon(path).catch(() => '')
      : Promise.resolve('');
    iconRequestCache.set(path, req);
  }
  return req;
}

interface DockItemProps {
  item: DockItemType;
  index?: number;
  waveScale?: number;
  onOpen: (path: string, name?: string) => void;
  onFolderClick?: () => void;
  onHover?: (index: number) => void;
  settings?: AppSettings | null;
  iconSize?: number;
  badgeCount?: number;
  weather?: WeatherData | null;
}

export function DockItem({ item, index = 0, waveScale = 1, onOpen, onFolderClick, onHover, settings, iconSize = 48, badgeCount = 0, weather = null }: DockItemProps) {
  const isSideDock = settings?.dockPosition === 'left' || settings?.dockPosition === 'right';
  const [imgError, setImgError] = useState(false);
  const [loadedIcon, setLoadedIcon] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState(false);
  const [contextPos, setContextPos] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);
  const [previews, setPreviews] = useState<Array<{ title: string; dataUrl: string }>>([]);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewRefreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewPopupRef = useRef<HTMLDivElement | null>(null);
  // 消息角标：增加时弹跳提示（减少时静默）
  const prevBadgeRef = useRef(badgeCount);
  const [badgeIncrease, setBadgeIncrease] = useState(false);
  useEffect(() => {
    setBadgeIncrease(badgeCount > prevBadgeRef.current);
    prevBadgeRef.current = badgeCount;
  }, [badgeCount]);

  const isSystemIcon = item.iconType === 'trash' || item.iconType === 'weather' || item.iconType === 'computer' || item.name === '回收站' || item.name === '天气' || item.name === '此电脑';
  const isWeather = isSystemIcon && item.name === '天气';
  const isFolder = item.icon === 'folder' || item.isFolder === true;
  const initial = item.name.charAt(0).toUpperCase();
  const hasProgress = (item.progress ?? 0) > 0;

  // macOS Dock 弹簧物理参数
  const spring = { type: 'spring' as const, stiffness: 400, damping: 22, mass: 0.5 };

  // 快速点击（天气图标无启动目标，仅展示）
  const handleClick = () => {
    if (isWeather) return;
    if (isFolder && onFolderClick) onFolderClick();
    else onOpen(item.path, item.name);
  };

  // 右键菜单 — Electron 下用原生菜单（Dock 窗口只有 80px 高，前端菜单会被裁剪）
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (window.electronAPI?.showAppContextMenu) {
      window.electronAPI.showAppContextMenu({
        id: item.id, name: item.name, path: item.path,
        isPinned: item.isPinned, isRunning: item.isRunning,
        isFolder, iconType: item.iconType,
        __pos: { x: e.screenX, y: e.screenY },
      } as any);
    } else {
      // 浏览器兜底：前端菜单
      setContextPos({ x: e.clientX, y: e.clientY });
      setContextMenu(true);
    }
  };

  useEffect(() => {
    const close = () => setContextMenu(false);
    if (contextMenu) {
      document.addEventListener('click', close);
      return () => document.removeEventListener('click', close);
    }
  }, [contextMenu]);

  // 窗口预览 — 进程精确匹配的窗口缩略图：悬停延迟后启动，期间 800ms 刷新近似实时
  const loadPreview = useCallback(async () => {
    if (!window.electronAPI?.getWindowPreviews) return;
    const list = await window.electronAPI.getWindowPreviews(item.name).catch(() => []);
    if (list && list.length) setPreviews(list);
  }, [item.name]);

  const handleMouseEnter = useCallback(() => {
    setIsHovered(true);
    onHover?.(index);
    if (settings?.showWindowPreview && item.isRunning && typeof window.electronAPI?.getWindowPreviews === 'function') {
      const delay = settings?.previewDelay || 300;
      previewTimer.current = setTimeout(() => {
        loadPreview();
        previewRefreshTimer.current = setInterval(loadPreview, 800);
      }, delay);
    }
  }, [item.isRunning, settings?.showWindowPreview, settings?.previewDelay, onHover, index, loadPreview]);

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false);
    onHover?.(-1);
    if (previewTimer.current) clearTimeout(previewTimer.current);
    if (previewRefreshTimer.current) { clearInterval(previewRefreshTimer.current); previewRefreshTimer.current = null; }
    setPreviews([]);
  }, [onHover]);

  // popup 精确矩形上报：主进程收窄 region（dock 条 ∪ popup），消除 popup 外的 tint 白色背景
  useEffect(() => {
    if (!window.electronAPI?.setDockPreviewRect) return;
    const el = previewPopupRef.current;
    if (!el || previews.length === 0) {
      window.electronAPI.setDockPreviewRect(null);
      return;
    }
    const t = setTimeout(() => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        window.electronAPI.setDockPreviewRect({ left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) });
      }
    }, 60); // 等 framer 入场动画完成再测（缩放中测量不准）
    return () => { clearTimeout(t); window.electronAPI.setDockPreviewRect?.(null); };
  }, [previews]);


  // IPC 图标加载
  useEffect(() => {
    if (!item.path || item.icon === 'folder') return;
    setLoadedIcon(null);
    setImgError(false);
    // 只对真实文件路径请求图标（.lnk/.exe），其余用 fallback
    if (window.electronAPI && item.path && /(\.lnk|\.exe)$/i.test(item.path)) {
      let cancelled = false;
      requestIcon(item.path).then(icon => {
        if (!cancelled && icon && icon.length > 50) setLoadedIcon(icon);
      });
      return () => { cancelled = true; };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.path]);

  // 图标内容
  const iconContent = () => {
    if (isWeather) {
      // 天气：实时图标 + 温度（官方：Dock 图标显示实时天气）
      return (
        <div className="dock-weather-icon" style={{ fontSize: iconSize * 0.45 }}>
          <span>{weather?.icon || '🌤️'}</span>
          <span className="dock-weather-temp">{weather ? `${weather.temp}°` : ''}</span>
        </div>
      );
    }
    if (isSystemIcon && item.name === '回收站') {
      return (
        // viewBox 收紧到内容边界（内容 x8-28 y8-31），使图标占满 iconSize 区域，与左侧应用图标视觉一致
        <svg width={iconSize} height={iconSize} viewBox="6 6 25 27" fill="none" style={{ color: 'var(--text-secondary)' }}>
          <rect x="8" y="12" width="20" height="18" rx="2" fill="currentColor" opacity="0.55"/>
          <path d="M14 12V10C14 8.9 14.9 8 16 8H20C21.1 8 22 8.9 22 10V12" stroke="currentColor" strokeWidth="1.5" opacity="0.55"/>
        </svg>
      );
    }
    if (isSystemIcon && item.name === '此电脑') {
      return (
        <svg width={iconSize} height={iconSize} viewBox="3 5 30 30" fill="none" style={{ color: 'var(--text-secondary)' }}>
          <rect x="6" y="8" width="24" height="17" rx="2" fill="currentColor" opacity="0.55"/>
          <rect x="12" y="29" width="12" height="3" fill="currentColor" opacity="0.35"/>
        </svg>
      );
    }
    if (isFolder) {
      return (
        // viewBox 收紧到文件夹内容边界（x4-36 y8-32），与左侧应用图标视觉一致
        <svg width={iconSize} height={iconSize} viewBox="2 6 36 28" fill="none">
          <path d="M4 12C4 9.8 5.8 8 8 8H16L18 11H32C34.2 11 36 12.8 36 15V28C36 30.2 34.2 32 32 32H8C5.8 32 4 30.2 4 28V12Z" 
            fill={item.name === '下载' ? '#007aff' : '#ff9500'} opacity="0.9"/>
        </svg>
      );
    }
    if (loadedIcon && !imgError) {
      return (
        <img src={loadedIcon} alt={item.name} className="dock-icon"
          onError={() => setImgError(true)} draggable={false} />
      );
    }
    return (
      <motion.div className="dock-icon-fallback" layout
        style={{ background: `linear-gradient(135deg, ${getColor(item.name)}, ${getColor2(item.name)})`, fontSize: iconSize * 0.42 }}>
        {initial}
      </motion.div>
    );
  };

  return (
    <motion.div
      className={`dock-item ${item.isRunning ? 'dock-item-running' : ''}`}
      layout
      whileHover={{ scale: waveScale }}
      whileTap={{ scale: waveScale * 0.93 }}
      transition={spring}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        originX: 0.5,
        // 放大方向：底部 dock 图标向上凸出（macOS），顶部 dock 向下，左右 dock 居中
        originY: settings?.dockPosition === 'bottom' ? 1 : settings?.dockPosition === 'top' ? 0 : 0.5,
        ['--icon-size' as any]: iconSize + 'px',
      }}
    >
      {/* Icon Wrapper — macOS 经典弹簧放大 */}
      <motion.div
        className="dock-icon-wrapper"
        animate={{ scale: isHovered ? 1 : 1 }}
        transition={spring}
      >
        {/* 通知角标 — 新消息弹跳（增加时 1.8x 弹回，减少时平滑） */}
        <AnimatePresence>
          {badgeCount > 0 && (
            <motion.div
              key={`badge-${badgeCount}`}
              className="dock-badge"
              initial={badgeIncrease ? { scale: 1.8 } : { scale: 1 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 14 }}
            >
              {badgeCount > 99 ? '99+' : badgeCount}
            </motion.div>
          )}
        </AnimatePresence>

        {/* 进度条 — 真实进度（复制文件/下载/播放器等） */}
        {hasProgress && (
          <motion.div className="dock-progress-bar"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
          >
            <motion.div className="dock-progress-fill"
              initial={{ width: '0%' }}
              animate={{ width: `${Math.min(100, Math.max(0, item.progress || 0))}%` }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
            />
          </motion.div>
        )}

        {iconContent()}
      </motion.div>

      {/* 运行指示器 — hover 时圆点展开为横线（macOS 行为） */}
      {/* 注意：framer-motion 接管 transform，CSS translateX(-50%) 会失效，居中必须用 framer 的 x */}
      <motion.div
        className={`running-indicator ${isHovered ? 'running-indicator-hovered' : ''}`}
        initial={false}
        animate={{
          x: '-50%',
          scale: item.isRunning ? 1 : 0,
          opacity: item.isRunning ? 1 : 0,
        }}
        transition={{ type: 'spring', stiffness: 500, damping: 20 }}
      />

      {/* Tooltip — macOS 风格淡入（方向按 dock 位置：bottom/top 水平居中，left/right 垂直居中） */}
      <AnimatePresence>
        {isHovered && (
          <motion.div
            className="dock-tooltip"
            initial={{
              opacity: 0, scale: 0.9,
              x: isSideDock ? 8 : '-50%',
              y: isSideDock ? '-50%' : 8,
            }}
            animate={{
              opacity: 1, scale: 1,
              x: isSideDock ? 0 : '-50%',
              y: isSideDock ? '-50%' : 0,
            }}
            exit={{
              opacity: 0, scale: 0.95,
              x: isSideDock ? 4 : '-50%',
              y: isSideDock ? '-50%' : 4,
            }}
            transition={{ duration: 0.12, ease: 'easeOut' }}
          >
            <span>{item.name}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 天气预报 — 悬停显示未来 3 天（官方 5.2.2：Dock 图标实时天气 vs 预览窗口未来天气，故可能有出入） */}
      <AnimatePresence>
        {isHovered && isWeather && weather?.forecast && weather.forecast.length > 0 && (
          <motion.div
            className="weather-popup"
            initial={isSideDock ? { opacity: 0, x: 8, scale: 0.9, y: '-50%' } : { opacity: 0, y: 12, scale: 0.9 }}
            animate={isSideDock ? { opacity: 1, x: 0, scale: 1, y: '-50%' } : { opacity: 1, y: 0, scale: 1 }}
            exit={isSideDock ? { opacity: 0, x: 4, scale: 0.95, y: '-50%' } : { opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
          >
            <div className="weather-popup-title">未来 3 天预报（图标为实时天气）</div>
            {weather.forecast.map((f, i) => (
              <div key={i} className="weather-popup-row">
                <span className="weather-popup-date">{f.date}</span>
                <span className="weather-popup-icon">{f.icon}</span>
                <span className="weather-popup-temp">{f.tempLow}° / {f.tempHigh}°</span>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 窗口预览 — 进程精确匹配的窗口缩略图网格 */}
      {/* 注意：framer-motion 接管 transform，CSS translateX(-50%) 会失效；居中必须显式 x:'-50%'（bottom/top）/ y:'-50%'（left/right） */}
      <AnimatePresence>
        {isHovered && previews.length > 0 && (
          <motion.div
            ref={previewPopupRef}
            className="window-preview-popup"
            initial={isSideDock ? { opacity: 0, x: 8, scale: 0.9, y: '-50%' } : { opacity: 0, y: 12, scale: 0.9, x: '-50%' }}
            animate={isSideDock ? { opacity: 1, x: 0, scale: 1, y: '-50%' } : { opacity: 1, y: 0, scale: 1, x: '-50%' }}
            exit={isSideDock ? { opacity: 0, x: 4, scale: 0.95, y: '-50%' } : { opacity: 0, y: 8, scale: 0.95, x: '-50%' }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
          >
            {previews.map((p, i) => (
              <div key={i} className="window-preview-item">
                <img src={p.dataUrl} alt={p.title} className="window-preview-img" />
                <span className="window-preview-title">{p.title}</span>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 右键菜单 — 弹性弹入 */}
      <AnimatePresence>
        {contextMenu && (
          <motion.div
            className="dock-context-menu"
            style={{ left: contextPos.x, top: contextPos.y }}
            initial={{ opacity: 0, scale: 0.9, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: -4 }}
            transition={{ duration: 0.1 }}
          >
            <div className="context-menu-item" onClick={() => { setContextMenu(false); onOpen(item.path); }}>
              <span>📂</span> 打开
            </div>
            {item.isPinned && (
              <div className="context-menu-item" onClick={() => setContextMenu(false)}>
                <span>📌</span> 从 Dock 移除
              </div>
            )}
            {!item.isPinned && (
              <div className="context-menu-item" onClick={() => setContextMenu(false)}>
                <span>📌</span> 固定到 Dock
              </div>
            )}
            <div className="context-menu-separator" />
            <div className="context-menu-item" onClick={() => setContextMenu(false)}>
              <span>ℹ️</span> 显示简介
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

const colors = ['#007aff','#5856d6','#ff2d55','#ff9500','#ffcc00','#34c759','#5ac8fa','#af52de','#ff3b30','#00c7be'];
function getColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}
function getColor2(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) * 31 + hash;
  return colors[Math.abs(hash + 3) % colors.length];
}
