import type { LyricLine, Track } from '../types';
import { findLyricsCandidate, lyricsSearchQueries } from './lyrics-match';
import { rpc } from './sidecar';

import {
  searchSoundCloudTracks,
  soundCloudTrackLyrics,
  soundCloudRelatedTracks,
  searchSpotifyTracks,
  type SoundCloudTrackCard,
  type SoundCloudSearchTrack,
  searchYtDlpTracks,
  ytDlpTrackStream,
  spotifyAuthStatus,
} from './providers-api';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

async function getJson(url: string): Promise<Json> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}

type SoundCloudTrackLike = Pick<SoundCloudTrackCard, 'id' | 'trackUrn' | 'title' | 'permalinkUrl' | 'artworkUrl' | 'duration' | 'user'> | Pick<SoundCloudSearchTrack, 'id' | 'urn' | 'title' | 'permalinkUrl' | 'artworkUrl' | 'duration' | 'user'>;

export function mapSoundCloudTrack(track: SoundCloudTrackLike): Track {
  const duration = track.duration / 1000;
  const nativeId = ('trackUrn' in track ? track.trackUrn : track.urn) || `soundcloud:tracks:${track.id}`;
  return {
    id: `sc:${track.id}`, title: track.title, artist: track.user?.username || 'SoundCloud',
    cover: track.artworkUrl || undefined, thumb: track.artworkUrl || undefined,
    src: track.permalinkUrl || '', duration, fullDuration: duration || undefined,
    nativeId, source: 'soundcloud',
  };
}

export async function searchTracks(query: string, signal?: AbortSignal): Promise<Track[]> {
  const results = await Promise.allSettled([
    searchSoundCloudTracks(query, signal),
    spotifyAuthStatus(signal).then((status) => status.authorized ? searchSpotifyTracks({ query, limit: 20 }, signal) : null),
    searchYtDlpTracks(query, signal),
  ]);
  const [soundcloud, spotify, youtube] = results;
  const tracks: Track[] = [];
  if (soundcloud.status === 'fulfilled') tracks.push(...soundcloud.value.map(mapSoundCloudTrack));
  if (spotify.status === 'fulfilled' && spotify.value) {
    for (const track of spotify.value.tracks) {
      const duration = track.durationMs / 1000;
      const cover = track.album.images.slice().sort((a, b) => b.width - a.width)[0]?.url;
      tracks.push({
        id: `sp:${track.nativeId}`, title: track.title, artist: track.artists.map((artist) => artist.name).join(', '),
        album: track.album.name, cover, thumb: cover, src: track.previewUrl || track.permalink || '',
        duration, fullDuration: duration || undefined, nativeId: track.nativeId, preview: Boolean(track.previewUrl), source: 'spotify',
      });
    }
  }
  if (youtube.status === 'fulfilled') {
    for (const track of youtube.value) {
      const duration = track.durationMs / 1000;
      tracks.push({
        id: `yt:${track.nativeId}`, title: track.title, artist: track.artist,
        cover: track.artworkUrl || undefined, thumb: track.artworkUrl || undefined,
        src: track.permalink || `https://music.youtube.com/watch?v=${encodeURIComponent(track.nativeId)}`,
        duration, fullDuration: duration || undefined, nativeId: track.nativeId, playback: 'direct', source: 'youtube',
      });
    }
  }
  if (tracks.length) return tracks;
  const firstError = results.find((result) => result.status === 'rejected');
  if (firstError?.status === 'rejected') throw firstError.reason;
  return [];
}


export async function trackStream(trackUrn: string): Promise<{ url: string; hls: boolean; preview: boolean }> {
  const result = await rpc<{ url: string; hls?: boolean; preview?: boolean }>('track.stream', { trackUrn });
  if (!result?.url) throw new Error('SoundCloud did not return an audio stream.');
  return { url: result.url, hls: Boolean(result.hls), preview: Boolean(result.preview) };
}

export async function relatedSoundCloudTracks(trackId: number): Promise<Track[]> {
  return (await soundCloudRelatedTracks(trackId)).map(mapSoundCloudTrack);
}

export { ytDlpTrackStream };

const normalizeMatch = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export async function findYouTubeFallback(track: Track): Promise<Track | null> {
  const results = await searchYtDlpTracks(`${track.title} ${track.artist}`);
  const targetTitle = normalizeMatch(track.title);
  const targetArtist = normalizeMatch(track.artist);
  const match = results
    .map((candidate) => {
      const title = normalizeMatch(candidate.title);
      const artist = normalizeMatch(candidate.artist);
      const titleMatch = title === targetTitle || title.includes(targetTitle) || targetTitle.includes(title);
      const artistMatch = !targetArtist || artist.includes(targetArtist) || targetArtist.includes(artist);
      return { candidate, score: (titleMatch ? 2 : 0) + (artistMatch ? 1 : 0) };
    })
    .filter(({ score }) => score >= 2)
    .sort((a, b) => b.score - a.score)[0]?.candidate;
  if (!match) return null;
  const duration = match.durationMs / 1000;
  return {
    id: `yt:${match.nativeId}`, title: match.title, artist: match.artist,
    cover: match.artworkUrl || undefined, thumb: match.artworkUrl || undefined,
    src: match.permalink || `https://music.youtube.com/watch?v=${encodeURIComponent(match.nativeId)}`,
    duration, fullDuration: duration || undefined, nativeId: match.nativeId, playback: 'direct', source: 'youtube',
  };
}

/* ---------------- lyrics ---------------- */

export function parseLrc(s: string): LyricLine[] {
  const out: LyricLine[] = [];
  for (const line of s.split('\n')) {
    const stamps = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) continue;
    const text = line.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of stamps) out.push({ t: +m[1] * 60 + +m[2], text });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Inserts "• • •" breathing lines for intros and long instrumental breaks. */
export function withGaps(lines: LyricLine[]): LyricLine[] {
  const out: LyricLine[] = [];
  const src = lines.filter((l, i) => l.text || (lines[i + 1] && lines[i + 1].t - l.t > 6));
  if (src.length && src[0].t > 5) out.push({ t: 0, text: '', gap: true });
  src.forEach((l, i) => {
    if (!l.text) {
      out.push({ t: l.t, text: '', gap: true });
      return;
    }
    out.push(l);
    const nx = src[i + 1];
    if (nx && nx.text && nx.t - l.t > 14) out.push({ t: l.t + 6.5, text: '', gap: true });
  });
  return out;
}

export interface LyricsData {
  synced?: LyricLine[];
  plain?: string[];
  instrumental?: boolean;
  preview?: boolean;
}

const lyricsCache = new Map<string, Promise<LyricsData | null>>();

export function getLyrics(t: Track): Promise<LyricsData | null> {
  if (t.lyrics) return Promise.resolve({ synced: t.lyrics });
  let p = lyricsCache.get(t.id);
  if (!p) {
    p = (t.source === 'soundcloud' ? fetchSoundCloudLyrics(t) : fetchLyrics(t)).catch(() => null);
    lyricsCache.set(t.id, p);
  }
  return p;
}

async function fetchSoundCloudLyrics(track: Track): Promise<LyricsData | null> {
  const match = track.nativeId?.match(/(\d+)$/);
  const trackId = Number(match?.[1]);
  if (!trackId) return fetchLyrics(track);
  const result = await soundCloudTrackLyrics({
    trackId,
    title: track.title,
    artist: track.artist,
    durationMs: Math.round((track.fullDuration ?? track.duration) * 1000),
  });
  if (result.isSynced && result.lines.length) {
    const synced = withGaps(result.lines.map((line) => ({ t: line.startMs / 1000, text: line.text })));
    if (synced.length) return { synced };
  }
  const plain = result.lines.map((line) => line.text.trim()).filter(Boolean);
  if (plain.length) return { plain };
  return fetchLyrics(track);
}

async function fetchLyrics(t: Track): Promise<LyricsData | null> {
  const duration = t.fullDuration ?? t.duration;
  const tolerance = t.source === 'youtube' ? 30 : 4;
  const queries = lyricsSearchQueries(t);
  let rec: Json | null = null;
  for (const query of queries) {
    const params = new URLSearchParams({ track_name: query.title, artist_name: query.artist });
    const results = await getJson(`https://lrclib.net/api/search?${params}`);
    rec = findLyricsCandidate(Array.isArray(results) ? results : [], query, duration, tolerance);
    if (rec) break;
  }
  if (!rec) return null;
  if (rec.instrumental) return { instrumental: true };
  const preview = false;
  if (rec.syncedLyrics) {
    const synced = withGaps(parseLrc(rec.syncedLyrics));
    if (synced.length) return { synced };
  }
  const plainSrc: string = rec.plainLyrics || (rec.syncedLyrics ? String(rec.syncedLyrics).replace(/\[[^\]]*\]/g, '') : '');
  const plain = plainSrc.split('\n').map((s) => s.trim());
  return plain.some(Boolean) ? { plain, preview } : null;
}
