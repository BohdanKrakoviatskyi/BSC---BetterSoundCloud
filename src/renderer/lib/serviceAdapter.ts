import type { ServiceProvider } from '../domain/models';
import type {
  ArtistProfile,
  Playlist,
  Profile,
  ServiceCredentials,
  SocialPage,
  SocialUser,
  Track,
  TrackCollection,
  TrackDetails,
  TrackLyrics,
} from '../domain/models';

/**
 * A playable stream.
 *
 * Re-declared here rather than imported from lib/desktop, because an adapter is a domain concern and
 * should not depend on the RPC transport underneath it. The shape matches TrackStreamOption in
 * desktop.ts exactly; desktop.ts still exports its own copy, and Phase 1 should collapse the two.
 */
export type AdapterTrackStream = {
  url: string;
  preview: boolean;
  hls: boolean;
  quality: string;
  alternatives?: AdapterTrackStreamOption[];
};

export type AdapterTrackStreamOption = Omit<AdapterTrackStream, 'alternatives'>;

export type AuthResult = { authorized: boolean; profile?: Profile | null };

/**
 * Outcome of a like, matching what SoundCloud actually returns.
 *
 * captchaUrl is part of the contract, not an extra: the app shows a captcha prompt when it appears,
 * and a result type that dropped it would silently break that flow.
 */
export type LikeResult = { liked: boolean; captchaUrl?: string };

/**
 * What every music service has to provide.
 *
 * Only the members a service can actually do are optional. `authStatus`, `authLogin`, `authLogout`,
 * `myTracks`, `myPlaylists`, `playlistTracks`, `trackDetails`, `trackStream`, `searchTracks`,
 * `relatedTracks` and `mixedSelections` are required, because the interface the app is written
 * against assumes they exist and the screens have no fallback.
 *
 * IDs are `string` here, not the `number` the SoundCloud domain uses. Spotify and YouTube ids are
 * opaque strings and must not be squeezed into a number or hashed into one.
 */
export interface ServiceAdapter {
  readonly service: ServiceProvider;

  // ---- auth
  authStatus(): Promise<AuthResult>;
  authLogin(credentials?: ServiceCredentials): Promise<AuthResult>;
  authLogout(): Promise<void>;
  authRefresh?(): Promise<AuthResult>;

  // ---- library
  myTracks(): Promise<Track[]>;
  myPlaylists(): Promise<Playlist[]>;
  playlistTracks(playlistId: string): Promise<Track[]>;

  // ---- track
  trackDetails(trackId: string): Promise<TrackDetails>;
  /** Takes the track, not an id: SoundCloud resolves a stream from the URN. */
  trackStream(track: Track): Promise<AdapterTrackStream>;
  trackLyrics(track: Track): Promise<TrackLyrics>;

  // ---- discovery
  searchTracks(query: string): Promise<Track[]>;
  relatedTracks(trackId: string): Promise<Track[]>;
  mixedSelections(): Promise<TrackCollection[]>;

  // ---- social. Not every service has artists or followers.
  artistProfile?(userId: string): Promise<ArtistProfile>;
  artistTracks?(userId: string): Promise<Track[]>;
  artistLikes?(userId: string, next?: string): Promise<{ tracks: Track[]; next?: string }>;
  artistPlaylists?(userId: string): Promise<Playlist[]>;
  artistFollowers?(userId: string, next?: string): Promise<SocialPage>;
  artistFollowings?(userId: string, next?: string): Promise<SocialPage>;

  // ---- likes. Spotify calls this save/unsave; YouTube Music has no equivalent.
  //
  // The track, not an id: SoundCloud needs the URN, and a service that only has a native id reads
  // track.nativeId instead.
  likeTrack?(track: Track): Promise<LikeResult>;
  unlikeTrack?(track: Track): Promise<LikeResult>;

  // ---- history. Managed locally, but a service may keep its own too.
  historyList?(): Promise<Track[]>;
  historyRecord?(track: Track): Promise<Track[]>;
  historyClear?(): Promise<Track[]>;
}

export type { SocialUser };
