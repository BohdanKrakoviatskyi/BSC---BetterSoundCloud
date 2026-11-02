import { rpc } from './sidecar';

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

export type SoundCloudAuthStatus = {
  authorized: boolean;
  profile?: SoundCloudProfile;
};


export type SoundCloudSearchTrack = {
  id: number;
  urn: string;
  title: string;
  permalinkUrl: string;
  artworkUrl: string;
  duration: number;
  user: {
    username: string;
    avatarUrl: string;
  };
};

export type SoundCloudTrackCard = {
  id: number;
  trackUrn: string;
  title: string;
  permalinkUrl?: string;
  artworkUrl?: string;
  duration: number;
  user: { username: string };
};

export type SoundCloudPlaylistCard = {
  id: string;
  urn: string;
  title: string;
  permalinkUrl: string;
  artworkUrl: string;
  trackCount: number;
  user: { username: string };
};

export type SoundCloudLyrics = {
  trackId: number;
  lines: { id: string; text: string; startMs: number }[];
  sourceUrl?: string;
  isSynced: boolean;
};


export type YouTubeAuthProfile = {
  id: string;
  email?: string;
  name?: string;
  picture?: string;
};

export type YouTubeAuthStatus = {
  authorized: boolean;
  profile?: YouTubeAuthProfile;
  expiresAt?: number;
};

export type YouTubeAuthExchangeParams = {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type YouTubeAuthCredentials = {
  clientId: string;
  clientSecret: string;
};

export type YouTubeTrack = {
  nativeId: string;
  source: string;
  urn: string;
  title: string;
  permalink?: string;
  artworkUrl?: string;
  durationMs: number;
  viewCount?: number;
  likeCount?: number;
  categoryId?: string;
  channelId?: string;
  subscriberCount?: number;
  artist: string;
  publishedAt?: string;
};

export type YouTubeTrackPage = {
  tracks: YouTubeTrack[];
  nextPageToken?: string;
  capped?: boolean;
};

export type YouTubeSearchParams = {
  query: string;
  pageToken?: string;
  limit?: number;
};

export function soundCloudAuthStatus(signal?: AbortSignal): Promise<SoundCloudAuthStatus> {
  return rpc('auth.status', {}, signal);
}

export function soundCloudSetClientId(clientId: string, signal?: AbortSignal): Promise<unknown> {
  return rpc('settings.update', { clientId }, signal);
}

export function soundCloudAuthLogin(token: string, signal?: AbortSignal): Promise<SoundCloudAuthStatus> {
  return rpc('auth.login', { token }, signal);
}

export function soundCloudAuthRefresh(signal?: AbortSignal): Promise<SoundCloudAuthStatus> {
  return rpc('auth.refresh', {}, signal);
}

export function soundCloudAuthLogout(signal?: AbortSignal): Promise<SoundCloudAuthStatus> {
  return rpc('auth.logout', {}, signal);
}

export function searchSoundCloudTracks(query: string, signal?: AbortSignal): Promise<SoundCloudSearchTrack[]> {
  return rpc('search.tracks', { query }, signal);
}

export function soundCloudRelatedTracks(trackId: number, signal?: AbortSignal): Promise<SoundCloudSearchTrack[]> {
  return rpc('track.related', { trackId }, signal);
}

export function soundCloudTracksMine(signal?: AbortSignal): Promise<SoundCloudTrackCard[]> {
  return rpc('tracks.mine', {}, signal);
}

export function soundCloudPlaylistsMine(signal?: AbortSignal): Promise<SoundCloudPlaylistCard[]> {
  return rpc('playlists.mine', {}, signal);
}

export function soundCloudPlaylistTracks(playlistUrn: string, signal?: AbortSignal): Promise<SoundCloudTrackCard[]> {
  return rpc('playlist.tracks', { playlistUrn }, signal);
}

export function soundCloudTrackLyrics(params: { trackId: number; title: string; artist: string; durationMs: number }, signal?: AbortSignal): Promise<SoundCloudLyrics> {
  return rpc('track.lyrics', params, signal);
}


export function youtubeAuthStatus(signal?: AbortSignal): Promise<YouTubeAuthStatus> {
  return rpc('youtube.auth.status', {}, signal);
}

export function youtubeAuthExchange(
  params: YouTubeAuthExchangeParams,
  signal?: AbortSignal,
): Promise<YouTubeAuthStatus> {
  return rpc('youtube.auth.exchange', params, signal);
}

export function youtubeAuthRefresh(
  credentials: YouTubeAuthCredentials,
  signal?: AbortSignal,
): Promise<YouTubeAuthStatus> {
  return rpc('youtube.auth.refresh', credentials, signal);
}

export function youtubeAuthLogout(signal?: AbortSignal): Promise<YouTubeAuthStatus> {
  return rpc('youtube.auth.logout', {}, signal);
}

export function searchYouTubeTracks(
  params: YouTubeSearchParams,
  signal?: AbortSignal,
): Promise<YouTubeTrackPage> {
  return rpc('youtube.search.tracks', params, signal);
}

export function searchYtDlpTracks(query: string, signal?: AbortSignal): Promise<YouTubeTrack[]> {
  return rpc('yt.dlp.search', { query }, signal);
}

export function ytDlpTrackStream(videoId: string): Promise<{ url: string }> {
  return rpc('yt.dlp.stream', { videoId });
}
