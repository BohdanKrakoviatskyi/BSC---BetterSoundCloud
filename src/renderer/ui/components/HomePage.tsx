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

export function HomePage({ selections, loading, error, history, historyLoading, historyError, artistFallback, currentTrackId, isPlaying, playbackLoading, onPlayTrack, onOpenTrack, onClearHistory, onRetry }: Props) {
  return (
    <div className="page-content home-page">
      <div className="category-tabs" aria-label="Разделы главной"><span className="category active">Для тебя</span><span className="category">Музыка</span><span className="category">Подкасты</span></div>
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
