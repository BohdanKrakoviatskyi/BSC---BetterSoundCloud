import type { Track, TrackCollection } from '../../domain/models';
import { TrackCarouselSection } from './TrackCarouselSection';

type Props = {
  selections: TrackCollection[];
  loading: boolean;
  error: string;
  history: Track[];
  historyLoading: boolean;
  historyError: string;
  artistFallback?: string;
  currentTrackId: number | null;
  isPlaying: boolean;
  playbackLoading: boolean;
  onPlayTrack: (track: Track) => void;
  onOpenTrack: (track: Track) => void;
  onClearHistory: () => void;
  onRetry: () => void;
};

function HomeSkeleton() {
  return (
    <div className="home-skeleton" role="status" aria-label="Загружаем главную страницу">
      {[0, 1].map((section) => (
        <section className="home-skeleton-section" key={section}>
          <div className="home-skeleton-heading">
            <span className="home-skeleton-kicker" />
            <span className="home-skeleton-title" />
          </div>
          <div className="home-skeleton-row" aria-hidden="true">
            {Array.from({ length: 5 }, (_, card) => (
              <div className="home-skeleton-card" key={card}>
                <span className="home-skeleton-art" />
                <span className="home-skeleton-line" />
                <span className="home-skeleton-line short" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function HomePage({ selections, loading, error, history, historyLoading, historyError, artistFallback, currentTrackId, isPlaying, playbackLoading, onPlayTrack, onOpenTrack, onClearHistory, onRetry }: Props) {
  const visibleSelections = selections.filter((selection) => selection.title.trim().toLowerCase() !== 'recently played');

  return (
    <div className="page-content home-page">
      {error && <div className="error-message" role="alert">{error} <button type="button" className="home-retry" onClick={onRetry}>Повторить</button></div>}
      <TrackCarouselSection
        title="Недавние"
        kicker="ИСТОРИЯ ПРОСЛУШИВАНИЙ"
        tracks={history}
        artistFallback={artistFallback}
        loading={historyLoading}
        error={historyError}
        emptyMessage="Ты пока ничего не слушал. Включи любой трек — он появится здесь."
        onClear={onClearHistory}
        currentTrackId={currentTrackId}
        isPlaying={isPlaying}
        playbackLoading={playbackLoading}
        onPlayTrack={onPlayTrack}
        onOpenTrack={onOpenTrack}
      />
      {loading && visibleSelections.length === 0
        ? <HomeSkeleton />
        : visibleSelections.length === 0
          ? !error && <p className="tracks-empty">Персональные подборки пока недоступны.</p>
          : visibleSelections.map((selection) => (
              <TrackCarouselSection
                key={selection.id}
                title={selection.title}
                kicker={selection.description || 'SOUNDCLOUD'}
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
