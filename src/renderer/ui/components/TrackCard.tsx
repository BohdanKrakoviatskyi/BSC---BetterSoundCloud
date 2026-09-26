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
  onOpenArtist?: () => void;
};

export function TrackCard({ track, artistFallback, isCurrent, isPlaying, isLoading, onPlay, onOpenDetails, onOpenArtist }: Props) {
  return (
    <article className="music-card">
      <div className="music-cover-wrap">
        <button className="cover-button" type="button" onClick={onOpenDetails} aria-label={`Подробнее о треке ${track.title}`}>
          {track.artwork ? <img className="cover" src={track.artwork} alt="" loading="lazy" /> : <div className="cover cover-fallback" aria-hidden="true">♫</div>}
        </button>
        <button
          className={`cover-play ${isCurrent && isPlaying ? 'is-playing' : ''}`}
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
      <button className="card-title" type="button" onClick={onOpenDetails} title={track.title}>{track.title}</button>
      <button className="card-subtitle" type="button" onClick={onOpenArtist} title="Открыть профиль автора" aria-disabled={!onOpenArtist}>{track.artist.name || artistFallback || 'SoundCloud'}</button>
      <div className="card-stats"><span>▶ {Number(track.playCount ?? 0).toLocaleString('ru-RU')}</span><span>♥ {Number(track.likeCount ?? 0).toLocaleString('ru-RU')}</span></div>
    </article>
  );
}
