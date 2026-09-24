import type { Track } from '../../domain/models';
import { TrackCard } from './TrackCard';
import { useRef } from 'react';

type Props = {
  tracks: Track[];
  likedTracks: Record<number, boolean>;
  likeBusy: Record<number, boolean>;
  loading: boolean;
  error: string;
  artistFallback?: string;
  onRefresh: () => void;
  onToggleLike: (track: Track) => void;
  onPlayTrack: (track: Track) => void;
  onOpenTrack: (track: Track) => void;
  currentTrackId: number | null;
  isPlaying: boolean;
  playbackLoading: boolean;
};

export function LikedTracksSection({ tracks, likedTracks, likeBusy, loading, error, artistFallback, onRefresh, onToggleLike, onPlayTrack, onOpenTrack, currentTrackId, isPlaying, playbackLoading }: Props) {
  const carouselRef = useRef<HTMLDivElement>(null);

  function scrollCarousel(direction: -1 | 1) {
    if (!carouselRef.current) return;
    carouselRef.current.scrollBy({ left: direction * carouselRef.current.clientWidth * 0.8, behavior: 'smooth' });
  }

  return (
    <section className="tracks-section" aria-label="Мои лайки">
      <div className="panel-heading tracks-heading">
        <div>
          <div className="card-kicker">МЕДИАТЕКА SOUNDCLOUD</div>
          <h2>Треки из моих лайков <span className="track-count">{tracks.length}</span></h2>
        </div>
        <div className="tracks-actions">
          <div className="carousel-controls" aria-label="Прокрутка треков">
            <button type="button" aria-label="Прокрутить влево" onClick={() => scrollCarousel(-1)}>‹</button>
            <button type="button" aria-label="Прокрутить вправо" onClick={() => scrollCarousel(1)}>›</button>
          </div>
          <button className="refresh-tracks" type="button" onClick={onRefresh} disabled={loading}>
            {loading ? 'Загружаю…' : 'Обновить'}
          </button>
        </div>
      </div>
      {error && <div className="error-message" role="alert">{error}</div>}
      {loading && tracks.length === 0
        ? <p className="tracks-empty">Загружаю ваши треки…</p>
        : tracks.length === 0
          ? <p className="tracks-empty">В лайках пока нет треков.</p>
          : <div ref={carouselRef} className="track-carousel">
            {tracks.map((track) => (
              <TrackCard
                key={track.id}
                track={track}
                artistFallback={artistFallback}
                liked={likedTracks[track.id] ?? true}
                busy={likeBusy[track.id] ?? false}
                onToggleLike={onToggleLike}
                isCurrent={currentTrackId === track.id}
                isPlaying={currentTrackId === track.id && isPlaying}
                isLoading={currentTrackId === track.id && playbackLoading}
                onPlay={() => onPlayTrack(track)}
                onOpenDetails={() => onOpenTrack(track)}
              />
            ))}
          </div>}
    </section>
  );
}
