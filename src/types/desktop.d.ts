import type { AuthStatus, SoundCloudMixedSelection, SoundCloudPlaylist, SoundCloudSearchTrack, SoundCloudSocialPage, SoundCloudTrack, SoundCloudTrackDetails, SoundCloudTrackPage, SoundCloudUserProfile, SpotifyAuthProfile, SpotifyAuthStatus, SpotifyPlaylistPage, SpotifyRecommendRequest, SpotifySaveResult, SpotifyTrack, SpotifyTrackPage, TrackLikeResult, YouTubeAuthProfile, YouTubeAuthStatus, YouTubeBundledCredentials, YouTubePlaylistPage, YouTubeTrack, YouTubeTrackPage, TrackLyricsDTO, TrackStream } from '../renderer/lib/desktop';

import type { Settings } from '../renderer/domain/models';

export {};

declare global {
  interface Window {
    desktop: {
      start(): Promise<void>;
      stop(): Promise<void>;
      getSettings(): Promise<Settings>;
      updateSettings(patch: Partial<Settings>): Promise<Settings>;
      clearAppData(): Promise<Settings>;
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
      trackLyrics(trackId: number, title: string, artist: string, durationMs: number): Promise<TrackLyricsDTO>;
      trackStream(trackUrn: string): Promise<TrackStream>;
      searchTracks(query: string): Promise<SoundCloudSearchTrack[]>;
      relatedTracks(trackId: number): Promise<SoundCloudSearchTrack[]>;
      mixedSelections(): Promise<SoundCloudMixedSelection[]>;
      userProfile(userId: number): Promise<SoundCloudUserProfile>;
      userTracks(userId: number): Promise<SoundCloudTrack[]>;
      userLikes(userId: number, next?: string): Promise<SoundCloudTrackPage>;
      userFollowers(userId: number, next?: string): Promise<SoundCloudSocialPage>;
      userFollowings(userId: number, next?: string): Promise<SoundCloudSocialPage>;
      userPlaylists(userId: number): Promise<SoundCloudPlaylist[]>;
      likeTrack(trackId: number, trackUrn: string, userId?: number, clientId?: string, datadomeCookie?: string): Promise<TrackLikeResult>;
      unlikeTrack(trackId: number, trackUrn: string, userId?: number, clientId?: string, datadomeCookie?: string): Promise<TrackLikeResult>;

      // ---- Spotify
      //
      // A next href is accepted by the methods that can page, because Spotify's continuation is an
      // opaque URL rather than an offset and cannot be reconstructed by the caller.
      spotifyAuthStatus(): Promise<SpotifyAuthStatus>;
      spotifyAuthExchange(code: string, clientId: string, clientSecret: string, redirectUri: string): Promise<SpotifyAuthStatus>;
      spotifyAuthRefresh(clientId: string, clientSecret: string): Promise<SpotifyAuthStatus>;
      spotifyAuthLogout(): Promise<SpotifyAuthStatus>;
      spotifyMyTracks(next?: string, limit?: number): Promise<SpotifyTrackPage>;
      spotifyMyPlaylists(next?: string, limit?: number): Promise<SpotifyPlaylistPage>;
      spotifyPlaylistTracks(id: string, next?: string, limit?: number): Promise<SpotifyTrackPage>;
      spotifyTrackDetails(id: string): Promise<SpotifyTrack>;
      spotifySearchTracks(query: string, limit?: number): Promise<SpotifyTrackPage>;
      spotifyRecommendations(request: SpotifyRecommendRequest): Promise<SpotifyTrackPage>;
      spotifyUserProfile(): Promise<SpotifyAuthProfile>;
      spotifySaveTrack(id: string): Promise<SpotifySaveResult>;
      spotifyUnsaveTrack(id: string): Promise<SpotifySaveResult>;

      // ---- YouTube Music
      youtubeAuthStatus(): Promise<YouTubeAuthStatus>;
      youtubeAuthExchange(code: string, clientId: string, clientSecret: string, redirectUri: string): Promise<YouTubeAuthStatus>;
      youtubeAuthRefresh(clientId: string, clientSecret: string): Promise<YouTubeAuthStatus>;
      youtubeBundledCredentials(): Promise<YouTubeBundledCredentials>;
      youtubeAuthLogout(): Promise<YouTubeAuthStatus>;
      youtubeMyTracks(pageToken?: string, limit?: number, musicOnly?: boolean): Promise<YouTubeTrackPage>;
      youtubeMyPlaylists(pageToken?: string, limit?: number): Promise<YouTubePlaylistPage>;
      youtubePlaylistTracks(id: string, pageToken?: string, limit?: number): Promise<YouTubeTrackPage>;
      youtubeTrackDetails(id: string): Promise<YouTubeTrack>;
      youtubeSearchTracks(query: string, pageToken?: string, limit?: number): Promise<YouTubeTrackPage>;
      youtubeUserProfile(): Promise<YouTubeAuthProfile>;
    };
  }
}
