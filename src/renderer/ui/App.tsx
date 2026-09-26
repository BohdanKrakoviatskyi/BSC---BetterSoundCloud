import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { ArtistProfile, Playlist, Track, TrackDetails, TrackCollection, TrackLyrics } from '../domain/models';
import { appGateway } from '../lib/appGateway';
import type { SoundCloudCredentials } from '../lib/useSoundCloudAuth';
import { AuthScreen } from './components/AuthScreen';
import { HomePage } from './components/HomePage';
import { LikedTracksSection } from './components/LikedTracksSection';
import { LyricsSidebar } from './components/LyricsSidebar';
import { PlayerBar, type PlayerSeekRequest } from './components/PlayerBar';
import { SettingsPanel } from './components/SettingsPanel';
import { TrackSearch } from './components/TrackSearch';
import { TrackDetailsPage } from './components/TrackDetailsPage';
import { ArtistProfilePage } from './components/ArtistProfilePage';
import { Sidebar } from './components/Sidebar';
import { MyLibraryPage } from './components/MyLibraryPage';
import { PlaylistPage } from './components/PlaylistPage';
import { ConfirmDialog } from './components/ConfirmDialog';
import type { LyricsPanelPhase, Page, Profile, Settings } from './types';
import { measureElementRect, type ElementRect } from './lib/artworkFlight';
import { ErrorMessage } from './components/ErrorMessage';
import { MyProfilePage } from './components/MyProfilePage';
import { UpdaterNotification } from './components/UpdaterNotification';

const defaultSettings: Settings = { accent: '#ff765d', compact: false, volume: 70, clientId: '', backgroundImage: '', backgroundBlur: 0 };
const sidebarWidthsKey = 'better-soundcloud.sidebar-widths';

function savedSidebarWidths(): { left: number; lyrics: number } {
  try {
    const parsed = JSON.parse(localStorage.getItem(sidebarWidthsKey) || '{}') as { left?: number; lyrics?: number };
    return {
      left: typeof parsed.left === 'number' && Number.isFinite(parsed.left) ? Math.max(220, Math.min(380, parsed.left)) : 320,
      lyrics: typeof parsed.lyrics === 'number' && Number.isFinite(parsed.lyrics) ? Math.max(260, Math.min(380, parsed.lyrics)) : 380,
    };
  } catch {
    return { left: 320, lyrics: 380 };
  }
}

function reasonText(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

type CaptchaChallengeStatus = { completed: boolean; closed: boolean; datadomeCookie?: string | null; userAgent?: string | null; unavailable?: string | null };

async function waitForCaptchaChallenge(): Promise<CaptchaChallengeStatus | null> {
  const deadline = Date.now() + 3 * 60_000;
  while (Date.now() < deadline) {
    const status = await invoke<CaptchaChallengeStatus>('poll_captcha_challenge');
    if (status.completed) return status;
    if (status.unavailable) {
      // DataDome refused to serve a solvable challenge, so there is nothing to
      // retry: report it instead of looking like a finished but failed check.
      console.warn('[ui.captcha] challenge unavailable', { reason: status.unavailable });
      return { completed: false, closed: true, unavailable: status.unavailable };
    }
    if (status.closed) {
      console.warn('[ui.captcha] window closed before the challenge was solved');
      return null;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
  }
  console.warn('[ui.captcha] timed out waiting for the challenge to be solved');
  return null;
}

function captchaFailureText(challenge: CaptchaChallengeStatus | null): string {
  if (challenge?.unavailable === 'blocked') {
    return 'SoundCloud временно заблокировал адрес: проверка недоступна и не решается. Смените сеть (VPN или мобильный интернет) и повторите позже.';
  }
  if (challenge === null) {
    return 'Проверка SoundCloud не завершена: окно закрылось или истекло время. Откройте консоль приложения и пришлите строки [bsc-captcha].';
  }
  return 'Проверка SoundCloud не завершена. Пройдите её в открытом окне и попробуйте снова.';
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
  const [playlistReturnPage, setPlaylistReturnPage] = useState<Page>('library');
  const [activePlaylistTracks, setActivePlaylistTracks] = useState<Track[]>([]);
  const [activePlaylistLoading, setActivePlaylistLoading] = useState(false);
  const [activePlaylistError, setActivePlaylistError] = useState('');
  const [history, setHistory] = useState<Track[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [playerVisible, setPlayerVisible] = useState(false);
  const [playbackPositionMs, setPlaybackPositionMs] = useState(0);
  const [repeatOne, setRepeatOne] = useState(false);
  const [shuffleLiked, setShuffleLiked] = useState(false);
  const [seekRequest, setSeekRequest] = useState<PlayerSeekRequest | null>(null);
  const seekRequestIdRef = useRef(0);
  const currentTrackRef = useRef<Track | null>(null);
  currentTrackRef.current = currentTrack;
  useEffect(() => setPlaybackPositionMs(0), [currentTrack?.id]);
  const historyWriteRef = useRef<Promise<void>>(Promise.resolve());
  const historyMutationRef = useRef(0);
  const [detailsTrack, setDetailsTrack] = useState<TrackDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState('');
  const [currentTrackIndex, setCurrentTrackIndex] = useState(-1);
  const [queueTracks, setQueueTracks] = useState<Track[]>([]);
  const [playbackLoading, setPlaybackLoading] = useState(false);
  const [shouldPlay, setShouldPlay] = useState(false);
  const [playbackError, setPlaybackError] = useState('');
  const [page, setPage] = useState<Page>('home');
  const [initialSidebarWidths] = useState(savedSidebarWidths);
  const [sidebarWidth, setSidebarWidth] = useState(initialSidebarWidths.left);
  const [lyricsPanelWidth, setLyricsPanelWidth] = useState(initialSidebarWidths.lyrics);
  useEffect(() => {
    try {
      localStorage.setItem(sidebarWidthsKey, JSON.stringify({ left: sidebarWidth, lyrics: lyricsPanelWidth }));
    } catch {
      // Resizing remains available if browser storage is disabled or full.
    }
  }, [sidebarWidth, lyricsPanelWidth]);
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [selections, setSelections] = useState<TrackCollection[]>([]);
  const [selectionsLoading, setSelectionsLoading] = useState(false);
  const [selectionsError, setSelectionsError] = useState('');
  const [relatedTracks, setRelatedTracks] = useState<Track[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [relatedError, setRelatedError] = useState('');
  const [detailsContext, setDetailsContext] = useState<Track[]>([]);
  const detailsRequestId = useRef(0);
  const [artistProfile, setArtistProfile] = useState<ArtistProfile | null>(null);
  const [artistProfileLoading, setArtistProfileLoading] = useState(false);
  const [artistProfileError, setArtistProfileError] = useState('');
  const [artistTracks, setArtistTracks] = useState<Track[]>([]);
  const [artistTracksLoading, setArtistTracksLoading] = useState(false);
  const [artistTracksError, setArtistTracksError] = useState('');
  const artistRequestId = useRef(0);
  const [myProfileDetails, setMyProfileDetails] = useState<ArtistProfile | null>(null);
  const [myProfileTracks, setMyProfileTracks] = useState<Track[]>([]);
  const [myProfilePlaylists, setMyProfilePlaylists] = useState<Playlist[]>([]);
  const [myProfileLoading, setMyProfileLoading] = useState(false);
  const [myProfileError, setMyProfileError] = useState('');
  const myProfileRequestId = useRef(0);
  // Lyrics sidebar. The phase drives the artwork flight, so the panel stays mounted in both
  // directions until the track artwork has reached its destination.
  const [lyricsPhase, setLyricsPhase] = useState<LyricsPanelPhase>('closed');
  const [lyrics, setLyrics] = useState<TrackLyrics | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [lyricsError, setLyricsError] = useState('');
  const [lyricsOrigin, setLyricsOrigin] = useState<ElementRect | null>(null);
  const lyricsRequestId = useRef(0);

  function recordPlayedTrack(track: Track) {
    historyMutationRef.current += 1;
    setHistory((current) => [track, ...current.filter((item) => item.id !== track.id)].slice(0, 20));
    setHistoryError('');
    historyWriteRef.current = historyWriteRef.current.then(async () => {
      try {
        await appGateway.historyRecord(track);
        console.info('[ui.history] track recorded', { trackId: track.id });
      } catch (reason) {
        const message = reasonText(reason, 'Не удалось сохранить историю');
        setHistoryError(message);
        console.error('[ui.history] record failed', { trackId: track.id, error: message });
      }
    });
  }

  function handlePlaybackStateChange(playing: boolean) {
    setShouldPlay(playing);
    if (playing) {
      const track = currentTrackRef.current;
      if (track) recordPlayedTrack(track);
    }
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
    const mutation = historyMutationRef.current;
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const loaded = await appGateway.historyList();
      if (mutation !== historyMutationRef.current) return;
      setHistory(loaded.slice(0, 20));
      console.info('[ui.history] loaded', { count: loaded.length });
    } catch (reason) {
      if (mutation !== historyMutationRef.current) return;
      const message = reasonText(reason, 'Не удалось загрузить историю прослушиваний');
      setHistoryError(message);
      console.error('[ui.history] load failed', { error: message });
    } finally {
      setHistoryLoading(false);
    }
  }

  async function clearHistory() {
    historyMutationRef.current += 1;
    setHistory([]);
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

  function applyTrackLikeState(track: Track, liked: boolean) {
    setLikedTracks((current) => ({ ...current, [track.id]: liked }));
    setTracks((current) => {
      if (!liked) return current.filter((item) => item.id !== track.id);
      if (current.some((item) => item.id === track.id)) return current;
      return [track, ...current];
    });
  }

  async function toggleTrackLike(track: Track) {
    const wasLiked = Boolean(likedTracks[track.id] || tracks.some((item) => item.id === track.id));
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
            setTracksError(captchaFailureText(challenge));
            return;
          }
          const datadomeCookie = challenge.datadomeCookie ?? undefined;
          // The sidecar has to replay the same browser identity that solved the
          // challenge, otherwise DataDome rejects the retried request.
          const challengeUserAgent = challenge.userAgent ?? undefined;
          console.info('[ui.captcha] challenge solved', {
            trackId: track.id,
            hasCookie: Boolean(datadomeCookie),
            hasUserAgent: Boolean(challengeUserAgent),
          });
          const retry = wasLiked
            ? await appGateway.unlikeTrack(track.id, track.urn, datadomeCookie, challengeUserAgent)
            : await appGateway.likeTrack(track.id, track.urn, datadomeCookie, challengeUserAgent);
          if (!retry.captchaUrl) {
            applyTrackLikeState(track, retry.liked);
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
      applyTrackLikeState(track, result.liked);
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

  function playRandomLikedTrack() {
    const liked = tracks.filter((item) => likedTracks[item.id] !== false);
    if (!liked.length) return;
    const candidates = liked.filter((item) => item.id !== currentTrack?.id);
    const pool = candidates.length ? candidates : liked;
    const selected = pool[Math.floor(Math.random() * pool.length)];
    loadTrackAt(liked.findIndex((item) => item.id === selected.id), liked);
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
    if (page !== 'playlist') setPlaylistReturnPage(page);
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

  async function openTrackDetails(track: Track, context: Track[] = []) {
    const requestId = ++detailsRequestId.current;
    setPage('track');
    setDetailsContext(context.length ? context : [track]);
    // Show the new track instantly using the lightweight data we already have (title, art, stats),
    // instead of blanking the page while the full details load in the background. This lets the
    // coverflow / carousel navigation feel immediate, with the hero animation carrying the transition.
    setDetailsTrack((prev) => {
      const keepExtras = prev?.id === track.id;
      return {
        ...track,
        description: keepExtras ? prev?.description : undefined,
        genre: keepExtras ? prev?.genre : undefined,
        tags: keepExtras ? prev?.tags : undefined,
        createdAt: keepExtras ? prev?.createdAt : undefined,
        displayDate: keepExtras ? prev?.displayDate : undefined,
        repostCount: keepExtras ? prev?.repostCount : undefined,
        commentCount: keepExtras ? prev?.commentCount : undefined,
        waveform: keepExtras ? prev?.waveform : undefined,
        artist: {
          ...track.artist,
          avatar: keepExtras ? prev?.artist.avatar : undefined,
          permalink: keepExtras ? prev?.artist.permalink : undefined,
          followerCount: keepExtras ? prev?.artist.followerCount : undefined,
        },
      };
    });
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

  function playContextTrack(track: Track) {
    const queue = detailsContext.length ? detailsContext : [track];
    const index = queue.findIndex((item) => item.id === track.id);
    if (index >= 0) {
      loadTrackAt(index, queue);
    } else {
      setCurrentTrack(track);
      setPlayerVisible(true);
      setCurrentTrackIndex(-1);
      setQueueTracks([track]);
      setPlaybackLoading(true);
      setPlaybackError('');
      setShouldPlay(true);
    }
    void openTrackDetails(track, detailsContext);
  }

  async function runArtistProfileRequest(requestId: number, artistId: number) {
    console.info('[ui.artist.profile] loading', { artistId });
    const [profileResult, tracksResult] = await Promise.allSettled([
      appGateway.artistProfile(artistId),
      appGateway.artistTracks(artistId),
    ]);
    if (requestId !== artistRequestId.current) {
      console.debug('[ui.artist.profile] ignored stale response', { artistId, requestId });
      return;
    }
    if (profileResult.status === 'fulfilled') {
      setArtistProfile(profileResult.value);
      console.info('[ui.artist.profile] loaded', { artistId, username: profileResult.value.username });
    } else {
      const message = reasonText(profileResult.reason, 'Не удалось загрузить профиль автора');
      console.error('[ui.artist.profile] failed', { artistId, error: message });
      setArtistProfileError(message);
    }
    if (tracksResult.status === 'fulfilled') {
      setArtistTracks(tracksResult.value);
      console.info('[ui.artist.tracks] loaded', { artistId, count: tracksResult.value.length });
    } else {
      const message = reasonText(tracksResult.reason, 'Не удалось загрузить треки автора');
      console.error('[ui.artist.tracks] failed', { artistId, error: message });
      setArtistTracksError(message);
    }
    setArtistProfileLoading(false);
    setArtistTracksLoading(false);
  }

  async function openArtistProfile(artistId: number) {
    if (!artistId) return;
    const requestId = ++artistRequestId.current;
    setPage('artist');
    setArtistProfileLoading(true);
    setArtistProfileError('');
    setArtistTracks([]);
    setArtistTracksLoading(true);
    setArtistTracksError('');
    setArtistProfile((prev) => (prev?.id === artistId ? prev : null));
    await runArtistProfileRequest(requestId, artistId);
  }

  async function openArtistFromTrack(track: Track) {
    const requestId = ++artistRequestId.current;
    setPage('artist');
    setArtistProfile(null);
    setArtistProfileLoading(true);
    setArtistProfileError('');
    setArtistTracks([]);
    setArtistTracksLoading(true);
    setArtistTracksError('');
    try {
      const details = await appGateway.trackDetails(track.id);
      if (requestId !== artistRequestId.current) return;
      const artistId = details.artist.id;
      if (!artistId) {
        setArtistProfileError('SoundCloud не вернул ID автора для этого трека');
        setArtistProfileLoading(false);
        setArtistTracksLoading(false);
        return;
      }
      await runArtistProfileRequest(requestId, artistId);
    } catch (reason) {
      if (requestId !== artistRequestId.current) return;
      const message = reasonText(reason, 'Не удалось определить автора трека');
      console.error('[ui.artist.profile] track lookup failed', { trackId: track.id, error: message });
      setArtistProfileError(message);
      setArtistProfileLoading(false);
      setArtistTracksLoading(false);
    }
  }

  async function openMyProfile() {
    setPage('profile');
    if (!profile) return;
    const requestId = ++myProfileRequestId.current;
    setMyProfileLoading(true);
    setMyProfileError('');
    const [detailsResult, tracksResult, playlistsResult] = await Promise.allSettled([
      appGateway.artistProfile(profile.id),
      appGateway.artistTracks(profile.id),
      appGateway.artistPlaylists(profile.id),
    ]);
    if (requestId !== myProfileRequestId.current) return;
    const errors: string[] = [];
    if (detailsResult.status === 'fulfilled') setMyProfileDetails(detailsResult.value);
    else errors.push(reasonText(detailsResult.reason, 'Не удалось загрузить данные профиля'));
    if (tracksResult.status === 'fulfilled') setMyProfileTracks(tracksResult.value);
    else errors.push(reasonText(tracksResult.reason, 'Не удалось загрузить опубликованные треки'));
    if (playlistsResult.status === 'fulfilled') setMyProfilePlaylists(playlistsResult.value);
    else errors.push(reasonText(playlistsResult.reason, 'Не удалось загрузить плейлисты профиля'));
    setMyProfileError(errors.join(' · '));
    setMyProfileLoading(false);
  }

  function playDetailsTrack() {
    const track = detailsTrack ?? currentTrack;
    if (!track) return;
    if (currentTrack?.id === track.id) {
      setShouldPlay((playing) => !playing);
      setPlaybackError('');
      return;
    }
    const contextIndex = detailsContext.findIndex((item) => item.id === track.id);
    const libraryIndex = tracks.findIndex((item) => item.id === track.id);
    const queue = contextIndex >= 0 && detailsContext.length > 1
      ? detailsContext
      : libraryIndex >= 0
        ? tracks
        : contextIndex >= 0
          ? detailsContext
          : [track];
    const index = queue.findIndex((item) => item.id === track.id);
    setCurrentTrack(track);
    setPlayerVisible(true);
    setCurrentTrackIndex(index);
    setQueueTracks(queue);
    setPlaybackLoading(true);
    setPlaybackError('');
    setShouldPlay(true);
    console.info('[ui.player] loading official SoundCloud widget from details', { trackId: track.id, permalinkUrl: track.permalink });
  }

  // The lyrics sidebar is opened only by the track page button, which passes the current rectangle
  // of the track artwork so the panel can start its flight exactly where the artwork is standing.
  function toggleLyrics(artworkRect: ElementRect | null) {
    if (lyricsPhase !== 'closed') {
      requestCloseLyrics();
      return;
    }
    setLyricsOrigin(artworkRect);
    setLyricsPhase('opening');
    console.info('[ui.lyrics] opening', { trackId: detailsTrack?.id, hasOrigin: Boolean(artworkRect) });
  }

  function requestCloseLyrics() {
    if (lyricsPhase === 'closed' || lyricsPhase === 'measuring' || lyricsPhase === 'closing') return;
    // `measuring` restores the track page layout for a single frame so the artwork's home rectangle
    // can be read without the panel visibly moving.
    setLyricsPhase('measuring');
    console.info('[ui.lyrics] closing', { trackId: detailsTrack?.id });
  }

  useLayoutEffect(() => {
    if (lyricsPhase !== 'measuring') return;
    setLyricsOrigin(measureElementRect(document.querySelector('[data-track-artwork]')));
    setLyricsPhase('closing');
  }, [lyricsPhase]);

  function handleLyricsSettled() {
    if (lyricsPhase === 'opening') {
      setLyricsPhase('open');
    } else if (lyricsPhase === 'closing') {
      setLyricsPhase('closed');
      setLyricsOrigin(null);
    }
  }

  // Leaving the track page has no artwork to fly back to, so the panel is dropped without a flight.
  useEffect(() => {
    if (page === 'track' || lyricsPhase === 'closed') return;
    setLyricsPhase('closed');
    setLyricsOrigin(null);
  }, [page, lyricsPhase]);


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

  // Load lyrics on the track page first so its lyrics button only appears when text is available.
  const lyricsPanelActive = lyricsPhase !== 'closed';
  useEffect(() => {
    if (!detailsTrack) {
      lyricsRequestId.current += 1;
      setLyrics(null);
      setLyricsLoading(false);
      setLyricsError('');
      return;
    }
    const trackId = detailsTrack.id;
    const requestId = ++lyricsRequestId.current;
    setLyrics(null);
    setLyricsLoading(true);
    setLyricsError('');
    console.info('[ui.lyrics] loading', { trackId });
    void appGateway.trackLyrics(detailsTrack)
      .then((loaded) => {
        if (requestId !== lyricsRequestId.current) return;
        setLyrics(loaded);
        console.info('[ui.lyrics] loaded', { trackId, lines: loaded.lines.length });
      })
      .catch((reason: unknown) => {
        if (requestId !== lyricsRequestId.current) return;
        setLyricsError(reasonText(reason, 'Не удалось загрузить текст песни'));
        console.error('[ui.lyrics] failed', { trackId, error: reasonText(reason, 'unknown error') });
      })
      .finally(() => {
        if (requestId === lyricsRequestId.current) setLyricsLoading(false);
      });
    // Keyed by id on purpose: re-running for the same track would only duplicate the request.
  }, [detailsTrack?.id]);

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
    setDetailsContext([]);
    setArtistProfile(null);
    setArtistTracks([]);
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
      setDetailsContext([]);
      setArtistProfile(null);
      setArtistTracks([]);
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
            ? <><ErrorMessage message={error} className="auth-error" /><button type="button" className="auth-button" onClick={() => window.location.reload()}>Попробовать снова</button></>
            : <p className="auth-note">Запускаем Go sidecar…</p>}
        </div>
      </div>
    );
  }

  if (auth === 'guest') return <AuthScreen error={loginError} busy={loginBusy} clientId={settings.clientId} onLogin={(token, clientId) => void login(token, clientId)} onSilentLogin={silentLogin} />;

  const isViewingPlayingTrack = page === 'track' && currentTrack !== null && detailsTrack !== null && currentTrack.id === detailsTrack.id;
  const lyricsPanelState = lyricsPhase === 'closed' ? '' : `lyrics-panel-${lyricsPhase}`;

  return (
    <div
      className={`app-shell ${playerVisible && !isViewingPlayingTrack ? 'player-visible' : ''} ${settings.backgroundImage ? 'has-custom-background' : ''} ${lyricsPanelState}`}
      style={{
        '--custom-background-image': settings.backgroundImage ? `url("${settings.backgroundImage}")` : 'none',
        '--custom-background-blur': `${settings.backgroundBlur}px`,
        '--content-panel-opacity': String(0.4 + Math.min(settings.backgroundBlur, 6) * (0.2 / 6)),
        '--sidebar-width': `${sidebarWidth}px`,
        '--lyrics-panel-width': `${lyricsPanelWidth}px`,
      } as CSSProperties}
    >
      <header className="topbar">
        <div className="window-tools"><button className="icon-button" type="button" onClick={() => setPage('likes')} aria-label="Назад">‹</button></div>
        <div className="global-search"><TrackSearch onSelect={selectTrack} /></div>
        <div className="top-actions">

          <button className={`header-account${page === 'profile' ? ' is-current' : ''}`} type="button" onClick={() => void openMyProfile()} title="Открыть профиль" aria-label="Мой профиль">
            {profile?.avatarUrl
              ? <img className="header-avatar" src={profile.avatarUrl} alt="" />
              : <span className="header-avatar header-avatar-fallback" aria-hidden="true">{(profile?.username || 'SC').slice(0, 2).toUpperCase()}</span>}
            <span className="header-account-copy"><b>@{profile?.username || 'аккаунт'}</b></span>
          </button>
          <UpdaterNotification />
          <button className="icon-button header-settings" type="button" onClick={() => setPage('settings')} aria-label="Настройки" title="Настройки">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33h-.08a1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51h-.08a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82v-.08a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1v-.08a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.08a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.08a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.08a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
          </button>
          <button className="icon-button header-logout" type="button" onClick={() => { setError(''); setLogoutDialogOpen(true); }} title="Выйти из SoundCloud" aria-label="Выйти из SoundCloud">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4.75H6.5A1.75 1.75 0 0 0 4.75 6.5v11A1.75 1.75 0 0 0 6.5 19.25H10" /><path d="M13.5 8.25 17.25 12l-3.75 3.75M17 12H9" /></svg>
          </button>
        </div>
      </header>
      <div className="workspace">
        <Sidebar profile={profile} page={page} tracks={tracks} onNavigate={setPage} onPlayTrack={selectTrack} onOpenArtist={(track) => void openArtistFromTrack(track)} onResize={(delta) => setSidebarWidth((width) => Math.max(220, Math.min(380, width + delta)))} />
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
              onOpenTrack={(track, context) => void openTrackDetails(track, context)}
              onOpenPlaylist={(playlist) => void openPlaylist(playlist)}
              onClearHistory={() => void clearHistory()}
              onRetry={() => void loadMixedSelections()}
              onOpenArtist={(track) => void openArtistFromTrack(track)}
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
                onOpenTrack={(track, context) => void openTrackDetails(track, context)}
                onOpenPlaylist={(playlist) => void openPlaylist(playlist)}
                onOpenArtist={(track) => void openArtistFromTrack(track)}
              />
          : page === 'playlist' && activePlaylist
            ? <PlaylistPage playlist={activePlaylist} tracks={activePlaylistTracks} loading={activePlaylistLoading} error={activePlaylistError} onBack={() => setPage(playlistReturnPage)} onPlay={playPlaylist} />
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
              onOpenTrack={(track, context) => void openTrackDetails(track, context)}
              currentTrackId={currentTrack?.id ?? null}
              isPlaying={shouldPlay}
              playbackLoading={playbackLoading}
            />
          : page === 'settings'
            ? <SettingsPanel settings={settings} saved={saved} error={error} profile={profile} tokenError={loginError} tokenBusy={loginBusy} onSaveToken={saveAccessToken} onClearData={clearAppData} onUpdate={(patch) => void updateSettings(patch)} />
          : page === 'profile' && profile
            ? <MyProfilePage
                account={profile}
                details={myProfileDetails}
                tracks={myProfileTracks}
                history={history}
                historyLoading={historyLoading}
                playlists={myProfilePlaylists}
                loading={myProfileLoading}
                error={myProfileError}
                currentTrackId={currentTrack?.id ?? null}
                isPlaying={shouldPlay}
                playbackLoading={playbackLoading}
                onPlayTrack={selectTrack}
                onOpenTrack={(track, context) => void openTrackDetails(track, context)}
                onOpenPlaylist={(playlist) => void openPlaylist(playlist)}
              />
          : page === 'artist'
            ? <ArtistProfilePage
                profile={artistProfile}
                loading={artistProfileLoading}
                error={artistProfileError}
                tracks={artistTracks}
                tracksLoading={artistTracksLoading}
                tracksError={artistTracksError}
                currentTrackId={currentTrack?.id ?? null}
                isPlaying={shouldPlay}
                playbackLoading={playbackLoading}
                onPlayTrack={selectTrack}
                onOpenTrack={(track, context) => void openTrackDetails(track, context)}
                onBack={() => setPage(detailsTrack ? 'track' : 'library')}
              />
          : <TrackDetailsPage
                track={detailsTrack}
                loading={detailsLoading}
                error={detailsError}
                isCurrent={currentTrack?.id === detailsTrack?.id}
                isPlaying={shouldPlay}
                playbackLoading={currentTrack?.id === detailsTrack?.id && playbackLoading}
                contextTracks={detailsContext}
                relatedTracks={relatedTracks}
                relatedLoading={relatedLoading}
                relatedError={relatedError}
                currentTrackId={currentTrack?.id ?? null}
                isPlayingNow={shouldPlay}
                onPlayRelated={selectTrack}
                onOpenRelated={(track, context) => void openTrackDetails(track, context)}
                onOpenContextTrack={playContextTrack}
                onOpenArtist={(artistId) => void openArtistProfile(artistId)}
                onBack={() => setPage('likes')}
                onPlay={playDetailsTrack}
                repeatOne={repeatOne}
                onToggleRepeat={() => setRepeatOne((enabled) => !enabled)}
                shuffleLiked={shuffleLiked}
                onToggleShuffle={() => setShuffleLiked((enabled) => !enabled)}
                liked={detailsTrack ? Boolean(likedTracks[detailsTrack.id] || tracks.some((item) => item.id === detailsTrack.id)) : false}
                likeBusy={detailsTrack ? (likeBusy[detailsTrack.id] ?? false) : false}
                onToggleLike={(track) => void toggleTrackLike(track)}
                onSeek={(positionMs) => {
                  if (!detailsTrack) return;
                  if (currentTrack?.id !== detailsTrack.id) playDetailsTrack();
                  setSeekRequest({ requestId: ++seekRequestIdRef.current, trackId: detailsTrack.id, positionMs });
                }}
                playbackPositionMs={currentTrack?.id === detailsTrack?.id ? playbackPositionMs : 0}
                volume={settings.volume}
                onVolumeChange={(volume) => void updateSettings({ volume })}
                lyricsOpen={lyricsPanelActive}
                lyricsAvailable={Boolean(detailsTrack && lyrics?.trackId === detailsTrack.id && lyrics.lines.length > 0)}
                onToggleLyrics={toggleLyrics}
              />}
        {tracksError && page !== 'likes' && <ErrorMessage message={tracksError} className="app-track-error" />}
        </div></main>
      </div>
      <LyricsSidebar
        phase={lyricsPhase}
        track={detailsTrack ?? { id: 0, urn: '', title: '', durationMs: 0, artist: { name: '' } }}
        lyrics={lyrics}
        loading={lyricsLoading}
        error={lyricsError}
        isCurrentTrack={currentTrack !== null && detailsTrack !== null && currentTrack.id === detailsTrack.id}
        isPlaying={shouldPlay}
        onTogglePlayback={togglePlayback}
        onSeek={(positionMs) => {
          if (!detailsTrack) return;
          if (currentTrack?.id !== detailsTrack.id) playDetailsTrack();
          setSeekRequest({ requestId: ++seekRequestIdRef.current, trackId: detailsTrack.id, positionMs });
        }}
        repeatOne={repeatOne}
        onToggleRepeat={() => setRepeatOne((enabled) => !enabled)}
        volume={settings.volume}
        onVolumeChange={(volume) => void updateSettings({ volume })}
        playbackPositionMs={currentTrack?.id === detailsTrack?.id ? playbackPositionMs : 0}
        originRect={lyricsOrigin}
        onClose={requestCloseLyrics}
        onSettled={handleLyricsSettled}
        onResize={(delta) => setLyricsPanelWidth((width) => Math.max(260, Math.min(380, width + delta)))}
      />
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
        {error && <ErrorMessage message={error} />}
      </ConfirmDialog>}
      <PlayerBar
        track={currentTrack}
        seekRequest={seekRequest}
        onSeekRequestHandled={(requestId) => setSeekRequest((current) => current?.requestId === requestId ? null : current)}
        repeatOne={repeatOne}
        onToggleRepeat={() => setRepeatOne((enabled) => !enabled)}
        shuffleLiked={shuffleLiked}
        onToggleShuffle={() => setShuffleLiked((enabled) => !enabled)}
        loading={playbackLoading}
        shouldPlay={shouldPlay}
        volume={settings.volume}
        onVolumeChange={(volume) => void updateSettings({ volume })}
        error={playbackError}
        liked={currentTrack ? Boolean(likedTracks[currentTrack.id] || tracks.some((item) => item.id === currentTrack.id)) : false}
        onLike={() => { if (currentTrack) void toggleTrackLike(currentTrack); }}
        onOpenTrack={() => { if (currentTrack) void openTrackDetails(currentTrack, queueTracks); }}
        onOpenArtist={() => { if (currentTrack) void openArtistFromTrack(currentTrack); }}
        onTogglePlayback={togglePlayback}
        onPrevious={() => void loadTrackAt(Math.max(currentTrackIndex - 1, 0))}
        onNext={() => void loadTrackAt(currentTrackIndex + 1)}
        hasNext={currentTrackIndex >= 0 && currentTrackIndex + 1 < queueTracks.length}
        onEnded={() => {
          if (shuffleLiked) playRandomLikedTrack();
          else if (currentTrackIndex + 1 < queueTracks.length) void loadTrackAt(currentTrackIndex + 1);
          else setShouldPlay(false);
        }}
        onReady={() => setPlaybackLoading(false)}
        onProgress={setPlaybackPositionMs}
        onError={(message) => { setPlaybackError(message); setPlaybackLoading(false); setShouldPlay(false); }}
        onPlaybackStateChange={handlePlaybackStateChange}
      />
    </div>
  );
}
