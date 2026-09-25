export type Settings = { accent: string; compact: boolean; volume: number; clientId: string };
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
    avatar?: string;
    permalink?: string;
    followerCount?: number;
  };
};

export type TrackCollection = {
  id: string;
  title: string;
  description?: string;
  tracks: Track[];
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
