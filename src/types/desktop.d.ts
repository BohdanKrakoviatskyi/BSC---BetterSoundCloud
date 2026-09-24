import type { AuthStatus, SoundCloudSearchTrack, SoundCloudTrack, SoundCloudTrackDetails, TrackLikeResult } from '../renderer/lib/desktop';

export {};

declare global {
  interface Window {
    desktop: {
      start(): Promise<void>;
      stop(): Promise<void>;
      getInfo(): Promise<{ name: string; version: string; backend: string }>;
      getSettings(): Promise<{ accent: string; compact: boolean; volume: number }>;
      updateSettings(patch: Partial<{ accent: string; compact: boolean; volume: number }>): Promise<{
        accent: string;
        compact: boolean;
        volume: number;
      }>;
      authStatus(): Promise<AuthStatus>;
      authLogin(token: string): Promise<AuthStatus>;
      authRefresh(): Promise<AuthStatus>;
      authLogout(): Promise<AuthStatus>;
      myTracks(): Promise<SoundCloudTrack[]>;
      trackDetails(trackId: number): Promise<SoundCloudTrackDetails>;
      searchTracks(query: string): Promise<SoundCloudSearchTrack[]>;
      likeTrack(trackId: number, trackUrn: string): Promise<TrackLikeResult>;
      unlikeTrack(trackId: number, trackUrn: string): Promise<TrackLikeResult>;
    };
  }
}
