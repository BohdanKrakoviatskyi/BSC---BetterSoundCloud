import type { Track } from '../../domain/models';
import { TrackCard } from './TrackCard';
import { useEffect, useRef, useState } from 'react';

type Props = {
  title: string;
  kicker?: string;
  tracks: Track[];
  artistFallback?: string;
  loading?: boolean;
  error?: string;
  currentTrackId: number | null;
  isPlaying: boolean;
  playbackLoading: boolean;
  onPlayTrack: (track: Track) => void;
  onOpenTrack: (track: Track) => void;
};

export function TrackCarouselSection({ title, kicker = 'SOUNDCLOUD', tracks, artistFallback, loading = false, error = '', currentTrackId, isPlaying, playbackLoading, onPlayTrack, onOpenTrack }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [hasOverflow, setHasOverflow] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setHasOverflow(element.scrollWidth > element.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [tracks.length]);

  function scroll(direction: -1 | 1) {
    ref.current?.scrollBy({ left: direction * ref.current.clientWidth * 0.8, behavior: 'smooth' });
  }

  return (
    <section className="shelf" aria-label={title}>
      <div className="section-heading">
        <div><div className="eyebrow">{kicker}</div><h2>{title}<span className="track-count"> {tracks.length}</span></h2></div>
        {hasOverflow && <div className="carousel-controls" aria-label="Прокрутка треков"><button type="button" aria-label="Прокрутить влево" onClick={() => scroll(-1)}>‹</button><button type="button" aria-label="Прокрутить вправо" onClick={() => scroll(1)}>›</button></div>}
      </div>
      {error && <div className="error-message" role="alert">{error}</div>}
      {loading && tracks.length === 0
        ? <p className="tracks-empty">Загружаю подборку…</p>
        : tracks.length === 0
          ? <p className="tracks-empty">Пока нет треков для этой подборки.</p>
          : <div ref={ref} className={`card-row track-carousel ${hasOverflow ? 'has-overflow' : ''}`}>
              {tracks.map((track) => <TrackCard
                key={track.id}
                track={track}
                artistFallback={artistFallback}
                liked={false}
                busy={false}
                onToggleLike={() => undefined}
                isCurrent={currentTrackId === track.id}
                isPlaying={currentTrackId === track.id && isPlaying}
                isLoading={currentTrackId === track.id && playbackLoading}
                onPlay={() => onPlayTrack(track)}
                onOpenDetails={() => onOpenTrack(track)}
              />)}
            </div>}
    </section>
  );
}
