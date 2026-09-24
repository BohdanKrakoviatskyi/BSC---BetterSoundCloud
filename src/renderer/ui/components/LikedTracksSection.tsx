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
  const uniqueTracks = Array.from(new Map(tracks.map((track) => [track.id, track])).values());

  function scrollCarousel(direction: -1 | 1) {
    if (!carouselRef.current) return;
    carouselRef.current.scrollBy({ left: direction * carouselRef.current.clientWidth * 0.8, behavior: 'smooth' });
  }

  return (
    <section className="shelf" aria-label="Мои лайки">
      <div className="section-heading">
        <div>
          <div className="eyebrow">МЕДИАТЕКА SOUNDCLOUD</div>
          <h2>Треки из моих лайков <span className="track-count">{tracks.length}</span></h2>
        </div>
        <div className="tracks-actions">
          <div className="carousel-controls" aria-label="Прокрутка треков">
            <button type="button" aria-label="Прокрутить влево" onClick={() => scrollCarousel(-1)}>‹</button>
            <button type="button" aria-label="Прокрутить вправо" onClick={() => scrollCarousel(1)}>›</button>
          </div>
          <button className="text-action" type="button" onClick={onRefresh} disabled={loading}>
            {loading ? 'Загружаю…' : 'Обновить'} <span aria-hidden="true">↻</span>
          </button>
        </div>
      </div>
      {error && <div className="error-message" role="alert">{error}</div>}
      {loading && tracks.length === 0
        ? <p className="tracks-empty">Загружаю ваши треки…</p>
          : uniqueTracks.length === 0
            ? <p className="tracks-empty">В лайках пока нет треков.</p>
          : <div ref={carouselRef} className="card-row">
            {uniqueTracks.map((track) => (
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
