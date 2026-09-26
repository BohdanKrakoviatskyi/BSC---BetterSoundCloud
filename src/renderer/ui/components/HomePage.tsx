import { Fragment } from 'react';
import type { Playlist, Track, TrackCollection } from '../../domain/models';
import { TrackCarouselSection } from './TrackCarouselSection';
import { PlaylistCarouselSection } from './PlaylistCarouselSection';
import { ErrorMessage } from './ErrorMessage';

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
  onOpenTrack: (track: Track, context: Track[]) => void;
  onOpenPlaylist: (playlist: Playlist) => void;
  onClearHistory: () => void;
  onRetry: () => void;
  onOpenArtist?: (track: Track) => void;
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

export function HomePage({ selections, loading, error, history, historyLoading, historyError, artistFallback, currentTrackId, isPlaying, playbackLoading, onPlayTrack, onOpenTrack, onOpenPlaylist, onClearHistory, onRetry, onOpenArtist }: Props) {
  const visibleSelections = selections.filter((selection) => selection.title.trim().toLowerCase() !== 'recently played');

  return (
    <div className="page-content home-page">
      {error && <ErrorMessage message={error} onRetry={onRetry} />}
      {history.length > 0
        ? <TrackCarouselSection
            title="Недавние"
            kicker=""
            tracks={history}
            artistFallback={artistFallback}
            loading={historyLoading}
            error={historyError}
            onClear={onClearHistory}
            onOpenArtist={onOpenArtist}
            currentTrackId={currentTrackId}
            isPlaying={isPlaying}
            playbackLoading={playbackLoading}
            onPlayTrack={onPlayTrack}
            onOpenTrack={onOpenTrack}
          />
        : historyError && <ErrorMessage message={historyError} />}
      {loading && visibleSelections.length === 0
        ? <HomeSkeleton />
        : visibleSelections.length === 0
          ? !error && <p className="tracks-empty">Персональные подборки пока недоступны.</p>
          : visibleSelections.map((selection) => (
              <Fragment key={selection.id}>
                {selection.madeForYou && selection.playlists && selection.playlists.length > 0 && (
                  <PlaylistCarouselSection
                    title="Специально для вас"
                    playlists={selection.playlists}
                    loading={false}
                    error=""
                    onOpenPlaylist={onOpenPlaylist}
                  />
                )}
                {selection.tracks.length > 0 && <TrackCarouselSection
                  title={selection.title}
                  kicker={selection.description || 'SOUNDCLOUD'}
                  tracks={selection.tracks}
                  artistFallback={artistFallback}
                  currentTrackId={currentTrackId}
                  isPlaying={isPlaying}
                  playbackLoading={playbackLoading}
                  onPlayTrack={onPlayTrack}
                  onOpenTrack={onOpenTrack}
                  onOpenArtist={onOpenArtist}
                />}
              </Fragment>
            ))}
    </div>
  );
}
