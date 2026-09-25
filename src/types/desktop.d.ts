import type { AuthStatus, SoundCloudMixedSelection, SoundCloudPlaylist, SoundCloudSearchTrack, SoundCloudTrack, SoundCloudTrackDetails, TrackLikeResult, TrackStream } from '../renderer/lib/desktop';

export {};

declare global {
  interface Window {
    desktop: {
      start(): Promise<void>;
      stop(): Promise<void>;
      getInfo(): Promise<{ name: string; version: string; backend: string }>;
      getSettings(): Promise<{ accent: string; compact: boolean; volume: number; clientId: string }>;
      updateSettings(patch: Partial<{ accent: string; compact: boolean; volume: number; clientId: string }>): Promise<{
        accent: string;
        compact: boolean;
        volume: number;
        clientId: string;
      }>;
      clearAppData(): Promise<{ accent: string; compact: boolean; volume: number; clientId: string }>;
      historyList(): Promise<SoundCloudTrack[]>;
      historyRecord(track: SoundCloudTrack): Promise<SoundCloudTrack[]>;
      historyClear(): Promise<SoundCloudTrack[]>;
      authStatus(): Promise<AuthStatus>;
      authLogin(token: string): Promise<AuthStatus>;
      authRefresh(): Promise<AuthStatus>;
      authLogout(): Promise<AuthStatus>;
      myTracks(): Promise<SoundCloudTrack[]>;
      myPlaylists(): Promise<SoundCloudPlaylist[]>;
      playlistTracks(playlistUrn: string): Promise<SoundCloudTrack[]>;
      trackDetails(trackId: number): Promise<SoundCloudTrackDetails>;
      trackStream(trackUrn: string): Promise<TrackStream>;
      searchTracks(query: string): Promise<SoundCloudSearchTrack[]>;
      relatedTracks(trackId: number): Promise<SoundCloudSearchTrack[]>;
      mixedSelections(): Promise<SoundCloudMixedSelection[]>;
      likeTrack(trackId: number, trackUrn: string): Promise<TrackLikeResult>;
      unlikeTrack(trackId: number, trackUrn: string): Promise<TrackLikeResult>;
    };
  }
}
