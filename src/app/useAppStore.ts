import { create } from 'zustand';

export type Route = 'home' | 'playlists' | 'songs' | 'search';
export type ThemeMode = 'system' | 'light' | 'dark';
export type MusicSource = 'spotify' | 'soundcloud' | 'local';

type AppStore = {
  route: Route;
  theme: ThemeMode;
  source: MusicSource;
  error: string | null;
  navigate: (route: Route) => void;
  setTheme: (theme: ThemeMode) => void;
  setSource: (source: MusicSource) => void;
  showError: (message: string) => void;
  clearError: () => void;
};

export const useAppStore = create<AppStore>((set) => ({
  route: 'home',
  theme: 'system',
  source: 'local',
  error: null,
  navigate: (route) => set({ route }),
  setTheme: (theme) => set({ theme }),
  setSource: (source) => set({ source }),
  showError: (error) => set({ error }),
  clearError: () => set({ error: null }),
}));