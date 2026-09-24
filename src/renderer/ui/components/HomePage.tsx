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
    <div className="page-content home-page">
      <div className="category-tabs" aria-label="Разделы главной"><span className="category active">Для тебя</span><span className="category">Музыка</span><span className="category">Подкасты</span></div>
      <section className="welcome">
        <div className="welcome-copy"><div className="eyebrow">ТВОЯ МУЗЫКА, ТВОЙ РИТМ</div>
        <h1>Открой что-то новое</h1>
        <p>Персональные подборки SoundCloud для тебя.</p></div>
        <div className="welcome-art" aria-hidden="true"><i />sound<b>cloud</b></div>
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
