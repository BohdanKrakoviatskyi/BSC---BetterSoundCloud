import type { Track } from '../../domain/models';
import { TrackCard } from './TrackCard';

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
  return (
    <section className="shelf" aria-label="Мои лайки">
      <div className="section-heading">
        <div>
          <div className="eyebrow">МЕДИАТЕКА SOUNDCLOUD</div>
          <h2>Треки из моих лайков <span className="track-count">{tracks.length}</span></h2>
        </div>
        <div className="tracks-actions">
          <button className="text-action" type="button" onClick={onRefresh} disabled={loading}>
            {loading ? 'Загружаю…' : 'Обновить'} <span aria-hidden="true">↻</span>
          </button>
        </div>
      </div>
      {error && <div className="error-message" role="alert">{error}</div>}
      {loading && tracks.length === 0
        ? <p className="tracks-empty">Загружаю ваши треки…</p>
        : tracks.length === 0
          ? <p className="tracks-empty">В лайках пока нет треков.</p>
          : <div className="liked-tracks-grid">
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
