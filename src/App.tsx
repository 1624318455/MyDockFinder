import { useEffect } from 'react';
import { Dock } from './components/Dock';
import { Settings } from './components/Settings';
import { useDockStore } from './store/dockStore';
import './App.css';

function App() {
  useEffect(() => {
    if (window.electronAPI?.onOpenSettings) {
      const cleanup = window.electronAPI.onOpenSettings(() => {
        useDockStore.getState().setSettingsOpen(true);
      });
      return cleanup;
    }
  }, []);

  const { settingsOpen } = useDockStore();

  return (
    <div className="app" style={{ opacity: settingsOpen ? 0.3 : 1 }}>
      <Dock />
      <Settings />
    </div>
  );
}

export default App;
