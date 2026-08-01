import { useEffect, useCallback, useState, useRef, useMemo } from 'react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
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
  const { pinnedApps, runningApps, setPinnedApps, setRunningApps, searchQuery, setSearchQuery, settings, setSettings, weather, setWeather } = useDockStore();
  const [dragOver, setDragOver] = useState(false);
  const [showLaunchpad, setShowLaunchpad] = useState(false);
  const [activeFolder, setActiveFolder] = useState<DockItem | null>(null);
  const [appeared, setAppeared] = useState(false);
  const [dockHovered, setDockHovered] = useState(false);
  const [adminMode, setAdminMode] = useState(false);
  const [adminBannerDismissed, setAdminBannerDismissed] = useState(false);
  // 管理员模式检测（官方：管理员下拖放动画不播放 → UI 提示 + 降级）
  useEffect(() => {
    if (!window.electronAPI?.isAdminMode) return;
    window.electronAPI.isAdminMode().then(v => setAdminMode(!!v));
  }, []);

  // 天气轮询：Dock 天气图标数据源（刷新频率可设置 7.5，默认 10 分钟）
  useEffect(() => {
    if (!window.electronAPI?.getWeather) return;
    const load = async () => {
      try {
        const w = await window.electronAPI.getWeather();
        if (w && typeof w === 'object') setWeather(w);
      } catch { /* 失败保持旧数据 */ }
    };
    load();
    const refresh = Math.max(60000, settings?.weatherRefreshMs ?? 600000);
    const t = setInterval(load, refresh);
    return () => clearInterval(t);
  }, [setWeather, settings?.weatherRefreshMs]);
  // hover 离开延迟：放大图标可能短暂移出容器边界，延迟置 false 避免闪烁
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleDockHover = (active: boolean) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    if (active) {
      setDockHovered(true);
      window.electronAPI?.setDockHover(true);
    } else {
      hoverTimer.current = setTimeout(() => {
        setDockHovered(false);
        window.electronAPI?.setDockHover(false);
      }, 60);
    }
  };
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
    // 通知主进程渲染就绪 → 立即推送一次全量状态（首帧即有 running/badges/progress）
    window.electronAPI?.sendDockReady?.();
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

  // 重命名：主进程菜单「重命名」→ 输入浮层（官方 3.4.2：若为快捷方式可重命名）
  const [renameTarget, setRenameTarget] = useState<{ name: string; path: string } | null>(null);
  const [renameValue, setRenameValue] = useState('');
  useEffect(() => {
    const unsub = window.electronAPI?.onRenamePrompt
      ? window.electronAPI.onRenamePrompt(item => {
          setRenameValue(item.name.replace(/\.lnk$/i, ''));
          setRenameTarget(item);
        })
      : undefined;
    return () => unsub?.();
  }, []);
  const submitRename = async () => {
    if (renameTarget && renameValue.trim()) {
      await window.electronAPI?.renamePinnedItem({ name: renameTarget.name, newName: renameValue.trim(), path: renameTarget.path });
    }
    setRenameTarget(null);
  };

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
      list.map((a) => ({
        id: `pin-${a.name}`, name: a.name, path: a.path, icon: '',
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

  // ===== 统一状态订阅：running/badges/progress 由主进程 5s tick 推送（替代 3 个独立轮询） =====
  useEffect(() => {
    if (!window.electronAPI?.onDockState) return;
    // 以最新 running 为基，合并图标与进度（避免互相覆盖）
    const applyRunning = (running: typeof runningApps) => {
      const prev = useDockStore.getState().runningApps;
      const progressMap = new Map(prev.map(r => [r.name.toLowerCase(), r.progress]));
      const next = running.map(r => ({ ...r, progress: progressMap.get(r.name.toLowerCase()) ?? 0 }));
      setRunningApps(next);
    };
    const unsub = window.electronAPI!.onDockState(async (patch) => {
      if (patch.running) {
        const running = patch.running;
        // 批量拉图标（一次 IPC）回填到 item.icon，供 DockItem 首帧渲染真实图标
        const paths = running.map(r => r.path).filter(Boolean);
        if (paths.length && window.electronAPI?.getAppIconsBatch) {
          const icons: Record<string, string> = await window.electronAPI.getAppIconsBatch(paths).catch(() => ({} as Record<string, string>));
          for (const r of running) {
            if (r.path && icons[r.path]) r.icon = icons[r.path];
          }
        }
        applyRunning(running);
      }
      if (patch.badges) {
        const map: Record<string, number> = {};
        for (const item of patch.badges) {
          if (item && item.name && typeof item.count === 'number' && item.count > 0) {
            map[item.name.toLowerCase()] = item.count;
          }
        }
        setBadges(prevBadges => {
          const sig = JSON.stringify(map);
          const prevSig = JSON.stringify(prevBadges);
          return prevSig === sig ? prevBadges : map;
        });
      }
      if (patch.progress) {
        const prev = useDockStore.getState().runningApps;
        let changed = false;
        const next = prev.map(r => {
          const p = patch.progress!.find(x => x.name.toLowerCase() === r.name.toLowerCase());
          const newP = p ? p.percent : 0;
          if (r.progress !== newP) { changed = true; return { ...r, progress: newP }; }
          return r;
        });
        if (changed) setRunningApps(next);
      }
    });
    return () => unsub();
  }, [setRunningApps]);

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

  // ===== 固定区拖拽排序（framer-motion Reorder，顺序持久化到 settings.json） =====
  const pinnedNames = useMemo(() => pinnedItems.map(i => i.name), [pinnedItems]);
  const handlePinnedReorder = useCallback((ordered: string[]) => {
    // 乐观更新本地顺序（以主进程广播回执为准）
    const byName = new Map(pinnedItems.map(i => [i.name, i]));
    const next: DockItem[] = [];
    for (const n of ordered) {
      const it = byName.get(n);
      if (it) { next.push(it); byName.delete(it.name); }
    }
    for (const it of pinnedItems) {
      if (byName.has(it.name)) next.push(it); // 防御：ordered 未包含的项保持原位
    }
    if (next.length !== pinnedItems.length) return; // 完整性异常则不更新
    setPinnedApps(next);
    window.electronAPI?.reorderPinnedApps(ordered).catch(() => {});
  }, [pinnedItems, setPinnedApps]);

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
      {adminMode && !adminBannerDismissed && (
        <div className="admin-banner" onClick={() => setAdminBannerDismissed(true)} title="点击关闭">
          ⚠️ 检测到管理员模式运行：拖放动画已降级（官方建议以普通用户运行）
        </div>
      )}
      {renameTarget && (
        <div className="rename-prompt" onClick={e => e.stopPropagation()}>
          <input
            autoFocus
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitRename(); if (e.key === 'Escape') setRenameTarget(null); }}
            placeholder="新名称"
            style={{ background: 'var(--dock-input-bg, rgba(255,255,255,0.08))', border: '1px solid var(--dock-border)', borderRadius: 6, padding: '4px 8px', color: 'var(--text-primary)', fontSize: 12, outline: 'none' }}
          />
          <button onClick={submitRename} style={{ background: 'var(--accent)', border: 'none', color: '#fff', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>确定</button>
          <button onClick={() => setRenameTarget(null)} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', borderRadius: 6, padding: '4px 8px', fontSize: 12, cursor: 'pointer' }}>取消</button>
        </div>
      )}
      <motion.div
        className={`dock-container ${dragOver ? 'dock-drag-over' : ''} ${dockHovered ? 'dock-expanded' : ''}`}
        ref={dockRef}
        variants={dockVariants}
        initial="hidden"
        animate={appeared ? "visible" : "hidden"}
        onMouseEnter={() => handleDockHover(true)}
        onMouseLeave={() => handleDockHover(false)}
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
          <Reorder.Group
            axis="x"
            values={pinnedNames}
            onReorder={handlePinnedReorder}
            className="dock-pinned-group"
          >
            {/* 固定区：用户手动固定的应用，永远显示（可拖拽排序） */}
            {pinnedItems.map(item => (
              <Reorder.Item
                key={item.name}
                value={item.name}
                className="dock-pinned-item"
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
                  weather={weather}
                />
              </Reorder.Item>
            ))}
          </Reorder.Group>

          {/* 固定区/运行区 分隔线（macOS 风格，仅两区都有时显示） */}
          {showRunningSeparator && (
            <motion.div className="dock-separator" key="sep-running" variants={itemVariants} />
          )}

          <AnimatePresence mode="popLayout">
            {/* 运行中区：可见窗口应用，进程退出才消失（不参与排序） */}
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
                  weather={weather}
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


