import type { Track } from '../types';

const normalize = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const firstArtist = (value: string) => value.split(/,|&| feat\.? | ft\.? | x | и /i)[0].trim();

function stripVideoLabels(value: string) {
  return value
    .replace(/\s*[[(](?:official\b|lyrics?\b|audio\b|music video\b|visuali[sz]er\b|4k\b|hd\b|mv\b)[^\])]*[\])]/gi, ' ')
    .replace(/\s*(?:[-–—|])\s*(?:official\b|lyrics?\b|audio\b|music video\b|visuali[sz]er\b).*$/i, '')
    .trim();
}

export function lyricsSearchQueries(track: Pick<Track, 'title' | 'artist' | 'source'>) {
  const title = stripVideoLabels(track.title);
  const artist = firstArtist(track.artist);
  const queries: { title: string; artist: string }[] = [];
  const add = (nextTitle: string, nextArtist: string) => {
    const clean = { title: nextTitle.trim(), artist: firstArtist(nextArtist) };
    if (clean.title && clean.artist && !queries.some((query) => normalize(query.title) === normalize(clean.title) && normalize(query.artist) === normalize(clean.artist))) {
      queries.push(clean);
    }
  };

  if (track.source === 'youtube') {
    const parts = title.match(/^(.+?)\s+[–—-]\s+(.+)$/);
    if (parts) {
      const left = parts[1].trim();
      const right = parts[2].trim();
      if (normalize(right) === normalize(artist)) add(left, right);
      else add(right, left);
    }
  }
  add(title, artist);
  if (title !== track.title) add(track.title, artist);
  return queries;
}

export type LyricsCandidate = {
  trackName?: string;
  artistName?: string;
  duration?: number;
  syncedLyrics?: string;
  plainLyrics?: string;
  instrumental?: boolean;
};

export function findLyricsCandidate<T extends LyricsCandidate>(
  candidates: T[],
  query: { title: string; artist: string },
  duration: number,
  tolerance: number,
): T | null {
  return candidates
    .filter((candidate) => (candidate.syncedLyrics || candidate.plainLyrics || candidate.instrumental)
      && (!duration || Math.abs((candidate.duration ?? 0) - duration) < tolerance))
    .filter((candidate) => {
      const resultTitle = normalize(candidate.trackName ?? '');
      const queryTitle = normalize(query.title);
      const resultArtist = normalize(candidate.artistName ?? '');
      const queryArtist = normalize(query.artist);
      return (resultTitle === queryTitle || resultTitle.includes(queryTitle) || queryTitle.includes(resultTitle))
        && resultArtist === queryArtist;
    })
    .sort((a, b) => Math.abs((a.duration ?? 0) - duration) - Math.abs((b.duration ?? 0) - duration))[0] ?? null;
}
