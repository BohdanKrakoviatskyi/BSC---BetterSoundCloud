import type { Track, TrackCollection } from '../../domain/models';
import { TrackCarouselSection } from './TrackCarouselSection';

type Props = {
  selections: TrackCollection[];
  loading: boolean;
  error: string;
  artistFallback?: string;
  currentTrackId: number | null;
  isPlaying: boolean;
  playbackLoading: boolean;
  onPlayTrack: (track: Track) => void;
  onOpenTrack: (track: Track) => void;
  onRetry: () => void;
};

export function HomePage({ selections, loading, error, artistFallback, currentTrackId, isPlaying, playbackLoading, onPlayTrack, onOpenTrack, onRetry }: Props) {
  return (
    <div className="home-page">
      <section className="home-welcome">
        <div className="card-kicker">ВАША МУЗЫКА</div>
        <h1>Откройте что-то новое</h1>
        <p>Персональные подборки и миксы SoundCloud для вас.</p>
      </section>
      {error && <div className="error-message" role="alert">{error} <button type="button" className="home-retry" onClick={onRetry}>Повторить</button></div>}
      {loading && selections.length === 0
        ? <p className="tracks-empty">Загружаю подборки SoundCloud…</p>
        : selections.length === 0
          ? !error && <p className="tracks-empty">Персональные подборки пока недоступны.</p>
          : selections.map((selection) => (
              <TrackCarouselSection
                key={selection.id}
                title={selection.title}
                kicker={selection.description || 'ПОДБОРКА ДЛЯ ВАС'}
                tracks={selection.tracks}
                artistFallback={artistFallback}
                currentTrackId={currentTrackId}
                isPlaying={isPlaying}
                playbackLoading={playbackLoading}
                onPlayTrack={onPlayTrack}
                onOpenTrack={onOpenTrack}
              />
            ))}
    </div>
  );
}
