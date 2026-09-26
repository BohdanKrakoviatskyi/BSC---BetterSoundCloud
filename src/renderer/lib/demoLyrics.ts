import type { Track, TrackLyrics } from '../domain/models';

/**
 * DEMO lyrics provider.
 *
 * The app has no lyrics backend yet, so the sidebar is wired to a deterministic placeholder so the
 * panel, the active-line highlight and the shared-element artwork animation can be built and tuned
 * against real data flow. The lines are generated from the track id, so the same track always shows
 * the same text and the timings stay stable while stepping through the UI.
 *
 * Replacing this file with a real provider means adding a `track.lyrics` RPC in the Go sidecar, a
 * `trackLyrics` call in `desktop.ts` and mapping the DTO in `appGateway.trackLyrics`. Nothing in the
 * UI layer has to change, because the component only ever sees the `TrackLyrics` domain model.
 */

const DEMO_SOURCE_LINES = [
  'City lights are bleeding slow',
  'I keep every word you throw',
  'Counting cars on a broken road',
  'Holding on to what we coded',
  'Nothing here was built to last',
  'We were never built to last',
  'Say it back to me again',
  'Like the night will let us stay',
  'Every echo in the rain',
  'Sounds a little like my name',
  'Turn the volume up to ten',
  'I would do it all again',
];

// Keeps the demo readable next to the real track title instead of looking like random noise.
const DEMO_LINES_PER_TRACK = 9;

function createRandom(seed: number): () => number {
  let state = (seed * 2654435761) % 4294967296;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function durationMsFor(track: Pick<Track, 'durationMs'>): number {
  return Math.max(track.durationMs, 45_000);
}

export function createDemoTrackLyrics(track: Track): TrackLyrics {
  const random = createRandom(track.id || 1);
  const totalMs = durationMsFor(track);
  const lineCount = Math.max(4, Math.min(DEMO_LINES_PER_TRACK, Math.floor(totalMs / 12_000)));
  // Leave a short instrumental intro so the first line does not start at 0:00.
  const introMs = Math.min(9_000, totalMs * 0.06);
  const slotMs = (totalMs - introMs) / lineCount;

  const offset = Math.floor(random() * DEMO_SOURCE_LINES.length);
  const lines = Array.from({ length: lineCount }, (_, index) => ({
    id: `demo-${track.id}-${index}`,
    text: DEMO_SOURCE_LINES[(offset + index) % DEMO_SOURCE_LINES.length],
    startMs: Math.round(introMs + index * slotMs),
  }));

  return { trackId: track.id, lines, isDemo: true };
}
