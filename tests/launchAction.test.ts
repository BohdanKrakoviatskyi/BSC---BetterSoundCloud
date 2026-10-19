import { describe, expect, it } from 'vitest';
import { parseLaunchAction } from '../src/app/launchAction';

describe('parseLaunchAction', () => {
  it('maps supported command line arguments to application actions', () => {
    expect(parseLaunchAction('--immersive')).toEqual({ type: 'toggle-immersive' });
    expect(parseLaunchAction('--close-immersive')).toEqual({ type: 'close-immersive' });
    expect(parseLaunchAction('--play-pause')).toEqual({ type: 'play-pause' });
    expect(parseLaunchAction('--next')).toEqual({ type: 'next' });
    expect(parseLaunchAction('--previous')).toEqual({ type: 'previous' });
  });

  it('maps supported bare route names and ignores unknown arguments', () => {
    expect(parseLaunchAction('home')).toEqual({ type: 'navigate', route: 'home' });
    expect(parseLaunchAction('playlists')).toEqual({ type: 'navigate', route: 'playlists' });
    expect(parseLaunchAction('songs')).toEqual({ type: 'navigate', route: 'songs' });
    expect(parseLaunchAction('--not-supported')).toBeNull();
  });
});
