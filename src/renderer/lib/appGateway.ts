import type { SoundCloudMixedSelection, SoundCloudSearchTrack, SoundCloudTrack, SoundCloudTrackDetails, SoundCloudUserProfile, TrackStream } from './desktop';
import type { ArtistProfile, Playlist, Profile, Settings, Track, TrackCollection, TrackDetails, TrackLyrics } from '../domain/models';
import type { AuthStatus } from './desktop';

function mapTrack(source: SoundCloudTrack | SoundCloudSearchTrack): Track {
  return {
    id: source.id,
    urn: source.trackUrn,
    title: source.title,
    permalink: source.permalinkUrl,
    artwork: source.artworkUrl,
    durationMs: source.duration,
    playCount: source.playbackCount,
    likeCount: source.likesCount,
    artist: { name: source.user?.username || '' },
  };
}

function mapTrackDetails(source: SoundCloudTrackDetails): TrackDetails {
  const track = mapTrack(source);
  return {
    ...track,
    description: source.description,
    genre: source.genre,
    tags: source.tagList,
    createdAt: source.createdAt,
    displayDate: source.displayDate,
    repostCount: source.repostsCount,
    commentCount: source.commentCount,
    waveform: source.waveformUrl,
    artist: {
      ...track.artist,
      id: source.user?.id,
      avatar: source.user?.avatarUrl,
      permalink: source.user?.permalinkUrl,
      followerCount: source.user?.followersCount,
    },
  };
}

function mapArtistProfile(source: SoundCloudUserProfile): ArtistProfile {
  return {
    id: source.id,
    username: source.username,
    fullName: source.fullName,
    permalink: source.permalinkUrl,
    avatar: source.avatarUrl,
    banner: source.bannerUrl,
    description: source.description,
    city: source.city,
    country: source.country,
    followersCount: source.followersCount,
    followingsCount: source.followingsCount,
    trackCount: source.trackCount,
    verified: source.verified,
  };
}

function mapCollection(source: SoundCloudMixedSelection): TrackCollection {
  return {
    id: source.id,
    title: source.title,
    description: source.description,
    tracks: source.tracks.map(mapTrack),
    playlists: source.playlists?.map(mapPlaylist),
    madeForYou: source.madeForYou,
  };
}

function mapPlaylist(source: { id: string; urn?: string; title: string; permalinkUrl?: string; artworkUrl?: string; trackCount: number; user: { username: string } }): Playlist {
  return {
    id: source.id,
    urn: source.urn,
    title: source.title,
    permalink: source.permalinkUrl,
    artwork: source.artworkUrl,
    trackCount: source.trackCount,
    artist: source.user?.username || '',
  };
}

function mapProfile(profile: AuthStatus['profile']): Profile | null {
  if (!profile) return null;
  return {
    id: profile.id,
    username: profile.username,
    fullName: profile.fullName,
    permalinkUrl: profile.permalinkUrl,
    avatarUrl: profile.avatarUrl,
    city: profile.city,
    country: profile.country,
    followersCount: profile.followersCount,
    trackCount: profile.trackCount,
    likesCount: profile.likesCount,
  };
}

export const appGateway = {
  start: () => window.desktop.start(),
  stop: () => window.desktop.stop(),
  getSettings: (): Promise<Settings> => window.desktop.getSettings(),
  updateSettings: (patch: Partial<Settings>): Promise<Settings> => window.desktop.updateSettings(patch),
  clearAppData: (): Promise<Settings> => window.desktop.clearAppData(),
  historyList: async () => (await window.desktop.historyList()).map(mapTrack),
  historyRecord: async (track: Track) => (await window.desktop.historyRecord({
    id: track.id,
    trackUrn: track.urn,
    title: track.title,
    permalinkUrl: track.permalink,
    artworkUrl: track.artwork,
    duration: track.durationMs,
    playbackCount: track.playCount,
    likesCount: track.likeCount,
    user: { username: track.artist.name },
  })).map(mapTrack),
  historyClear: async () => (await window.desktop.historyClear()).map(mapTrack),
  authStatus: async () => {
    const status = await window.desktop.authStatus();
    return { authorized: status.authorized, profile: mapProfile(status.profile) ?? undefined };
  },
  authRefresh: async () => {
    const status = await window.desktop.authRefresh();
    return { authorized: status.authorized, profile: mapProfile(status.profile) ?? undefined };
  },
  authLogin: async (token: string) => {
    const status = await window.desktop.authLogin(token);
    return { authorized: status.authorized, profile: mapProfile(status.profile) ?? undefined };
  },
  authLogout: () => window.desktop.authLogout(),
  myTracks: async () => (await window.desktop.myTracks()).map(mapTrack),
  myPlaylists: async (): Promise<Playlist[]> => (await window.desktop.myPlaylists()).map(mapPlaylist),
  playlistTracks: async (playlistUrn: string) => (await window.desktop.playlistTracks(playlistUrn)).map(mapTrack),
  trackDetails: async (trackId: number) => mapTrackDetails(await window.desktop.trackDetails(trackId)),
  trackLyrics: async (track: Track): Promise<TrackLyrics> => window.desktop.trackLyrics(track.id, track.title, track.artist.name, track.durationMs),
  trackStream: (trackUrn: string): Promise<TrackStream> => window.desktop.trackStream(trackUrn),
  searchTracks: async (query: string) => (await window.desktop.searchTracks(query)).map(mapTrack),
  relatedTracks: async (trackId: number) => (await window.desktop.relatedTracks(trackId)).map(mapTrack),
  mixedSelections: async () => (await window.desktop.mixedSelections()).map(mapCollection),
  artistProfile: async (userId: number) => mapArtistProfile(await window.desktop.userProfile(userId)),
  artistTracks: async (userId: number) => (await window.desktop.userTracks(userId)).map(mapTrack),
  artistPlaylists: async (userId: number): Promise<Playlist[]> => (await window.desktop.userPlaylists(userId)).map(mapPlaylist),
  likeTrack: (trackId: number, trackUrn: string, datadomeCookie?: string) => window.desktop.likeTrack(trackId, trackUrn, datadomeCookie),
  unlikeTrack: (trackId: number, trackUrn: string, datadomeCookie?: string) => window.desktop.unlikeTrack(trackId, trackUrn, datadomeCookie),
};
