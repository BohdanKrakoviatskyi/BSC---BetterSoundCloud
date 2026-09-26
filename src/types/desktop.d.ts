import type { AuthStatus, SoundCloudMixedSelection, SoundCloudPlaylist, SoundCloudSearchTrack, SoundCloudTrack, SoundCloudTrackDetails, SoundCloudUserProfile, TrackLikeResult, TrackStream } from '../renderer/lib/desktop';

export {};

declare global {
  interface Window {
    desktop: {
      start(): Promise<void>;
      stop(): Promise<void>;
      getInfo(): Promise<{ name: string; version: string; backend: string }>;
      getSettings(): Promise<{ accent: string; compact: boolean; volume: number; clientId: string; backgroundImage: string; backgroundBlur: number }>;
      updateSettings(patch: Partial<{ accent: string; compact: boolean; volume: number; clientId: string; backgroundImage: string; backgroundBlur: number }>): Promise<{
        accent: string;
        compact: boolean;
        volume: number;
        clientId: string;
        backgroundImage: string;
        backgroundBlur: number;
      }>;
      clearAppData(): Promise<{ accent: string; compact: boolean; volume: number; clientId: string; backgroundImage: string; backgroundBlur: number }>;
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
      userProfile(userId: number): Promise<SoundCloudUserProfile>;
      userTracks(userId: number): Promise<SoundCloudTrack[]>;
      likeTrack(trackId: number, trackUrn: string, datadomeCookie?: string): Promise<TrackLikeResult>;
      unlikeTrack(trackId: number, trackUrn: string, datadomeCookie?: string): Promise<TrackLikeResult>;
    };
  }
}
