import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { DockItem as DockItemType, AppSettings } from '../types';

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
  onOpen: (path: string) => void;
  onFolderClick?: () => void;
  onHover?: (index: number) => void;
  settings?: AppSettings | null;
  iconSize?: number;
  badgeCount?: number;
}

export function DockItem({ item, index = 0, waveScale = 1, onOpen, onFolderClick, onHover, settings, iconSize = 48, badgeCount = 0 }: DockItemProps) {
  const [imgError, setImgError] = useState(false);
  const [loadedIcon, setLoadedIcon] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState(false);
  const [contextPos, setContextPos] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);
  const [previews, setPreviews] = useState<Array<{ title: string; dataUrl: string }>>([]);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewRefreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // 消息角标：增加时弹跳提示（减少时静默）
  const prevBadgeRef = useRef(badgeCount);
  const [badgeIncrease, setBadgeIncrease] = useState(false);
  useEffect(() => {
    setBadgeIncrease(badgeCount > prevBadgeRef.current);
    prevBadgeRef.current = badgeCount;
  }, [badgeCount]);

  const isFolder = item.icon === 'folder' || item.isFolder === true;
  const isSystemIcon = item.iconType === 'trash' || item.iconType === 'weather' || item.iconType === 'computer' || item.name === '回收站' || item.name === '天气' || item.name === '此电脑';
  const initial = item.name.charAt(0).toUpperCase();
  const hasProgress = (item.progress ?? 0) > 0;

  // macOS Dock 弹簧物理参数
  const spring = { type: 'spring' as const, stiffness: 400, damping: 22, mass: 0.5 };

  // 快速点击
  const handleClick = () => {
    if (isFolder && onFolderClick) onFolderClick();
    else onOpen(item.path);
  };

  // 右键菜单 — Electron 下用原生菜单（Dock 窗口只有 80px 高，前端菜单会被裁剪）
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (window.electronAPI?.showAppContextMenu) {
      window.electronAPI.showAppContextMenu({
        id: item.id, name: item.name, path: item.path,
        isPinned: item.isPinned, isRunning: item.isRunning,
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
    if (isSystemIcon && item.name === '天气') {
      // 天气：显示 emoji + 温度
      return (
        <div className="dock-weather-icon" style={{ fontSize: iconSize * 0.5 }}>
          <span>🌤️</span>
        </div>
      );
    }
    if (isSystemIcon && item.name === '回收站') {
      return (
        <svg width={iconSize} height={iconSize} viewBox="0 0 36 36" fill="none">
          <rect x="8" y="12" width="20" height="18" rx="2" fill="white" opacity="0.55"/>
          <path d="M14 12V10C14 8.9 14.9 8 16 8H20C21.1 8 22 8.9 22 10V12" stroke="white" strokeWidth="1.5" opacity="0.55"/>
        </svg>
      );
    }
    if (isSystemIcon && item.name === '此电脑') {
      return (
        <svg width={iconSize} height={iconSize} viewBox="0 0 36 36" fill="none">
          <rect x="6" y="8" width="24" height="17" rx="2" fill="white" opacity="0.55"/>
          <rect x="12" y="29" width="12" height="3" fill="white" opacity="0.35"/>
        </svg>
      );
    }
    if (isFolder) {
      return (
        <svg width={iconSize} height={iconSize} viewBox="0 0 40 40" fill="none">
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

      {/* 运行指示器 — 弹性动画 */}
      <motion.div
        className="running-indicator"
        initial={false}
        animate={{
          scale: item.isRunning ? 1 : 0,
          opacity: item.isRunning ? 1 : 0,
        }}
        transition={{ type: 'spring', stiffness: 500, damping: 20 }}
      />

      {/* Tooltip — macOS 风格淡入 */}
      <AnimatePresence>
        {isHovered && (
          <motion.div
            className="dock-tooltip"
            initial={{ opacity: 0, y: 8, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.95 }}
            transition={{ duration: 0.12, ease: 'easeOut' }}
          >
            <span>{item.name}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 窗口预览 — 进程精确匹配的窗口缩略图网格 */}
      <AnimatePresence>
        {isHovered && previews.length > 0 && (
          <motion.div
            className="window-preview-popup"
            initial={{ opacity: 0, y: 12, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
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
