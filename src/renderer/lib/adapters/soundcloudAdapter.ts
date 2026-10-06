import type { ServiceProvider } from '../../domain/models';
import type {
  ArtistProfile,
  Playlist,
  Profile,
  ServiceCredentials,
  SocialPage,
  Track,
  TrackCollection,
  TrackDetails,
  TrackLyrics,
} from '../../domain/models';
import { appGateway } from '../appGateway';
import type { AdapterTrackStream, AuthResult, ServiceAdapter } from '../serviceAdapter';

/**
 * SoundCloud behind the ServiceAdapter interface.
 *
 * A wrapper and nothing more: appGateway is untouched, so the existing screens keep working exactly as
 * they do while they are migrated over one call site at a time. That is the whole point of this phase
 * — the app must not notice it.
 *
 * The ids are converted from number to string because the interface works in strings, for the other
 * services' sake. They round-trip: every method that takes an id accepts the string form of the same
 * number, and no hashing is involved, so nothing here can collide.
 */
export const soundcloudAdapter: ServiceAdapter = {
  service: 'soundcloud' as ServiceProvider,

  async authStatus(): Promise<AuthResult> {
    const status = await appGateway.authStatus();
    return { authorized: status.authorized, profile: status.profile ?? null };
  },

  async authLogin(credentials?: ServiceCredentials): Promise<AuthResult> {
    // The SoundCloud flow is an access token the user pastes or supplies through the auth window;
    // the stored credentials carry it. Nothing is forced into the existing signature.
    const token = credentials?.token;
    if (!token) {
      const status = await appGateway.authStatus();
      return { authorized: status.authorized, profile: status.profile ?? null };
    }
    const status = await appGateway.authLogin(token);
    return { authorized: status.authorized, profile: status.profile ?? null };
  },

  async authLogout(): Promise<void> {
    await appGateway.authLogout();
  },

  async authRefresh(): Promise<AuthResult> {
    const status = await appGateway.authRefresh();
    return { authorized: status.authorized, profile: status.profile ?? null };
  },

  myTracks: () => appGateway.myTracks(),
  myPlaylists: (): Promise<Playlist[]> => appGateway.myPlaylists(),
  playlistTracks: (playlistId: string): Promise<Track[]> => appGateway.playlistTracks(playlistId),

  trackDetails: (trackId: string): Promise<TrackDetails> => appGateway.trackDetails(Number(trackId)),

  async trackStream(track: Track): Promise<AdapterTrackStream> {
    // SoundCloud resolves a stream from the URN, which is why this takes the track.
    return appGateway.trackStream(track.urn);
  },

  trackLyrics: (track: Track): Promise<TrackLyrics> => appGateway.trackLyrics(track),

  searchTracks: (query: string): Promise<Track[]> => appGateway.searchTracks(query),
  relatedTracks: (trackId: string): Promise<Track[]> => appGateway.relatedTracks(Number(trackId)),
  mixedSelections: (): Promise<TrackCollection[]> => appGateway.mixedSelections(),

  artistProfile: (userId: string): Promise<ArtistProfile> => appGateway.artistProfile(Number(userId)),
  artistTracks: (userId: string): Promise<Track[]> => appGateway.artistTracks(Number(userId)),
  artistLikes: (userId: string, next?: string) => appGateway.artistLikes(Number(userId), next),
  artistPlaylists: (userId: string): Promise<Playlist[]> => appGateway.artistPlaylists(Number(userId)),
  artistFollowers: (userId: string, next?: string): Promise<SocialPage> =>
    appGateway.artistFollowers(Number(userId), next),
  artistFollowings: (userId: string, next?: string): Promise<SocialPage> =>
    appGateway.artistFollowings(Number(userId), next),

  // Both need the id and the URN, and may hand back a captcha URL for the flow the app already has.
  likeTrack: (track: Track) => appGateway.likeTrack(track.id, track.urn),
  unlikeTrack: (track: Track) => appGateway.unlikeTrack(track.id, track.urn),

  historyList: () => appGateway.historyList(),
  historyRecord: (track: Track): Promise<Track[]> => appGateway.historyRecord(track),
  historyClear: (): Promise<Track[]> => appGateway.historyClear(),
};

export type { Profile };
