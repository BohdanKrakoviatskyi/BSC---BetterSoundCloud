import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Playlist, Track, TrackDetails, TrackCollection } from '../domain/models';
import { appGateway } from '../application/appGateway';
import type { SoundCloudCredentials } from '../platform/useSoundCloudAuth';
import type { Page, Profile, Settings } from './types';

const defaultSettings: Settings = { accent: '#ff765d', compact: false, volume: 70, clientId: '' };

function reasonText(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

type CaptchaChallengeStatus = { completed: boolean; closed: boolean; datadomeCookie?: string | null };

async function waitForCaptchaChallenge(): Promise<CaptchaChallengeStatus | null> {
  const deadline = Date.now() + 3 * 60_000;
  while (Date.now() < deadline) {
    const status = await invoke<CaptchaChallengeStatus>('poll_captcha_challenge');
    if (status.completed) return status;
    if (status.closed) return null;
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
  }
  return null;
}

export function useAppController() {
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
  const historyWriteRef = useRef<Promise<void>>(Promise.resolve());
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

  function recordPlayedTrack() {
    const track = currentTrackRef.current;
    if (!track) return;
    historyWriteRef.current = historyWriteRef.current.then(async () => {
      try {
        const updated = await appGateway.historyRecord(track);
        setHistory(updated);
        console.info('[ui.history] track recorded', { trackId: track.id, count: updated.length });
      } catch (reason) {
        const message = reasonText(reason, 'Не удалось сохранить историю');
        setHistoryError(message);
        console.error('[ui.history] record failed', { trackId: track.id, error: message });
      }
    });
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
    const wasLiked = likedTracks[track.id] ?? false;
    const operation = wasLiked ? 'unlike' : 'like';
    setLikedTracks((current) => ({ ...current, [track.id]: !wasLiked }));
    setLikeBusy((current) => ({ ...current, [track.id]: true }));
    setTracksError('');
    console.info(`[ui.track.${operation}] started`, { trackId: track.id });
    try {
      const result = wasLiked
        ? await appGateway.unlikeTrack(track.id, track.urn)
        : await appGateway.likeTrack(track.id, track.urn);
      if (result.captchaUrl) {
        setLikedTracks((current) => ({ ...current, [track.id]: wasLiked }));
        console.warn(`[ui.track.${operation}] SoundCloud requested a captcha`, { trackId: track.id });
        let challengeUrl = result.captchaUrl;
        for (let attempt = 0; attempt < 2; attempt++) {
          await invoke('show_captcha_window', { url: challengeUrl });
          const challenge = await waitForCaptchaChallenge();
          if (!challenge) {
            setTracksError('Проверка SoundCloud не завершена. Пройди её в открытом окне и попробуй снова.');
            return;
          }
          const datadomeCookie = challenge.datadomeCookie ?? undefined;
          const retry = wasLiked
            ? await appGateway.unlikeTrack(track.id, track.urn, datadomeCookie)
            : await appGateway.likeTrack(track.id, track.urn, datadomeCookie);
          if (!retry.captchaUrl) {
            setLikedTracks((current) => ({ ...current, [track.id]: retry.liked }));
            console.info(`[ui.track.${operation}] completed after captcha`, { trackId: track.id, liked: retry.liked });
            return;
          }
          if (attempt === 1) {
            setTracksError('SoundCloud не принял результат проверки. Попробуй повторить действие позже.');
            return;
          }
          challengeUrl = retry.captchaUrl;
        }
      }
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
      const stopBackend = () => {
        void appGateway.stop().catch((reason: unknown) => {
          console.warn('[local-backend] stop failed during app cleanup', { error: reasonText(reason, String(reason)) });
        });
      };
      void historyWriteRef.current.then(stopBackend, stopBackend);
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

  return {
    settings, ready, error, saved, auth, profile, loginBusy, loginError,
    tracks, likedTracks, likeBusy, tracksLoading, tracksError,
    playlists, playlistsLoading, playlistsError, activePlaylist, activePlaylistTracks,
    activePlaylistLoading, activePlaylistError, history, historyLoading, historyError,
    currentTrack, playerVisible, detailsTrack, detailsLoading, detailsError,
    currentTrackIndex, queueTracks, playbackLoading, shouldPlay, playbackError, page,
    logoutDialogOpen, logoutBusy, selections, selectionsLoading, selectionsError,
    relatedTracks, relatedLoading, relatedError,
    setError, setPage, setLogoutDialogOpen, setShouldPlay, setPlaybackLoading, setPlaybackError,
    loadMixedSelections, clearHistory, refreshLibrary, selectTrack, openTrackDetails,
    openPlaylist, playPlaylist, toggleTrackLike, saveAccessToken, clearAppData,
    updateSettings, playDetailsTrack, togglePlayback, savePlayerVolume, loadTrackAt,
    handlePlaybackStateChange, focusGlobalSearch, confirmLogout, login, silentLogin,
  };
}
