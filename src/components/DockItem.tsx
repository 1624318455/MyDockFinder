import { useState, useRef } from 'react';
import type { DockItem as DockItemType } from '../types';

interface DockItemProps {
  item: DockItemType;
  onOpen: (path: string) => void;
  onFolderClick?: () => void;
}

export function DockItem({ item, onOpen, onFolderClick }: DockItemProps) {
  const [hovered, setHovered] = useState(false);
  const [imgError, setImgError] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const isFolder = item.icon === 'folder' || item.name === '下载' || item.name === 'Downloads';
  const isFinder = item.name === 'Finder';
  const initial = item.name.charAt(0).toUpperCase();

  const handleClick = () => {
    if (isFinder && onFolderClick) {
      onFolderClick();
    } else if (isFolder) {
      onOpen(item.path);
    } else {
      onOpen(item.path);
    }
  };

  const iconContent = () => {
    if (isFolder) {
      return (
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
          <path d="M4 12C4 9.8 5.8 8 8 8H16L18 11H32C34.2 11 36 12.8 36 15V28C36 30.2 34.2 32 32 32H8C5.8 32 4 30.2 4 28V12Z" 
            fill={item.name === '下载' ? '#007aff' : '#ff9500'} opacity="0.9"/>
          <path d="M4 12C4 9.8 5.8 8 8 8H16L18 11H32C34.2 11 36 12.8 36 15V28C36 30.2 34.2 32 32 32H8C5.8 32 4 30.2 4 28V12Z" 
            fill="white" opacity="0.2"/>
        </svg>
      );
    }

    if (!imgError) {
      const iconSrc = `file://${item.path}`;
      return (
        <img
          src={iconSrc}
          alt={item.name}
          className="dock-icon"
          onError={() => setImgError(true)}
          draggable={false}
        />
      );
    }

    return (
      <div className="dock-icon-fallback" style={{
        background: `linear-gradient(135deg, ${getColor(item.name)}, ${getColor2(item.name)})`,
      }}>
        {initial}
      </div>
    );
  };

  return (
    <div
      ref={ref}
      className={`dock-item ${hovered ? 'dock-item-hovered' : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={handleClick}
    >
      <div className="dock-icon-wrapper" style={{
        transform: hovered ? 'scale(1.15)' : 'scale(1)',
        transition: 'transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1)',
      }}>
        {iconContent()}
      </div>
      {item.isRunning && (
        <div className={`running-indicator ${hovered ? 'running-indicator-hovered' : ''}`} />
      )}
      {hovered && (
        <div className="dock-tooltip">
          <span>{item.name}</span>
        </div>
      )}
    </div>
  );
}

const colors = [
  '#007aff', '#5856d6', '#ff2d55', '#ff9500', '#ffcc00',
  '#34c759', '#5ac8fa', '#af52de', '#ff3b30', '#00c7be',
];

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
