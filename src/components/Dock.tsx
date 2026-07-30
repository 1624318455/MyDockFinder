import { useEffect, useCallback, useState } from 'react';
import { DockItem as DockItemComponent } from './DockItem';
import { SystemTray } from './SystemTray';
import { FolderView } from './FolderView';
import { Launchpad } from './Launchpad';
import { useDockStore } from '../store/dockStore';
import type { DockItem, AppInfo } from '../types';

const DEFAULT_APPS = [
  'Finder', 'Safari', 'Messages', 'Mail', 'Maps',
  'Photos', 'FaceTime', 'Calendar', 'Contacts', 'Notes',
  'Reminders', 'Music', 'App Store', 'System Settings',
  'Terminal', 'Visual Studio Code', 'Spotify', 'Chrome',
];

export function Dock() {
  const { items, setItems, setRecentFiles, searchQuery, setSearchQuery } = useDockStore();
  const [showLaunchpad, setShowLaunchpad] = useState(false);
  const [activeFolder, setActiveFolder] = useState<DockItem | null>(null);

  const loadApps = useCallback(async () => {
    if (!window.electronAPI) {
      const fallbackApps: AppInfo[] = DEFAULT_APPS.map((name) => ({
        name, path: `/Applications/${name}.app`, icon: '',
      }));
      setItems(fallbackApps.map((app, i) => ({
        id: `app-${i}`, ...app, isRunning: i < 3, isPinned: true,
      })));
      return;
    }

    try {
      // Get running apps
      const running = await window.electronAPI.getRunningApps();
      
      // Get all apps
      const allApps = await window.electronAPI.getAllApps();
      
      // Mix: pinned apps from all apps + running apps
      const pinned: DockItem[] = allApps.slice(0, 12).map((app, i) => ({
        id: `pin-${i}`, ...app, isRunning: false, isPinned: true,
      }));

      // Mark running apps
      const runningNames = new Set(running.map((r: { name: string }) => r.name));
      const merged: DockItem[] = pinned.map(item => ({
        ...item,
        isRunning: runningNames.has(item.name),
      }));

      // Add running apps that aren't in pinned
      for (const r of running) {
        if (!merged.find(m => m.name === r.name)) {
          merged.push({
            id: r.id,
            name: r.name,
            path: r.path,
            icon: '',
            isRunning: true,
            isPinned: false,
          });
        }
      }

      setItems(merged);

      const files = await window.electronAPI.getRecentFiles();
      setRecentFiles(files);
    } catch (err) {
      console.error('Failed to load apps:', err);
    }
  }, [setItems, setRecentFiles]);

  useEffect(() => {
    loadApps();
    // Poll for running apps every 5 seconds
    const interval = setInterval(loadApps, 5000);
    return () => clearInterval(interval);
  }, [loadApps]);

  const handleOpenApp = useCallback(async (appPath: string) => {
    if (window.electronAPI) {
      await window.electronAPI.openApp(appPath);
    }
  }, []);

  const filteredItems = items.filter((item: DockItem) =>
    item.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleFinderClick = () => {
    setShowLaunchpad(prev => !prev);
  };

  const handleLaunchpadClose = () => {
    setShowLaunchpad(false);
  };

  return (
    <>
      {showLaunchpad && <Launchpad onClose={handleLaunchpadClose} onOpen={handleOpenApp} />}
      {activeFolder && (
        <FolderView
          folder={activeFolder}
          onClose={() => setActiveFolder(null)}
          onOpen={handleOpenApp}
        />
      )}

      <div className="dock-container">
        {/* Search Bar */}
        <div className="dock-search">
          <input
            type="text"
            placeholder="搜索..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="dock-search-input"
            onFocus={() => setShowLaunchpad(false)}
          />
        </div>

        {/* Dock Items */}
        <div className="dock-items">
          {filteredItems.map((item: DockItem) => (
            <DockItemComponent 
              key={item.id} 
              item={item} 
              onOpen={handleOpenApp}
              onFolderClick={item.name === 'Finder' ? handleFinderClick : undefined}
            />
          ))}

          {/* Separator */}
          <div className="dock-separator" />

          {/* Downloads Folder */}
          <DockItemComponent
            item={{
              id: 'downloads',
              name: '下载',
              path: '',
              icon: 'folder',
              isRunning: false,
              isPinned: true,
            }}
            onOpen={() => setActiveFolder({
              id: 'downloads',
              name: '下载',
              path: '/Users/memeflyfly/Downloads',
              icon: 'folder',
              isRunning: false,
              isPinned: true,
            })}
          />

          {/* Trash */}
          <div className="dock-item dock-special">
            <div className="dock-icon-wrapper">
              <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
                <rect x="8" y="12" width="20" height="18" rx="2" fill="white" opacity="0.7"/>
                <path d="M14 12V10C14 8.9 14.9 8 16 8H20C21.1 8 22 8.9 22 10V12" stroke="white" strokeWidth="1.5" opacity="0.7"/>
              </svg>
            </div>
            <div className="dock-tooltip"><span>废纸篓</span></div>
          </div>
        </div>

        {/* System Tray */}
        <SystemTray />
      </div>
    </>
  );
}
