import type { Track } from '../../domain/models';

type Props = {
  track: Track;
  artistFallback?: string;
  liked: boolean;
  busy: boolean;
  onToggleLike: (track: Track) => void;
  isCurrent: boolean;
  isPlaying: boolean;
  isLoading: boolean;
  onPlay: () => void;
  onOpenDetails: () => void;
};

export function TrackCard({ track, artistFallback, liked, busy, onToggleLike, isCurrent, isPlaying, isLoading, onPlay, onOpenDetails }: Props) {
  const likeLabel = liked ? 'Убрать из лайков' : 'Добавить в лайки';

  return (
    <article className="track-card">
      <div className="track-cover">
        <button className="track-cover-image track-details-trigger" type="button" onClick={onOpenDetails} aria-label={`Подробнее о треке ${track.title}`}>
          {track.artwork
            ? <img src={track.artwork} alt="" loading="lazy" />
            : <div className="track-cover-fallback" aria-hidden="true">♫</div>}
        </button>
        <button
          className={`track-play-button ${isCurrent && isPlaying ? 'is-playing' : ''}`}
          type="button"
          aria-label={isCurrent && isPlaying ? `Пауза: ${track.title}` : `Воспроизвести: ${track.title}`}
          title={isCurrent && isPlaying ? 'Пауза' : 'Воспроизвести'}
          aria-busy={isLoading}
          disabled={isLoading}
          onClick={onPlay}
        >
          {isLoading ? <span className="player-spinner" /> : isCurrent && isPlaying ? 'Ⅱ' : '▶'}
        </button>
        {/* Кнопка лайка временно отключена по запросу; API и обработчик сохранены.
        <button
          type="button"
          className={`track-like-button track-like-overlay ${liked ? 'is-liked' : 'is-unliked'} ${busy ? 'is-pending' : ''}`}
          aria-pressed={liked}
          aria-label={likeLabel}
          title={likeLabel}
          aria-busy={busy}
          disabled={busy}
          onClick={() => onToggleLike(track)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" />
          </svg>
        </button>
        */}
      </div>
      <div className="track-details">
        <button className="track-title track-details-trigger" type="button" onClick={onOpenDetails} title={track.title}>{track.title}</button>
        <span className="track-artist">{track.artist.name || artistFallback || 'SoundCloud'}</span>
        <div className="track-stats">
          <span><i aria-hidden="true">▶</i> {Number(track.playCount ?? 0).toLocaleString('ru-RU')}</span>
          <span><i aria-hidden="true">♥</i> {Number(track.likeCount ?? 0).toLocaleString('ru-RU')}</span>
        </div>
      </div>
    </article>
  );
}
