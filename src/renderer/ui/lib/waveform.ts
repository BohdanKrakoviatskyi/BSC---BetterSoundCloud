// Deterministic pseudo-waveform generator. SoundCloud's real waveform data would need an extra
// request per track, so instead we derive a stable, track-specific amplitude pattern from its id.
// This keeps the shape consistent between renders (and between the player bar and the track page)
// without any network cost.
export function createWaveform(trackId: number, length = 88): number[] {
  return Array.from({ length }, (_, index) => {
    const detail = Math.abs(Math.sin((index + 1) * 12.9898 + trackId * 78.233) * 43758.5453) % 1;
    const bass = Math.abs(Math.sin(index * 0.105 + trackId * 0.17));
    const beat = Math.abs(Math.sin(index * 0.39 + trackId * 0.31));
    return Math.min(1, 0.08 + bass * 0.38 + beat * 0.22 + detail * 0.32);
  });
}
