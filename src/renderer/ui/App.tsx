import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { ArtistProfile, Playlist, SocialUser, Track, TrackDetails, TrackCollection, TrackLyrics } from '../domain/models';
import { appGateway } from '../lib/appGateway';
import { serviceManager, serviceCapabilities } from '../lib/serviceManager';
import type { ServiceAccount, ServiceProvider } from '../domain/models';
import { getLastActiveService, setLastActiveService, loadCredentials } from '../lib/credentialStore';
import type { SoundCloudCredentials } from '../lib/useSoundCloudAuth';
import { HomePage } from './components/HomePage';
import { LikedTracksSection } from './components/LikedTracksSection';
import { LyricsSidebar } from './components/LyricsSidebar';
import { PlayerBar, type PlayerSeekRequest } from './components/PlayerBar';
import { SettingsPanel } from './components/SettingsPanel';
import { TrackSearch } from './components/TrackSearch';
import { TrackDetailsPage } from './components/TrackDetailsPage';
import { ArtistProfilePage } from './components/ArtistProfilePage';
import { FaArrowRightFromBracket, FaChevronLeft, FaGear } from './lib/icons';
import { ArtistTrackListPage } from './components/ArtistTrackListPage';
import { SocialUsersPage } from './components/SocialUsersPage';
import { Sidebar } from './components/Sidebar';
import { MyLibraryPage } from './components/MyLibraryPage';
import { PlaylistPage } from './components/PlaylistPage';
import { ConfirmDialog } from './components/ConfirmDialog';
import type { LyricsPanelPhase, Page, Profile, Settings } from './types';
import { measureElementRect, type ElementRect } from './lib/artworkFlight';
import { ErrorMessage } from './components/ErrorMessage';
import { MyProfilePage } from './components/MyProfilePage';
import { UpdaterNotification } from './components/UpdaterNotification';
import { QueuePanel } from './components/QueuePanel';
import { ConnectedAccounts } from './components/ConnectedAccounts';
import { ServiceSwitcher } from './components/ServiceSwitcher';
import { MultiAuthScreen } from './components/MultiAuthScreen';
import { describeError } from './lib/format';
import { useBackgroundUrl } from '../lib/useBackgroundUrl';

const defaultSettings: Settings = { accent: '#ff765d', volume: 70, clientId: '', backgroundImage: '', backgroundBlur: 0 };
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

export function App() {
  const [settings, setSettings] = useState(defaultSettings);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(true);
  const [auth, setAuth] = useState<'checking' | 'guest' | 'authorized'>('checking');
  // Which service the library below belongs to. Seeded from storage rather than from a constant, so a
  // launch goes back to where the user was rather than to SoundCloud every time.
  // Seeded from storage, and the manager is pointed at the same service straight away rather than
  // reconciled afterwards. Left to reconcile, one render would read capabilities from Spotify while the
  // library loaded from SoundCloud — the switcher showing an artist-less service over a SoundCloud
  // library, which looks like a bug in one of them.
  const [activeService, setActiveService] = useState<ServiceProvider>(() => {
    const restored = getLastActiveService();
    try {
      serviceManager.switchTo(restored);
      return restored;
    } catch {
      serviceManager.switchTo('soundcloud');
      return 'soundcloud';
    }
  });
  const [serviceAccounts, setServiceAccounts] = useState<Partial<Record<ServiceProvider, ServiceAccount>>>({});
  const [switchingService, setSwitchingService] = useState(false);
  // Read from the adapter rather than written out, so the two cannot disagree the first time a method is
  // added to one of them.
  const capabilities = serviceCapabilities(activeService);
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
  // The home page's "Недавние" row, narrowed to the tracks that are in the library.
  //
  // Everything that has been played used to land there, including tracks the user never liked and
  // ones they have since removed, which made the row a log rather than a shortcut. Matching against
  // `tracks` is the library as the active service reports it — the same list the heart button and
  // "Мои треки" are built from — so the two can never disagree about what is saved.
  //
  // Matching on `id`, not `nativeId`: history is written by the sidecar keyed by its own ids, and
  // both sides of the comparison are already in the same identity space.
  const libraryTrackIds = useMemo(() => new Set(tracks.map((track) => track.id)), [tracks]);
  const libraryHistory = useMemo(
    () => history.filter((track) => libraryTrackIds.has(track.id)),
    [history, libraryTrackIds],
  );
  const [detailsTrack, setDetailsTrack] = useState<TrackDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState('');
  const [currentTrackIndex, setCurrentTrackIndex] = useState(-1);
  const [queueTracks, setQueueTracks] = useState<Track[]>([]);
  const [manualQueue, setManualQueue] = useState<Track[]>([]);
  const [manualQueueEnabled, setManualQueueEnabled] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
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
  const [artistLikedTracks, setArtistLikedTracks] = useState<Track[]>([]);
  const [artistLikedTracksNext, setArtistLikedTracksNext] = useState('');
  const [artistLikedTracksLoading, setArtistLikedTracksLoading] = useState(false);
  const [artistLikedTracksError, setArtistLikedTracksError] = useState('');
  const artistLikesLoadingRef = useRef(false);
  const [artistPlaylists, setArtistPlaylists] = useState<Playlist[]>([]);
  const [artistPlaylistsLoading, setArtistPlaylistsLoading] = useState(false);
  const [artistPlaylistsError, setArtistPlaylistsError] = useState('');
  const [artistSocialTab, setArtistSocialTab] = useState<'followers' | 'followings'>('followers');
  const [artistFollowers, setArtistFollowers] = useState<SocialUser[]>([]);
  const [artistFollowings, setArtistFollowings] = useState<SocialUser[]>([]);
  const [artistFollowersNext, setArtistFollowersNext] = useState('');
  const [artistFollowingsNext, setArtistFollowingsNext] = useState('');
  const [artistSocialLoading, setArtistSocialLoading] = useState(false);
  const [artistSocialError, setArtistSocialError] = useState('');
  const artistRequestId = useRef(0);
  const artistSocialRequestId = useRef(0);
  const artistReturnPage = useRef<Page>('library');
  const artistSocialReturnSnapshot = useRef<{
    followers: SocialUser[];
    followings: SocialUser[];
    followersNext: string;
    followingsNext: string;
  } | null>(null);
  const [myProfileDetails, setMyProfileDetails] = useState<ArtistProfile | null>(null);
  const [myProfileTracks, setMyProfileTracks] = useState<Track[]>([]);
  const [myProfilePlaylists, setMyProfilePlaylists] = useState<Playlist[]>([]);
  const [myProfileLoading, setMyProfileLoading] = useState(false);
  const [myProfileError, setMyProfileError] = useState('');
  const [myProfileSocialTab, setMyProfileSocialTab] = useState<'followers' | 'followings' | null>(null);
  const [myProfileFollowers, setMyProfileFollowers] = useState<SocialUser[]>([]);
  const [myProfileFollowings, setMyProfileFollowings] = useState<SocialUser[]>([]);
  const [myProfileFollowersNext, setMyProfileFollowersNext] = useState('');
  const [myProfileFollowingsNext, setMyProfileFollowingsNext] = useState('');
  const [myProfileSocialLoading, setMyProfileSocialLoading] = useState(false);
  const [myProfileSocialError, setMyProfileSocialError] = useState('');
  const myProfileSocialRequestId = useRef(0);
  const [socialPageOwner, setSocialPageOwner] = useState<'my' | 'artist'>('my');
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
      // The sidecar's history is keyed by SoundCloud ids, so a Spotify track written there would sit in
      // the list and be unplayable. Only the service that owns the store records to it.
      if (activeService !== 'soundcloud') return;
      try {
        await appGateway.historyRecord(track);
        console.info('[ui.history] track recorded', { trackId: track.id });
      } catch (reason) {
        const message = describeError(reason, 'Не удалось сохранить историю');
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
      const loaded = await serviceManager.active.mixedSelections();
      setSelections(loaded);
      console.info('[ui.mixed-selections] loaded', { count: loaded.length, tracks: loaded.reduce((count, selection) => count + selection.tracks.length, 0) });
    } catch (reason) {
      const message = describeError(reason, 'Не удалось загрузить подборки');
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
      const loaded = await serviceManager.active.myTracks();
      setTracks(loaded);
      setLikedTracks(Object.fromEntries(loaded.map((track) => [track.id, true])));
      console.info('[ui.tracks] loaded', { count: loaded.length });
    } catch (reason) {
      const message = describeError(reason, 'Не удалось загрузить треки');
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
      const message = describeError(reason, 'Не удалось загрузить историю прослушиваний');
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
      const message = describeError(reason, 'Не удалось очистить историю прослушиваний');
      setHistoryError(message);
      console.error('[ui.history] clear failed', { error: message });
    }
  }

  async function loadPlaylists() {
    setPlaylistsLoading(true);
    setPlaylistsError('');
    try {
      const loaded = await serviceManager.active.myPlaylists();
      setPlaylists(loaded);
      console.info('[ui.playlists] loaded', { count: loaded.length, service: activeService });
    } catch (reason) {
      const message = describeError(reason, 'Не удалось загрузить плейлисты');
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

  /**
   * The like path for a service that is not SoundCloud.
   *
   * SoundCloud's is not used here: it carries a captcha challenge, a retry loop and a DataDome cookie, and
   * the adapter's signature has nowhere to put any of that. It stays where it is.
   */
  async function toggleTrackLikeOutsideSoundCloud(track: Track, wasLiked: boolean): Promise<boolean> {
    const adapter = serviceManager.active;
    if (!adapter.likeTrack || !adapter.unlikeTrack) {
      setTracksError(`Лайки не поддерживаются сервисом ${activeService}`);
      return false;
    }
    const operation = wasLiked ? 'unlike' : 'like';
    setLikeBusy((current) => ({ ...current, [track.id]: true }));
    setTracksError('');
    try {
      const result = wasLiked
        ? await adapter.unlikeTrack(track)
        : await adapter.likeTrack(track);
      applyTrackLikeState(track, result.liked);
      console.info(`[ui.track.${operation}] completed`, { service: activeService, trackId: track.id, liked: result.liked });
      return true;
    } catch (reason) {
      const message = describeError(reason, 'Не удалось изменить лайк');
      console.error(`[ui.track.${operation}] failed`, { service: activeService, trackId: track.id, error: message });
      setTracksError(message);
      return false;
    } finally {
      setLikeBusy((current) => ({ ...current, [track.id]: false }));
    }
  }

  async function toggleTrackLike(track: Track) {
    const wasLiked = (likedTracks[track.id] !== undefined ? likedTracks[track.id] : tracks.some((item) => item.id === track.id));
    if (activeService !== 'soundcloud') {
      await toggleTrackLikeOutsideSoundCloud(track, wasLiked);
      return;
    }
    const operation = wasLiked ? 'unlike' : 'like';
    setLikedTracks((current) => ({ ...current, [track.id]: !wasLiked }));
    setLikeBusy((current) => ({ ...current, [track.id]: true }));
    setTracksError('');
    console.info(`[ui.track.${operation}] started`, { trackId: track.id });
    try {
      const result = wasLiked
        ? await appGateway.unlikeTrack(track.id, track.urn, profile?.id, settings.clientId)
        : await appGateway.likeTrack(track.id, track.urn, profile?.id, settings.clientId);
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
            ? await appGateway.unlikeTrack(track.id, track.urn, profile?.id, settings.clientId, datadomeCookie)
            : await appGateway.likeTrack(track.id, track.urn, profile?.id, settings.clientId, datadomeCookie);
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
      const message = describeError(reason, 'Не удалось изменить лайк');
      console.error(`[ui.track.${operation}] failed`, { trackId: track.id, error: message });
      setLikedTracks((current) => ({ ...current, [track.id]: wasLiked }));
      setTracksError(message);
    } finally {
      setLikeBusy((current) => ({ ...current, [track.id]: false }));
    }
  }

  function loadTrackAt(index: number, queue: Track[] = queueTracks, fromManualQueue = false) {
    const track = queue[index];
    if (!track) {
      setShouldPlay(false);
      return;
    }
    if (!fromManualQueue) setManualQueueEnabled(false);
    setCurrentTrack(track);
    setPlayerVisible(true);
    setCurrentTrackIndex(index);
    setQueueTracks(queue);
    setPlaybackLoading(true);
    setPlaybackError('');
    setShouldPlay(true);
    console.info('[ui.player] loading track', { trackId: track.id, permalinkUrl: track.permalink });
  }

  function playRandomLikedTrack() {
    const liked = tracks.filter((item) => likedTracks[item.id] !== false);
    if (!liked.length) return null;
    const candidates = liked.filter((item) => item.id !== currentTrack?.id);
    const pool = candidates.length ? candidates : liked;
    const selected = pool[Math.floor(Math.random() * pool.length)];
    loadTrackAt(liked.findIndex((item) => item.id === selected.id), liked);
    return selected;
  }

  function addCurrentTrackToQueue() {
    if (!currentTrack) return;
    setManualQueue((queue) => [...queue, currentTrack]);
  }

  function playQueuedTrack(index: number) {
    const track = manualQueue[index];
    if (!track) return;
    setManualQueueEnabled(true);
    if (index > 0) setManualQueue((queue) => [track, ...queue.filter((_, queueIndex) => queueIndex !== index)]);
    loadTrackAt(0, [track], true);
  }

  function toggleManualQueuePlayback() {
    if (manualQueueEnabled) {
      setShouldPlay((playing) => !playing);
      return;
    }
    if (!manualQueue.length) return;
    setManualQueueEnabled(true);
    loadTrackAt(0, [manualQueue[0]], true);
  }

  function advanceManualQueue() {
    if (manualQueue.length > 1) {
      const nextTrack = manualQueue[1];
      setManualQueue((queue) => queue.slice(1));
      loadTrackAt(0, [nextTrack], true);
    } else {
      setManualQueue([]);
      setManualQueueEnabled(false);
      setShouldPlay(false);
    }
  }

  function playNextTrack() {
    if (manualQueueEnabled) {
      advanceManualQueue();
      return;
    }
    if (currentTrackIndex + 1 < queueTracks.length) void loadTrackAt(currentTrackIndex + 1);
  }

  function navigateLyricsTrack(direction: -1 | 1) {
    if (direction === 1 && manualQueueEnabled) {
      const nextTrack = manualQueue[1];
      if (!nextTrack) return;
      advanceManualQueue();
      void openTrackDetails(nextTrack, manualQueue);
      return;
    }
    const nextIndex = currentTrackIndex + direction;
    const nextTrack = queueTracks[nextIndex];
    if (!nextTrack) return;
    void loadTrackAt(nextIndex);
    void openTrackDetails(nextTrack, queueTracks);
  }

  function handleTrackEnded() {
    if (shuffleLiked) {
      const nextTrack = playRandomLikedTrack();
      if (nextTrack && lyricsPanelActive) void openTrackDetails(nextTrack, tracks);
      else if (!nextTrack) setShouldPlay(false);
      return;
    }
    // Репит-один разбирается раньше, в самом PlayerBar: он перезапускает трек сам и сюда не
    // доходит. Дальше — обычный переход по очереди, ровно как по кнопке «вперёд».
    if (manualQueueEnabled) {
      advanceManualQueue();
      return;
    }
    // currentTrackIndex >= 0 обязателен: у трека, открытого отдельно, индекс -1 и в очереди лежит
    // только он сам. Без проверки 0 < 1 проходит, и следующим играет тот же трек — бесконечное
    // повторение вместо остановки.
    if (currentTrackIndex >= 0 && currentTrackIndex + 1 < queueTracks.length) {
      void loadTrackAt(currentTrackIndex + 1);
      return;
    }
    // Очередь кончилась — останавливаемся.
    setShouldPlay(false);
    if (lyricsPanelActive) setPlaybackPositionMs(0);
  }

  /**
   * Points the app at another service and loads what belongs to it.
   *
   * The previous service's data is cleared before the new one loads rather than after. Leaving it up
   * means the library shows SoundCloud tracks for as long as a request takes, and the player can start on
   * a track the new service has nothing to do with.
   */
  async function switchService(next: ServiceProvider) {
    if (switchingService) return;
    // Not the same as "already active". activeService is seeded from storage, so a user whose last
    // service was Spotify and who is not signed into it is sitting on the guest screen with Spotify
    // already selected — and the switch their successful sign-in triggers must still run, or the library
    // never loads and the screen never goes away.
    if (next === activeService && serviceAccounts[next]?.isLoggedIn) return;
    setSwitchingService(true);
    setError('');
    try {
      // Throws for a service with no adapter, which is a programming mistake rather than a runtime
      // condition, and is said to at the point of the mistake.
      const adapter = serviceManager.switchTo(next);
      setLastActiveService(next);
      setActiveService(next);

      setTracks([]);
      setPlaylists([]);
      setSelections([]);
      setLikedTracks({});
      setLikeBusy({});
      setActivePlaylist(null);
      setActivePlaylistTracks([]);
      setRelatedTracks([]);
      setDetailsTrack(null);
      setArtistProfile(null);
      setArtistTracks([]);
      setArtistLikedTracks([]);
      setTracksError('');

      let session;
      try {
        session = await adapter.authStatus();
      } catch (reason) {
        // A status check that fails means signed out as far as the interface is concerned. It is not a
        // reason to throw the switch away and strand the user on the previous service.
        console.warn('[ui.services] status check failed', { service: next, error: describeError(reason, 'unknown') });
        session = { authorized: false, profile: null };
      }

      // An expired token is worth one recovery attempt before giving up, whenever the service can
      // refresh at all. Both Spotify and YouTube throw a clear message when their stored credentials
      // are missing, which the catch below turns into signed-out rather than into a failure.
      if (!session.authorized && adapter.authRefresh) {
        try {
          session = await adapter.authRefresh();
        } catch (reason) {
          console.warn('[ui.services] refresh failed', { service: next, error: describeError(reason, 'unknown') });
        }
      }

      setServiceAccounts((current) => ({
        ...current,
        [next]: {
          service: next,
          profile: session.profile ?? null,
          isLoggedIn: session.authorized,
          credentials: loadCredentials(next) ?? undefined,
        },
      }));

      if (!session.authorized) {
        setProfile(null);
        setAuth('guest');
        return;
      }

      setProfile(session.profile ?? null);
      setAuth('authorized');
      void loadTracks();
      void loadPlaylists();
      void loadMixedSelections();
      // The history store belongs to SoundCloud and is keyed by its ids, so it is not loaded for
      // anything else — and nothing records to it for anything else either.
      if (next === 'soundcloud') void loadHistory();
      console.info('[ui.services] switched', { service: next, authorized: session.authorized });
    } finally {
      setSwitchingService(false);
    }
  }

  /** Records what a service reports about itself, without switching to it. */
  async function refreshServiceAccount(service: ServiceProvider) {
    const adapter = serviceManager.getAdapter(service);
    if (!adapter) return;
    try {
      const session = await adapter.authStatus();
      setServiceAccounts((current) => ({
        ...current,
        [service]: {
          service,
          profile: session.profile ?? null,
          isLoggedIn: session.authorized,
          credentials: loadCredentials(service) ?? undefined,
        },
      }));
    } catch (reason) {
      // Silent on purpose: this runs at startup for every service, and a warning on a screen nobody is
      // looking at yet is noise.
      console.debug('[ui.services] account check failed', { service, error: describeError(reason, 'unknown') });
    }
  }

  /**
   * Opens an artist page, when the active service has artists.
   *
   * The callers pass this to components as a callback and a callback cannot be undefined, so the guard
   * lives here rather than at each call site: twenty components would each need their own check, and one
   * forgotten would be a link that navigates nowhere.
   */
  function openArtistWhenAvailable(track: Track) {
    if (!capabilities.artists) return;
    void openArtistFromTrack(track);
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
      // The playlist's own id, not its URN. The SoundCloud sidecar strips a `soundcloud:playlists:`
      // prefix when it is given one and uses the value as-is when it is not, so both services take this
      // unchanged — whereas the URN would be wrong for Spotify and YouTube, whose sidecars want the bare
      // id.
      setActivePlaylistTracks(await serviceManager.active.playlistTracks(playlist.id));
    } catch (reason) {
      setActivePlaylistError(describeError(reason, 'Не удалось загрузить треки плейлиста'));
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
      serviceManager.active.trackDetails(track.nativeId ?? String(track.id)),
      serviceManager.active.relatedTracks(track.nativeId ?? String(track.id)),
    ]);
    if (requestId !== detailsRequestId.current) {
      console.debug('[ui.track.details] ignored stale response', { trackId: track.id, requestId });
      return;
    }
    if (detailsResult.status === 'fulfilled') {
      setDetailsTrack(detailsResult.value);
      console.info('[ui.track.details] loaded', { trackId: detailsResult.value.id, title: detailsResult.value.title });
    } else {
      const message = describeError(detailsResult.reason, 'Не удалось загрузить информацию о треке');
      console.error('[ui.track.details] failed', { trackId: track.id, error: message });
      setDetailsError(message);
    }
    if (relatedResult.status === 'fulfilled') {
      setRelatedTracks(relatedResult.value);
      console.info('[ui.track.related] loaded', { trackId: track.id, count: relatedResult.value.length });
    } else {
      const message = describeError(relatedResult.reason, 'Не удалось загрузить похожие треки');
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
    // YouTube channels are served by the service adapter, not the SoundCloud gateway. Likes and
    // socials do not exist there: likes resolve empty (the section hides itself) and the social
    // chips are hidden by prop, so their loaders must never run against SoundCloud ids.
    // Destructured inside the guard: optional-method narrowing does not survive the await below.
    const youtube = activeService === 'youtube-music' ? serviceManager.getAdapter('youtube-music') : undefined;
    const youtubeArtist = youtube?.artistProfile && youtube.artistTracks && youtube.artistPlaylists
      ? { profile: youtube.artistProfile, tracks: youtube.artistTracks, playlists: youtube.artistPlaylists }
      : null;
    const [profileResult, tracksResult, likesResult, playlistsResult] = youtubeArtist
      ? await Promise.allSettled([
        youtubeArtist.profile(String(artistId)),
        youtubeArtist.tracks(String(artistId)),
        Promise.resolve({ tracks: [] as Track[], next: '' }),
        youtubeArtist.playlists(String(artistId)),
      ])
      : await Promise.allSettled([
        appGateway.artistProfile(artistId),
        appGateway.artistTracks(artistId),
        appGateway.artistLikes(artistId),
        appGateway.artistPlaylists(artistId),
      ]);
    if (requestId !== artistRequestId.current) {
      console.debug('[ui.artist.profile] ignored stale response', { artistId, requestId });
      return;
    }
    if (profileResult.status === 'fulfilled') {
      setArtistProfile(profileResult.value);
      console.info('[ui.artist.profile] loaded', { artistId, username: profileResult.value.username });
    } else {
      const message = describeError(profileResult.reason, 'Не удалось загрузить профиль автора');
      console.error('[ui.artist.profile] failed', { artistId, error: message });
      setArtistProfileError(message);
    }
    if (tracksResult.status === 'fulfilled') {
      setArtistTracks(tracksResult.value);
      console.info('[ui.artist.tracks] loaded', { artistId, count: tracksResult.value.length });
    } else {
      const message = describeError(tracksResult.reason, 'Не удалось загрузить треки автора');
      console.error('[ui.artist.tracks] failed', { artistId, error: message });
      setArtistTracksError(message);
    }
    if (likesResult.status === 'fulfilled') {
      setArtistLikedTracks(likesResult.value.tracks);
      setArtistLikedTracksNext(likesResult.value.next);
      console.info('[ui.artist.likes] loaded', { artistId, count: likesResult.value.tracks.length, hasNext: Boolean(likesResult.value.next) });
    }
    else {
      setArtistLikedTracks([]);
      setArtistLikedTracksError(describeError(likesResult.reason, 'Лайки автора недоступны'));
    }
    if (playlistsResult.status === 'fulfilled') setArtistPlaylists(playlistsResult.value);
    else {
      setArtistPlaylists([]);
      setArtistPlaylistsError(describeError(playlistsResult.reason, 'Не удалось загрузить плейлисты автора'));
    }
    setArtistProfileLoading(false);
    setArtistTracksLoading(false);
    setArtistLikedTracksLoading(false);
    setArtistPlaylistsLoading(false);
  }

  async function loadArtistSocial(artistId: number, tab: 'followers' | 'followings', next?: string, append = false) {
    const requestId = ++artistSocialRequestId.current;
    setArtistSocialLoading(true);
    setArtistSocialError('');
    try {
      const result = tab === 'followers'
        ? await appGateway.artistFollowers(artistId, next)
        : await appGateway.artistFollowings(artistId, next);
      if (requestId !== artistSocialRequestId.current || artistProfile?.id !== artistId) return;
      const setter = tab === 'followers' ? setArtistFollowers : setArtistFollowings;
      setter((current) => append ? [...current, ...result.users.filter((user) => !current.some((item) => item.id === user.id))] : result.users);
      if (tab === 'followers') setArtistFollowersNext(result.next || '');
      else setArtistFollowingsNext(result.next || '');
    } catch (reason) {
      if (requestId !== artistSocialRequestId.current) return;
      setArtistSocialError(describeError(reason, 'Не удалось загрузить список пользователей'));
    } finally {
      if (requestId === artistSocialRequestId.current) setArtistSocialLoading(false);
    }
  }

  async function loadMoreArtistLikes() {
    if (!artistProfile || !artistLikedTracksNext || artistLikedTracksLoading || artistLikesLoadingRef.current) return;
    const artistId = artistProfile.id;
    const requestId = artistRequestId.current;
    artistLikesLoadingRef.current = true;
    setArtistLikedTracksLoading(true);
    setArtistLikedTracksError('');
    try {
      const result = await appGateway.artistLikes(artistId, artistLikedTracksNext);
      if (requestId !== artistRequestId.current || artistProfile?.id !== artistId) return;
      setArtistLikedTracks((current) => [...current, ...result.tracks.filter((track) => !current.some((item) => item.id === track.id))]);
      setArtistLikedTracksNext(result.next);
      console.info('[ui.artist.likes] appended', { artistId, count: result.tracks.length, total: artistLikedTracks.length + result.tracks.length, hasNext: Boolean(result.next) });
    } catch (reason) {
      if (requestId !== artistRequestId.current) return;
      setArtistLikedTracksError(describeError(reason, 'Не удалось загрузить следующие лайки автора'));
    } finally {
      artistLikesLoadingRef.current = false;
      if (requestId === artistRequestId.current) setArtistLikedTracksLoading(false);
    }
  }

  function selectArtistSocialTab(tab: 'followers' | 'followings') {
    setSocialPageOwner('artist');
    setPage(tab);
    setArtistSocialTab(tab);
    if (!artistProfile) return;
    const isLoaded = tab === 'followers' ? artistFollowers.length > 0 : artistFollowings.length > 0;
    if (!isLoaded) void loadArtistSocial(artistProfile.id, tab);
  }

  function loadMoreArtistSocial() {
    if (!artistProfile) return;
    const next = artistSocialTab === 'followers' ? artistFollowersNext : artistFollowingsNext;
    if (next) void loadArtistSocial(artistProfile.id, artistSocialTab, next, true);
  }

  async function openArtistProfile(artistId: number) {
    if (!artistId) return;
    artistReturnPage.current = page;
    if ((page === 'followers' || page === 'followings') && socialPageOwner === 'artist') {
      artistSocialReturnSnapshot.current = {
        followers: artistFollowers,
        followings: artistFollowings,
        followersNext: artistFollowersNext,
        followingsNext: artistFollowingsNext,
      };
    } else {
      artistSocialReturnSnapshot.current = null;
    }
    const requestId = ++artistRequestId.current;
    artistSocialRequestId.current += 1;
    setPage('artist');
    setArtistSocialTab('followers');
    setArtistFollowers([]);
    setArtistFollowings([]);
    setArtistFollowersNext('');
    setArtistFollowingsNext('');
    setArtistSocialError('');
    setArtistProfileLoading(true);
    setArtistProfileError('');
    setArtistTracks([]);
    setArtistTracksLoading(true);
    setArtistTracksError('');
    setArtistLikedTracks([]);
    setArtistLikedTracksNext('');
    setArtistLikedTracksLoading(true);
    setArtistLikedTracksError('');
    setArtistPlaylists([]);
    setArtistPlaylistsLoading(true);
    setArtistPlaylistsError('');
    setArtistProfile((prev) => (prev?.id === artistId ? prev : null));
    await runArtistProfileRequest(requestId, artistId);
  }

  async function openArtistFromTrack(track: Track) {
    artistReturnPage.current = page;
    artistSocialReturnSnapshot.current = null;
    const requestId = ++artistRequestId.current;
    artistSocialRequestId.current += 1;
    setPage('artist');
    setArtistSocialTab('followers');
    setArtistFollowers([]);
    setArtistFollowings([]);
    setArtistFollowersNext('');
    setArtistFollowingsNext('');
    setArtistSocialError('');
    setArtistProfile(null);
    setArtistProfileLoading(true);
    setArtistProfileError('');
    setArtistTracks([]);
    setArtistTracksLoading(true);
    setArtistTracksError('');
    setArtistLikedTracks([]);
    setArtistLikedTracksNext('');
    setArtistLikedTracksLoading(true);
    setArtistLikedTracksError('');
    setArtistPlaylists([]);
    setArtistPlaylistsLoading(true);
    setArtistPlaylistsError('');
    try {
      const details = await serviceManager.active.trackDetails(track.nativeId ?? String(track.id));
      if (requestId !== artistRequestId.current) return;
      const artistId = details.artist.id;
      if (!artistId) {
        setArtistProfileError('Не удалось определить автора этого трека');
        setArtistProfileLoading(false);
        setArtistTracksLoading(false);
        setArtistLikedTracksLoading(false);
        setArtistPlaylistsLoading(false);
        return;
      }
      await runArtistProfileRequest(requestId, artistId);
    } catch (reason) {
      if (requestId !== artistRequestId.current) return;
      const message = describeError(reason, 'Не удалось определить автора трека');
      console.error('[ui.artist.profile] track lookup failed', { trackId: track.id, error: message });
      setArtistProfileError(message);
      setArtistProfileLoading(false);
      setArtistTracksLoading(false);
      setArtistLikedTracksLoading(false);
      setArtistPlaylistsLoading(false);
    }
  }

  function backFromArtistProfile() {
    if ((artistReturnPage.current === 'followers' || artistReturnPage.current === 'followings') && socialPageOwner === 'artist' && artistSocialReturnSnapshot.current) {
      setArtistFollowers(artistSocialReturnSnapshot.current.followers);
      setArtistFollowings(artistSocialReturnSnapshot.current.followings);
      setArtistFollowersNext(artistSocialReturnSnapshot.current.followersNext);
      setArtistFollowingsNext(artistSocialReturnSnapshot.current.followingsNext);
    }
    setPage(artistReturnPage.current);
  }

  async function openMyProfile() {
    setPage('profile');
    if (!profile) return;
    const requestId = ++myProfileRequestId.current;
    setMyProfileSocialTab(null);
    setMyProfileFollowers([]);
    setMyProfileFollowings([]);
    setMyProfileFollowersNext('');
    setMyProfileFollowingsNext('');
    setMyProfileSocialError('');
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
    else errors.push(describeError(detailsResult.reason, 'Не удалось загрузить данные профиля'));
    if (tracksResult.status === 'fulfilled') setMyProfileTracks(tracksResult.value);
    else errors.push(describeError(tracksResult.reason, 'Не удалось загрузить опубликованные треки'));
    if (playlistsResult.status === 'fulfilled') setMyProfilePlaylists(playlistsResult.value);
    else errors.push(describeError(playlistsResult.reason, 'Не удалось загрузить плейлисты профиля'));
    setMyProfileError(errors.join(' · '));
    setMyProfileLoading(false);
  }

  async function openMySocialPage(tab: 'followers' | 'followings') {
    setSocialPageOwner('my');
    setPage(tab);
    const loaded = tab === 'followers' ? myProfileFollowers.length > 0 : myProfileFollowings.length > 0;
    if (!loaded) await loadMyProfileSocial(tab);
    else setMyProfileSocialTab(tab);
  }

  async function loadMyProfileSocial(tab: 'followers' | 'followings', next?: string, append = false) {
    if (!profile) return;
    const requestId = ++myProfileSocialRequestId.current;
    setMyProfileSocialTab(tab);
    setMyProfileSocialLoading(true);
    setMyProfileSocialError('');
    try {
      const result = tab === 'followers'
        ? await appGateway.artistFollowers(profile.id, next)
        : await appGateway.artistFollowings(profile.id, next);
      if (requestId !== myProfileSocialRequestId.current) return;
      const setter = tab === 'followers' ? setMyProfileFollowers : setMyProfileFollowings;
      setter((current) => append ? [...current, ...result.users.filter((user) => !current.some((item) => item.id === user.id))] : result.users);
      if (tab === 'followers') setMyProfileFollowersNext(result.next || '');
      else setMyProfileFollowingsNext(result.next || '');
    } catch (reason) {
      if (requestId !== myProfileSocialRequestId.current) return;
      setMyProfileSocialError(describeError(reason, 'Не удалось загрузить список пользователей'));
    } finally {
      if (requestId === myProfileSocialRequestId.current) setMyProfileSocialLoading(false);
    }
  }

  function loadMoreMyProfileSocial() {
    if (myProfileSocialTab === 'followers' && myProfileFollowersNext) void loadMyProfileSocial('followers', myProfileFollowersNext, true);
    else if (myProfileSocialTab === 'followings' && myProfileFollowingsNext) void loadMyProfileSocial('followings', myProfileFollowingsNext, true);
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
    console.info('[ui.player] loading track from details', { trackId: track.id, permalinkUrl: track.permalink });
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
      .then(async ([storedSettings, status]) => {
        if (!active) return;
        setSettings(storedSettings);
        setProfile(status.profile ?? null);
        setAuth(status.authorized ? 'authorized' : 'guest');
        setReady(true);
        void loadHistory();

        // Every registered service is asked about itself, not only the active one: the switcher has to
        // show a grey dot beside a service nobody is signed into, and it cannot ask after it has shown.
        for (const candidate of serviceManager.allServices) {
          void refreshServiceAccount(candidate);
        }

        // SoundCloud's own status above is the app's existing bootstrap and is left in charge when it is
        // the remembered service, or when it is signed in. The multi-service path only takes over when
        // the user last worked in something else and that service still has a session.
        // Restoring the remembered service and loading the active service's data are two separate
        // jobs. They used to be chained: the data load sat below the restore, so every early return
        // in between skipped it — and the first of those returns fires whenever the user last worked
        // in SoundCloud, which is the common case. Nothing loaded until the user switched services
        // and back, because switchService loads without asking.
        let restoredRemembered = false;
        const remembered = getLastActiveService();
        if (remembered !== 'soundcloud') {
          const stored = loadCredentials(remembered);
          const adapter = stored ? serviceManager.getAdapter(remembered) : null;
          if (adapter) {
            try {
              const restored = await adapter.authStatus();
              if (active && restored.authorized) {
                console.info('[ui.startup] restoring remembered service', { service: remembered });
                await switchService(remembered);
                restoredRemembered = true;
              }
            } catch (reason) {
              // Falling through to the guest screen is the right outcome: a service that cannot be reached is
              // a service that cannot be used, and the switcher still shows it as disconnected.
              console.warn('[ui.startup] restore failed', { service: remembered, error: describeError(reason, 'unknown') });
            }
          }
        }

        // Only when nothing took over: switchService has already loaded for the service it switched to.
        if (!restoredRemembered && status.authorized) {
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
            .catch((reason: unknown) => console.error('[ui.auth.refresh] failed', { error: describeError(reason, 'unknown error') }));
        }      })
      .catch((reason: unknown) => {
        if (!active) return;
        const message = describeError(reason, 'Локальный backend недоступен');
        console.error('[ui.startup] failed', { error: message });
        setError(message);
      });
    return () => {
      active = false;
      const stopBackend = () => {
        void appGateway.stop().catch((reason: unknown) => {
          console.warn('[local-backend] stop failed during app cleanup', { error: describeError(reason, String(reason)) });
        });
      };
      // Written on unmount as well as on switch, so a service chosen and then quit from is restored
      // next launch even if the switch never completed.
      setLastActiveService(getLastActiveService());
      void historyWriteRef.current.then(stopBackend, stopBackend);
    };
  }, []);

  // The service accent is a separate variable from --accent, which is the user's own setting and is
  // left alone. Switching service changes what marks the service, not the colour they chose.
  useEffect(() => {
    document.documentElement.dataset.service = activeService;
  }, [activeService]);

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', settings.accent);
  }, [settings.accent]);

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
    void serviceManager.active.trackLyrics(detailsTrack)
      .then((loaded) => {
        if (requestId !== lyricsRequestId.current) return;
        setLyrics(loaded);
        console.info('[ui.lyrics] loaded', { trackId, lines: loaded.lines.length });
      })
      .catch((reason: unknown) => {
        if (requestId !== lyricsRequestId.current) return;
        setLyricsError(describeError(reason, 'Не удалось загрузить текст песни'));
        console.error('[ui.lyrics] failed', { trackId, error: describeError(reason, 'unknown error') });
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
      const message = describeError(reason, 'Не удалось сохранить настройки');
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
          console.warn('[ui.auth.silent] client id save failed', { error: describeError(reason, 'unknown error') });
        }
      }
      try {
        await invoke('finish_auth_flow');
      } catch (reason) {
        console.warn('[ui.auth] could not close SoundCloud window', { error: describeError(reason, 'unknown error') });
      }
      setProfile(result.profile);
      setAuth('authorized');
      void loadTracks();
      void loadPlaylists();
      void loadMixedSelections();
    } catch (reason) {
      const message = describeError(reason, 'Не удалось подключить аккаунт');
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
      const message = describeError(reason, 'Не удалось сохранить access token');
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
    // The embedded webview keeps its own SoundCloud session. Without this, a later launch
    // is signed back in by the auth script with no user action.
    try {
      await invoke('end_soundcloud_session');
    } catch (reason) {
      console.warn('[ui.auth.logout] could not clear the embedded session', { error: describeError(reason, 'unknown error') });
    }
    try {
      // The service on screen, not always SoundCloud. With a Spotify library up, signing out of
      // SoundCloud would have ended an account the user was not even looking at.
      if (activeService === 'soundcloud') {
        await appGateway.authLogout();
      } else {
        await serviceManager.active.authLogout();
      }
    } catch (reason) {
      const message = describeError(reason, 'Не удалось выйти');
      console.error('[ui.auth.logout] failed', { service: activeService, error: message });
      setError(message);
      return false;
    }
    setServiceAccounts((current) => ({
      ...current,
      [activeService]: {
        service: activeService,
        profile: null,
        isLoggedIn: false,
        credentials: current[activeService]?.credentials,
      },
    }));
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

  // The wallpaper arrives as a data URL, and Chrome refuses to load a URL longer than 2 MB. The
  // hook hands back an object URL instead, which stays short however big the image is.
  //
  // It has to sit above every early return below. A hook called after one of them runs a
  // different number of times depending on the state, which React rejects, and the whole view
  // fails to render.
  const backgroundUrl = useBackgroundUrl(settings.backgroundImage);

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

  if (auth === 'guest') {
    return (
      <MultiAuthScreen
        accounts={serviceAccounts}
        lastService={activeService}
        error={loginError}
        soundCloud={{
          clientId: settings.clientId,
          onLogin: (token, clientId) => void login(token, clientId),
          onSilentLogin: silentLogin,
        }}
        onSignedIn={(service) => void switchService(service)}
      />
    );
  }

  const isViewingPlayingTrack = page === 'track' && currentTrack !== null && detailsTrack !== null && currentTrack.id === detailsTrack.id;
  const lyricsPanelState = lyricsPhase === 'closed' ? '' : `lyrics-panel-${lyricsPhase}`;

  return (
    <div
      className={`app-shell ${playerVisible && !isViewingPlayingTrack ? 'player-visible' : ''} ${backgroundUrl ? 'has-custom-background' : ''} ${lyricsPanelState}`}
      style={{
        '--custom-background-image': backgroundUrl ? `url("${backgroundUrl}")` : 'none',
        '--custom-background-blur': `${settings.backgroundBlur}px`,
        '--content-panel-opacity': String(0.4 + Math.min(settings.backgroundBlur, 6) * (0.2 / 6)),
        '--sidebar-width': `${sidebarWidth}px`,
        '--lyrics-panel-width': `${lyricsPanelWidth}px`,
      } as CSSProperties}
    >
      <header className="topbar">
        <div className="window-tools"><button className="icon-button" type="button" onClick={() => setPage('likes')} aria-label="Назад"><FaChevronLeft /></button></div>
        <div className="global-search"><TrackSearch onSelect={selectTrack} /></div>
        <div className="top-actions">
          <ServiceSwitcher
            activeService={activeService}
            accounts={serviceAccounts}
            switching={switchingService}
            busyService={switchingService ? activeService : null}
            onSwitch={(service) => void switchService(service)}
          />

          <button className={`header-account${page === 'profile' ? ' is-current' : ''}`} type="button" onClick={() => void openMyProfile()} title="Открыть профиль" aria-label="Мой профиль">
            {profile?.avatarUrl
              ? <img className="header-avatar" src={profile.avatarUrl} alt="" />
              : <span className="header-avatar header-avatar-fallback" aria-hidden="true">{(profile?.username || 'SC').slice(0, 2).toUpperCase()}</span>}
            <span className="header-account-copy"><b>@{profile?.username || 'аккаунт'}</b></span>
          </button>
          <UpdaterNotification />
          <button className="icon-button header-settings" type="button" onClick={() => setPage('settings')} aria-label="Настройки" title="Настройки">
            <FaGear aria-hidden="true" />
          </button>
          <button className="icon-button header-logout" type="button" onClick={() => { setError(''); setLogoutDialogOpen(true); }} title="Выйти из SoundCloud" aria-label="Выйти из SoundCloud">
            <FaArrowRightFromBracket aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="workspace">
        <Sidebar profile={profile} page={page} tracks={tracks} activeService={activeService} onOpenArtist={capabilities.artists ? openArtistWhenAvailable : undefined} onNavigate={setPage} onPlayTrack={selectTrack} onOpenTrack={(track) => void openTrackDetails(track, tracks)} onResize={(delta) => setSidebarWidth((width) => Math.max(220, Math.min(380, width + delta)))} />
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
              onOpenArtist={capabilities.artists ? openArtistWhenAvailable : undefined}
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
                onOpenArtist={capabilities.artists ? openArtistWhenAvailable : undefined}
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
            ? <SettingsPanel settings={settings} saved={saved} error={error} profile={profile} tokenError={loginError} tokenBusy={loginBusy} onSaveToken={saveAccessToken} onUpdate={(patch) => void updateSettings(patch)} accountsSection={<ConnectedAccounts accounts={serviceAccounts} activeService={activeService} onSwitch={(service) => void switchService(service)} onSignOutSoundCloud={() => { setError(''); setLogoutDialogOpen(true); }} />} />
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
                onOpenSocial={(tab) => void openMySocialPage(tab)}
              />
          : (page === 'followers' || page === 'followings')
            ? <SocialUsersPage
                kind={page}
                users={socialPageOwner === 'artist'
                  ? page === 'followers' ? artistFollowers : artistFollowings
                  : page === 'followers' ? myProfileFollowers : myProfileFollowings}
                loading={socialPageOwner === 'artist' ? artistSocialLoading : myProfileSocialLoading}
                error={socialPageOwner === 'artist' ? artistSocialError : myProfileSocialError}
                hasMore={socialPageOwner === 'artist'
                  ? Boolean(page === 'followers' ? artistFollowersNext : artistFollowingsNext)
                  : Boolean(page === 'followers' ? myProfileFollowersNext : myProfileFollowingsNext)}
                onBack={() => setPage(socialPageOwner === 'artist' ? 'artist' : 'profile')}
                onSwitch={(kind) => socialPageOwner === 'artist' ? selectArtistSocialTab(kind) : void openMySocialPage(kind)}
                onLoadMore={() => socialPageOwner === 'artist' ? loadMoreArtistSocial() : loadMoreMyProfileSocial()}
                onOpenProfile={(userId) => void openArtistProfile(userId)}
              />
          : (page === 'artist-tracks-all' || page === 'artist-likes-all')
            ? <ArtistTrackListPage
                title={page === 'artist-tracks-all' ? 'Все треки' : 'Понравившиеся треки'}
                artistName={artistProfile?.fullName || artistProfile?.username || ''}
                tracks={page === 'artist-tracks-all' ? artistTracks : artistLikedTracks}
                totalCount={page === 'artist-likes-all' ? artistProfile?.likesCount : undefined}
                loading={page === 'artist-likes-all' && artistLikedTracksLoading}
                error={page === 'artist-likes-all' ? artistLikedTracksError : ''}
                hasMore={page === 'artist-likes-all' && Boolean(artistLikedTracksNext)}
                onLoadMore={page === 'artist-likes-all' ? loadMoreArtistLikes : undefined}
                currentTrackId={currentTrack?.id ?? null}
                isPlaying={shouldPlay}
                playbackLoading={playbackLoading}
                onBack={() => setPage('artist')}
                onPlay={selectTrack}
                onOpen={(track, context) => void openTrackDetails(track, context)}
                onOpenArtist={capabilities.artists ? openArtistWhenAvailable : undefined}
              />
          : page === 'artist'
            ? <ArtistProfilePage
                profile={artistProfile}
                loading={artistProfileLoading}
                error={artistProfileError}
                tracks={artistTracks}
                tracksLoading={artistTracksLoading}
                tracksError={artistTracksError}
                likedTracks={artistLikedTracks}
                likedTracksLoading={artistLikedTracksLoading}
                likedTracksError={artistLikedTracksError}
                playlists={artistPlaylists}
                playlistsLoading={artistPlaylistsLoading}
                playlistsError={artistPlaylistsError}
                currentTrackId={currentTrack?.id ?? null}
                isPlaying={shouldPlay}
                playbackLoading={playbackLoading}
                onPlayTrack={selectTrack}
                onOpenTrack={(track, context) => void openTrackDetails(track, context)}
                onOpenPlaylist={(playlist) => void openPlaylist(playlist)}
                onSocialTab={selectArtistSocialTab}
                onViewTracks={() => setPage('artist-tracks-all')}
                onViewLikes={() => setPage('artist-likes-all')}
                onBack={backFromArtistProfile}
                hideSocial={activeService === 'youtube-music'}
                tracksKicker={activeService === 'youtube-music' ? 'ВИДЕО КАНАЛА' : undefined}
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
                liked={detailsTrack ? (likedTracks[detailsTrack.id] !== undefined ? likedTracks[detailsTrack.id] : tracks.some((item) => item.id === detailsTrack.id)) : false}
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
                hasLyrics={Boolean(lyrics?.lines.length)}
                onToggleLyrics={toggleLyrics}
              />}
        {tracksError && <ErrorMessage message={tracksError} className="app-track-error" />}
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
        onTogglePlayback={playDetailsTrack}
        onPreviousTrack={() => navigateLyricsTrack(-1)}
        onNextTrack={() => navigateLyricsTrack(1)}
        canPreviousTrack={currentTrackIndex > 0 && !manualQueueEnabled}
        canNextTrack={manualQueueEnabled
          ? manualQueue.length > 1
          : currentTrackIndex >= 0 && currentTrackIndex + 1 < queueTracks.length}
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
        source={activeService}
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
        liked={currentTrack ? (likedTracks[currentTrack.id] !== undefined ? likedTracks[currentTrack.id] : tracks.some((item) => item.id === currentTrack.id)) : false}
        onLike={() => { if (currentTrack) void toggleTrackLike(currentTrack); }}
        queueOpen={queueOpen}
        onToggleQueue={() => setQueueOpen((open) => !open)}
        onOpenTrack={() => { if (currentTrack) void openTrackDetails(currentTrack, queueTracks); }}
        onOpenArtist={capabilities.artists ? () => { if (currentTrack) void openArtistFromTrack(currentTrack); } : undefined}
        onTogglePlayback={togglePlayback}
        onPrevious={() => void loadTrackAt(Math.max(currentTrackIndex - 1, 0))}
        onNext={playNextTrack}
        hasNext={(manualQueueEnabled && manualQueue.length > 1) || (!manualQueueEnabled && currentTrackIndex >= 0 && currentTrackIndex + 1 < queueTracks.length)}
        onEnded={() => {
          handleTrackEnded();
        }}
        onReady={() => setPlaybackLoading(false)}
        onProgress={(positionMs) => {
          // The 4 Hz tick only feeds the lyrics panel and the detail-page waveform. With neither on
          // screen, writing it to root state re-rendered the whole app for no reader.
          if (lyricsPanelActive || page === 'track') setPlaybackPositionMs(positionMs);
        }}
        onError={(message) => { setPlaybackError(message); setPlaybackLoading(false); setShouldPlay(false); }}
        onPlaybackStateChange={handlePlaybackStateChange}
      />
      {queueOpen && <QueuePanel
        tracks={manualQueue}
        currentTrack={currentTrack}
        queueState={manualQueueEnabled ? (shouldPlay ? 'playing' : 'paused') : 'idle'}
        onAddCurrentTrack={addCurrentTrackToQueue}
        onToggleQueuePlayback={toggleManualQueuePlayback}
        onPlay={playQueuedTrack}
        onRemove={(index) => {
          setManualQueue((queue) => queue.filter((_, queueIndex) => queueIndex !== index));
          if (manualQueueEnabled && index === 0) setManualQueueEnabled(false);
        }}
        currentQueueIndex={manualQueueEnabled && currentTrack?.id === manualQueue[0]?.id ? 0 : -1}
        onClear={() => { setManualQueue([]); setManualQueueEnabled(false); }}
        onClose={() => setQueueOpen(false)}
      />}
    </div>
  );
}
