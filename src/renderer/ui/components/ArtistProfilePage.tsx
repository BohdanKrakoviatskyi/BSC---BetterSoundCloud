import type { CSSProperties } from 'react';
import type { ArtistProfile, Track } from '../../domain/models';
import { TrackCarouselSection } from './TrackCarouselSection';
import { ErrorMessage } from './ErrorMessage';

type Props = {
  profile: ArtistProfile | null;
  loading: boolean;
  error: string;
  tracks: Track[];
  tracksLoading: boolean;
  tracksError: string;
  currentTrackId: number | null;
  isPlaying: boolean;
  playbackLoading: boolean;
  onPlayTrack: (track: Track) => void;
  onOpenTrack: (track: Track, context: Track[]) => void;
  onBack: () => void;
};

function formatCount(value?: number): string {
  return Number(value || 0).toLocaleString('ru-RU');
}

export function ArtistProfilePage({ profile, loading, error, tracks, tracksLoading, tracksError, currentTrackId, isPlaying, playbackLoading, onPlayTrack, onOpenTrack, onBack }: Props) {
  if (loading && !profile) return <div className="track-details-loading">Загружаю профиль автора…</div>;
  if (!profile) return <div className="track-details-error"><p>{error || 'Не удалось загрузить профиль автора.'}</p><button type="button" onClick={onBack}>Назад</button></div>;

  const displayName = profile.fullName || profile.username;
  const location = [profile.city, profile.country].filter(Boolean).join(', ');
  const heroStyle = {
    '--hero': profile.banner ? `url("${profile.banner}")` : profile.avatar ? `url("${profile.avatar}")` : 'radial-gradient(ellipse at 30% 20%, #4a2c28, #17171a 68%)',
  } as CSSProperties;

  return (
    <article className="page-content artist-profile-page" key={profile.id}>
      <section className="artist-hero" style={heroStyle}>
        <button className="track-detail-back artist-profile-back" type="button" onClick={onBack}><span aria-hidden="true">←</span> Назад</button>
        <div className="artist-hero-copy">
          <span aria-hidden="false">
            {profile.verified && <span className="artist-verified-badge" title="Подтверждённый аккаунт">✓</span>}
            ПРОФИЛЬ SOUNDCLOUD
          </span>
          <h1>{displayName}</h1>
          <p>
            {location && <span>{location} · </span>}
            {formatCount(profile.trackCount)} треков · {formatCount(profile.followersCount)} подписчиков
          </p>
          <div className="detail-buttons">
            <button className="play-button large" type="button" disabled={!tracks.length} onClick={() => tracks[0] && onPlayTrack(tracks[0])} aria-label="Слушать топ трек автора">▶</button>
          </div>
        </div>
      </section>

      <section className="profile-overview artist-profile-overview">
        {profile.avatar ? <img className="big-profile round-art" src={profile.avatar} alt="" /> : <span className="big-profile round-art profile-fallback">{displayName.slice(0, 2).toUpperCase()}</span>}
        <div>
          <h2>{profile.username}</h2>
          <p>{profile.description || 'Автор пока не добавил описание профиля.'}</p>
        </div>
        <div className="artist-stat-chips" aria-label="Статистика автора">
          <span className="chip"><strong>{formatCount(profile.trackCount)}</strong> треков</span>
          <span className="chip"><strong>{formatCount(profile.followersCount)}</strong> подписчиков</span>
          <span className="chip"><strong>{formatCount(profile.followingsCount)}</strong> подписок</span>
        </div>
      </section>

      {error && <ErrorMessage message={error} className="track-detail-inline-error" />}

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
      />
    </article>
  );
}
