import { useEffect, useState, useMemo } from 'react';
import type { AppInfo } from '../types';

interface LaunchpadProps {
  onClose: () => void;
  onOpen: (path: string) => void;
}

export function Launchpad({ onClose, onOpen }: LaunchpadProps) {
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const load = async () => {
      if (window.electronAPI) {
        try {
          const allApps = await window.electronAPI.getAllApps();
          setApps(allApps);
        } catch {}
      } else {
        // Demo data
        setApps([
          { name: 'Safari', path: '', icon: '' },
          { name: 'Messages', path: '', icon: '' },
          { name: 'Mail', path: '', icon: '' },
          { name: 'Music', path: '', icon: '' },
          { name: 'Photos', path: '', icon: '' },
          { name: 'Calendar', path: '', icon: '' },
          { name: 'Notes', path: '', icon: '' },
        ]);
      }
    };
    load();
  }, []);

  const filteredApps = useMemo(() => {
    if (!search) return apps.slice(0, 40);
    const q = search.toLowerCase();
    return apps.filter(a => a.name.toLowerCase().includes(q)).slice(0, 40);
  }, [apps, search]);

  return (
    <div className="launchpad-overlay" onClick={onClose}>
      <div className="launchpad-content" onClick={e => e.stopPropagation()}>
        <div className="launchpad-search" onClick={e => e.stopPropagation()}>
          <input
            type="text"
            placeholder="搜索应用..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="launchpad-search-input"
            autoFocus
          />
        </div>

        <div className="launchpad-grid">
          {filteredApps.map((app, i) => (
            <div
              key={`${app.name}-${i}`}
              className="launchpad-app"
              onClick={() => {
                onOpen(app.path);
                onClose();
              }}
            >
              <div className="launchpad-app-icon" style={{
                background: `linear-gradient(135deg, ${getLaunchpadColor(i)}, ${getLaunchpadColor(i + 3)})`,
              }}>
                {app.name.charAt(0).toUpperCase()}
              </div>
              <div className="launchpad-app-name">{app.name}</div>
            </div>
          ))}
        </div>
      </div>

      <button className="launchpad-close-btn" onClick={onClose}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M6 6L18 18M18 6L6 18" stroke="white" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  );
}

const launchpadColors = [
  '#007aff', '#5856d6', '#ff2d55', '#ff9500', '#ffcc00',
  '#34c759', '#5ac8fa', '#af52de', '#ff3b30', '#00c7be',
  '#8e8e93', '#636366', '#aeaeb2', '#1c1c1e', '#2c2c2e',
];

function getLaunchpadColor(i: number): string {
  return launchpadColors[i % launchpadColors.length];
}
