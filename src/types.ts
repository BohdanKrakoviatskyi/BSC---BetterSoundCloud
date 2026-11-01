export type Source = 'demo' | 'audius' | 'itunes';

export interface LyricLine {
  t: number;
  text: string;
  gap?: boolean;
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  cover?: string;
  thumb?: string;
  src: string;
  duration: number;
  fullDuration?: number;
  source: Source;
  lyrics?: LyricLine[];
}

export interface Playlist {
  id: string;
  name: string;
  ids: string[];
  created: number;
}
