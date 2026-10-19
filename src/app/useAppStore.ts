import { create } from 'zustand';

export type Route = 'home' | 'playlists' | 'songs' | 'search';
export type ThemeMode = 'system' | 'light' | 'dark';
export type MusicSource = 'spotify' | 'soundcloud' | 'local';

type AppStore = {
  route: Route;
  theme: ThemeMode;
  source: MusicSource;
  error: string | null;
  trackPath: string | null;
  playback: { playing: boolean; position_ms: number; duration_ms: number | null; volume: number };
  spectrum: number[];
  navigate: (route: Route) => void;
  setTheme: (theme: ThemeMode) => void;
  setSource: (source: MusicSource) => void;
  showError: (message: string) => void;
  clearError: () => void;
  setTrackPath: (path: string | null) => void;
  setPlayback: (playback: AppStore['playback']) => void;
  setSpectrum: (spectrum: number[]) => void;
};

export const useAppStore = create<AppStore>((set) => ({
  route: 'home',
  theme: 'system',
  source: 'local',
  error: null,
  trackPath: null,
  playback: { playing: false, position_ms: 0, duration_ms: null, volume: 1 },
  spectrum: Array.from({ length: 48 }, () => 0),
  navigate: (route) => set({ route }),
  setTheme: (theme) => set({ theme }),
  setSource: (source) => set({ source }),
  showError: (error) => set({ error }),
  clearError: () => set({ error: null }),
  setTrackPath: (trackPath) => set({ trackPath }),
  setPlayback: (playback) => set({ playback }),
  setSpectrum: (spectrum) => set({ spectrum }),
}));
