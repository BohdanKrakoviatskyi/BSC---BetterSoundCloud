import type { SoundCloudMixedSelection, SoundCloudSearchTrack, SoundCloudTrack, SoundCloudTrackDetails } from './desktop';
import type { Profile, Settings, Track, TrackCollection, TrackDetails } from '../domain/models';
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
      avatar: source.user?.avatarUrl,
      permalink: source.user?.permalinkUrl,
      followerCount: source.user?.followersCount,
    },
  };
}

function mapCollection(source: SoundCloudMixedSelection): TrackCollection {
  return { id: source.id, title: source.title, description: source.description, tracks: source.tracks.map(mapTrack) };
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
  trackDetails: async (trackId: number) => mapTrackDetails(await window.desktop.trackDetails(trackId)),
  searchTracks: async (query: string) => (await window.desktop.searchTracks(query)).map(mapTrack),
  relatedTracks: async (trackId: number) => (await window.desktop.relatedTracks(trackId)).map(mapTrack),
  mixedSelections: async () => (await window.desktop.mixedSelections()).map(mapCollection),
  likeTrack: (trackId: number, trackUrn: string) => window.desktop.likeTrack(trackId, trackUrn),
  unlikeTrack: (trackId: number, trackUrn: string) => window.desktop.unlikeTrack(trackId, trackUrn),
};
