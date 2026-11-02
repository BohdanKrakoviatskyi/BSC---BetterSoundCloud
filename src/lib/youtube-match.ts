type FallbackTrack = { title: string; artist: string; duration: number };
type YouTubeCandidate = { title: string; artist: string; durationMs: number };

const normalize = (value: string) => value.toLocaleLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function titleTokens(value: string) {
  const core = value
    .replace(/\s*[\[(]\s*(?:feat(?:uring)?|ft)\.?\s*[^)\]]*[)\]]/gi, ' ')
    .replace(/\s*\b(?:feat(?:uring)?|ft)\.?\s+.*$/i, ' ')
    .replace(/\s*[\[(](?:official\b|lyrics?\b|audio\b|music video\b|visuali[sz]er\b|4k\b|hd\b)[^\])]*[\])]/gi, ' ')
    .replace(/\s*[-–—|]\s*(?:official\b|lyrics\b|audio\b|music video\b|visuali[sz]er\b).*$/i, ' ');
  return new Set(normalize(core).split(/\s+/).filter((token) => token.length > 1));
}

function coverage(target: Set<string>, candidate: Set<string>) {
  if (!target.size) return 0;
  let shared = 0;
  for (const token of target) if (candidate.has(token)) shared++;
  return shared / target.size;
}

function featuredArtist(value: string) {
  return value.replace(/\s*[\[(]\s*(?:feat(?:uring)?|ft)\.?\s*[^)\]]*[)\]]/gi, ' ')
    .replace(/\s*\b(?:feat(?:uring)?|ft)\.?\s+.*$/i, ' ').trim();
}

export function youtubeFallbackQueries(track: FallbackTrack) {
  const title = featuredArtist(track.title);
  const artist = featuredArtist(track.artist);
  return [...new Set([`${title} ${artist}`.trim(), title].filter(Boolean))];
}

export function findYouTubeFallbackCandidate<T extends YouTubeCandidate>(track: FallbackTrack, candidates: T[]): T | null {
  const targetTitle = titleTokens(track.title);
  const targetArtist = new Set(normalize(featuredArtist(track.artist)).split(/\s+/).filter((token) => token.length > 1));
  return candidates
    .map((candidate, index) => {
      const titleScore = coverage(targetTitle, titleTokens(candidate.title));
      const artistScore = coverage(targetArtist, new Set(normalize(candidate.artist).split(/\s+/).filter((token) => token.length > 1)));
      const durationScore = track.duration > 0 && candidate.durationMs > 0
        ? 1 - Math.min(Math.abs(track.duration - candidate.durationMs / 1000) / Math.max(track.duration, candidate.durationMs / 1000), 1)
        : 0;
      return { candidate, index, titleScore, artistScore, durationScore };
    })
    .filter(({ titleScore }) => titleScore >= 0.75)
    .sort((a, b) => b.titleScore - a.titleScore || b.durationScore - a.durationScore || b.artistScore - a.artistScore || a.index - b.index)[0]?.candidate ?? null;
}
