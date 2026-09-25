export type BackendSettings = { accent: string; compact: boolean; volume: number; clientId: string };
export type AppInfo = { name: string; version: string; backend: string };
export type SoundCloudProfile = {
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
export type AuthStatus = { authorized: boolean; profile?: SoundCloudProfile };
export type TrackLikeResult = { liked: boolean; captchaUrl?: string };
export type TrackStreamOption = { url: string; preview: boolean; hls: boolean; quality: string };
export type TrackStream = TrackStreamOption & { alternatives?: TrackStreamOption[] };
export type SoundCloudTrack = {
  id: number;
  trackUrn: string;
  title: string;
  permalinkUrl?: string;
  artworkUrl?: string;
  duration: number;
  playbackCount?: number;
  likesCount?: number;
  user: { username: string };
};
export type SoundCloudTrackDetails = SoundCloudTrack & {
  description?: string;
  genre?: string;
  tagList?: string;
  createdAt?: string;
  displayDate?: string;
  repostsCount?: number;
  commentCount?: number;
  waveformUrl?: string;
  user: SoundCloudTrack['user'] & {
    avatarUrl?: string;
    permalinkUrl?: string;
    followersCount?: number;
  };
};
export type SoundCloudSearchTrack = SoundCloudTrack;
export type SoundCloudMixedSelection = { id: string; title: string; description?: string; tracks: SoundCloudSearchTrack[] };
export type SoundCloudPlaylist = { id: string; urn?: string; title: string; permalinkUrl?: string; artworkUrl?: string; trackCount: number; user: { username: string } };
