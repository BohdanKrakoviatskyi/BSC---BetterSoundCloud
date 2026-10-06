export type Settings = { accent: string; volume: number; clientId: string; backgroundImage: string; backgroundBlur: number };

/**
 * Which music service something belongs to.
 *
 * SoundCloud is assumed wherever this is absent, so every track, profile and account that already
 * exists keeps its meaning without being touched. That is what lets the multi-service work stay
 * additive instead of becoming a rewrite.
 */
export type ServiceProvider = 'soundcloud' | 'spotify' | 'youtube-music';

export const SERVICE_PROVIDERS: readonly ServiceProvider[] = ['soundcloud', 'spotify', 'youtube-music'];

export const DEFAULT_SERVICE: ServiceProvider = 'soundcloud';

export function isServiceProvider(value: unknown): value is ServiceProvider {
  return typeof value === 'string' && (SERVICE_PROVIDERS as readonly string[]).includes(value);
}

/**
 * What a service needs to restore a session.
 *
 * This holds access and refresh tokens, so it is a secret: it belongs in the sidecar's 0600 file
 * next to the SoundCloud token, not in the webview. See credentialStore.
 */
export type ServiceCredentials = {
  service: ServiceProvider;
  token?: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  /** Unix milliseconds. */
  expiresAt?: number;
  email?: string;
};

export type ServiceAccount = {
  service: ServiceProvider;
  profile: Profile | null;
  isLoggedIn: boolean;
  /** Only present while that service is connected. */
  credentials?: ServiceCredentials;
};
export type Profile = {
  id: number;
  /** Absent means SoundCloud. */
  service?: ServiceProvider;
  username: string;
  fullName?: string;
  permalinkUrl?: string;
  avatarUrl?: string;
  city?: string;
  country?: string;
  followersCount?: number;
  trackCount?: number;
  likesCount?: number;
};

export type Track = {
  /**
   * Numeric because every SoundCloud id is, and plenty of code compares it directly: queue and
   * like lookups, `currentTrack?.id === track.id`, React keys.
   *
   * It cannot hold a Spotify or YouTube id, and must not be made to by hashing. A hash can collide,
   * and a collision would mark the wrong track as liked and play the wrong queue entry. Tracks from
   * another service carry their real id in nativeId and are matched on service + nativeId.
   */
  id: number;
  /** The id in the service's own namespace, for anything that is not SoundCloud. */
  nativeId?: string;
  /** Absent means SoundCloud. */
  source?: ServiceProvider;
  urn: string;
  title: string;
  permalink?: string;
  artwork?: string;
  durationMs: number;
  playCount?: number;
  likeCount?: number;
  artist: { name: string };
};

export type TrackDetails = Track & {
  description?: string;
  genre?: string;
  tags?: string;
  createdAt?: string;
  displayDate?: string;
  repostCount?: number;
  commentCount?: number;
  waveform?: string;
  artist: Track['artist'] & {
    id?: number;
    avatar?: string;
    permalink?: string;
    followerCount?: number;
  };
};

/** A single lyrics line with its position inside the track, so the UI can highlight what is being sung. */
export type LyricsLine = {
  id: string;
  text: string;
  startMs: number;
};

export type TrackLyrics = {
  trackId: number;
  lines: LyricsLine[];
  sourceUrl?: string;
  isSynced?: boolean;
  logs?: string[];
  /**
   * Marks lyrics that are not the real words of the track. The demo provider sets it, and the UI
   * labels the panel so placeholder text is never mistaken for the actual song.
   */
  isDemo?: boolean;
};

export type ArtistProfile = {
  id: number;
  username: string;
  fullName?: string;
  permalink?: string;
  avatar?: string;
  banner?: string;
  description?: string;
  city?: string;
  country?: string;
  followersCount?: number;
  followingsCount?: number;
  trackCount?: number;
  likesCount?: number;
  verified?: boolean;
};

export type SocialUser = {
  id: number;
  username: string;
  fullName?: string;
  permalink?: string;
  avatar?: string;
  followersCount?: number;
  followingsCount?: number;
  trackCount?: number;
};

export type SocialPage = { users: SocialUser[]; next?: string };

export type TrackCollection = {
  id: string;
  title: string;
  description?: string;
  tracks: Track[];
  playlists?: Playlist[];
  madeForYou?: boolean;
};

export type Playlist = {
  id: string;
  urn?: string;
  title: string;
  permalink?: string;
  artwork?: string;
  trackCount: number;
  artist: string;
};
