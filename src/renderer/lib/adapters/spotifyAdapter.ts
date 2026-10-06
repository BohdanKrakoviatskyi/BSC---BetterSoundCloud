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
import { identityFor } from '../serviceIdentity';

const SPOTIFY_REDIRECT_URI = 'http://localhost:8888/callback';

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
    // desktop.spotifyAuthExchange(code, ...) takes these and trades an authorization code for
    // tokens. The code comes from the OAuth window, which is step 1.2 and is not here yet.
    // The authorization code comes from the OAuth window, which step 1.2 adds. Until that exists
    // there is nothing to exchange, and saying so plainly beats a confusing failure from Spotify.
    throw new Error('Окно авторизации Spotify ещё не подключено: код доступа не получен');
  },

  async authLogout(): Promise<void> {
    await desktop.spotifyAuthLogout();
  },

  async authRefresh(): Promise<AuthResult> {
    // The client id and secret are the user's own app credentials, not part of the session, so they
    // are not held here. Without them a refresh cannot be performed and that is worth saying.
    throw new Error('Обновление токена Spotify требует Client ID и Client Secret');
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
