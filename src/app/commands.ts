import { invoke, isTauri } from '@tauri-apps/api/core';

export type LaunchAction =
  | { type: 'toggle-immersive' }
  | { type: 'close-immersive' }
  | { type: 'play-pause' }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'navigate'; route: string }
  | { type: 'focus-window' };

export const commands = {
  initialAction: () => invoke<LaunchAction | null>('initial_action'),
  reportError: (message: string) => invoke<void>('report_error', { message }),
  minimizeWindow: () => isTauri() ? invoke<void>('minimize_window') : Promise.resolve(),
  toggleMaximizeWindow: () => isTauri() ? invoke<void>('toggle_maximize_window') : Promise.resolve(),
  closeWindow: () => isTauri() ? invoke<void>('close_window') : Promise.resolve(),
};