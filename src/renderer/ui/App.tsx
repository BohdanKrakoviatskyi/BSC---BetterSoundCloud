import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Playlist, Track, TrackDetails, TrackCollection } from '../domain/models';
import { appGateway } from '../lib/appGateway';
import type { SoundCloudCredentials } from '../lib/useSoundCloudAuth';
import { AuthScreen } from './components/AuthScreen';
import { HomePage } from './components/HomePage';
import { LikedTracksSection } from './components/LikedTracksSection';
import { PlayerBar } from './components/PlayerBar';
import { SettingsPanel } from './components/SettingsPanel';
import { TrackSearch } from './components/TrackSearch';
import { TrackDetailsPage } from './components/TrackDetailsPage';
import { Sidebar } from './components/Sidebar';
import { MyLibraryPage } from './components/MyLibraryPage';
import { PlaylistPage } from './components/PlaylistPage';
import { ConfirmDialog } from './components/ConfirmDialog';
import type { Page, Profile, Settings } from './types';

const defaultSettings: Settings = { accent: '#ff765d', compact: false, volume: 70, clientId: '' };

function reasonText(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

export function App() {
  const [settings, setSettings] = useState(defaultSettings);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(true);
  const [auth, setAuth] = useState<'checking' | 'guest' | 'authorized'>('checking');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [likedTracks, setLikedTracks] = useState<Record<number, boolean>>({});
  const [likeBusy, setLikeBusy] = useState<Record<number, boolean>>({});
  const [tracksLoading, setTracksLoading] = useState(false);
  const [tracksError, setTracksError] = useState('');
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [playlistsError, setPlaylistsError] = useState('');
  const [activePlaylist, setActivePlaylist] = useState<Playlist | null>(null);
  const [activePlaylistTracks, setActivePlaylistTracks] = useState<Track[]>([]);
  const [activePlaylistLoading, setActivePlaylistLoading] = useState(false);
  const [activePlaylistError, setActivePlaylistError] = useState('');
  const [history, setHistory] = useState<Track[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [playerVisible, setPlayerVisible] = useState(false);
  const currentTrackRef = useRef<Track | null>(null);
  currentTrackRef.current = currentTrack;
  const [detailsTrack, setDetailsTrack] = useState<TrackDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState('');
  const [currentTrackIndex, setCurrentTrackIndex] = useState(-1);
  const [queueTracks, setQueueTracks] = useState<Track[]>([]);
  const [playbackLoading, setPlaybackLoading] = useState(false);
  const [shouldPlay, setShouldPlay] = useState(false);
  const [playbackError, setPlaybackError] = useState('');
  const [page, setPage] = useState<Page>('home');
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [selections, setSelections] = useState<TrackCollection[]>([]);
  const [selectionsLoading, setSelectionsLoading] = useState(false);
  const [selectionsError, setSelectionsError] = useState('');
  const [relatedTracks, setRelatedTracks] = useState<Track[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [relatedError, setRelatedError] = useState('');
  const detailsRequestId = useRef(0);

  async function recordPlayedTrack() {
    const track = currentTrackRef.current;
    if (!track) return;
    try {
      const updated = await appGateway.historyRecord(track);
      setHistory(updated);
      console.info('[ui.history] track recorded', { trackId: track.id, count: updated.length });
    } catch (reason) {
      const message = reasonText(reason, 'Не удалось сохранить историю');
      setHistoryError(message);
      console.error('[ui.history] record failed', { trackId: track.id, error: message });
    }
  }

  function handlePlaybackStateChange(playing: boolean) {
    setShouldPlay(playing);
    if (playing) void recordPlayedTrack();
  }

  async function loadMixedSelections() {
    setSelectionsLoading(true);
    setSelectionsError('');
    try {
      const loaded = await appGateway.mixedSelections();
      setSelections(loaded);
      console.info('[ui.mixed-selections] loaded', { count: loaded.length, tracks: loaded.reduce((count, selection) => count + selection.tracks.length, 0) });
    } catch (reason) {
      const message = reasonText(reason, 'Не удалось загрузить подборки');
      setSelectionsError(message);
      console.error('[ui.mixed-selections] failed', { error: message });
    } finally {
      setSelectionsLoading(false);
    }
  }

  async function loadTracks() {
    setTracksLoading(true);
    setTracksError('');
    try {
      const loaded = await appGateway.myTracks();
      setTracks(loaded);
      setLikedTracks(Object.fromEntries(loaded.map((track) => [track.id, true])));
      console.info('[ui.tracks] loaded', { count: loaded.length });
    } catch (reason) {
      const message = reasonText(reason, 'Не удалось загрузить треки');
      console.error('[ui.tracks] load failed', { error: message });
      setTracksError(message);
    } finally {
      setTracksLoading(false);
    }
  }

  async function loadHistory() {
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const loaded = await appGateway.historyList();
      setHistory(loaded);
      console.info('[ui.history] loaded', { count: loaded.length });
    } catch (reason) {
      const message = reasonText(reason, 'Не удалось загрузить историю прослушиваний');
      setHistoryError(message);
      console.error('[ui.history] load failed', { error: message });
    } finally {
      setHistoryLoading(false);
    }
  }

  async function clearHistory() {
    setHistoryError('');
    try {
      const cleared = await appGateway.historyClear();
      setHistory(cleared);
      console.info('[ui.history] cleared', { remaining: cleared.length });
    } catch (reason) {
      const message = reasonText(reason, 'Не удалось очистить историю прослушиваний');
      setHistoryError(message);
      console.error('[ui.history] clear failed', { error: message });
    }
  }

  async function loadPlaylists() {
    setPlaylistsLoading(true);
    setPlaylistsError('');
    try {
      const loaded = await appGateway.myPlaylists();
      setPlaylists(loaded);
      console.info('[ui.playlists] loaded', { count: loaded.length });
    } catch (reason) {
      const message = reasonText(reason, 'Не удалось загрузить плейлисты SoundCloud');
      setPlaylistsError(message);
      console.error('[ui.playlists] load failed', { error: message });
    } finally {
      setPlaylistsLoading(false);
    }
  }

  function refreshLibrary() {
    void loadTracks();
    void loadPlaylists();
  }

  async function toggleTrackLike(track: Track) {
    const wasLiked = likedTracks[track.id] ?? true;
    const operation = wasLiked ? 'unlike' : 'like';
    setLikedTracks((current) => ({ ...current, [track.id]: !wasLiked }));
    setLikeBusy((current) => ({ ...current, [track.id]: true }));
    setTracksError('');
    console.info(`[ui.track.${operation}] started`, { trackId: track.id });
    try {
      const result = wasLiked
        ? await appGateway.unlikeTrack(track.id, track.urn)
        : await appGateway.likeTrack(track.id, track.urn);
      setLikedTracks((current) => ({ ...current, [track.id]: result.liked }));
      console.info(`[ui.track.${operation}] completed`, { trackId: track.id, liked: result.liked });
    } catch (reason) {
      const message = reasonText(reason, 'Не удалось изменить лайк');
      console.error(`[ui.track.${operation}] failed`, { trackId: track.id, error: message });
      setLikedTracks((current) => ({ ...current, [track.id]: wasLiked }));
      setTracksError(message);
    } finally {
      setLikeBusy((current) => ({ ...current, [track.id]: false }));
    }
  }

  function loadTrackAt(index: number, queue: Track[] = queueTracks) {
    const track = queue[index];
    if (!track) {
      setShouldPlay(false);
      return;
    }
    setCurrentTrack(track);
    setPlayerVisible(true);
    setCurrentTrackIndex(index);
    setQueueTracks(queue);
    setPlaybackLoading(true);
    setPlaybackError('');
    setShouldPlay(true);
    console.info('[ui.player] loading official SoundCloud widget', { trackId: track.id, permalinkUrl: track.permalink });
  }

  function selectTrack(track: Track) {
    if (currentTrack?.id === track.id) {
      setShouldPlay((playing) => !playing);
      setPlaybackError('');
      return;
    }
    const index = tracks.findIndex((item) => item.id === track.id);
    if (index >= 0) {
      void loadTrackAt(index, tracks);
      return;
    }
    setCurrentTrack(track);
    setPlayerVisible(true);
    setCurrentTrackIndex(-1);
    setQueueTracks([track]);
    setPlaybackLoading(true);
    setPlaybackError('');
    setShouldPlay(true);
    console.info('[ui.player] loading selected search result', { trackId: track.id, permalinkUrl: track.permalink });
  }

  async function openPlaylist(playlist: Playlist) {
    setActivePlaylist(playlist);
    setActivePlaylistTracks([]);
    setActivePlaylistError('');
    setActivePlaylistLoading(true);
    setPage('playlist');
    try {
      setActivePlaylistTracks(await appGateway.playlistTracks(playlist.urn || playlist.id));
    } catch (reason) {
      setActivePlaylistError(reasonText(reason, 'Не удалось загрузить треки плейлиста'));
    } finally {
      setActivePlaylistLoading(false);
    }
  }

  function playPlaylist(index: number) {
    if (activePlaylistTracks.length) void loadTrackAt(index, activePlaylistTracks);
  }

  function togglePlayback() {
    setShouldPlay((playing) => !playing);
  }

  function focusGlobalSearch() {
    setPage('search');
    window.setTimeout(() => document.querySelector<HTMLInputElement>('#globalSearch')?.focus(), 0);
  }

  async function openTrackDetails(track: Track) {
    const requestId = ++detailsRequestId.current;
    setPage('track');
    setDetailsTrack(null);
    setDetailsLoading(true);
    setDetailsError('');
    setRelatedTracks([]);
    setRelatedLoading(true);
    setRelatedError('');
    console.info('[ui.track.details] loading', { trackId: track.id });
    const [detailsResult, relatedResult] = await Promise.allSettled([
      appGateway.trackDetails(track.id),
      appGateway.relatedTracks(track.id),
    ]);
    if (requestId !== detailsRequestId.current) {
      console.debug('[ui.track.details] ignored stale response', { trackId: track.id, requestId });
      return;
    }
    if (detailsResult.status === 'fulfilled') {
      setDetailsTrack(detailsResult.value);
      console.info('[ui.track.details] loaded', { trackId: detailsResult.value.id, title: detailsResult.value.title });
    } else {
      const message = reasonText(detailsResult.reason, 'Не удалось загрузить информацию о треке');
      console.error('[ui.track.details] failed', { trackId: track.id, error: message });
      setDetailsError(message);
    }
    if (relatedResult.status === 'fulfilled') {
      setRelatedTracks(relatedResult.value);
      console.info('[ui.track.related] loaded', { trackId: track.id, count: relatedResult.value.length });
    } else {
      const message = reasonText(relatedResult.reason, 'Не удалось загрузить похожие треки');
      console.error('[ui.track.related] failed', { trackId: track.id, error: message });
      setRelatedError(message);
    }
    setDetailsLoading(false);
    setRelatedLoading(false);
  }

  function playDetailsTrack() {
    const track = detailsTrack ?? currentTrack;
    if (!track) return;
    if (currentTrack?.id === track.id) {
      setShouldPlay((playing) => !playing);
      setPlaybackError('');
      return;
    }
    const index = tracks.findIndex((item) => item.id === track.id);
    setCurrentTrack(track);
    setPlayerVisible(true);
    setCurrentTrackIndex(index);
    setPlaybackLoading(true);
    setPlaybackError('');
    setShouldPlay(true);
    console.info('[ui.player] loading official SoundCloud widget from details', { trackId: track.id, permalinkUrl: track.permalink });
  }

  async function savePlayerVolume(volume: number) {
    setSettings((current) => ({ ...current, volume }));
    try {
      const stored = await appGateway.updateSettings({ volume });
      setSettings(stored);
    } catch (reason) {
      console.error('[ui.player] volume save failed', { error: reasonText(reason, 'unknown error') });
    }
  }

  useEffect(() => {
    let active = true;
    appGateway.start()
      .then(() => Promise.all([appGateway.getSettings(), appGateway.authStatus()]))
      .then(([storedSettings, status]) => {
        if (!active) return;
        setSettings(storedSettings);
        setProfile(status.profile ?? null);
        setAuth(status.authorized ? 'authorized' : 'guest');
        setReady(true);
        void loadHistory();
        if (status.authorized) {
          void loadTracks();
          void loadPlaylists();
          void loadMixedSelections();
          appGateway.authRefresh()
            .then((fresh) => {
              if (!active) return;
              if (!fresh.authorized) {
                setProfile(null);
                setAuth('guest');
              } else if (fresh.profile) {
                setProfile(fresh.profile);
              }
            })
            .catch((reason: unknown) => console.error('[ui.auth.refresh] failed', { error: reasonText(reason, 'unknown error') }));
        }
      })
      .catch((reason: unknown) => {
        if (!active) return;
        const message = reasonText(reason, 'Локальный backend недоступен');
        console.error('[ui.startup] failed', { error: message });
        setError(message);
      });
    return () => {
      active = false;
      void appGateway.stop().catch((reason: unknown) => {
        console.warn('[local-backend] stop failed during app cleanup', { error: reasonText(reason, String(reason)) });
      });
    };
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', settings.accent);
    document.documentElement.dataset.compact = String(settings.compact);
  }, [settings.accent, settings.compact]);

  async function updateSettings(patch: Partial<Settings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    setSaved(false);
    setError('');
    try {
      const stored = await appGateway.updateSettings(patch);
      setSettings(stored);
      setSaved(true);
    } catch (reason) {
      const message = reasonText(reason, 'Не удалось сохранить настройки');
      console.error('[ui.settings.update] failed', { keys: Object.keys(patch), error: message });
      setError(message);
    }
  }

  async function login(token: string, clientId?: string) {
    if (!token) {
      setLoginError('Вставьте access token SoundCloud');
      return;
    }
    setLoginBusy(true);
    setLoginError('');
    try {
      const result = await appGateway.authLogin(token);
      if (!result.authorized || !result.profile) throw new Error('SoundCloud не подтвердил токен');
      if (clientId) {
        try {
          const stored = await appGateway.updateSettings({ clientId });
          setSettings(stored);
        } catch (reason) {
          console.warn('[ui.auth.silent] client id save failed', { error: reasonText(reason, 'unknown error') });
        }
      }
      try {
        await invoke('finish_auth_flow');
      } catch (reason) {
        console.warn('[ui.auth] could not close SoundCloud window', { error: reasonText(reason, 'unknown error') });
      }
      setProfile(result.profile);
      setAuth('authorized');
      void loadTracks();
      void loadPlaylists();
      void loadMixedSelections();
    } catch (reason) {
      const message = reasonText(reason, 'Не удалось подключить аккаунт');
      console.error('[ui.auth.login] failed', { error: message });
      setLoginError(message);
    } finally {
      setLoginBusy(false);
    }
  }

  async function silentLogin(credentials: SoundCloudCredentials) {
    await login(credentials.token, credentials.clientId);
  }

  async function saveAccessToken(token: string): Promise<boolean> {
    setLoginBusy(true);
    setLoginError('');
    try {
      const result = await appGateway.authLogin(token);
      if (!result.authorized || !result.profile) throw new Error('SoundCloud не подтвердил токен');
      setProfile(result.profile);
      setAuth('authorized');
      void loadTracks();
      void loadPlaylists();
      void loadMixedSelections();
      return true;
    } catch (reason) {
      const message = reasonText(reason, 'Не удалось сохранить access token');
      console.error('[ui.settings.token] save failed', { error: message });
      setLoginError(message);
      return false;
    } finally {
      setLoginBusy(false);
    }
  }

  async function logout(): Promise<boolean> {
    setLoginError('');
    setError('');
    try {
      await appGateway.authLogout();
    } catch (reason) {
      const message = reasonText(reason, 'Не удалось выйти');
      console.error('[ui.auth.logout] failed', { error: message });
      setError(message);
      return false;
    }
    setProfile(null);
    setTracks([]);
    setPlaylists([]);
    setQueueTracks([]);
    setSelections([]);
    setRelatedTracks([]);
    setLikedTracks({});
    setCurrentTrack(null);
    setPlayerVisible(false);
    setCurrentTrackIndex(-1);
    setShouldPlay(false);
    setPlaybackError('');
    setAuth('guest');
    return true;
  }

  async function confirmLogout() {
    setLogoutBusy(true);
    try {
      if (await logout()) setLogoutDialogOpen(false);
    } finally {
      setLogoutBusy(false);
    }
  }

  async function clearAppData(): Promise<boolean> {
    setError('');
    try {
      const resetSettings = await appGateway.clearAppData();
      setSettings(resetSettings);
      setSaved(true);
      setProfile(null);
      setTracks([]);
      setPlaylists([]);
      setQueueTracks([]);
      setHistory([]);
      setSelections([]);
      setRelatedTracks([]);
      setLikedTracks({});
      setCurrentTrack(null);
      setPlayerVisible(false);
      setCurrentTrackIndex(-1);
      setShouldPlay(false);
      setPlaybackError('');
      setLoginError('');
      setAuth('guest');
      return true;
    } catch (reason) {
      const message = reasonText(reason, 'Не удалось очистить данные приложения');
      setError(message);
      console.error('[ui.settings.clear-data] failed', { error: message });
      return false;
    }
  }

  if (!ready) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="brand auth-brand">Better<span>SoundCloud</span></div>
          <div className="eyebrow">ЛОКАЛЬНЫЙ BACKEND</div>
          {error
            ? <><div className="error-message auth-error" role="alert">{error}</div><button type="button" className="auth-button" onClick={() => window.location.reload()}>Попробовать снова</button></>
            : <p className="auth-note">Запускаем Go sidecar…</p>}
        </div>
      </div>
    );
  }

  if (auth === 'guest') return <AuthScreen error={loginError} busy={loginBusy} clientId={settings.clientId} onLogin={(token, clientId) => void login(token, clientId)} onSilentLogin={silentLogin} />;

  return (
    <div className={`app-shell ${playerVisible ? 'player-visible' : ''}`}>
      <header className="topbar">
        <div className="window-tools"><button className="icon-button" type="button" onClick={() => setPage('likes')} aria-label="Назад">‹</button></div>
        <div className="global-search"><TrackSearch onSelect={selectTrack} /></div>
        <div className="top-actions">
          <button className="icon-button header-settings" type="button" onClick={() => setPage('settings')} aria-label="Настройки" title="Настройки">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33h-.08a1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51h-.08a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82v-.08a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1v-.08a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.08a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.08a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.08a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
          </button>
          <div className="header-account" title={profile?.fullName || profile?.username || 'SoundCloud'}>
            {profile?.avatarUrl
              ? <img className="header-avatar" src={profile.avatarUrl} alt="" />
              : <span className="header-avatar header-avatar-fallback" aria-hidden="true">{(profile?.username || 'SC').slice(0, 2).toUpperCase()}</span>}
            <span className="header-account-copy"><b>{profile?.fullName || profile?.username || 'SoundCloud'}</b><small>@{profile?.username || 'аккаунт'}</small></span>
          </div>
          <button className="icon-button header-logout" type="button" onClick={() => { setError(''); setLogoutDialogOpen(true); }} title="Выйти из SoundCloud" aria-label="Выйти из SoundCloud">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4.75H6.5A1.75 1.75 0 0 0 4.75 6.5v11A1.75 1.75 0 0 0 6.5 19.25H10" /><path d="M13.5 8.25 17.25 12l-3.75 3.75M17 12H9" /></svg>
          </button>
        </div>
      </header>
      <div className="workspace">
        <Sidebar profile={profile} page={page} tracks={tracks} onNavigate={setPage} onPlayTrack={selectTrack} />
        <main className="main-view panel" id="mainView"><div className="main-scroll">
        {page === 'home'
          ? <HomePage
              selections={selections}
              loading={selectionsLoading}
              error={selectionsError}
              history={history}
              historyLoading={historyLoading}
              historyError={historyError}
              artistFallback={profile?.username}
              currentTrackId={currentTrack?.id ?? null}
              isPlaying={shouldPlay}
              playbackLoading={playbackLoading}
              onPlayTrack={selectTrack}
              onOpenTrack={(track) => void openTrackDetails(track)}
              onClearHistory={() => void clearHistory()}
              onRetry={() => void loadMixedSelections()}
            />
          : page === 'search'
            ? <section className="page-content search-landing"><span className="eyebrow">ПОИСК SOUNDCLOUD</span><h1>Найди свой следующий трек</h1><p>Введи название песни или имя исполнителя в строку поиска.</p><button type="button" className="primary-button" onClick={focusGlobalSearch}>Начать поиск <span>⌕</span></button></section>
          : page === 'library'
            ? <MyLibraryPage
                tracks={tracks}
                playlists={playlists}
                tracksLoading={tracksLoading}
                playlistsLoading={playlistsLoading}
                tracksError={tracksError}
                playlistsError={playlistsError}
                artistFallback={profile?.username}
                currentTrackId={currentTrack?.id ?? null}
                isPlaying={shouldPlay}
                playbackLoading={playbackLoading}
                onRefresh={refreshLibrary}
                onPlayTrack={selectTrack}
                onOpenTrack={(track) => void openTrackDetails(track)}
                onOpenPlaylist={(playlist) => void openPlaylist(playlist)}
              />
          : page === 'playlist' && activePlaylist
            ? <PlaylistPage playlist={activePlaylist} tracks={activePlaylistTracks} loading={activePlaylistLoading} error={activePlaylistError} onBack={() => setPage('library')} onPlay={playPlaylist} />
          : page === 'likes'
          ? <LikedTracksSection
              tracks={tracks}
              likedTracks={likedTracks}
              likeBusy={likeBusy}
              loading={tracksLoading}
              error={tracksError}
              artistFallback={profile?.username}
              onRefresh={() => void loadTracks()}
              onToggleLike={(track) => void toggleTrackLike(track)}
              onPlayTrack={selectTrack}
              onOpenTrack={(track) => void openTrackDetails(track)}
              currentTrackId={currentTrack?.id ?? null}
              isPlaying={shouldPlay}
              playbackLoading={playbackLoading}
            />
          : page === 'settings'
            ? <SettingsPanel settings={settings} saved={saved} error={error} profile={profile} tokenError={loginError} tokenBusy={loginBusy} onSaveToken={saveAccessToken} onClearData={clearAppData} onUpdate={(patch) => void updateSettings(patch)} />
          : <TrackDetailsPage
                track={detailsTrack}
                loading={detailsLoading}
                error={detailsError}
                isCurrent={currentTrack?.id === detailsTrack?.id}
                isPlaying={shouldPlay}
                playbackLoading={currentTrack?.id === detailsTrack?.id && playbackLoading}
                relatedTracks={relatedTracks}
                relatedLoading={relatedLoading}
                relatedError={relatedError}
                currentTrackId={currentTrack?.id ?? null}
                isPlayingNow={shouldPlay}
                onPlayRelated={selectTrack}
                onOpenRelated={(track) => void openTrackDetails(track)}
                onBack={() => setPage('likes')}
                onPlay={playDetailsTrack}
              />}
        {tracksError && page !== 'likes' && <div className="error-message app-track-error" role="alert">{tracksError}</div>}
        </div></main>
      </div>
      {logoutDialogOpen && <ConfirmDialog
        eyebrow="АККАУНТ SOUNDCLOUD"
        title="Выйти из аккаунта?"
        description="Аккаунт будет отключён только в BetterSoundCloud. Доступ к нему в браузере и других приложениях не изменится."
        confirmLabel="Выйти"
        busyLabel="Выходим…"
        busy={logoutBusy}
        variant="danger"
        onClose={() => setLogoutDialogOpen(false)}
        onConfirm={() => void confirmLogout()}
      >
        {error && <div className="error-message" role="alert">{error}</div>}
      </ConfirmDialog>}
      <PlayerBar
        track={currentTrack}
        loading={playbackLoading}
        shouldPlay={shouldPlay}
        volume={settings.volume}
        error={playbackError}
        liked={currentTrack ? (likedTracks[currentTrack.id] ?? false) : false}
        onLike={() => { if (currentTrack) void toggleTrackLike(currentTrack); }}
        onOpenTrack={() => { if (currentTrack) void openTrackDetails(currentTrack); }}
        onTogglePlayback={togglePlayback}
        onVolumeCommit={(volume) => void savePlayerVolume(volume)}
        onPrevious={() => void loadTrackAt(Math.max(currentTrackIndex - 1, 0))}
        onNext={() => void loadTrackAt(currentTrackIndex + 1)}
        hasNext={currentTrackIndex >= 0 && currentTrackIndex + 1 < queueTracks.length}
        onEnded={() => {
          if (currentTrackIndex + 1 < queueTracks.length) void loadTrackAt(currentTrackIndex + 1);
          else setShouldPlay(false);
        }}
        onReady={() => setPlaybackLoading(false)}
        onError={(message) => { setPlaybackError(message); setPlaybackLoading(false); setShouldPlay(false); }}
        onPlaybackStateChange={handlePlaybackStateChange}
      />
    </div>
  );
}
