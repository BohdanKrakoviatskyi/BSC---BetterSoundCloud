import { createStore, persist, uid } from '../lib/util';
import { DEMO } from '../data/demo';
import type { Playlist, Track } from '../types';
import { snack, ui, go } from './ui';
import { t } from '../lib/i18n';
import { player, next } from './player';

const demoMap = new Map(DEMO.map((x) => [x.id, x]));
const volatile = new Map<string, Track>();

const defaults = (): Playlist[] => [
  { id: 'p-chill', name: t('plDefault1'), ids: ['d4', 'd5', 'd2', 'd6'], created: 1 },
  { id: 'p-energy', name: t('plDefault2'), ids: ['d1', 'd3', 'd8', 'd7'], created: 2 },
  { id: 'p-night', name: t('plDefault3'), ids: ['d1', 'd6', 'd8'], created: 3 },
];

export const library = createStore({
  liked: ['d1', 'd5', 'd7'] as string[],
  disliked: [] as string[],
  playlists: defaults(),
  cache: {} as Record<string, Track>,
  recent: [] as string[],
});

/** Only keep external track metadata that is still referenced somewhere. */
function pruned(s: ReturnType<typeof library.get>) {
  const keep = new Set<string>([...s.liked, ...s.disliked, ...s.recent, ...s.playlists.flatMap((p) => p.ids), ...player.get().queue]);
  const out: Record<string, Track> = {};
  for (const id in s.cache) if (keep.has(id)) out[id] = s.cache[id];
  return out;
}
persist('lyra.lib.v1', library, (s) => ({ ...s, cache: pruned(s) }));

export const getTrack = (id: string): Track | undefined => demoMap.get(id) ?? library.get().cache[id] ?? volatile.get(id);

export function registerTracks(ts: Track[]) {
  for (const x of ts) if (!demoMap.has(x.id)) volatile.set(x.id, x);
}

export function ensureCached(id: string) {
  if (demoMap.has(id) || library.get().cache[id]) return;
  const tr = volatile.get(id);
  if (tr) library.set((s) => ({ cache: { ...s.cache, [id]: tr } }));
}

export const isDisliked = (id: string) => library.get().disliked.includes(id);

export function toggleLike(id: string): boolean {
  ensureCached(id);
  const s = library.get();
  const on = !s.liked.includes(id);
  library.set({
    liked: on ? [id, ...s.liked] : s.liked.filter((x) => x !== id),
    disliked: on ? s.disliked.filter((x) => x !== id) : s.disliked,
  });
  snack(t(on ? 'addedFav' : 'removedFav'));
  return on;
}

export function toggleDislike(id: string) {
  ensureCached(id);
  const s = library.get();
  const on = !s.disliked.includes(id);
  library.set({
    disliked: on ? [id, ...s.disliked] : s.disliked.filter((x) => x !== id),
    liked: on ? s.liked.filter((x) => x !== id) : s.liked,
  });
  if (on) {
    snack(t('dislikedMsg'), { label: t('undo'), run: () => toggleDislike(id) });
    const p = player.get();
    if (p.queue[p.index] === id && p.queue.length > 1) next();
  }
}

export function createPlaylist(name: string, trackId?: string) {
  const p: Playlist = { id: uid(), name: name.trim() || t('newPlaylist'), ids: trackId ? [trackId] : [], created: Date.now() };
  if (trackId) ensureCached(trackId);
  library.set((s) => ({ playlists: [...s.playlists, p] }));
  snack(t('playlistCreated', { name: p.name }));
  return p.id;
}

export function renamePlaylist(id: string, name: string) {
  library.set((s) => ({ playlists: s.playlists.map((p) => (p.id === id ? { ...p, name: name.trim() || p.name } : p)) }));
}

export function deletePlaylist(id: string) {
  const r = ui.get().route;
  if (r.name === 'playlist' && r.id === id) go({ name: 'home' }, true);
  library.set((s) => ({ playlists: s.playlists.filter((p) => p.id !== id) }));
}

export function togglePlaylistTrack(pid: string, tid: string) {
  ensureCached(tid);
  const p = library.get().playlists.find((x) => x.id === pid);
  if (!p) return;
  const has = p.ids.includes(tid);
  library.set((s) => ({
    playlists: s.playlists.map((x) => (x.id === pid ? { ...x, ids: has ? x.ids.filter((i) => i !== tid) : [...x.ids, tid] } : x)),
  }));
  snack(t(has ? 'removedFrom' : 'addedTo', { name: p.name }), { label: t('undo'), run: () => togglePlaylistTrack(pid, tid) });
}

export function pushRecent(id: string) {
  library.set((s) => ({ recent: [id, ...s.recent.filter((x) => x !== id)].slice(0, 20) }));
}

export function searchLocal(q: string): string[] {
  const n = q.toLowerCase();
  const all = new Map<string, Track>([...demoMap, ...Object.entries(library.get().cache)]);
  return [...all.values()]
    .filter((x) => `${x.title} ${x.artist} ${x.album ?? ''}`.toLowerCase().includes(n))
    .slice(0, 8)
    .map((x) => x.id);
}
