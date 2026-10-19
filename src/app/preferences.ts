import { isTauri } from '@tauri-apps/api/core';
import { load } from '@tauri-apps/plugin-store';
import type { MusicSource, ThemeMode } from './useAppStore';

const store = isTauri() ? load('settings.json', { defaults: { theme: 'system', source: 'local' } }) : null;

export async function readPreferences(): Promise<{ theme: ThemeMode; source: MusicSource }> {
  if (!store) {
    const theme = localStorage.getItem('theme');
    const source = localStorage.getItem('source');
    return {
      theme: theme === 'light' || theme === 'dark' ? theme : 'system',
      source: source === 'spotify' || source === 'soundcloud' ? source : 'local',
    };
  }
  const settings = await store;
  const theme = await settings.get<ThemeMode>('theme');
  const source = await settings.get<MusicSource>('source');
  return {
    theme: theme === 'light' || theme === 'dark' ? theme : 'system',
    source: source === 'spotify' || source === 'soundcloud' ? source : 'local',
  };
}

export async function savePreference(key: 'theme' | 'source', value: ThemeMode | MusicSource): Promise<void> {
  if (!store) {
    localStorage.setItem(key, value);
    return;
  }
  const settings = await store;
  await settings.set(key, value);
  await settings.save();
}