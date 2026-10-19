export type LaunchAction =
  | { type: 'toggle-immersive' }
  | { type: 'close-immersive' }
  | { type: 'play-pause' }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'navigate'; route: 'home' | 'playlists' | 'songs' };

const actions: Readonly<Record<string, LaunchAction>> = {
  '--immersive': { type: 'toggle-immersive' },
  '--close-immersive': { type: 'close-immersive' },
  '--play-pause': { type: 'play-pause' },
  '--next': { type: 'next' },
  '--previous': { type: 'previous' },
  home: { type: 'navigate', route: 'home' },
  playlists: { type: 'navigate', route: 'playlists' },
  songs: { type: 'navigate', route: 'songs' },
};

export function parseLaunchAction(argument: string): LaunchAction | null {
  return actions[argument] ?? null;
}