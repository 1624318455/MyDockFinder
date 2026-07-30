import { useEffect, useState } from 'react';
import type { DockItem as DockItemType, FileInfo } from '../types';
import { useDockStore } from '../store/dockStore';

interface FolderViewProps {
  folder: DockItemType;
  onClose: () => void;
  onOpen: (path: string) => void;
}

export function FolderView({ folder, onClose, onOpen }: FolderViewProps) {
  const [contents, setContents] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentFolder, setCurrentFolder] = useState(folder.path);
  const [history, setHistory] = useState<string[]>([]);

  useEffect(() => {
    loadFolder(currentFolder);
  }, [currentFolder]);

  const loadFolder = async (path: string) => {
    setLoading(true);
    try {
      if (window.electronAPI) {
        const items = await window.electronAPI.getFolderContents(path);
        setContents(items);
      } else {
        setContents([]);
      }
    } catch {
      setContents([]);
    }
    setLoading(false);
  };

  const handleItemClick = (item: FileInfo) => {
    if (item.isDirectory) {
      setHistory(prev => [...prev, currentFolder]);
      setCurrentFolder(item.path);
    } else {
      // Try to open file
      if (window.electronAPI) {
        window.electronAPI.openApp(item.path).catch(() => {});
      }
    }
  };

  const goBack = () => {
    if (history.length > 0) {
      const prev = history[history.length - 1];
      setHistory(prev => prev.slice(0, -1));
      setCurrentFolder(prev);
    }
  };

  const formatSize = (bytes?: number): string => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const folderName = currentFolder.split('/').pop() || folder.name;

  return (
    <div className="folder-overlay" onClick={onClose}>
      <div className="folder-panel" onClick={e => e.stopPropagation()}>
        <div className="folder-header">
          {history.length > 0 && (
            <button className="folder-back" onClick={goBack}>
              ← 返回
            </button>
          )}
          <h3>{folderName}</h3>
          <span className="folder-count">{contents.length} 个项目</span>
          <button className="folder-close" onClick={onClose}>✕</button>
        </div>

        <div className="folder-content">
          {loading ? (
            <div className="folder-loading">加载中...</div>
          ) : contents.length === 0 ? (
            <div className="folder-empty">空文件夹</div>
          ) : (
            <div className="folder-grid">
              {contents.map((item, i) => (
                <div
                  key={`${item.path}-${i}`}
                  className="folder-item"
                  onClick={() => handleItemClick(item)}
                  title={item.name}
                >
                  <div className="folder-item-icon">
                    {item.isDirectory ? (
                      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                        <path d="M2 10C2 7.8 3.8 6 6 6H12L14 9H26C28.2 9 30 10.8 30 13V22C30 24.2 28.2 26 26 26H6C3.8 26 2 24.2 2 22V10Z" fill="#ff9500" opacity="0.9"/>
                      </svg>
                    ) : (
                      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                        <rect x="4" y="2" width="24" height="28" rx="3" fill="white" opacity="0.3"/>
                        <path d="M4 8H28" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5"/>
                        <rect x="10" y="12" width="12" height="2" rx="1" fill="white" opacity="0.5"/>
                        <rect x="10" y="16" width="8" height="2" rx="1" fill="white" opacity="0.3"/>
                      </svg>
                    )}
                  </div>
                  <div className="folder-item-name">{item.name}</div>
                  <div className="folder-item-size">{formatSize(item.size)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
