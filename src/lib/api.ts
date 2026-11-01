import type { LyricLine, Track } from '../types';

const APP = 'lyra_m3_player';
const AU = 'https://api.audius.co/v1';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

async function getJson(url: string, signal?: AbortSignal): Promise<Json> {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

function mapAudius(x: Json): Track | null {
  if (!x || x.is_streamable === false || x.stream_conditions || x.is_stream_gated) return null;
  const art = x.artwork || {};
  return {
    id: 'au:' + x.id,
    title: String(x.title ?? '').trim(),
    artist: x.user?.name ?? 'Unknown',
    album: x.genre || undefined,
    cover: art['480x480'] || art['1000x1000'] || art['150x150'],
    thumb: art['150x150'] || art['480x480'],
    src: `${AU}/tracks/${x.id}/stream?app_name=${APP}`,
    duration: x.duration || 0,
    source: 'audius',
  };
}

const notNull = <T,>(v: T | null): v is T => v !== null;

export async function audiusTrending(signal?: AbortSignal) {
  const j = await getJson(`${AU}/tracks/trending?app_name=${APP}&time=week&limit=24`, signal);
  return ((j.data ?? []) as Json[]).map(mapAudius).filter(notNull);
}

export async function audiusSearch(q: string, signal?: AbortSignal) {
  const j = await getJson(`${AU}/tracks/search?query=${encodeURIComponent(q)}&app_name=${APP}&limit=20`, signal);
  return ((j.data ?? []) as Json[]).map(mapAudius).filter(notNull);
}

export async function itunesSearch(q: string, signal?: AbortSignal): Promise<Track[]> {
  const j = await getJson(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=song&limit=25`, signal);
  return ((j.results ?? []) as Json[])
    .filter((x) => x.previewUrl && x.trackId)
    .map((x) => ({
      id: 'it:' + x.trackId,
      title: x.trackName,
      artist: x.artistName,
      album: x.collectionName,
      cover: String(x.artworkUrl100 ?? '').replace('100x100bb', '600x600bb') || undefined,
      thumb: String(x.artworkUrl100 ?? '').replace('100x100bb', '160x160bb') || undefined,
      src: x.previewUrl,
      duration: 30,
      fullDuration: x.trackTimeMillis ? x.trackTimeMillis / 1000 : undefined,
      source: 'itunes' as const,
    }));
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
    p = fetchLyrics(t).catch(() => null);
    lyricsCache.set(t.id, p);
  }
  return p;
}

const cleanTitle = (s: string) => s.replace(/\s*[([].*?[)\]]\s*/g, ' ').replace(/\s+-\s+.*$/, '').trim();
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

async function fetchLyrics(t: Track): Promise<LyricsData | null> {
  const title = cleanTitle(t.title);
  const artist = t.artist.split(/,|&| feat\.? | ft\.? | x | и /i)[0].trim();
  const dur = t.fullDuration ?? t.duration;
  const base = 'https://lrclib.net/api';
  let rec: Json | null = null;
  if (t.source === 'itunes') {
    const p = new URLSearchParams({ track_name: title, artist_name: artist });
    if (t.album) p.set('album_name', t.album);
    if (dur) p.set('duration', String(Math.round(dur)));
    try {
      rec = await getJson(`${base}/get?${p}`);
    } catch {
      rec = null;
    }
  }
  if (!rec) {
    const arr = (await getJson(`${base}/search?${new URLSearchParams({ track_name: title, artist_name: artist })}`)) as unknown as Json[];
    const strict = t.source !== 'itunes';
    rec =
      (Array.isArray(arr) ? arr : [])
        .filter((x) => (x.syncedLyrics || x.plainLyrics || x.instrumental) && (!dur || Math.abs((x.duration ?? 0) - dur) < (strict ? 4 : 8)))
        .filter((x) => !strict || norm(x.artistName ?? '') === norm(artist))
        .sort((a, b) => Math.abs(a.duration - dur) - Math.abs(b.duration - dur))[0] ?? null;
  }
  if (!rec) return null;
  if (rec.instrumental) return { instrumental: true };
  const preview = t.source === 'itunes';
  if (rec.syncedLyrics && !preview) {
    const synced = withGaps(parseLrc(rec.syncedLyrics));
    if (synced.length) return { synced };
  }
  const plainSrc: string = rec.plainLyrics || (rec.syncedLyrics ? String(rec.syncedLyrics).replace(/\[[^\]]*\]/g, '') : '');
  const plain = plainSrc.split('\n').map((s) => s.trim());
  return plain.some(Boolean) ? { plain, preview } : null;
}
