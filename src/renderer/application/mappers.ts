import type { AuthStatus, SoundCloudMixedSelection, SoundCloudPlaylist, SoundCloudSearchTrack, SoundCloudTrack, SoundCloudTrackDetails } from './backendDtos';
import type { Playlist, Profile, Track, TrackCollection, TrackDetails } from '../domain/models';

export function mapTrack(source: SoundCloudTrack | SoundCloudSearchTrack): Track {
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

export function mapTrackDetails(source: SoundCloudTrackDetails): TrackDetails {
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

export function mapCollection(source: SoundCloudMixedSelection): TrackCollection {
  return { id: source.id, title: source.title, description: source.description, tracks: source.tracks.map(mapTrack) };
}

export function mapPlaylist(source: SoundCloudPlaylist): Playlist {
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

export function mapProfile(profile: AuthStatus['profile']): Profile | null {
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
