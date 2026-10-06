import type { ServiceProvider } from '../../domain/models';
import type { Playlist, Profile, Track, TrackCollection, TrackDetails, TrackLyrics } from '../../domain/models';
import type { ServiceCredentials } from '../../domain/models';
import { desktop } from '../desktop';
import type { YouTubeAuthProfile, YouTubePlaylist, YouTubeTrack, YouTubeTrackPage } from '../desktop';
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

const YOUTUBE_POLL_INTERVAL_MS = 700;
const YOUTUBE_POLL_TIMEOUT_MS = 5 * 60_000;

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
    const clientId = credentials?.clientId;
    const clientSecret = credentials?.clientSecret;
    if (!clientId || !clientSecret) {
      throw new Error('Для входа через YouTube нужны Client ID и Client Secret');
    }

    await desktop.youtubeAuthStart(clientId, YOUTUBE_REDIRECT_URI);
    const code = await waitForYoutubeCode();
    const status = await desktop.youtubeAuthExchange(code, clientId, clientSecret, YOUTUBE_REDIRECT_URI);

    // Stored only after the exchange worked. Credentials that turned out to be wrong would otherwise
    // sit there being handed to every later attempt.
    if (status.authorized) {
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
    // Unlike Spotify this one needs nothing but the stored session, which is why it works.
    const status = await desktop.youtubeAuthRefresh();
    return { authorized: status.authorized, profile: status.profile ? toProfile(status.profile) : null };
  },

  async myTracks(): Promise<Track[]> {
    // Music only, because a liked video list that is mostly lectures is not a music library. A video
    // miscategorised as music still shows up, which is the better of the two failures.
    const page = await desktop.youtubeMyTracks(undefined, undefined, true);
    return toTracks(page);
  },

  async myPlaylists(): Promise<Playlist[]> {
    const page = await desktop.youtubeMyPlaylists();
    return page.playlists.map(toPlaylist);
  },

  async playlistTracks(playlistId: string): Promise<Track[]> {
    return toTracks(await desktop.youtubePlaylistTracks(playlistId));
  },

  async trackDetails(trackId: string): Promise<TrackDetails> {
    // TrackDetails only widens Track with optional fields and YouTube fills in none of them, so the
    // track is the whole answer.
    return toTrack(await desktop.youtubeTrackDetails(trackId));
  },

  async trackStream(track: Track): Promise<AdapterTrackStream> {
    // There is no YouTube playback API and no stream URL in any of these responses. What can be done
    // without a third-party downloader is hand the embed over to a player, so the stream a caller gets
    // here is the watch page rather than an audio file.
    //
    // Said plainly because a caller expecting a playable URL would otherwise discover this by
    // watching nothing happen.
    const id = track.nativeId ?? '';
    if (!id) {
      throw new Error('У этого трека нет YouTube-идентификатора');
    }
    return { url: `https://www.youtube.com/embed/${encodeURIComponent(id)}`, preview: false, hls: false, quality: 'embed' };
  },

  async trackLyrics(track: Track): Promise<TrackLyrics> {
    // No lyrics anywhere in YouTube's API. Empty lines render as "no lyrics"; throwing would turn a
    // missing feature into a visible error on every track.
    return { trackId: track.id, lines: [], isSynced: false };
  },

  async searchTracks(query: string): Promise<Track[]> {
    return toTracks(await desktop.youtubeSearchTracks(query));
  },

  async relatedTracks(trackId: string): Promise<Track[]> {
    // Search is the closest thing YouTube offers, and it costs a hundred calls a day, which is why
    // this is capped low rather than run generously.
    const page = await desktop.youtubeSearchTracks(trackId, undefined, 10);
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
