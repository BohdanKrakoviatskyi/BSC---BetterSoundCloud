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
  pickLocalFile: async () => window.prompt('Enter the full path to an audio file') || null,
};
