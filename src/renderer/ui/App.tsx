import { useEffect, useState } from 'react';
import type { SoundCloudTrack, SoundCloudTrackDetails } from '../lib/desktop';
import { AuthScreen } from './components/AuthScreen';
import { LikedTracksSection } from './components/LikedTracksSection';
import { PlayerBar } from './components/PlayerBar';
import { SettingsPanel } from './components/SettingsPanel';
import { TrackSearch } from './components/TrackSearch';
import { TrackDetailsPage } from './components/TrackDetailsPage';
import { Sidebar } from './components/Sidebar';
import type { Page, Profile, Settings } from './types';

const defaultSettings: Settings = { accent: '#f0c75e', compact: false, volume: 70 };

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
  const [tracks, setTracks] = useState<SoundCloudTrack[]>([]);
  const [likedTracks, setLikedTracks] = useState<Record<number, boolean>>({});
  const [likeBusy, setLikeBusy] = useState<Record<number, boolean>>({});
  const [tracksLoading, setTracksLoading] = useState(false);
  const [tracksError, setTracksError] = useState('');
  const [currentTrack, setCurrentTrack] = useState<SoundCloudTrack | null>(null);
  const [detailsTrack, setDetailsTrack] = useState<SoundCloudTrackDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState('');
  const [currentTrackIndex, setCurrentTrackIndex] = useState(-1);
  const [playbackLoading, setPlaybackLoading] = useState(false);
  const [shouldPlay, setShouldPlay] = useState(false);
  const [playbackError, setPlaybackError] = useState('');
  const [page, setPage] = useState<Page>('likes');

  async function loadTracks() {
    setTracksLoading(true);
    setTracksError('');
    try {
      const loaded = await window.desktop.myTracks();
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

  async function toggleTrackLike(track: SoundCloudTrack) {
    const wasLiked = likedTracks[track.id] ?? true;
    const operation = wasLiked ? 'unlike' : 'like';
    setLikedTracks((current) => ({ ...current, [track.id]: !wasLiked }));
    setLikeBusy((current) => ({ ...current, [track.id]: true }));
    setTracksError('');
    console.info(`[ui.track.${operation}] started`, { trackId: track.id });
    try {
      const result = wasLiked
        ? await window.desktop.unlikeTrack(track.id, track.trackUrn)
        : await window.desktop.likeTrack(track.id, track.trackUrn);
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

  function loadTrackAt(index: number) {
    const track = tracks[index];
    if (!track) {
      setShouldPlay(false);
      return;
    }
    setCurrentTrack(track);
    setCurrentTrackIndex(index);
    setPlaybackLoading(true);
    setPlaybackError('');
    setShouldPlay(true);
    console.info('[ui.player] loading official SoundCloud widget', { trackId: track.id, permalinkUrl: track.permalinkUrl });
  }

  function selectTrack(track: SoundCloudTrack) {
    if (currentTrack?.id === track.id) {
      setShouldPlay((playing) => !playing);
      setPlaybackError('');
      return;
    }
    const index = tracks.findIndex((item) => item.id === track.id);
    if (index >= 0) {
      void loadTrackAt(index);
      return;
    }
    setCurrentTrack(track);
    setCurrentTrackIndex(-1);
    setPlaybackLoading(true);
    setPlaybackError('');
    setShouldPlay(true);
    console.info('[ui.player] loading selected search result', { trackId: track.id, permalinkUrl: track.permalinkUrl });
  }

  function togglePlayback() {
    setShouldPlay((playing) => !playing);
  }

  async function openTrackDetails(track: SoundCloudTrack) {
    setPage('track');
    setDetailsTrack(null);
    setDetailsLoading(true);
    setDetailsError('');
    console.info('[ui.track.details] loading', { trackId: track.id });
    try {
      const details = await window.desktop.trackDetails(track.id);
      setDetailsTrack(details);
      console.info('[ui.track.details] loaded', { trackId: details.id, title: details.title });
    } catch (reason) {
      const message = reasonText(reason, 'Не удалось загрузить информацию о треке');
      console.error('[ui.track.details] failed', { trackId: track.id, error: message });
      setDetailsError(message);
    } finally {
      setDetailsLoading(false);
    }
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
    setCurrentTrackIndex(index);
    setPlaybackLoading(true);
    setPlaybackError('');
    setShouldPlay(true);
    console.info('[ui.player] loading official SoundCloud widget from details', { trackId: track.id, permalinkUrl: track.permalinkUrl });
  }

  async function savePlayerVolume(volume: number) {
    setSettings((current) => ({ ...current, volume }));
    try {
      const stored = await window.desktop.updateSettings({ volume });
      setSettings(stored);
    } catch (reason) {
      console.error('[ui.player] volume save failed', { error: reasonText(reason, 'unknown error') });
    }
  }

  useEffect(() => {
    let active = true;
    window.desktop.start()
      .then(() => Promise.all([window.desktop.getSettings(), window.desktop.authStatus()]))
      .then(([storedSettings, status]) => {
        if (!active) return;
        setSettings(storedSettings);
        setProfile(status.profile ?? null);
        setAuth(status.authorized ? 'authorized' : 'guest');
        setReady(true);
        if (status.authorized) {
          void loadTracks();
          window.desktop.authRefresh()
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
      void window.desktop.stop().catch((reason: unknown) => {
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
      const stored = await window.desktop.updateSettings(patch);
      setSettings(stored);
      setSaved(true);
    } catch (reason) {
      const message = reasonText(reason, 'Не удалось сохранить настройки');
      console.error('[ui.settings.update] failed', { keys: Object.keys(patch), error: message });
      setError(message);
    }
  }

  async function login(token: string) {
    if (!token) {
      setLoginError('Вставьте access token SoundCloud');
      return;
    }
    setLoginBusy(true);
    setLoginError('');
    try {
      const result = await window.desktop.authLogin(token);
      if (!result.authorized || !result.profile) throw new Error('SoundCloud не подтвердил токен');
      setProfile(result.profile);
      setAuth('authorized');
      void loadTracks();
    } catch (reason) {
      const message = reasonText(reason, 'Не удалось подключить аккаунт');
      console.error('[ui.auth.login] failed', { error: message });
      setLoginError(message);
    } finally {
      setLoginBusy(false);
    }
  }

  async function logout() {
    setLoginError('');
    try {
      await window.desktop.authLogout();
    } catch (reason) {
      const message = reasonText(reason, 'Не удалось выйти');
      console.error('[ui.auth.logout] failed', { error: message });
      setError(message);
      return;
    }
    setProfile(null);
    setTracks([]);
    setLikedTracks({});
    setCurrentTrack(null);
    setCurrentTrackIndex(-1);
    setShouldPlay(false);
    setPlaybackError('');
    setAuth('guest');
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

  if (auth === 'guest') return <AuthScreen error={loginError} busy={loginBusy} onLogin={(token) => void login(token)} />;

  return (
    <div className="app-shell">
      <Sidebar profile={profile} page={page} backendReady={ready} onNavigate={setPage} onLogout={() => void logout()} />
      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumbs">BetterSoundCloud <span>/</span> {page === 'likes' ? 'Мои лайки' : page === 'settings' ? 'Настройки' : detailsTrack?.title || 'Трек'}</div>
          <TrackSearch onSelect={selectTrack} />
        </header>
        {page === 'likes'
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
            ? <SettingsPanel settings={settings} saved={saved} error={error} onUpdate={(patch) => void updateSettings(patch)} />
            : <TrackDetailsPage
                track={detailsTrack}
                loading={detailsLoading}
                error={detailsError}
                isCurrent={currentTrack?.id === detailsTrack?.id}
                isPlaying={shouldPlay}
                playbackLoading={currentTrack?.id === detailsTrack?.id && playbackLoading}
                onBack={() => setPage('likes')}
                onPlay={playDetailsTrack}
              />}
      </main>
      <PlayerBar
        key={currentTrack?.id ?? 'empty'}
        track={currentTrack}
        loading={playbackLoading}
        shouldPlay={shouldPlay}
        volume={settings.volume}
        error={playbackError}
        onTogglePlayback={togglePlayback}
        onVolumeCommit={(volume) => void savePlayerVolume(volume)}
        onPrevious={() => void loadTrackAt(Math.max(currentTrackIndex - 1, 0))}
        onNext={() => void loadTrackAt(currentTrackIndex + 1)}
        hasNext={currentTrackIndex >= 0 && currentTrackIndex + 1 < tracks.length}
        onEnded={() => {
          if (currentTrackIndex + 1 < tracks.length) void loadTrackAt(currentTrackIndex + 1);
          else setShouldPlay(false);
        }}
        onReady={() => setPlaybackLoading(false)}
        onError={(message) => { setPlaybackError(message); setPlaybackLoading(false); setShouldPlay(false); }}
        onPlaybackStateChange={setShouldPlay}
      />
    </div>
  );
}
