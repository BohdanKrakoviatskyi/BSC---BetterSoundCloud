import type { CSSProperties } from 'react';
import type { ArtistProfile, Playlist, Track } from '../../domain/models';
import { TrackCarouselSection } from './TrackCarouselSection';
import { ErrorMessage } from './ErrorMessage';
import { PlaylistCarouselSection } from './PlaylistCarouselSection';
import { FaArrowLeft, FaPlay } from '../lib/icons';
import { formatCount, initials } from '../lib/format';

type Props = {
  profile: ArtistProfile | null;
  loading: boolean;
  error: string;
  tracks: Track[];
  tracksLoading: boolean;
  tracksError: string;
  likedTracks: Track[];
  likedTracksLoading: boolean;
  likedTracksError: string;
  playlists: Playlist[];
  playlistsLoading: boolean;
  playlistsError: string;
  currentTrackId: number | null;
  isPlaying: boolean;
  playbackLoading: boolean;
  onPlayTrack: (track: Track) => void;
  onOpenTrack: (track: Track, context: Track[]) => void;
  onOpenPlaylist: (playlist: Playlist) => void;
  onSocialTab: (tab: 'followers' | 'followings') => void;
  onViewTracks: () => void;
  onViewLikes: () => void;
  onBack: () => void;
};

function ArtistProfileSkeleton() {
  return <article className="page-content artist-profile-page artist-profile-skeleton" aria-label="Загружаю профиль автора" aria-busy="true">
    <div className="artist-skeleton-hero">
      <i className="artist-skeleton-block artist-skeleton-avatar" />
      <div className="artist-skeleton-identity"><i className="artist-skeleton-block artist-skeleton-name" /><i className="artist-skeleton-block artist-skeleton-full-name" /><i className="artist-skeleton-block artist-skeleton-meta" /></div>
      <div className="artist-skeleton-stats"><i /><i /><i /></div>
    </div>
    <div className="artist-skeleton-overview"><i className="artist-skeleton-block artist-skeleton-avatar small" /><div><i className="artist-skeleton-block artist-skeleton-name small-name" /><i className="artist-skeleton-block artist-skeleton-description" /></div></div>
    {[0, 1, 2].map((section) => <section className="artist-skeleton-section" key={section}>
      <i className="artist-skeleton-block artist-skeleton-heading" />
      <div>{[0, 1, 2, 3, 4].map((card) => <i className="artist-skeleton-block artist-skeleton-card" key={card} />)}</div>
    </section>)}
  </article>;
}

export function ArtistProfilePage({ profile, loading, error, tracks, tracksLoading, tracksError, likedTracks, likedTracksLoading, likedTracksError, playlists, playlistsLoading, playlistsError, currentTrackId, isPlaying, playbackLoading, onPlayTrack, onOpenTrack, onOpenPlaylist, onSocialTab, onViewTracks, onViewLikes, onBack }: Props) {
  if (loading && !profile) return <ArtistProfileSkeleton />;
  if (!profile) return <div className="track-details-error"><p>{error || 'Не удалось загрузить профиль автора.'}</p><button type="button" onClick={onBack}>Назад</button></div>;

  const displayName = profile.fullName || profile.username;
  const username = profile.username || displayName;
  const location = [profile.city, profile.country].filter(Boolean).join(', ');
  const heroStyle = {
    '--hero': profile.banner ? `url("${profile.banner}")` : profile.avatar ? `url("${profile.avatar}")` : 'radial-gradient(ellipse at 30% 20%, #4a2c28, #17171a 68%)',
    '--hero-background': profile.banner ? `url("${profile.banner}")` : profile.avatar ? `url("${profile.avatar}")` : 'radial-gradient(ellipse at 30% 20%, #4a2c28, #17171a 68%)',
  } as CSSProperties;

  return (
    <article className="page-content artist-profile-page" key={profile.id}>
      <section className="artist-hero" style={heroStyle}>
        <button className="track-detail-back artist-profile-back" type="button" onClick={onBack}><FaArrowLeft aria-hidden="true" /> Назад</button>
        <div className="artist-hero-copy">
          <span aria-hidden="false">
            {profile.verified && <span className="artist-verified-badge" title="Подтверждённый аккаунт">✓</span>}
          </span>
          <h1>{username}</h1>
          <p className="artist-hero-full-name">{displayName}</p>
          <p>
            {location && <span>{location} · </span>}
            {formatCount(profile.trackCount)} треков · {formatCount(profile.followersCount)} подписчиков
          </p>
          <div className="detail-buttons">
            <button className="play-button large" type="button" disabled={!tracks.length} onClick={() => tracks[0] && onPlayTrack(tracks[0])} aria-label="Слушать топ трек автора"><FaPlay /></button>
          </div>
        </div>
      </section>

      <section className="profile-overview artist-profile-overview">
        {profile.avatar ? <img className="big-profile round-art" src={profile.avatar} alt="" /> : <span className="big-profile round-art profile-fallback">{initials(displayName)}</span>}
        <div>
          <h2>{profile.username}</h2>
          <p>{profile.description || 'Автор пока не добавил описание профиля.'}</p>
        </div>
        <div className="artist-stat-chips" aria-label="Статистика автора">
          <span className="chip"><strong>{formatCount(profile.trackCount)}</strong> треков</span>
          <button className="chip artist-social-chip" type="button" onClick={() => onSocialTab('followers')}><strong>{formatCount(profile.followersCount)}</strong> подписчиков</button>
          <button className="chip artist-social-chip" type="button" onClick={() => onSocialTab('followings')}><strong>{formatCount(profile.followingsCount)}</strong> подписок</button>
        </div>
      </section>

      {error && <ErrorMessage message={error} className="track-detail-inline-error" />}

      {likedTracks.length > 0 && <TrackCarouselSection
        title="Понравившиеся треки"
        kicker="ПУБЛИЧНЫЕ ЛАЙКИ"
        tracks={likedTracks}
        totalCount={profile.likesCount}
        loading={likedTracksLoading}
        error={likedTracksError}
        emptyMessage="Публичные лайки не найдены или скрыты автором."
        currentTrackId={currentTrackId}
        isPlaying={isPlaying}
        playbackLoading={playbackLoading}
        onPlayTrack={onPlayTrack}
        onOpenTrack={onOpenTrack}
        onViewAll={onViewLikes}
      />}
      <TrackCarouselSection
        title="Треки автора"
        kicker="ЗАГРУЖЕНО НА SOUNDCLOUD"
        tracks={tracks}
        loading={tracksLoading}
        error={tracksError}
        emptyMessage="Автор пока не опубликовал ни одного трека."
        currentTrackId={currentTrackId}
        isPlaying={isPlaying}
        playbackLoading={playbackLoading}
        onPlayTrack={onPlayTrack}
        onOpenTrack={onOpenTrack}
        onViewAll={onViewTracks}
      />
      <PlaylistCarouselSection
        title="Плейлисты автора"
        playlists={playlists}
        loading={playlistsLoading}
        error={playlistsError}
        onOpenPlaylist={onOpenPlaylist}
      />
    </article>
  );
}
