import type { ServiceProvider } from '../../domain/models';
import type { ArtistProfile, Playlist, Profile, Track, TrackCollection, TrackDetails, TrackLyrics } from '../../domain/models';
import type { ServiceCredentials } from '../../domain/models';
import { desktop } from '../desktop';
import type { YouTubeArtistProfile, YouTubeAuthProfile, YouTubePlaylist, YouTubeTrack, YouTubeTrackPage } from '../desktop';
import { loadCredentials, saveCredentials } from '../credentialStore';
import type { AdapterTrackStream, AuthResult, ServiceAdapter } from '../serviceAdapter';
import { identityFor } from '../serviceIdentity';

/**
 * The port the OAuth window intercepts.
 *
 * 8889 rather than Spotify's 8888, and that is not cosmetic: two windows that both decide to claim a
 * redirect on the same port would fight over it, and one service would break the other.
 */
const YOUTUBE_REDIRECT_URI = 'http://localhost:8889/callback';

/** Only reading. Everything writable needs force-ssl, which is a much larger ask than this app makes. */
const YOUTUBE_SCOPES_HINT = 'youtube.readonly';

// Bundled one-click credentials (build-time env, see youtube_bundled_credentials). Resolved once
// per session and never written to any store — unlike user-entered keys, which persist so refresh
// survives restarts.
let bundledCreds: { clientId: string; clientSecret: string; configured: boolean } | null = null;

async function bundledCredentials(): Promise<{ clientId: string; clientSecret: string; configured: boolean }> {
  if (!bundledCreds) bundledCreds = await desktop.youtubeBundledCredentials();
  return bundledCreds;
}

type ResolvedCredentials = { clientId: string; clientSecret: string; persist: boolean };

async function resolveCredentials(explicit?: ServiceCredentials): Promise<ResolvedCredentials> {
  if (explicit?.clientId && explicit?.clientSecret) {
    // Typed by hand: the only set worth remembering.
    return { clientId: explicit.clientId, clientSecret: explicit.clientSecret, persist: true };
  }
  const stored = loadCredentials('youtube-music');
  if (stored?.clientId && stored?.clientSecret) {
    return { clientId: stored.clientId, clientSecret: stored.clientSecret, persist: false };
  }
  const bundled = await bundledCredentials();
  if (!bundled.configured) {
    throw new Error('Нужны Client ID и Client Secret: введи свои ниже — или собери приложение с общими ключами (см. доку)');
  }
  return { clientId: bundled.clientId, clientSecret: bundled.clientSecret, persist: false };
}

const channelIdByNumericId = new Map<number, string>();

function channelIdentity(channelId: string): number {
  const id = identityFor('youtube-music', `channel:${channelId}`);
  channelIdByNumericId.set(id, channelId);
  return id;
}

function nativeChannelId(numericId: number): string | null {
  return channelIdByNumericId.get(numericId) ?? null;
}

const YOUTUBE_POLL_INTERVAL_MS = 700;
const YOUTUBE_POLL_TIMEOUT_MS = 5 * 60_000;

/**
 * Resolved proxy URLs, keyed by video id.
 *
 * The URL names a localhost endpoint with a per-launch port, so entries live for the session and
 * are never served past it. The point is surviving the gap between opening a track and pressing
 * play: the first download takes seconds (a yt-dlp spawn), and the browser only honours a
 * programmatic play() while the click's user gesture is still fresh. A warm cache keeps play()
 * inside that window. The audio bytes themselves live in the Rust-side disk cache permanently
 * (until evicted), so replays never download twice.
 */
const audioUrlCache = new Map<string, { url: string; expiresAt: number }>();
const AUDIO_URL_TTL_MS = 5 * 60 * 60_000;

function cachedAudioUrl(videoId: string): string | null {
  const entry = audioUrlCache.get(videoId);
  if (!entry || entry.expiresAt <= Date.now() + 60_000) {
    if (entry) audioUrlCache.delete(videoId);
    return null;
  }
  return entry.url;
}

async function waitForYoutubeCode(): Promise<string> {
  const deadline = Date.now() + YOUTUBE_POLL_TIMEOUT_MS;

  for (;;) {
    const status = await desktop.youtubeAuthPoll();

    if (status.completed) {
      if (status.error) throw new Error(`Google: ${status.error}`);
      if (!status.code) throw new Error('Google не вернул код авторизации');
      return status.code;
    }
    if (status.closed) throw new Error('Окно входа YouTube закрыто, авторизация не завершена');
    if (Date.now() >= deadline) throw new Error('Вход в YouTube не завершён за 5 минут');

    await new Promise((resolve) => {
      window.setTimeout(resolve, YOUTUBE_POLL_INTERVAL_MS);
    });
  }
}

function toTrack(source: YouTubeTrack): Track {
  return {
    // Not the video id: see serviceIdentity for why these are handed out rather than derived.
    id: identityFor('youtube-music', source.nativeId),
    nativeId: source.nativeId,
    source: 'youtube-music',
    urn: source.urn,
    title: source.title,
    permalink: source.permalink,
    artwork: source.artworkUrl,
    durationMs: source.durationMs,
    playCount: source.viewCount,
    likeCount: source.likeCount,
    artist: { name: source.artist },
  };
}

function toPlaylist(source: YouTubePlaylist): Playlist {
  return {
    id: source.nativeId,
    urn: source.urn,
    title: source.title,
    permalink: source.permalink,
    artwork: source.artworkUrl,
    trackCount: source.trackCount,
    artist: source.artist,
  };
}

function toTrackDetails(source: YouTubeTrack): TrackDetails {
  const track = toTrack(source);
  const details: TrackDetails = { ...track };
  // The artist link needs a numeric id: the channel registry hands one out and resolves it back
  // when the artist page loads. Without a channel there is no page, so the id stays absent.
  const artist: TrackDetails['artist'] = { ...details.artist };
  if (source.channelId) artist.id = channelIdentity(source.channelId);
  if (source.subscriberCount !== undefined) artist.followerCount = source.subscriberCount;
  details.artist = artist;
  return details;
}

function toArtistProfile(source: YouTubeArtistProfile): ArtistProfile {
  // identityFor is stable per session, so the page key and the openArtist lookups agree.
  const id = source.channelId ? channelIdentity(source.channelId) : identityFor('youtube-music', `channel:${source.title}`);
  return {
    id,
    username: source.title,
    avatar: source.avatarUrl,
    banner: source.bannerUrl,
    description: source.description,
    followersCount: source.subscriberCount,
    trackCount: source.videoCount,
  };
}

function toProfile(source: YouTubeAuthProfile): Profile {
  return {
    id: identityFor('youtube-music', source.id),
    service: 'youtube-music',
    username: source.name || source.email || source.id,
    fullName: source.name,
    avatarUrl: source.picture,
  };
}

function toTracks(page: YouTubeTrackPage): Track[] {
  return page.tracks.map(toTrack);
}

/**
 * How many list heads to pre-resolve audio URLs for.
 *
 * One yt-dlp spawn takes seconds, so resolving at press time is what makes the first play feel
 * stuck. Warming a handful up front moves that cost into the library load happening anyway, and
 * pressing play on a warmed track starts inside the click's gesture. Three parallel downloads
 * is the cap: enough to cover the visible list head, few enough not to hammer the machine on every
 * library load — each head is a full background download. The URL cache (5h TTL) plus the permanent
 * disk cache make repeat visits free.
 */
const PREFETCH_HEADS = 3;

/**
 * The backend's expired-token message (see youtubeAccessToken in youtube_tracks.go). Reads that fail
 * with it are worth exactly one silent refresh-and-retry: the access token lives an hour, and
 * forcing a manual re-login every hour would make the service unusable.
 */
const YOUTUBE_EXPIRED_MARKER = 'нужен refresh';

/** Credentials for the refresh grant: stored hand-typed keys first, bundled one-click keys next.
 * Anything missing means signing in again — there is nothing to refresh with. */
async function refreshSession(): Promise<AuthResult> {
  let clientId: string;
  let clientSecret: string;
  const stored = loadCredentials('youtube-music');
  if (stored?.clientId && stored?.clientSecret) {
    clientId = stored.clientId;
    clientSecret = stored.clientSecret;
  } else {
    const bundled = await bundledCredentials();
    if (!bundled.configured) {
      throw new Error(
        'Нет сохранённых учётных данных YouTube: войдите заново',
      );
    }
    clientId = bundled.clientId;
    clientSecret = bundled.clientSecret;
  }
  const status = await desktop.youtubeAuthRefresh(clientId, clientSecret);
  return { authorized: status.authorized, profile: status.profile ? toProfile(status.profile) : null };
}

/** One shared refresh for every concurrent read, so five expiring calls cause one grant, not five. */
let refreshInflight: Promise<AuthResult> | null = null;

function refreshOnce(): Promise<AuthResult> {
  if (!refreshInflight) {
    refreshInflight = refreshSession().finally(() => {
      refreshInflight = null;
    });
  }
  return refreshInflight;
}

async function withRefreshRetry<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(YOUTUBE_EXPIRED_MARKER)) throw error;
    const session = await refreshOnce();
    if (!session.authorized) throw error;
    return operation();
  }
}

// Orphan elements holding a metadata preload. Kept referenced so the load is not garbage
// collected mid-flight; released on metadata/error or after a safety timeout.
const warmedElements: HTMLAudioElement[] = [];

function releaseWarmed(element: HTMLAudioElement): void {
  const index = warmedElements.indexOf(element);
  if (index >= 0) warmedElements.splice(index, 1);
}

function prefetchAudioUrls(tracks: Track[]): void {
  const heads = tracks.map((track) => track.nativeId ?? '').filter((id) => id && !cachedAudioUrl(id)).slice(0, PREFETCH_HEADS);
  if (!heads.length || typeof Audio === 'undefined') return;
  console.info('[youtube] prefetching audio urls', { count: heads.length });
  void Promise.allSettled(
    heads.map((videoId) =>
      desktop.youtubeAudioUrl(videoId).then(
        (url) => {
          audioUrlCache.set(videoId, { url, expiresAt: Date.now() + AUDIO_URL_TTL_MS });
          // The proxy URL alone resolves nothing until first GET: pull just the head through an
          // orphan element so the upstream resolve, connection and moov happen now, not on play.
          // Metadata only — a few hundred KB, not the whole file.
          const element = new Audio();
          element.preload = 'metadata';
          warmedElements.push(element);
          const release = () => releaseWarmed(element);
          element.addEventListener('loadedmetadata', release, { once: true });
          element.addEventListener('error', release, { once: true });
          window.setTimeout(release, 30_000);
          element.src = url;
          element.load();
        },
        () => {},
      ),
    ),
  );
}

/**
 * YouTube Music behind the ServiceAdapter interface.
 *
 * Everything here walks all pages, for the same reason the Spotify adapter does: the interface returns
 * plain arrays with no continuation. YouTube's continuation is a pageToken rather than a URL, and the
 * bridge accepts it, so what is lost is the adapter's decision to stop calling — not the ability to
 * continue.
 */
export const youtubeMusicAdapter: ServiceAdapter = {
  service: 'youtube-music' as ServiceProvider,

  async authStatus(): Promise<AuthResult> {
    const status = await desktop.youtubeAuthStatus();
    return { authorized: status.authorized, profile: status.profile ? toProfile(status.profile) : null };
  },

  async authLogin(credentials?: ServiceCredentials): Promise<AuthResult> {
    const { clientId, clientSecret, persist } = await resolveCredentials(credentials);

    await desktop.youtubeAuthStart(clientId, YOUTUBE_REDIRECT_URI);
    const code = await waitForYoutubeCode();
    const status = await desktop.youtubeAuthExchange(code, clientId, clientSecret, YOUTUBE_REDIRECT_URI);

    // Stored only after the exchange worked, and only when hand-typed. Credentials that turned out
    // to be wrong would otherwise sit there being handed to every later attempt, and bundled ones
    // must never land in localStorage — they are already compiled into the app.
    if (status.authorized && persist) {
      saveCredentials('youtube-music', { clientId, clientSecret });
    }

    return { authorized: status.authorized, profile: status.profile ? toProfile(status.profile) : null };
  },

  async authLogout(): Promise<void> {
    await desktop.youtubeAuthLogout();
    // The client id and secret stay: they identify the app the user registered, not the session that
    // just ended.
  },

  async authRefresh(): Promise<AuthResult> {
    return refreshSession();
  },

  async myTracks(): Promise<Track[]> {
    // Music only, because a liked video list that is mostly lectures is not a music library. A video
    // miscategorised as music still shows up, which is the better of the two failures.
    const page = await withRefreshRetry(() => desktop.youtubeMyTracks(undefined, undefined, true));
    const tracks = toTracks(page);
    prefetchAudioUrls(tracks);
    return tracks;
  },

  async myPlaylists(): Promise<Playlist[]> {
    const page = await withRefreshRetry(() => desktop.youtubeMyPlaylists());
    return page.playlists.map(toPlaylist);
  },

  async playlistTracks(playlistId: string): Promise<Track[]> {
    return toTracks(await withRefreshRetry(() => desktop.youtubePlaylistTracks(playlistId)));
  },

  async trackDetails(trackId: string): Promise<TrackDetails> {
    // TrackDetails widens Track with likes and the channel's subscriber count (as the artist's
    // follower count). The backend fills both on the single-video call; lists carry views and
    // likes only, because a channels.list per row would burn quota for a list screen.
    const details = toTrackDetails(await withRefreshRetry(() => desktop.youtubeTrackDetails(trackId)));
    // Warm the audio cache while the user reads: opening details is the usual step before pressing
    // play, and resolving now means play() later fires inside the click's gesture. Costs no quota.
    const videoId = details.nativeId;
    if (videoId && !cachedAudioUrl(videoId)) {
      void desktop.youtubeAudioUrl(videoId).then(
        (url) => audioUrlCache.set(videoId, { url, expiresAt: Date.now() + AUDIO_URL_TTL_MS }),
        () => {},
      );
    }
    return details;
  },

  async trackStream(track: Track): Promise<AdapterTrackStream> {
    // There is no YouTube playback API and no stream URL in any of these responses. The URL below
    // names the Rust-side localhost proxy (see the youtube_audio_url command), which serves the
    // downloaded file from its disk cache — downloading on first miss, instantly after that.
    const id = track.nativeId ?? '';
    if (!id) {
      throw new Error('У этого трека нет YouTube-идентификатора');
    }
    const cached = cachedAudioUrl(id);
    if (cached) return { url: cached, preview: false, hls: false, quality: 'audio' };
    const url = await desktop.youtubeAudioUrl(id);
    audioUrlCache.set(id, { url, expiresAt: Date.now() + AUDIO_URL_TTL_MS });
    return { url, preview: false, hls: false, quality: 'audio' };
  },

  async artistProfile(userId: string): Promise<ArtistProfile> {
    // userId is the numeric identity handed out for the channel; the backend wants the UC-id.
    const channelId = nativeChannelId(Number(userId));
    if (!channelId) {
      throw new Error('Неизвестный автор: открой его заново со страницы трека');
    }
    const profile = await withRefreshRetry(() => desktop.youtubeArtistProfile(channelId));
    return toArtistProfile(profile);
  },

  async artistTracks(userId: string): Promise<Track[]> {
    const channelId = nativeChannelId(Number(userId));
    if (!channelId) {
      throw new Error('Неизвестный автор: открой его заново со страницы трека');
    }
    const page = await withRefreshRetry(() => desktop.youtubeArtistTracks(channelId));
    return toTracks(page);
  },

  async artistPlaylists(userId: string): Promise<Playlist[]> {
    const channelId = nativeChannelId(Number(userId));
    if (!channelId) {
      throw new Error('Неизвестный автор: открой его заново со страницы трека');
    }
    const page = await withRefreshRetry(() => desktop.youtubeArtistPlaylists(channelId));
    return page.playlists.map(toPlaylist);
  },

  async trackLyrics(track: Track): Promise<TrackLyrics> {
    // No lyrics anywhere in YouTube's API. Empty lines render as "no lyrics"; throwing would turn a
    // missing feature into a visible error on every track.
    return { trackId: track.id, lines: [], isSynced: false };
  },

  async searchTracks(query: string): Promise<Track[]> {
    return toTracks(await withRefreshRetry(() => desktop.youtubeSearchTracks(query)));
  },

  async relatedTracks(trackId: string): Promise<Track[]> {
    // Search is the closest thing YouTube offers, and it costs a hundred calls a day, which is why
    // this is capped low rather than run generously.
    const page = await withRefreshRetry(() => desktop.youtubeSearchTracks(trackId, undefined, 10));
    return toTracks(page);
  },

  async mixedSelections(): Promise<TrackCollection[]> {
    // No equivalent on YouTube. An empty list leaves the section empty rather than showing a broken
    // one.
    return [];
  },

  // No likeTrack. Writing a rating needs the force-ssl scope, and the app asks only for readonly —
  // requesting write access to a user's YouTube account for a feature that cannot play the audio
  // anyway would be a poor trade.

  // No artist, follower or history methods, for the same reasons as the Spotify adapter: the artist
  // endpoints are a later phase, and history in the sidecar is keyed by SoundCloud ids.
};

export type { YOUTUBE_SCOPES_HINT };
