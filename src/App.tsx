import { useCallback, useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauri } from '@tauri-apps/api/core';
import { motion } from 'framer-motion';
import { readPreferences } from './app/preferences';
import { commands, type LaunchAction } from './app/commands';
import { useAppStore } from './app/useAppStore';
import { SettingsDialog } from './shell/SettingsDialog';
import { Sidebar } from './shell/Sidebar';
import { WindowControls } from './shell/WindowControls';

const titles = { home: 'Good evening', search: 'Search', playlists: 'Your playlists', songs: 'Saved songs' } as const;

function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const route = useAppStore((state) => state.route);
  const theme = useAppStore((state) => state.theme);
  const setTheme = useAppStore((state) => state.setTheme);
  const setSource = useAppStore((state) => state.setSource);
  const source = useAppStore((state) => state.source);
  const navigate = useAppStore((state) => state.navigate);
  const showError = useAppStore((state) => state.showError);
  const error = useAppStore((state) => state.error);
  const clearError = useAppStore((state) => state.clearError);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    let unlistenAction: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;
    let unlistenSettings: (() => void) | undefined;

    const applyAction = (action: { type: string; route?: string }) => {
      if (action.type === 'navigate' && action.route && ['home', 'search', 'playlists', 'songs'].includes(action.route)) navigate(action.route as 'home' | 'search' | 'playlists' | 'songs');
      if (action.type === 'toggle-immersive' || action.type === 'close-immersive') showError('Immersive playback will be available when the audio engine is connected.');
      if (action.type === 'play-pause' || action.type === 'next' || action.type === 'previous') showError('Playback controls will be available when a music source is connected.');
    };
    void readPreferences().then((preferences) => { setTheme(preferences.theme); setSource(preferences.source); }).catch((reason: unknown) => showError(String(reason)));
    if (isTauri()) {
      void commands.initialAction().then((action) => { if (action) applyAction(action); }).catch((reason: unknown) => showError(String(reason)));
      void listen<LaunchAction>('launch-action', (event) => applyAction(event.payload)).then((unlisten) => { unlistenAction = unlisten; });
      void listen<string>('app-error', (event) => showError(event.payload)).then((unlisten) => { unlistenError = unlisten; });
      void listen('open-settings', () => setSettingsOpen(true)).then((unlisten) => { unlistenSettings = unlisten; });
    }

    return () => { unlistenAction?.(); unlistenError?.(); unlistenSettings?.(); };
  }, [navigate, setSource, setTheme, showError]);

  const startDragging = () => { if (isTauri()) void getCurrentWindow().startDragging(); };
  const showPage = () => {
    if (route === 'home') return <><section className="welcome-card"><div className="welcome-copy"><p className="eyebrow">A LITTLE SPACE FOR SOUND</p><h2>Your music,<br /><em>your atmosphere.</em></h2><p>Bring your favorite music together in one calm, expressive player.</p><button className="primary-button" onClick={() => setSettingsOpen(true)}>Choose a music source <span aria-hidden="true">&#8599;</span></button></div><div className="art-orbit" aria-hidden="true"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="orbit-core">{("\u266b")}</div><div className="orbit-star">{("\u2733")}</div></div></section><section className="getting-started"><div><p className="eyebrow">GETTING STARTED</p><h3>Make it yours</h3><p>Connect a source in settings to start building your listening space.</p></div><button className="text-button" onClick={() => setSettingsOpen(true)}>Open settings <span aria-hidden="true">&#8594;</span></button></section></>;
    if (route === 'search') return <section className="empty-view"><span className="empty-symbol">{("\u2315")}</span><h2>Find your next favorite</h2><p>Search across your connected music sources.</p><button className="primary-button" onClick={() => setSettingsOpen(true)}>Connect a source</button></section>;
    if (route === 'playlists') return <section className="empty-view"><span className="empty-symbol">{("\u25a4")}</span><h2>Your playlists will live here</h2><p>Connect a music source to browse and organize playlists.</p><button className="primary-button" onClick={() => setSettingsOpen(true)}>Connect a source</button></section>;
    return <section className="empty-view"><span className="empty-symbol">{("\u266b")}</span><h2>A home for the songs you love</h2><p>Your saved songs will appear after you connect a source.</p><button className="primary-button" onClick={() => setSettingsOpen(true)}>Connect a source</button></section>;
  };

  return <div className="app-frame">
    <Sidebar />
    <main className="main-panel">
      <header className="titlebar" onMouseDown={(event) => { if (event.buttons === 1) startDragging(); }}>
        <div className="titlebar-breadcrumb"><span className="status-pip"/>PERSONAL LISTENING SPACE</div>
        <div className="titlebar-actions" onMouseDown={(event) => event.stopPropagation()}><button className="icon-button settings-trigger" aria-label="Open settings" onClick={() => setSettingsOpen(true)}>⚙</button><WindowControls /></div>
      </header>
      <div className="page-scroll"><div className="page-heading"><div><p className="eyebrow">{route === 'home' ? 'YOUR SPACE' : 'EXPLORE YOUR LIBRARY'}</p><h1>{titles[route]}</h1></div><span className="date-stamp">RESONANCE | 0.2.6</span></div><motion.div key={route} className="page-content" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: 'easeOut' }}>{showPage()}</motion.div></div>
      <footer className="player-dock"><div className="dock-empty-art">{("\u266b")}</div><div className="dock-track"><strong>Nothing playing yet</strong><span>Choose a source to begin</span></div><div className="dock-center"><span className="dock-line"/><span className="dock-note">Your listening space is ready</span><span className="dock-line"/></div><button className="dock-source" onClick={() => setSettingsOpen(true)}><span className="connection-dot"/> {source}</button></footer>
    </main>
    {error && <div className="error-toast" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={clearError}>{("\u00d7")}</button></div>}
    <SettingsDialog open={settingsOpen} onClose={closeSettings} />
  </div>;
}

export default App;