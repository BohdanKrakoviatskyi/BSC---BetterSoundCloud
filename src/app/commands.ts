import { invoke, isTauri } from '@tauri-apps/api/core';

export type LaunchAction =
  | { type: 'toggle-immersive' }
  | { type: 'close-immersive' }
  | { type: 'play-pause' }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'navigate'; route: string }
  | { type: 'focus-window' };

export type PlaybackSnapshot = { playing: boolean; position_ms: number; duration_ms: number | null; volume: number };
export type LocalSong = { instanceId: number; uri: string; path: string; name: string; artists: string; albumName: string; durationMs: number; artworkPath: string | null; tags: { title: string | null; artist: string | null; album: string | null; albumArtist: string | null; trackNumber: number | null; discNumber: number | null; date: string | null; genre: string | null; durationMs: number; artworkPath: string | null } };
export type LocalLibraryStatus = { sources: string[]; songCount: number; scanning: boolean };
export type LocalPlaylist = { id: string; name: string; description: string; artworkPath: string | null; songs: LocalSong[] };
export type LocalTagEdits = { title?: string; artist?: string; album?: string; albumArtist?: string; genre?: string; date?: string; trackNumber?: string; discNumber?: string; removeArtwork?: boolean };

export const commands = {
  initialAction: () => invoke<LaunchAction | null>('initial_action'),
  reportError: (message: string) => invoke<void>('report_error', { message }),
  minimizeWindow: () => isTauri() ? invoke<void>('minimize_window') : Promise.resolve(),
  toggleMaximizeWindow: () => isTauri() ? invoke<void>('toggle_maximize_window') : Promise.resolve(),
  closeWindow: () => isTauri() ? invoke<void>('close_window') : Promise.resolve(),
  playLocalFile: (path: string) => invoke<void>('play_local_file', { path }),
  crossfadeLocalFile: (path: string, crossfadeMs: number) => invoke<void>('crossfade_local_file', { path, crossfadeMs }),
  playbackSnapshot: () => invoke<PlaybackSnapshot>('playback_snapshot'),
  playbackPause: () => invoke<void>('playback_pause'),
  playbackResume: () => invoke<void>('playback_resume'),
  playbackNext: () => invoke<void>('playback_next'),
  queueLocalFiles: (paths: string[]) => invoke<void>('queue_local_files', { paths }),
  localQueue: () => invoke<string[]>('local_queue'),
  preloadNextLocal: () => invoke<boolean>('preload_next_local'),
  playbackStop: () => invoke<void>('playback_stop'),
  playbackSeek: (positionMs: number) => invoke<void>('playback_seek', { positionMs }),
  playbackSetVolume: (volume: number) => invoke<void>('playback_set_volume', { volume }),
  playbackSetSpeed: (tempo: number) => invoke<void>('playback_set_speed', { tempo }),
  playbackSetEqualizer: (gains: number[]) => invoke<void>('playback_set_equalizer', { gains }),
  spectrumSetEnabled: (enabled: boolean) => invoke<void>('spectrum_set_enabled', { enabled }),
  spectrumEnable: () => invoke<void>('spectrum_enable'),
  spectrumLevels: () => invoke<number[]>('spectrum_levels'),
  localLibrarySources: () => invoke<string[]>('local_library_sources'),
  localLibrarySongs: () => invoke<LocalSong[]>('local_library_songs'),
  localLibraryAddSources: (paths: string[]) => invoke<number>('local_library_add_sources', { paths }),
  localLibrarySetSources: (sources: string[]) => invoke<void>('local_library_set_sources', { sources }),
  localLibraryStatus: () => invoke<LocalLibraryStatus>('local_library_status'),
  localLibraryRemoveSource: (path: string) => invoke<boolean>('local_library_remove_source', { path }),
  localLibraryRescan: () => invoke<number>('local_library_rescan'),
  localSongEditTags: (uri: string, edits: LocalTagEdits, artwork?: number[]) => invoke<void>('local_song_edit_tags', { uri, edits, artwork: artwork ?? null }),
  localPlaylists: () => invoke<LocalPlaylist[]>('local_playlists'),
  localPlaylistCreate: (name: string) => invoke<LocalPlaylist>('local_playlist_create', { name }),
  localPlaylistAddSongs: (id: string, songs: LocalSong[]) => invoke<number>('local_playlist_add_songs', { id, songs }),
  localPlaylistDelete: (id: string) => invoke<boolean>('local_playlist_delete', { id }),
  localPlaylistRemoveSong: (id: string, uri: string) => invoke<number>('local_playlist_remove_song', { id, uri }),
  localPlaylistReorder: (id: string, uris: string[]) => invoke<void>('local_playlist_reorder', { id, uris }),
  pathFromFileDrop: () => window.prompt('Enter the full path to an audio file or folder') || null,
  pickLocalFile: async () => window.prompt('Enter the full path to an audio file') || null,
};
