import { useCallback, useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauri } from '@tauri-apps/api/core';
import { motion } from 'framer-motion';
import { readLocalMusicSources, readPreferences, saveLocalMusicSources } from './app/preferences';
import { readArtworkBytes } from './app/artwork';
import { commands, type LaunchAction, type LocalPlaylist } from './app/commands';
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
  const trackPath = useAppStore((state) => state.trackPath);
  const playback = useAppStore((state) => state.playback);
  const setTrackPath = useAppStore((state) => state.setTrackPath);
  const setPlayback = useAppStore((state) => state.setPlayback);
  const spectrum = useAppStore((state) => state.spectrum);
  const setSpectrum = useAppStore((state) => state.setSpectrum);
  const localSongs = useAppStore((state) => state.localSongs);
  const setLocalLibrary = useAppStore((state) => state.setLocalLibrary);
  const localSources = useAppStore((state) => state.localSources);
  const localLibraryReady = useAppStore((state) => state.localLibraryReady);
  const [libraryScanning, setLibraryScanning] = useState(false);
  const [localPlaylists, setLocalPlaylists] = useState<LocalPlaylist[]>([]);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);

  useEffect(() => { if (isTauri()) void commands.spectrumEnable(); }, []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    let unlistenAction: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;
    let unlistenSettings: (() => void) | undefined;
    let unlistenLibrary: (() => void) | undefined;

    const applyAction = (action: { type: string; route?: string }) => {
      if (action.type === 'navigate' && action.route && ['home', 'search', 'playlists', 'songs'].includes(action.route)) navigate(action.route as 'home' | 'search' | 'playlists' | 'songs');
      if (action.type === 'toggle-immersive' || action.type === 'close-immersive') showError('Immersive player is scheduled for Phase 8.');
      if (action.type === 'play-pause') { if (playback.playing) void commands.playbackPause(); else void commands.playbackResume(); }
      if (action.type === 'next') void commands.playbackNext();
    };
    void readPreferences().then(async (preferences) => {
      setTheme(preferences.theme); setSource(preferences.source);
      if (isTauri()) {
        const savedSources = await readLocalMusicSources();
        const rustSources = await commands.localLibrarySources();
        if (savedSources.length && !rustSources.length) {
          await commands.localLibrarySetSources(savedSources);
          await commands.localLibraryRescan();
        }
        else if (rustSources.length && !savedSources.length) await saveLocalMusicSources(rustSources);
      }
    }).catch((reason: unknown) => showError(String(reason)));
    if (isTauri()) {
      void commands.localPlaylists().then(setLocalPlaylists).catch((reason: unknown) => showError(String(reason)));
      void commands.initialAction().then((action) => { if (action) applyAction(action); }).catch((reason: unknown) => showError(String(reason)));
      void listen<LaunchAction>('launch-action', (event) => applyAction(event.payload)).then((unlisten) => { unlistenAction = unlisten; });
      void listen<string>('app-error', (event) => showError(event.payload)).then((unlisten) => { unlistenError = unlisten; });
      void listen('open-settings', () => setSettingsOpen(true)).then((unlisten) => { unlistenSettings = unlisten; });
      const refreshLibrary = async () => {
        try {
          const status = await commands.localLibraryStatus();
          const songs = await commands.localLibrarySongs();
          setLocalLibrary(songs, status.sources);
          setLibraryScanning(status.scanning);
        } catch (reason) { showError(String(reason)); }
      };
      void refreshLibrary();
      void listen<number>('local-library-scanned', () => { void refreshLibrary(); }).then((unlisten) => { unlistenLibrary = unlisten; });
      void listen<{ paths: string[] }>('tauri://drag-drop', (event) => {
        const paths = event.payload.paths;
        const path = paths[0];
        if (path) {
          const crossfade = trackPath && playback.duration_ms && playback.position_ms >= playback.duration_ms - 5_000;
          setTrackPath(path);
          if (paths.length > 1) void commands.queueLocalFiles(paths.slice(1));
          void (crossfade ? commands.crossfadeLocalFile(path, 5000) : commands.playLocalFile(path)).catch((reason: unknown) => showError(String(reason)));
        }
      });
    }

    return () => { unlistenAction?.(); unlistenError?.(); unlistenSettings?.(); unlistenLibrary?.(); };
  }, [navigate, setLocalLibrary, setSource, setTheme, showError, playback.playing]);

  useEffect(() => {
    if (isTauri() && localLibraryReady) void saveLocalMusicSources(localSources).catch((reason: unknown) => showError(String(reason)));
  }, [localSources, localLibraryReady, showError]);

  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    const poll = async () => { try { const snapshot = await commands.playbackSnapshot(); if (active) setPlayback(snapshot); const levels = await commands.spectrumLevels(); if (active) setSpectrum(levels); } catch (reason) { if (active) showError(String(reason)); } };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 250);
    return () => { active = false; window.clearInterval(timer); };
  }, [setPlayback, setSpectrum, showError]);

  const chooseLocalFile = async () => {
    try { const path = await commands.pickLocalFile(); if (!path) return; setTrackPath(path); if (isTauri()) await commands.playLocalFile(path); }
    catch (reason) { showError(String(reason)); }
  };
  const trackName = trackPath?.split(/[\\/]/).at(-1) ?? 'Nothing playing yet';

  const startDragging = () => { if (isTauri()) void getCurrentWindow().startDragging(); };
  const addLibrarySource = async () => {
    try {
      const path = await commands.pathFromFileDrop();
      if (!path) return;
      setLibraryScanning(true);
      await commands.localLibraryAddSources([path]);
      const [songs, sources] = await Promise.all([commands.localLibrarySongs(), commands.localLibrarySources()]);
      setLocalLibrary(songs, sources);
      await saveLocalMusicSources(sources);
    } catch (reason) { showError(String(reason)); }
    finally { setLibraryScanning(false); }
  };
  const saveSongTags = async (song: (typeof localSongs)[number], form: HTMLFormElement) => {
    const values = new FormData(form);
    const field = (name: string) => String(values.get(name) ?? '');
    try {
      const selectedArtwork = values.get('artwork');
      if (selectedArtwork instanceof File && selectedArtwork.size > 0 && (!['image/jpeg', 'image/png'].includes(selectedArtwork.type) || selectedArtwork.size > 20 * 1024 * 1024)) {
        showError('Choose a JPEG or PNG image smaller than 20 MiB for the cover.');
        return;
      }
      const artwork = selectedArtwork instanceof File && selectedArtwork.size > 0
        ? await readArtworkBytes(selectedArtwork)
        : undefined;
      await commands.localSongEditTags(song.uri, {
        title: field('title'), artist: field('artist'), album: field('album'), albumArtist: field('albumArtist'),
        genre: field('genre'), date: field('date'), trackNumber: field('trackNumber'), discNumber: field('discNumber'),
        removeArtwork: values.has('removeArtwork'),
      }, artwork);
      form.reset();
      setLocalPlaylists(await commands.localPlaylists());
    } catch (reason) { showError(String(reason)); }
  };
  const removeLibrarySource = async (path: string) => {
    try {
      setLibraryScanning(true);
      await commands.localLibraryRemoveSource(path);
      const [songs, sources] = await Promise.all([commands.localLibrarySongs(), commands.localLibrarySources()]);
      setLocalLibrary(songs, sources);
      await saveLocalMusicSources(sources);
    } catch (reason) { showError(String(reason)); }
    finally { setLibraryScanning(false); }
  };
  const rescanLibrary = async () => {
    try {
      setLibraryScanning(true);
      await commands.localLibraryRescan();
      setLocalLibrary(await commands.localLibrarySongs(), localSources);
    } catch (reason) { showError(String(reason)); }
    finally { setLibraryScanning(false); }
  };
  const createLocalPlaylist = async () => {
    const name = window.prompt('Playlist name')?.trim();
    if (!name) return;
    try {
      const playlist = await commands.localPlaylistCreate(name);
      setLocalPlaylists((items) => [playlist, ...items]);
      setSelectedPlaylistId(playlist.id);
    } catch (reason) { showError(String(reason)); }
  };
  const saveLocalPlaylist = async (playlist: LocalPlaylist, form: HTMLFormElement) => {
    const values = new FormData(form);
    const name = String(values.get('name') ?? '');
    const description = String(values.get('description') ?? '');
    const selectedArtwork = values.get('artwork');
    try {
      if (selectedArtwork instanceof File && selectedArtwork.size > 0 && (!['image/jpeg', 'image/png'].includes(selectedArtwork.type) || selectedArtwork.size > 20 * 1024 * 1024)) {
        showError('Choose a JPEG or PNG image smaller than 20 MiB for the cover.');
        return;
      }
      const artwork = selectedArtwork instanceof File && selectedArtwork.size > 0
        ? await readArtworkBytes(selectedArtwork)
        : undefined;
      await commands.localPlaylistUpdate(playlist.id, name, description, artwork);
      setLocalPlaylists(await commands.localPlaylists());
    } catch (reason) { showError(String(reason)); }
  };
  const addSongToPlaylist = async (song: (typeof localSongs)[number]) => {
    if (!selectedPlaylistId) return;
    try {
      await commands.localPlaylistAddSongs(selectedPlaylistId, [song]);
      setLocalPlaylists(await commands.localPlaylists());
    } catch (reason) { showError(String(reason)); }
  };
  const deleteLocalPlaylist = async (id: string) => {
    try {
      await commands.localPlaylistDelete(id);
      setLocalPlaylists(await commands.localPlaylists());
      if (selectedPlaylistId === id) setSelectedPlaylistId(null);
    } catch (reason) { showError(String(reason)); }
  };
  const removePlaylistSong = async (id: string, uri: string) => {
    try {
      await commands.localPlaylistRemoveSong(id, uri);
      setLocalPlaylists(await commands.localPlaylists());
    } catch (reason) { showError(String(reason)); }
  };
  const movePlaylistSong = async (playlist: LocalPlaylist, index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= playlist.songs.length) return;
    const songs = [...playlist.songs];
    [songs[index], songs[target]] = [songs[target], songs[index]];
    try {
      await commands.localPlaylistReorder(playlist.id, songs.map((song) => song.uri));
      setLocalPlaylists(await commands.localPlaylists());
    } catch (reason) { showError(String(reason)); }
  };
  const showPage = () => {
    if (route === 'home') return <><section className="welcome-card"><div className="welcome-copy"><p className="eyebrow">A LITTLE SPACE FOR SOUND</p><h2>Your music,<br /><em>your atmosphere.</em></h2><p>Bring your favorite music together in one calm, expressive player.</p><button className="primary-button" onClick={() => setSettingsOpen(true)}>Choose a music source <span aria-hidden="true">&#8599;</span></button></div><div className="art-orbit" aria-hidden="true"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="orbit-core">{("\u266b")}</div><div className="orbit-star">{("\u2733")}</div></div></section><section className="getting-started"><div><p className="eyebrow">GETTING STARTED</p><h3>Make it yours</h3><p>Connect a source in settings to start building your listening space.</p></div><button className="text-button" onClick={() => setSettingsOpen(true)}>Open settings <span aria-hidden="true">&#8594;</span></button></section></>;
    if (route === 'search') return <section className="empty-view"><span className="empty-symbol">{("\u2315")}</span><h2>Find your next favorite</h2><p>Search across your connected music sources.</p><button className="primary-button" onClick={() => setSettingsOpen(true)}>Connect a source</button></section>;
    if (route === 'playlists') {
      const selected = localPlaylists.find((playlist) => playlist.id === selectedPlaylistId);
      return <section className="local-library-view">
        <div className="local-library-heading"><div><p className="eyebrow">LOCAL PLAYLISTS</p><h2>{selected?.name ?? 'Your playlists'}</h2><p>Playlists saved on this device.</p></div><div className="library-actions"><button className="primary-button" onClick={() => void createLocalPlaylist()}>Create playlist</button></div></div>
        {selected ? <>
          <button className="text-button" onClick={() => setSelectedPlaylistId(null)}>All playlists</button>
          <div className="playlist-detail-heading">{selected.artworkUrl ? <img src={selected.artworkUrl} alt={`${selected.name} cover`} /> : <span className="song-art">▤</span>}<div><strong>{selected.name}</strong><small>{selected.description || 'No description'}</small></div></div>
          <details className="playlist-editor"><summary>Edit playlist details</summary><form key={`${selected.id}-${selected.name}`} onSubmit={(event) => { event.preventDefault(); void saveLocalPlaylist(selected, event.currentTarget); }}><label>Name<input name="name" defaultValue={selected.name} required /></label><label>Description<input name="description" defaultValue={selected.description} /></label><label>Replace playlist cover<input type="file" name="artwork" accept="image/jpeg,image/png,.jpg,.jpeg,.png" /></label><button className="primary-button" type="submit">Save playlist</button></form></details>
          <ul className="local-song-list">{selected.songs.map((song, index) => <li key={`${song.instanceId}-${index}`}><button className="local-song-row" onClick={() => { setTrackPath(song.path); void commands.playLocalFile(song.path).catch((reason: unknown) => showError(String(reason))); }}><span className="song-art">♫</span><span className="song-meta"><strong>{song.name}</strong><small>{song.artists} · {song.albumName}</small></span></button><button className="text-button" aria-label={`Move ${song.name} up`} onClick={() => void movePlaylistSong(selected, index, -1)} disabled={index === 0}>↑</button><button className="text-button" aria-label={`Move ${song.name} down`} onClick={() => void movePlaylistSong(selected, index, 1)} disabled={index === selected.songs.length - 1}>↓</button><button className="text-button" aria-label={`Remove ${song.name}`} onClick={() => void removePlaylistSong(selected.id, song.uri)}>Remove</button><details className="tag-editor"><summary>Edit copied track tags</summary><form onSubmit={(event) => { event.preventDefault(); void saveSongTags(song, event.currentTarget); }}>{(['title', 'artist', 'album', 'albumArtist', 'genre', 'date', 'trackNumber', 'discNumber'] as const).map((field) => <label key={field}>{field}<input name={field} defaultValue={song.tags[field] ?? ''} /></label>)}<label>Replace embedded artwork<input type="file" name="artwork" accept="image/jpeg,image/png,.jpg,.jpeg,.png" /></label><label className="tag-remove-art"><input type="checkbox" name="removeArtwork" />Remove embedded artwork</label><button className="primary-button" type="submit">Save tags</button></form></details></li>)}</ul>
          {localSongs.length > 0 && <details><summary>Add songs</summary><ul className="local-song-list">{localSongs.map((song) => <li key={song.instanceId}><button className="local-song-row" onClick={() => void addSongToPlaylist(song)}><span className="song-meta"><strong>{song.name}</strong><small>{song.artists} · {song.albumName}</small></span><span>+</span></button></li>)}</ul></details>}
        </> : localPlaylists.length ? <ul className="library-source-list">{localPlaylists.map((playlist) => <li key={playlist.id}><button className="text-button" onClick={() => setSelectedPlaylistId(playlist.id)}>{playlist.name} · {playlist.songs.length} songs</button><button className="text-button" aria-label={`Delete ${playlist.name}`} onClick={() => void deleteLocalPlaylist(playlist.id)}>Delete</button></li>)}</ul> : <div className="empty-view"><span className="empty-symbol">▤</span><h2>Your playlists will live here</h2><p>Create a playlist and add local music to it.</p><button className="primary-button" onClick={() => void createLocalPlaylist()}>Create playlist</button></div>}
      </section>;
    }
    return <section className="local-library-view"><div className="local-library-heading"><div><p className="eyebrow">LOCAL FILES</p><h2>{localSongs.length ? `${localSongs.length} songs` : 'Your music collection'}</h2><p>Scanned folders and audio files on this device.</p></div><div className="library-actions"><button className="text-button" onClick={() => void rescanLibrary()} disabled={libraryScanning}>{libraryScanning ? 'Scanning…' : 'Rescan'}</button><button className="primary-button" onClick={() => void addLibrarySource()} disabled={libraryScanning}>Add file or folder</button></div></div>{localSources.length > 0 && <ul className="library-source-list" aria-label="Library sources">{localSources.map((path) => <li key={path}><span title={path}>{path}</span><button className="text-button" aria-label={`Remove ${path}`} onClick={() => void removeLibrarySource(path)} disabled={libraryScanning}>Remove</button></li>)}</ul>}{localSongs.length ? <ul className="local-song-list">{localSongs.map((song) => <li key={song.instanceId}><button className="local-song-row" onClick={() => { setTrackPath(song.path); void commands.playLocalFile(song.path).catch((reason: unknown) => showError(String(reason))); }}><span className="song-art">{song.artworkUrl ? <img src={song.artworkUrl} alt="" /> : '♫'}</span><span className="song-meta"><strong>{song.name}</strong><small>{song.artists} · {song.albumName}</small></span><span className="song-duration">{song.durationMs ? `${Math.floor(song.durationMs / 60000)}:${String(Math.floor(song.durationMs / 1000) % 60).padStart(2, '0')}` : '—'}</span></button><details className="tag-editor"><summary>Edit tags</summary><form onSubmit={(event) => { event.preventDefault(); void saveSongTags(song, event.currentTarget); }}>{(['title', 'artist', 'album', 'albumArtist', 'genre', 'date', 'trackNumber', 'discNumber'] as const).map((field) => <label key={field}>{field}<input name={field} defaultValue={song.tags[field] ?? ''} /></label>)}<label>Replace embedded artwork<input type="file" name="artwork" accept="image/jpeg,image/png,.jpg,.jpeg,.png" /></label><label className="tag-remove-art"><input type="checkbox" name="removeArtwork" />Remove embedded artwork</label><button className="primary-button" type="submit">Save tags</button></form></details></li>)}</ul> : <div className="empty-view"><span className="empty-symbol">{("\u266b")}</span><h2>A home for the songs you love</h2><p>Add an audio file from your device to start your local library.</p><button className="primary-button" onClick={() => void addLibrarySource()}>Add file or folder</button></div>}</section>;
  };

  return <div className="app-frame">
    <Sidebar />
    <main className="main-panel">
      <header className="titlebar" onMouseDown={(event) => { if (event.buttons === 1) startDragging(); }}>
        <div className="titlebar-breadcrumb"><span className="status-pip"/>PERSONAL LISTENING SPACE</div>
        <div className="titlebar-actions" onMouseDown={(event) => event.stopPropagation()}><button className="icon-button settings-trigger" aria-label="Open settings" onClick={() => setSettingsOpen(true)}>⚙</button><WindowControls /></div>
      </header>
      <div className="page-scroll"><div className="page-heading"><div><p className="eyebrow">{route === 'home' ? 'YOUR SPACE' : 'EXPLORE YOUR LIBRARY'}</p><h1>{titles[route]}</h1></div><span className="date-stamp">RESONANCE | 0.2.6</span></div><motion.div key={route} className="page-content" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: 'easeOut' }}>{showPage()}</motion.div></div>
      <footer className="player-dock"><button className="dock-empty-art" aria-label="Choose local audio file" onClick={() => void chooseLocalFile()}>{("\u266b")}</button><div className="dock-track"><strong title={trackName}>{trackName}</strong><span>{trackPath ? (playback.playing ? 'Playing from this device' : 'Local audio') : 'Choose a source to begin'}</span></div><div className="dock-center"><button className="dock-play" aria-label={playback.playing ? 'Pause' : 'Play'} onClick={() => void (playback.playing ? commands.playbackPause() : commands.playbackResume())}>{playback.playing ? 'Ⅱ' : '▶'}</button><button className="dock-skip" aria-label="Next track" onClick={() => void commands.playbackNext()}>▶|</button><input aria-label="Playback position" className="dock-progress" type="range" min={0} max={playback.duration_ms ?? 100} value={playback.duration_ms ? Math.min(playback.position_ms, playback.duration_ms) : 0} onChange={(event) => void commands.playbackSeek(Number(event.target.value))} disabled={!trackPath || !playback.duration_ms} /><span className="dock-note">{playback.duration_ms ? `${Math.floor(playback.position_ms / 60000)}:${String(Math.floor(playback.position_ms / 1000) % 60).padStart(2, '0')}` : 'Local playback'}</span></div><div className="dock-spectrum" aria-label="Audio spectrum">{spectrum.map((level, index) => <i key={index} style={{ height: `${Math.max(2, level * 24)}px` }} />)}</div><button className="dock-source" onClick={() => void chooseLocalFile()}><span className="connection-dot"/> Open file · {source}</button></footer>
    </main>
    {error && <div className="error-toast" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={clearError}>{("\u00d7")}</button></div>}
    <SettingsDialog open={settingsOpen} onClose={closeSettings} />
  </div>;
}

export default App;
