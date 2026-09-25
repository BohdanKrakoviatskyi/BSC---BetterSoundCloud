import type { Playlist, Settings, Track } from '../domain/models';
import type { TrackStream } from './backendDtos';
import { mapCollection, mapPlaylist, mapProfile, mapTrack, mapTrackDetails } from './mappers';

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
  trackStream: (trackUrn: string): Promise<TrackStream> => window.desktop.trackStream(trackUrn),
  searchTracks: async (query: string) => (await window.desktop.searchTracks(query)).map(mapTrack),
  relatedTracks: async (trackId: number) => (await window.desktop.relatedTracks(trackId)).map(mapTrack),
  mixedSelections: async () => (await window.desktop.mixedSelections()).map(mapCollection),
  likeTrack: (trackId: number, trackUrn: string, datadomeCookie?: string) => window.desktop.likeTrack(trackId, trackUrn, datadomeCookie),
  unlikeTrack: (trackId: number, trackUrn: string, datadomeCookie?: string) => window.desktop.unlikeTrack(trackId, trackUrn, datadomeCookie),
};
