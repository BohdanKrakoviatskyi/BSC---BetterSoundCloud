import type { Track } from '../../domain/models';

type Props = {
  tracks: Track[];
  currentTrack: Track | null;
  queueState: 'idle' | 'playing' | 'paused';
  onAddCurrentTrack: () => void;
  onToggleQueuePlayback: () => void;
  onPlay: (index: number) => void;
  onRemove: (index: number) => void;
  currentQueueIndex: number;
  onClear: () => void;
  onClose: () => void;
};

function formatDuration(durationMs: number) {
  const totalSeconds = Math.floor((durationMs || 0) / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

export function QueuePanel({ tracks, currentTrack, queueState, onAddCurrentTrack, onToggleQueuePlayback, onPlay, onRemove, currentQueueIndex, onClear, onClose }: Props) {
  return (
    <section className="queue-panel" aria-label="Очередь воспроизведения" role="dialog">
      <header className="queue-panel-header">
        <h2>Очередь</h2>
        <button className={`queue-play-all${queueState === 'playing' ? ' is-playing' : ''}`} type="button" onClick={onToggleQueuePlayback} disabled={!tracks.length} aria-pressed={queueState === 'playing'} title={queueState === 'playing' ? 'Пауза очереди' : queueState === 'paused' ? 'Продолжить очередь' : 'Играть песни из очереди'}>
          {queueState === 'playing'
            ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM15 5h4v14h-4z" /></svg>
            : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 12 7-12 7z" /></svg>}
          <span>{queueState === 'playing' ? 'Пауза очереди' : queueState === 'paused' ? 'Продолжить очередь' : 'Играть очередь'}</span>
        </button>
        <button className="queue-add-current" type="button" onClick={onAddCurrentTrack} disabled={!currentTrack} title="Добавить текущую песню в очередь">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h12M4 11h12M4 16h7" /><path d="M18 15v7M14.5 18.5h7" /></svg>
          <span>Добавить</span>
        </button>
        <button className="queue-clear" type="button" onClick={onClear} disabled={!tracks.length}>Очистить</button>
        <button className="queue-close" type="button" onClick={onClose} aria-label="Закрыть очередь">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </header>
      {tracks.length ? (
        <div className="queue-list">
          {tracks.map((track, index) => (
            <div className={`queue-track${index === currentQueueIndex ? ' is-current' : ''}`} key={`${track.id}-${index}`}>
              <button className="queue-track-select" type="button" onClick={() => onPlay(index)} aria-current={index === currentQueueIndex ? 'true' : undefined}>
                {track.artwork ? <img src={track.artwork} alt="" /> : <span className="queue-art-fallback">♫</span>}
                <span className="queue-track-copy"><small>{track.artist.name || 'SoundCloud'}</small><b>{track.title}</b></span>
                <time>{formatDuration(track.durationMs)}</time>
              </button>
              <button className="queue-track-remove" type="button" onClick={() => onRemove(index)} aria-label={`Убрать «${track.title}» из очереди`} title="Убрать из очереди">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg>
              </button>
            </div>
          ))}
        </div>
      ) : <p className="queue-empty">Очередь пуста. Добавьте трек кнопкой рядом с лайком.</p>}
    </section>
  );
}
