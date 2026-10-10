import type { ServiceProvider } from '../../domain/models';
import type { Playlist, Profile, Track, TrackCollection, TrackDetails, TrackLyrics } from '../../domain/models';
import type { ServiceCredentials } from '../../domain/models';
import { desktop } from '../desktop';
import type {
  SpotifyAuthProfile,
  SpotifyPlaylist,
  SpotifyTrack,
  SpotifyTrackPage,
} from '../desktop';
import type { AdapterTrackStream, AuthResult, LikeResult, ServiceAdapter } from '../serviceAdapter';
import { loadCredentials, saveCredentials } from '../credentialStore';
import { identityFor } from '../serviceIdentity';

const SPOTIFY_REDIRECT_URI = 'http://127.0.0.1:8888/callback';
/** How often to ask the Rust side what the authorization window has produced. */
const SPOTIFY_POLL_INTERVAL_MS = 700;

/**
 * How long to wait for the person in front of the screen.
 *
 * Generous, because this is someone reading a consent screen and possibly creating an account. It
 * still has to end: a wait that never returns leaves the caller awaiting forever with the window
 * open and no way back.
 */
const SPOTIFY_POLL_TIMEOUT_MS = 5 * 60_000;

/**
 * Waits for the authorization window to produce a code.
 *
 * The three things that can happen are kept apart on purpose. Declining is not a failure and
 * reports Spotify's own wording; a window closed without answering is a different thing and says
 * so; a timeout is named as one, because someone who walked away from a consent screen should not
 * be told their credentials are wrong.
 */
async function waitForSpotifyCode(): Promise<string> {
  const deadline = Date.now() + SPOTIFY_POLL_TIMEOUT_MS;

  for (;;) {
    const status = await desktop.spotifyAuthPoll();

    if (status.completed) {
      if (status.error) {
        throw new Error('Spotify: ' + status.error);
      }
      if (!status.code) {
        throw new Error('Spotify не вернул код авторизации');
      }
      return status.code;
    }

    // The window is gone and nothing was reported: closed rather than answered.
    if (status.closed) {
      throw new Error('Окно входа Spotify закрыто, авторизация не завершена');
    }

    if (Date.now() >= deadline) {
      throw new Error('Вход в Spotify не завершён за 5 минут');
    }

    await new Promise((resolve) => {
      window.setTimeout(resolve, SPOTIFY_POLL_INTERVAL_MS);
    });
  }
}

function toTrack(source: SpotifyTrack): Track {
  return {
    // Not a Spotify id: see serviceIdentity for why this is handed out rather than derived.
    id: identityFor('spotify', source.nativeId),
    nativeId: source.nativeId,
    source: 'spotify',
    urn: source.urn,
    title: source.title,
    permalink: source.permalink,
    artwork: source.artworkUrl,
    durationMs: source.durationMs,
    artist: { name: source.artists.map((artist) => artist.name).join(', ') },
  };
}

function toPlaylist(source: SpotifyPlaylist): Playlist {
  return {
    // Playlist ids are strings in the domain already, so the native id goes straight in.
    id: source.nativeId,
    urn: source.urn,
    title: source.title,
    permalink: source.permalink,
    artwork: source.artworkUrl,
    trackCount: source.trackCount,
    artist: source.artist,
  };
}

function toProfile(source: SpotifyAuthProfile): Profile {
  return {
    id: identityFor('spotify', source.id),
    service: 'spotify',
    username: source.displayName || source.email || source.id,
    fullName: source.displayName,
    avatarUrl: undefined,
  };
}

function toTracks(page: SpotifyTrackPage): Track[] {
  return page.tracks.map(toTrack);
}

/**
 * Spotify behind the ServiceAdapter interface.
 *
 * Every method that can page through results walks the whole thing. The interface returns a plain
 * array with no continuation, and the screens that exist today expect a whole list; returning only
 * the first page would show a library that looks truncated with no way to say so.
 *
 * The cost is that a large library is fetched in full on every load, and Spotify's nextHref is
 * dropped on the floor. That is a known gap, not a design: the fix belongs in the interface, which
 * needs to be able to hand a continuation to the screens that can follow one. Until then the paging
 * works — desktop.spotifyMyTracks takes a next href — and it is the adapter that throws it away.
 */
export const spotifyAdapter: ServiceAdapter = {
  service: 'spotify' as ServiceProvider,

  async authStatus(): Promise<AuthResult> {
    const status = await desktop.spotifyAuthStatus();
    return { authorized: status.authorized, profile: status.profile ? toProfile(status.profile) : null };
  },

  async authLogin(credentials?: ServiceCredentials): Promise<AuthResult> {
    const clientId = credentials?.clientId;
    const clientSecret = credentials?.clientSecret;
    if (!clientId || !clientSecret) {
      throw new Error('Для входа через Spotify нужны Client ID и Client Secret');
    }
    await desktop.spotifyAuthStart(clientId, SPOTIFY_REDIRECT_URI);
    const code = await waitForSpotifyCode();
    const status = await desktop.spotifyAuthExchange(code, clientId, clientSecret, SPOTIFY_REDIRECT_URI);

    // Only once the exchange has succeeded. Storing credentials that turned out to be wrong would
    // leave them sitting there being handed to every later refresh attempt.
    if (status.authorized) {
      saveCredentials('spotify', { clientId, clientSecret });
    }

    return { authorized: status.authorized, profile: status.profile ? toProfile(status.profile) : null };
  },

  async authLogout(): Promise<void> {
    await desktop.spotifyAuthLogout();
    // The stored client id and secret stay. They identify the app the user registered, not the
    // session that just ended, and the refresh below needs them — dropping them would mean signing
    // in again from scratch after every sign-out.
  },

  async authRefresh(): Promise<AuthResult> {
    // The client id and secret are the user's own app registration rather than part of the session,
    // which is why they are not in this signature and are read from the credential store instead —
    // authLogin puts them there after a successful exchange.
    const stored = loadCredentials('spotify');
    const clientId = stored?.clientId;
    const clientSecret = stored?.clientSecret;
    if (!clientId || !clientSecret) {
      throw new Error(
        'Нет сохранённых учётных данных Spotify: войдите заново, чтобы приложение запомнило Client ID и Client Secret',
      );
    }

    const status = await desktop.spotifyAuthRefresh(clientId, clientSecret);
    return { authorized: status.authorized, profile: status.profile ? toProfile(status.profile) : null };
  },

  async myTracks(): Promise<Track[]> {
    return toTracks(await desktop.spotifyMyTracks());
  },

  async myPlaylists(): Promise<Playlist[]> {
    const page = await desktop.spotifyMyPlaylists();
    return page.playlists.map(toPlaylist);
  },

  async playlistTracks(playlistId: string): Promise<Track[]> {
    return toTracks(await desktop.spotifyPlaylistTracks(playlistId));
  },

  async trackDetails(trackId: string): Promise<TrackDetails> {
    const track = toTrack(await desktop.spotifyTrackDetails(trackId));
    const details: TrackDetails = { ...track };
    // TrackDetails only widens Track with optional fields, and Spotify fills in none of them, so the
    // track itself is the whole answer. Saying that here beats an object spread that looks like it is
    // populating something.
    return details;
  },

  async trackStream(track: Track): Promise<AdapterTrackStream> {
    // Full playback needs the Web Playback SDK, which needs Premium. What the Web API gives without
    // it is the 30-second preview, and about a third of tracks have none at all.
    const details = await desktop.spotifyTrackDetails(track.nativeId ?? track.id.toString());
    if (!details.previewUrl) {
      throw new Error(
        'У этого трека нет превью. Полное воспроизведение Spotify доступно только с подпиской Premium.',
      );
    }
    return { url: details.previewUrl, preview: true, hls: false, quality: 'preview' };
  },

  async trackLyrics(track: Track): Promise<TrackLyrics> {
    // Spotify has no lyrics endpoint. Returning nothing is what a screen can render; throwing would
    // turn a missing feature into a visible error on every track.
    //
    // Worth knowing: the lyrics endpoint on the Go side is matched on title, artist and duration, so
    // it would find lyrics for a Spotify track unchanged. That is not wired up here because it
    // cannot be checked without a real Spotify track, and matching by title alone risks attaching the
    // wrong words to the right music.
    return { trackId: track.id, lines: [], isSynced: false };
  },

  async searchTracks(query: string): Promise<Track[]> {
    return toTracks(await desktop.spotifySearchTracks(query));
  },

  async relatedTracks(trackId: string): Promise<Track[]> {
    // Recommendations are Spotify's closest thing to related tracks, and they take the track as a
    // seed. Spotify refuses a request with no seed, which is why this cannot answer from nothing.
    const page = await desktop.spotifyRecommendations({ seedTrackIds: [trackId], limit: 20 });
    return toTracks(page);
  },

  async mixedSelections(): Promise<TrackCollection[]> {
    // Spotify has no equivalent of SoundCloud's mixed selections. An empty list leaves the section
    // empty rather than showing a broken one; the recommendations above are the substitute.
    return [];
  },

  async likeTrack(track: Track): Promise<LikeResult> {
    // Spotify calls this saving to the library. There is no captcha, hence no captchaUrl.
    const result = await desktop.spotifySaveTrack(track.nativeId ?? track.id.toString());
    return { liked: result.saved };
  },

  async unlikeTrack(track: Track): Promise<LikeResult> {
    const result = await desktop.spotifyUnsaveTrack(track.nativeId ?? track.id.toString());
    return { liked: result.saved };
  },

  // No artist, follower or history methods. The artist endpoints are a later phase, and history lives
  // in the sidecar keyed by SoundCloud ids, so offering it here would return entries that belong to
  // tracks from another service. Leaving them off is what makes the screens hide those sections
  // rather than render something wrong.
};
