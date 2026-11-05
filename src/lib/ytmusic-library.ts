import type { Track } from '../types';

export type YtMusicTrack = {
  videoId: string;
  title: string;
  artist?: string;
  artists?: string[];
  artworkUrl?: string | null;
  durationSeconds?: number | null;
  available?: boolean;
};

export type YtMusicPlaylist = {
  playlistId: string;
  title: string;
  artworkUrl?: string | null;
  trackCount: number;
  tracks?: YtMusicTrack[];
};

export type YtMusicProfile = { name?: string; handle?: string; picture?: string };
export type YtMusicLibrary = {
  profile: YtMusicProfile;
  playlists: YtMusicPlaylist[];
  likedSongs: YtMusicTrack[];
  savedSongs: YtMusicTrack[];
};

export function mapYtMusicTrack(track: YtMusicTrack): Track {
  const videoId = String(track.videoId || '').trim();
  const artist = track.artist || track.artists?.filter(Boolean).join(', ') || 'YouTube Music';
  const duration = Number(track.durationSeconds) || 0;
  const artwork = track.artworkUrl || undefined;
  return {
    id: `yt:${videoId}`,
    title: track.title || 'Unknown title',
    artist,
    cover: artwork,
    thumb: artwork,
    src: `https://music.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    duration,
    fullDuration: duration || undefined,
    nativeId: videoId,
    playback: 'direct',
    source: 'youtube',
  };
}

export function mapYtMusicTracks(tracks: YtMusicTrack[]): Track[] {
  const seen = new Set<string>();
  return tracks.flatMap((track) => {
    const id = String(track.videoId || '').trim();
    if (!id || seen.has(id)) return [];
    seen.add(id);
    return [mapYtMusicTrack(track)];
  });
}

export const YTMUSIC_LIKED_ID = 'ytliked';
export const YTMUSIC_SAVED_ID = 'ytsaved';

export const ytmusicPlaylistId = (playlistId: string) => `ytpl:${playlistId}`;

export type YtMusicCollection =
  | { kind: 'playlist'; playlistId: string }
  | { kind: 'liked' | 'saved' };

export function parseYtMusicCollectionId(id?: string): YtMusicCollection | null {
  if (id === YTMUSIC_LIKED_ID) return { kind: 'liked' };
  if (id === YTMUSIC_SAVED_ID) return { kind: 'saved' };
  if (id?.startsWith('ytpl:') && id.length > 5) return { kind: 'playlist', playlistId: id.slice(5) };
  return null;
}
