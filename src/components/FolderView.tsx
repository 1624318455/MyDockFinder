import { useEffect, useMemo, useState } from 'react';
import type { DockItem as DockItemType, FileInfo } from '../types';

interface FolderViewProps {
  folder: DockItemType;
  onClose: () => void;
}

type SortMode = 'name' | 'date' | 'size';

export function FolderView({ folder, onClose }: FolderViewProps) {
  const [contents, setContents] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentFolder, setCurrentFolder] = useState(folder.path);
  const [history, setHistory] = useState<string[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>('name');

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

  // 排序：目录优先 + 名称本地化（中文数字感知） / 修改时间 / 大小
  const sorted = useMemo(() => {
    const arr = [...contents];
    arr.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      switch (sortMode) {
        case 'date':
          return (b.modifiedAt || 0) - (a.modifiedAt || 0);
        case 'size':
          return (b.size || 0) - (a.size || 0);
        default:
          return a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' });
      }
    });
    return arr;
  }, [contents, sortMode]);

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

  const formatDate = (ms?: number): string => {
    if (!ms) return '';
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const folderName = currentFolder.split('/').pop() || folder.name;
  const sortButtons: Array<{ mode: SortMode; label: string }> = [
    { mode: 'name', label: '名称' },
    { mode: 'date', label: '时间' },
    { mode: 'size', label: '大小' },
  ];

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
          <div className="folder-sort">
            {sortButtons.map(b => (
              <button
                key={b.mode}
                className={`folder-sort-btn ${sortMode === b.mode ? 'active' : ''}`}
                onClick={() => setSortMode(b.mode)}
              >
                {b.label}
              </button>
            ))}
          </div>
          <button className="folder-close" onClick={onClose}>✕</button>
        </div>

        <div className="folder-content">
          {loading ? (
            <div className="folder-loading">加载中...</div>
          ) : sorted.length === 0 ? (
            <div className="folder-empty">空文件夹</div>
          ) : (
            <div className="folder-grid">
              {sorted.map((item, i) => (
                <div
                  key={`${item.path}-${i}`}
                  className="folder-item"
                  onClick={() => handleItemClick(item)}
                  title={item.name}
                  draggable={!item.isDirectory}
                  onDragStart={(e) => {
                    // 拖出到桌面/资源管理器：通知主进程 webContents.startDrag 接管
                    e.dataTransfer.setData('text/plain', item.path);
                    e.dataTransfer.effectAllowed = 'copy';
                    window.electronAPI?.startDrag(item.path);
                  }}
                >
                  <div className="folder-item-icon">
                    {item.thumbnail ? (
                      <img src={item.thumbnail} alt={item.name} className="folder-item-thumb" draggable={false} />
                    ) : item.isDirectory ? (
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
                  <div className="folder-item-size">
                    {item.isDirectory ? formatDate(item.modifiedAt) : formatSize(item.size)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
