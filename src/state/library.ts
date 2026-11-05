import { createStore, persist, uid } from '../lib/util';
import type { Playlist, SoundCloudPlaylist, Track } from '../types';
import {
  soundCloudAuthStatus, soundCloudPlaylistTracks, soundCloudPlaylistsMine, soundCloudTracksMine,
  ytMusicAuthStatus, ytMusicLibrarySync, ytMusicPlaylistArtwork, ytMusicPlaylistTracks,
} from '../lib/providers-api';
import { mapSoundCloudTrack } from '../lib/api';
import { mapYtMusicTracks, type YtMusicPlaylist, type YtMusicProfile } from '../lib/ytmusic-library';
import { snack, ui, go } from './ui';
import { t } from '../lib/i18n';
import { player, next } from './player';

const volatile = new Map<string, Track>();

export const library = createStore({
  liked: [] as string[],
  disliked: [] as string[],
  playlists: [] as Playlist[],
  soundcloudLiked: [] as Track[],
  soundcloudPlaylists: [] as SoundCloudPlaylist[],
  soundcloudPlaylistTracks: {} as Record<string, Track[]>,
  soundcloudLibraryLoading: false,
  soundcloudLibraryError: '',
  ytmusicLiked: [] as Track[],
  ytmusicPlaylists: [] as YtMusicPlaylist[],
  ytmusicPlaylistArt: {} as Record<string, string | null>,
  ytmusicPlaylistTracks: {} as Record<string, Track[]>,
  ytmusicLibraryLoading: false,
  ytmusicLibraryError: '',
  ytmusicAuthorized: false,
  ytmusicProfile: null as YtMusicProfile | null,
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
persist('lyra.lib.v1', library, (s) => ({
  liked: s.liked, disliked: s.disliked, playlists: s.playlists, cache: pruned(s), recent: s.recent,
}));

const storedLibrary = library.get();
const keepTrack = (id: string) => !id.startsWith('sp:');
library.set({
  liked: storedLibrary.liked.filter(keepTrack),
  disliked: storedLibrary.disliked.filter(keepTrack),
  recent: storedLibrary.recent.filter(keepTrack),
  playlists: storedLibrary.playlists.map((playlist) => ({ ...playlist, ids: playlist.ids.filter(keepTrack) })),
  cache: Object.fromEntries(Object.entries(storedLibrary.cache).filter(([id]) => keepTrack(id))),
});

const obsoletePlaylistNames = new Set([
  'вечерний чилл', 'evening chill', 'заряд энергии', 'energy boost', 'ночная дорога', 'night drive',
]);
library.set((s) => ({ playlists: s.playlists.filter((playlist) => !obsoletePlaylistNames.has(playlist.name.trim().toLocaleLowerCase())) }));

let libraryLoad: Promise<void> | undefined;
const playlistLoads = new Map<string, Promise<Track[]>>();
let ytmusicLoad: Promise<void> | undefined;
let ytmusicEpoch = 0;
const ytmusicPlaylistLoads = new Map<string, Promise<Track[]>>();
const ytmusicArtworkLoads = new Map<string, Promise<string | null>>();

export function loadSoundCloudLibrary(force = false): Promise<void> {
  if (libraryLoad) return force ? libraryLoad.then(() => loadSoundCloudLibrary()) : libraryLoad;
  library.set({ soundcloudLibraryLoading: true, soundcloudLibraryError: '' });
  libraryLoad = (async () => {
    try {
      const auth = await soundCloudAuthStatus();
      if (!auth.authorized) {
        clearSoundCloudLibrary();
        return;
      }
      const [likesResult, playlistsResult] = await Promise.allSettled([soundCloudTracksMine(), soundCloudPlaylistsMine()]);
      const liked = likesResult.status === 'fulfilled' ? likesResult.value.map(mapSoundCloudTrack) : [];
      const playlists: SoundCloudPlaylist[] = playlistsResult.status === 'fulfilled'
        ? playlistsResult.value.map((playlist) => ({
            id: playlist.id,
            urn: playlist.urn || `soundcloud:playlists:${playlist.id}`,
            name: playlist.title,
            artworkUrl: playlist.artworkUrl || undefined,
            permalinkUrl: playlist.permalinkUrl || undefined,
            trackCount: playlist.trackCount,
            username: playlist.user?.username || auth.profile?.username || 'SoundCloud',
          }))
        : [];
      registerTracks(liked);
      library.set({
        soundcloudLiked: liked,
        soundcloudPlaylists: playlists,
        soundcloudPlaylistTracks: {},
        soundcloudLibraryError: likesResult.status === 'rejected'
          ? String(likesResult.reason)
          : playlistsResult.status === 'rejected' ? String(playlistsResult.reason) : '',
      });
    } catch (error) {
      clearSoundCloudLibrary();
      library.set({ soundcloudLibraryError: error instanceof Error ? error.message : String(error) });
    } finally {
      library.set({ soundcloudLibraryLoading: false });
      libraryLoad = undefined;
    }
  })();
  return libraryLoad;
}

export function clearSoundCloudLibrary() {
  library.set({
    soundcloudLiked: [], soundcloudPlaylists: [], soundcloudPlaylistTracks: {},
    soundcloudLibraryLoading: false, soundcloudLibraryError: '',
  });
}

export function reloadSoundCloudPlaylistTracks(urn: string): Promise<Track[]> {
  const soundcloudPlaylistTracks = { ...library.get().soundcloudPlaylistTracks };
  delete soundcloudPlaylistTracks[urn];
  library.set({ soundcloudPlaylistTracks });
  return loadSoundCloudPlaylistTracks(urn);
}

export function loadSoundCloudPlaylistTracks(urn: string): Promise<Track[]> {
  const cached = library.get().soundcloudPlaylistTracks[urn];
  if (cached) return Promise.resolve(cached);
  const pending = playlistLoads.get(urn);
  if (pending) return pending;
  const request = soundCloudPlaylistTracks(urn).then((cards) => {
    const tracks = cards.map(mapSoundCloudTrack);
    registerTracks(tracks);
    library.set((state) => ({ soundcloudPlaylistTracks: { ...state.soundcloudPlaylistTracks, [urn]: tracks } }));
    return tracks;
  }).finally(() => playlistLoads.delete(urn));
  playlistLoads.set(urn, request);
  return request;
}

export function loadYtMusicLibrary(force = false): Promise<void> {
  if (ytmusicLoad) return force ? ytmusicLoad.then(() => loadYtMusicLibrary()) : ytmusicLoad;
  const epoch = ytmusicEpoch;
  library.set({ ytmusicLibraryLoading: true, ytmusicLibraryError: '' });
  const request = (async () => {
    try {
      const auth = await ytMusicAuthStatus();
      if (epoch !== ytmusicEpoch) return;
      if (!auth.authorized) {
        clearYtMusicLibrary();
        return;
      }
      library.set({ ytmusicAuthorized: true, ytmusicProfile: auth.profile ?? library.get().ytmusicProfile });
      const result = await ytMusicLibrarySync();
      if (epoch !== ytmusicEpoch) return;
      const liked = mapYtMusicTracks(result.likedSongs);
      registerTracks(liked);
      library.set({
        ytmusicLiked: liked,
        ytmusicPlaylists: result.playlists,
        ytmusicPlaylistArt: {},
        ytmusicPlaylistTracks: {},
        ytmusicProfile: result.profile ?? auth.profile ?? null,
        ytmusicLibraryError: '',
      });
    } catch (error) {
      if (epoch !== ytmusicEpoch) return;
      library.set({ ytmusicLibraryError: error instanceof Error ? error.message : String(error) });
    } finally {
      if (epoch === ytmusicEpoch) library.set({ ytmusicLibraryLoading: false });
    }
  })();
  ytmusicLoad = request;
  void request.finally(() => {
    if (ytmusicLoad === request) ytmusicLoad = undefined;
  });
  return request;
}

export function clearYtMusicLibrary() {
  ytmusicEpoch += 1;
  ytmusicLoad = undefined;
  ytmusicArtworkLoads.clear();
  library.set({
    ytmusicLiked: [], ytmusicPlaylists: [], ytmusicPlaylistArt: {}, ytmusicPlaylistTracks: {},
    ytmusicLibraryLoading: false, ytmusicLibraryError: '', ytmusicAuthorized: false, ytmusicProfile: null,
  });
}

export function loadYtMusicPlaylistArtwork(playlistId: string): Promise<string | null> {
  const cached = library.get().ytmusicPlaylistArt;
  if (playlistId in cached) return Promise.resolve(cached[playlistId]);
  const pending = ytmusicArtworkLoads.get(playlistId);
  if (pending) return pending;
  const epoch = ytmusicEpoch;
  const request = ytMusicPlaylistArtwork(playlistId).then((art) => {
    if (epoch === ytmusicEpoch) {
      library.set((state) => ({ ytmusicPlaylistArt: { ...state.ytmusicPlaylistArt, [playlistId]: art } }));
    }
    return art;
  }).catch(() => null).finally(() => ytmusicArtworkLoads.delete(playlistId));
  ytmusicArtworkLoads.set(playlistId, request);
  return request;
}

export function loadYtMusicPlaylistTracks(playlistId: string): Promise<Track[]> {
  const cached = library.get().ytmusicPlaylistTracks[playlistId];
  if (cached) return Promise.resolve(cached);
  const pending = ytmusicPlaylistLoads.get(playlistId);
  if (pending) return pending;
  const epoch = ytmusicEpoch;
  const request = ytMusicPlaylistTracks(playlistId).then((playlist) => {
    const tracks = mapYtMusicTracks(playlist.tracks ?? []);
    if (epoch === ytmusicEpoch) {
      registerTracks(tracks);
      library.set((state) => ({ ytmusicPlaylistTracks: { ...state.ytmusicPlaylistTracks, [playlistId]: tracks } }));
    }
    return tracks;
  }).finally(() => ytmusicPlaylistLoads.delete(playlistId));
  ytmusicPlaylistLoads.set(playlistId, request);
  return request;
}

export function reloadYtMusicPlaylistTracks(playlistId: string): Promise<Track[]> {
  const ytmusicPlaylistTracks = { ...library.get().ytmusicPlaylistTracks };
  delete ytmusicPlaylistTracks[playlistId];
  library.set({ ytmusicPlaylistTracks });
  return loadYtMusicPlaylistTracks(playlistId);
}

export const getTrack = (id: string): Track | undefined => library.get().cache[id] ?? volatile.get(id);

export function registerTracks(ts: Track[]) {
  for (const x of ts) volatile.set(x.id, x);
}

export function ensureCached(id: string) {
  if (library.get().cache[id]) return;
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
  const all = new Map<string, Track>(Object.entries(library.get().cache));
  return [...all.values()]
    .filter((x) => `${x.title} ${x.artist} ${x.album ?? ''}`.toLowerCase().includes(n))
    .slice(0, 8)
    .map((x) => x.id);
}
