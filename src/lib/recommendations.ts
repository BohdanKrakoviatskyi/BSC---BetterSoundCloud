type RecommendationTrack = {
  id: string;
  title: string;
  artist: string;
  duration?: number;
};

const normalize = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const words = (value: string) => new Set(normalize(value).split(/\s+/).filter((word) => word.length > 1));

function similarity(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return shared / Math.max(a.size, b.size);
}

export function rankRecommendations<T extends RecommendationTrack>(
  seed: RecommendationTrack,
  candidates: T[],
  queued: ReadonlySet<string> = new Set(),
  disliked: ReadonlySet<string> = new Set(),
): T[] {
  const seedTitle = normalize(seed.title);
  const seedArtist = words(seed.artist);
  const seedTitleWords = words(seed.title);
  return candidates
    .filter((candidate) => candidate.id !== seed.id && !queued.has(candidate.id) && !disliked.has(candidate.id))
    .filter((candidate) => normalize(candidate.title) !== seedTitle)
    .map((candidate, index) => ({
      candidate,
      index,
      artistScore: similarity(seedArtist, words(candidate.artist)),
      titleScore: similarity(seedTitleWords, words(candidate.title)),
      durationScore: seed.duration && candidate.duration
        ? 1 - Math.min(Math.abs(seed.duration - candidate.duration) / Math.max(seed.duration, candidate.duration), 1)
        : 0,
    }))
    .filter(({ artistScore }) => artistScore >= 0.5)
    .sort((a, b) => b.titleScore - a.titleScore || b.artistScore - a.artistScore || b.durationScore - a.durationScore || a.index - b.index)
    .map(({ candidate }) => candidate);
}
