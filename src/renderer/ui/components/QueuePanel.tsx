import type { Track } from '../../domain/models';
import { FaListUl, FaMinus, FaPause, FaPlay, FaPlus, FaXmark } from '../lib/icons';
import { formatDuration } from '../lib/format';

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

export function QueuePanel({ tracks, currentTrack, queueState, onAddCurrentTrack, onToggleQueuePlayback, onPlay, onRemove, currentQueueIndex, onClear, onClose }: Props) {
  return (
    <section className="queue-panel" aria-label="Очередь воспроизведения" role="dialog">
      <header className="queue-panel-header">
        <h2>Очередь</h2>
        <button className={`queue-play-all${queueState === 'playing' ? ' is-playing' : ''}`} type="button" onClick={onToggleQueuePlayback} disabled={!tracks.length} aria-pressed={queueState === 'playing'} title={queueState === 'playing' ? 'Пауза очереди' : queueState === 'paused' ? 'Продолжить очередь' : 'Играть песни из очереди'}>
          {queueState === 'playing'
            ? <FaPause aria-hidden="true" />
            : <FaPlay aria-hidden="true" />}
          <span>{queueState === 'playing' ? 'Пауза очереди' : queueState === 'paused' ? 'Продолжить очередь' : 'Играть очередь'}</span>
        </button>
        <button className="queue-add-current" type="button" onClick={onAddCurrentTrack} disabled={!currentTrack} title="Добавить текущую песню в очередь">
          <FaListUl aria-hidden="true" />
          <span>Добавить</span>
        </button>
        <button className="queue-clear" type="button" onClick={onClear} disabled={!tracks.length}>Очистить</button>
        <button className="queue-close" type="button" onClick={onClose} aria-label="Закрыть очередь">
          <FaXmark aria-hidden="true" />
        </button>
      </header>
      {tracks.length ? (
        <div className="queue-list">
          {tracks.map((track, index) => (
            <div className={`queue-track${index === currentQueueIndex ? ' is-current' : ''}`} key={`${track.id}-${index}`}>
              <button className="queue-track-select" type="button" onClick={() => onPlay(index)} aria-current={index === currentQueueIndex ? 'true' : undefined}>
                {track.artwork ? <img src={track.artwork} alt="" /> : <span className="queue-art-fallback"><FaPlus aria-hidden="true" style={{ transform: 'rotate(45deg)' }} /></span>}
                <span className="queue-track-copy"><small>{track.artist.name || 'SoundCloud'}</small><b>{track.title}</b></span>
                <time>{formatDuration(track.durationMs)}</time>
              </button>
              <button className="queue-track-remove" type="button" onClick={() => onRemove(index)} aria-label={`Убрать «${track.title}» из очереди`} title="Убрать из очереди">
                <FaMinus aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      ) : <p className="queue-empty">Очередь пуста. Добавьте трек кнопкой рядом с лайком.</p>}
    </section>
  );
}
