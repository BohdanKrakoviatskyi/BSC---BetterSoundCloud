export type Settings = { accent: string; compact: boolean; volume: number; clientId: string; backgroundImage: string; backgroundBlur: number };
export type Profile = {
  id: number;
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
  id: number;
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
  verified?: boolean;
};

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
