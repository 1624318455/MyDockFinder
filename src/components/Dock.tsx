import { useEffect, useCallback, useState, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { DockItem as DockItemComponent } from './DockItem';
import { SystemTray } from './SystemTray';
import { FolderView } from './FolderView';
import { Launchpad } from './Launchpad';
import { useDockStore } from '../store/dockStore';
import type { DockItem } from '../types';

const DEFAULT_APPS = [
  'File Explorer', 'Google Chrome', 'Microsoft Edge', 'Firefox',
  'Spotify', 'Visual Studio Code', 'Terminal', 'Calculator',
  'Notepad', 'Settings', 'Word', 'Excel',
];

// Dock 容器动画 — 从底部弹入
const dockVariants: any = {
  hidden: { y: 120, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: { type: 'spring' as const, stiffness: 200, damping: 20, mass: 1.2 },
  },
};

// 图标的交错进入动画
const itemContainerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.035, delayChildren: 0.25 },
  },
};

const itemVariants: any = {
  hidden: { y: 60, opacity: 0, scale: 0.6 },
  visible: {
    y: 0,
    opacity: 1,
    scale: 1,
    transition: {
      type: 'spring',
      stiffness: 350,
      damping: 25,
      mass: 0.8,
    },
  },
};

export function Dock() {
  const { pinnedApps, runningApps, setPinnedApps, setRunningApps, searchQuery, setSearchQuery, settings, setSettings } = useDockStore();
  const [dragOver, setDragOver] = useState(false);
  const [showLaunchpad, setShowLaunchpad] = useState(false);
  const [activeFolder, setActiveFolder] = useState<DockItem | null>(null);
  const [appeared, setAppeared] = useState(false);
  const dockRef = useRef<HTMLDivElement>(null);
  const [userHome, setUserHome] = useState('C:\\Users\\Default');
  // 消息角标：统一轮询（微信/QQ等未读数），name.toLowerCase -> count
  const [badges, setBadges] = useState<Record<string, number>>({});

  useEffect(() => {
    if (window.electronAPI?.getSettings) {
      window.electronAPI.getSettings().then(s => { if (s) setSettings(s); });
    }
    if (window.electronAPI?.getSystemInfo) {
      window.electronAPI.getSystemInfo().then(info => {
        if (info.homeDir) setUserHome(info.homeDir);
      });
    }
    // 设置变化实时刷新（设置窗口保存后广播）
    const unsub = window.electronAPI?.onSettingsChanged
      ? window.electronAPI.onSettingsChanged(s => { if (s) setSettings(s); })
      : undefined;
    // 触发启动动画
    setTimeout(() => setAppeared(true), 50);
    return () => unsub?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setSettings]);

  // 原生右键菜单「从 Dock 移除」
  useEffect(() => {
    const unsub = window.electronAPI?.onDockRemoveItem
      ? window.electronAPI.onDockRemoveItem(id => {
          useDockStore.getState().removeItem(id);
        })
      : undefined;
    return () => unsub?.();
  }, []);

  // Auto-hide
  useEffect(() => {
    if (!settings?.autoHide || !window.electronAPI) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handleLeave = () => {
      timer = setTimeout(() => window.electronAPI?.autoHideDock(), 1000);
    };
    const handleEnter = () => {
      if (timer) { clearTimeout(timer); timer = null; }
    };
    const el = dockRef.current;
    if (el) {
      el.addEventListener('mouseleave', handleLeave);
      el.addEventListener('mouseenter', handleEnter);
    }
    return () => {
      if (timer) clearTimeout(timer);
      if (el) {
        el.removeEventListener('mouseleave', handleLeave);
        el.removeEventListener('mouseenter', handleEnter);
      }
    };
  }, [settings?.autoHide]);

  // ===== 固定区：用户手动固定的应用（持久化，加载一次 + 监听变更） =====
  useEffect(() => {
    const toItems = (list: Array<{ name: string; path: string }>): DockItem[] =>
      list.map((a, i) => ({
        id: `pin-${i}`, name: a.name, path: a.path, icon: '',
        isRunning: false, isPinned: true,
      }));
    if (window.electronAPI?.getPinnedApps) {
      window.electronAPI.getPinnedApps().then(list => {
        if (Array.isArray(list)) setPinnedApps(toItems(list));
      });
    } else {
      // 浏览器兜底：显示几个演示应用
      setPinnedApps(DEFAULT_APPS.slice(0, 5).map((name, i) => ({
        id: `pin-${i}`, name, path: '', icon: '', isRunning: false, isPinned: true,
      })));
    }
    const unsub = window.electronAPI?.onPinnedAppsChanged
      ? window.electronAPI.onPinnedAppsChanged(list => {
          if (Array.isArray(list)) setPinnedApps(toItems(list));
        })
      : undefined;
    return () => unsub?.();
  }, [setPinnedApps]);

  // ===== 运行中区：可见窗口应用入轨，进程退出才消失（5 秒轮询，仅 diff 更新） =====
  const loadRunning = useCallback(async () => {
    if (!window.electronAPI?.getRunningApps) return;
    try {
      const running = await window.electronAPI.getRunningApps();
      // 批量拉图标（一次 IPC）回填到 item.icon，供 DockItem 首帧渲染真实图标
      const paths = running.map(r => r.path).filter(Boolean);
      if (paths.length && window.electronAPI?.getAppIconsBatch) {
        const icons: Record<string, string> = await window.electronAPI.getAppIconsBatch(paths).catch(() => ({} as Record<string, string>));
        for (const r of running) {
          if (r.path && icons[r.path]) r.icon = icons[r.path];
        }
      }
      const prev = useDockStore.getState().runningApps;
      const sig = running.map(r => r.name + ':' + r.isRunning).join('|');
      const prevSig = prev.map(r => r.name + ':' + r.isRunning).join('|');
      if (sig !== prevSig) setRunningApps(running);
    } catch {}
  }, [setRunningApps]);

  useEffect(() => {
    loadRunning();
    const interval = setInterval(loadRunning, 5000);
    return () => clearInterval(interval);
  }, [loadRunning]);

  // ===== 显示项 = 固定区 + 运行中区（去重：已在固定的不重复显示） =====
  const displayItems = useMemo(() => {
    const running = runningApps.filter(r =>
      !pinnedApps.some(p => p.name.toLowerCase() === r.name.toLowerCase())
    );
    return [...pinnedApps, ...running];
  }, [pinnedApps, runningApps]);

  // ===== 拖放：从资源管理器拖入文件/文件夹 =====
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (!window.electronAPI?.getPathForFile) return;
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    // 批量处理每个拖入项
    for (const file of files) {
      try {
        const realPath = window.electronAPI.getPathForFile(file);
        if (!realPath) continue;
        const info = await window.electronAPI.inspectDroppedPath(realPath);
        if (!info.exists) continue;
        await window.electronAPI.pinApp({
          name: info.name,
          path: info.path,
          isFolder: info.isFolder,
          iconType: info.isFolder ? 'folder' : 'file',
        });
      } catch {}
    }
  };

  // ===== 系统图标菜单（右键 Dock 空白区） =====
  const handleDockBackgroundContextMenu = (e: React.MouseEvent) => {
    // 只有点空白区域（非图标）才弹出
    if ((e.target as HTMLElement).closest('.dock-item')) return;
    e.preventDefault();
    window.electronAPI?.showSystemIconsMenu?.({ x: e.screenX, y: e.screenY } as any);
  };

  // ===== 任务进度轮询：更新运行中图标的进度条 =====
  // ===== 消息角标轮询：5s 一次，变化才更新 =====
  useEffect(() => {
    if (!window.electronAPI?.getNotificationCounts) return;
    const loadBadges = async () => {
      try {
        const list = await window.electronAPI!.getNotificationCounts();
        if (!Array.isArray(list)) return;
        const map: Record<string, number> = {};
        for (const item of list) {
          if (item && item.name && typeof item.count === 'number' && item.count > 0) {
            map[item.name.toLowerCase()] = item.count;
          }
        }
        // 用 setBadges 每次设置（React 浅比较优化渲染）
        setBadges(prevBadges => {
          const sig = JSON.stringify(map);
          const prevSig = JSON.stringify(prevBadges);
          return prevSig === sig ? prevBadges : map;
        });
      } catch {}
    };
    loadBadges();
    const interval = setInterval(loadBadges, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.getTaskProgress) return;
    const loadProgress = async () => {
      try {
        const progressList = await window.electronAPI!.getTaskProgress();
        const prev = useDockStore.getState().runningApps;
        let changed = false;
        const next = prev.map(r => {
          const p = progressList.find(x => x.name.toLowerCase() === r.name.toLowerCase());
          const newP = p ? p.percent : 0;
          if (r.progress !== newP) { changed = true; return { ...r, progress: newP }; }
          return r;
        });
        if (changed) setRunningApps(next);
      } catch {}
    };
    loadProgress();
    const interval = setInterval(loadProgress, 3000);
    return () => clearInterval(interval);
  }, [setRunningApps]);

  const handleOpenApp = useCallback(async (appPath: string) => {
    if (!window.electronAPI) return;
    // 系统图标（shell: 路径）走 openPath
    if (appPath.startsWith('shell:')) {
      await window.electronAPI.openPath(appPath);
    } else {
      await window.electronAPI.openApp(appPath);
    }
  }, []);

  const q = searchQuery.toLowerCase();
  const pinnedItems = displayItems.filter(i => i.isPinned && i.name.toLowerCase().includes(q));
  const runningItems = displayItems.filter(i => !i.isPinned && i.name.toLowerCase().includes(q));
  const filteredItems = displayItems.filter(i => i.name.toLowerCase().includes(q));
  // 固定/运行 区内部分隔线：仅当两区都有内容时显示
  const showRunningSeparator = pinnedItems.length > 0 && runningItems.length > 0;

  const handleFinderClick = () => setShowLaunchpad(prev => !prev);
  const handleLaunchpadClose = () => setShowLaunchpad(false);
  const handleOpenFolder = (folder: DockItem) => setActiveFolder(folder);

  return (
    <>
      <AnimatePresence>
        {showLaunchpad && <Launchpad onClose={handleLaunchpadClose} onOpen={handleOpenApp} />}
      </AnimatePresence>
      <AnimatePresence>
        {activeFolder && (
          <FolderView
            folder={activeFolder}
            onClose={() => setActiveFolder(null)}
          />
        )}
      </AnimatePresence>

      {/* 外层：静态居中定位（不参与动画，避免 transform 冲突） */}
      <div className="dock-positioner" data-position={settings?.dockPosition || 'bottom'}>
      <motion.div
        className={`dock-container ${dragOver ? 'dock-drag-over' : ''}`}
        ref={dockRef}
        variants={dockVariants}
        initial="hidden"
        animate={appeared ? "visible" : "hidden"}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onContextMenu={handleDockBackgroundContextMenu}
      >
        <div className="dock-search">
          <input type="text" placeholder="搜索..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="dock-search-input"
            onFocus={() => setShowLaunchpad(false)}
          />
        </div>

        <motion.div
          className="dock-items"
          variants={itemContainerVariants}
          initial="hidden"
          animate={appeared ? "visible" : "hidden"}
        >
          <AnimatePresence mode="popLayout">
            {/* 固定区：用户手动固定的应用，永远显示 */}
            {pinnedItems.map(item => (
              <motion.div
                key={item.id}
                variants={itemVariants}
                exit={{ y: -30, opacity: 0, scale: 0.5, transition: { duration: 0.15 } }}
              >
                <DockItemComponent
                  item={item}
                  onOpen={handleOpenApp}
                  onFolderClick={
                    item.isFolder || item.iconType === 'folder'
                      ? () => handleOpenFolder(item)
                      : item.name === 'File Explorer'
                        ? handleFinderClick
                        : undefined
                  }
                  settings={settings}
                  iconSize={settings?.iconSize || 48}
                  badgeCount={badges[item.name.toLowerCase()] || 0}
                />
              </motion.div>
            ))}

            {/* 固定区/运行区 分隔线（macOS 风格，仅两区都有时显示） */}
            {showRunningSeparator && (
              <motion.div className="dock-separator" key="sep-running" variants={itemVariants} />
            )}

            {/* 运行中区：可见窗口应用，进程退出才消失 */}
            {runningItems.map(item => (
              <motion.div
                key={item.id}
                variants={itemVariants}
                exit={{ y: -30, opacity: 0, scale: 0.5, transition: { duration: 0.15 } }}
              >
                <DockItemComponent
                  item={item}
                  onOpen={handleOpenApp}
                  settings={settings}
                  iconSize={settings?.iconSize || 48}
                  badgeCount={badges[item.name.toLowerCase()] || 0}
                />
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Separator + Special items */}
          <motion.div
            className="dock-separator"
            variants={itemVariants}
          />
          <motion.div variants={itemVariants}>
            <DockItemComponent
              item={{
                id: 'downloads', name: '下载', path: '', icon: 'folder',
                isRunning: false, isPinned: true,
              }}
              onOpen={() => handleOpenFolder({
                id: 'downloads', name: '下载',
                path: userHome + '\\Downloads',
                icon: 'folder', isRunning: false, isPinned: true,
              })}

            />
          </motion.div>

            <DockItemComponent
              index={filteredItems.length + 2}
              waveScale={1}
              onHover={() => {}}
              onOpen={() => {}}
              item={{
                id: 'trash', name: '回收站', path: '', icon: 'trash',
                isRunning: false, isPinned: true,
              }}
            />
        </motion.div>

        <SystemTray />
      </motion.div>
      </div>
    </>
  );
}


