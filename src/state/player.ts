import { useSyncExternalStore } from 'react';
import { createStore, persist, clamp, shuffled, useStore } from '../lib/util';
import { getTrack, library, pushRecent, isDisliked, ensureCached } from './library';
import { snack } from './ui';
import { t } from '../lib/i18n';
import type { Track } from '../types';

export type Repeat = 'off' | 'all' | 'one';

export const audio = new Audio();
audio.preload = 'auto';

export const player = createStore({
  queue: [] as string[],
  index: -1,
  playing: false,
  loading: false,
  duration: 0,
  volume: 0.8,
  muted: false,
  shuffle: false,
  repeat: 'off' as Repeat,
  pos: 0,
});

let original: string[] | null = null;
let pendingSeek = 0;
let errors = 0;

export const currentTrack = (): Track | null => {
  const s = player.get();
  const id = s.queue[s.index];
  return id ? getTrack(id) ?? null : null;
};

export function useCurrentTrack(): Track | null {
  const id = useStore(player, (s) => s.queue[s.index] ?? null);
  return useStore(library, () => (id ? getTrack(id) ?? null : null));
}

/* ---------------- time / frame clock ---------------- */
export const dur = () => (isFinite(audio.duration) && audio.duration > 0 ? audio.duration : player.get().duration);
const curTime = () => (audio.src && audio.readyState > 0 ? audio.currentTime : player.get().pos);

const frameSubs = new Set<(t: number, d: number) => void>();
let raf = 0;
function emitFrame() {
  const ct = curTime();
  const d = dur();
  frameSubs.forEach((f) => f(ct, d));
}
function tick() {
  raf = 0;
  emitFrame();
  if (!audio.paused && frameSubs.size) raf = requestAnimationFrame(tick);
}
const kick = () => {
  if (!raf) raf = requestAnimationFrame(tick);
};
/** Per-frame callback while playing (DOM writes only — avoids React re-renders). */
export function onFrame(f: (t: number, d: number) => void) {
  frameSubs.add(f);
  f(curTime(), dur());
  kick();
  return () => {
    frameSubs.delete(f);
  };
}

const timeSubs = new Set<() => void>();
const emitTime = () => timeSubs.forEach((f) => f());
const subTime = (cb: () => void) => {
  timeSubs.add(cb);
  return () => {
    timeSubs.delete(cb);
  };
};
export const useSecond = () => useSyncExternalStore(subTime, () => Math.floor(curTime()));

/* ---------------- media session ---------------- */
function mediaMeta(tr: Track) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: tr.title,
      artist: tr.artist,
      album: tr.album ?? '',
      artwork: tr.cover ? [{ src: tr.cover, sizes: '600x600', type: 'image/jpeg' }] : [],
    });
  } catch {
    /* unsupported */
  }
}

/* ---------------- controls ---------------- */
function load(i: number, autoplay: boolean) {
  const s = player.get();
  const id = s.queue[i];
  const tr = id ? getTrack(id) : undefined;
  if (!tr) return;
  ensureCached(id);
  player.set({ index: i, duration: tr.duration, loading: autoplay, pos: 0 });
  audio.src = tr.src;
  if (autoplay) {
    audio.play().catch((e: Error) => {
      if (e.name !== 'AbortError') player.set({ playing: false, loading: false });
    });
  }
  pushRecent(id);
  mediaMeta(tr);
  emitFrame();
  emitTime();
}

export function playQueue(ids: string[], start = 0, shuffle?: boolean) {
  if (!ids.length) return;
  const sh = shuffle ?? player.get().shuffle;
  let q = ids.slice();
  let idx = clamp(start, 0, q.length - 1);
  if (sh) {
    original = q.slice();
    const first = q[idx];
    q = [first, ...shuffled(q.filter((_, k) => k !== idx))];
    idx = 0;
  } else original = null;
  player.set({ queue: q, shuffle: sh });
  load(idx, true);
}

export const shufflePlay = (ids: string[]) => ids.length && playQueue(ids, Math.floor(Math.random() * ids.length), true);

export function toggle() {
  const s = player.get();
  if (s.index < 0 || !s.queue.length) return;
  if (!audio.src) {
    const keep = s.pos;
    load(s.index, true);
    pendingSeek = keep;
    return;
  }
  if (audio.paused) audio.play().catch(() => player.set({ playing: false }));
  else audio.pause();
}

function step(dir: 1 | -1, auto: boolean) {
  const s = player.get();
  const n = s.queue.length;
  if (!n) return;
  if (auto && s.repeat === 'one') {
    audio.currentTime = 0;
    audio.play().catch(() => {});
    return;
  }
  let i = s.index;
  for (let k = 0; k < n; k++) {
    i += dir;
    if (i >= n) {
      if (auto && s.repeat === 'off') {
        player.set({ playing: false });
        return;
      }
      i = 0;
    }
    if (i < 0) i = n - 1;
    if (!isDisliked(s.queue[i])) break;
  }
  load(i, true);
}

export const next = (auto = false) => step(1, auto);
export function prev() {
  if (curTime() > 3) seek(0);
  else step(-1, false);
}
export const jumpTo = (i: number) => load(i, true);

export function seek(sec: number) {
  if (!audio.src || audio.readyState < 1) {
    pendingSeek = Math.max(0, sec);
    player.set({ pos: pendingSeek });
  } else audio.currentTime = clamp(sec, 0, dur() || sec);
  emitFrame();
  emitTime();
}
export const seekBy = (d: number) => seek(curTime() + d);

export function setVolume(v: number) {
  v = clamp(v, 0, 1);
  audio.volume = v;
  audio.muted = false;
  player.set({ volume: v, muted: false });
}
export function toggleMute() {
  const m = !player.get().muted;
  audio.muted = m;
  player.set({ muted: m });
}

export function toggleShuffle() {
  const s = player.get();
  const cur = s.queue[s.index];
  if (!s.shuffle) {
    original = s.queue.slice();
    const rest = shuffled(s.queue.filter((_, k) => k !== s.index));
    player.set({ shuffle: true, queue: cur ? [cur, ...rest] : rest, index: cur ? 0 : -1 });
  } else {
    const q = original ?? s.queue;
    player.set({ shuffle: false, queue: q, index: Math.max(0, q.indexOf(cur)) });
    original = null;
  }
}

export function cycleRepeat() {
  const r = player.get().repeat;
  player.set({ repeat: r === 'off' ? 'all' : r === 'all' ? 'one' : 'off' });
}

export function playNext(id: string) {
  const s = player.get();
  if (s.index < 0) return playQueue([id]);
  const curId = s.queue[s.index];
  const q = s.queue.filter((x) => x !== id || x === curId);
  const ci = q.indexOf(curId);
  q.splice(ci + 1, 0, id);
  if (original && !original.includes(id)) original.push(id);
  player.set({ queue: q, index: ci });
  snack(t('playingNext'));
}

export function addToQueue(id: string) {
  const s = player.get();
  if (s.index < 0) return playQueue([id]);
  if (!s.queue.includes(id)) {
    player.set({ queue: [...s.queue, id] });
    if (original) original.push(id);
  }
  snack(t('addedToQueue'));
}

/* ---------------- audio events ---------------- */
audio.addEventListener('play', () => {
  player.set({ playing: true });
  kick();
});
audio.addEventListener('playing', () => {
  player.set({ loading: false });
  errors = 0;
});
audio.addEventListener('pause', () => player.set({ playing: false, pos: audio.currentTime }));
audio.addEventListener('waiting', () => player.set({ loading: true }));
audio.addEventListener('canplay', () => player.set({ loading: false }));
audio.addEventListener('ended', () => next(true));
audio.addEventListener('loadedmetadata', () => {
  if (pendingSeek) {
    audio.currentTime = Math.min(pendingSeek, audio.duration || pendingSeek);
    pendingSeek = 0;
  }
  if (isFinite(audio.duration)) player.set({ duration: audio.duration });
  emitFrame();
  emitTime();
});
let lastSaved = 0;
audio.addEventListener('timeupdate', () => {
  emitTime();
  if (audio.paused) emitFrame();
  if (Math.abs(audio.currentTime - lastSaved) > 4) {
    lastSaved = audio.currentTime;
    player.set({ pos: audio.currentTime });
  }
});
audio.addEventListener('seeked', () => {
  emitFrame();
  emitTime();
});
audio.addEventListener('error', () => {
  if (!audio.src || !audio.error) return;
  player.set({ loading: false, playing: false });
  snack(t('cantPlay'));
  if (++errors < 3) setTimeout(() => next(true), 900);
});

export function initPlayer() {
  persist('lyra.player.v1', player, (s) => ({
    queue: s.queue, index: s.index, volume: s.volume, muted: s.muted, shuffle: s.shuffle, repeat: s.repeat, pos: s.pos, duration: s.duration,
  }));
  const s = player.get();
  const curId = s.queue[s.index];
  const q = s.queue.filter((id) => getTrack(id));
  const idx = curId ? q.indexOf(curId) : -1;
  player.set({ queue: q, index: idx, playing: false, loading: false, pos: idx >= 0 ? s.pos : 0 });
  audio.volume = s.volume;
  audio.muted = s.muted;
  pendingSeek = idx >= 0 ? s.pos : 0;
  const cur = currentTrack();
  if (cur) mediaMeta(cur);
  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    const h: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => toggle()],
      ['pause', () => audio.pause()],
      ['previoustrack', () => prev()],
      ['nexttrack', () => next()],
      ['seekbackward', () => seekBy(-10)],
      ['seekforward', () => seekBy(10)],
      ['seekto', (d) => d.seekTime != null && seek(d.seekTime)],
    ];
    for (const [a, fn] of h) {
      try {
        ms.setActionHandler(a, fn);
      } catch {
        /* unsupported action */
      }
    }
  }
  window.addEventListener('pagehide', () => player.set({ pos: curTime() }));
}
