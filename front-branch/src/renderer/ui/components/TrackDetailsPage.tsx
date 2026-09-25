import type { Track, TrackDetails } from '../../domain/models';
import { TrackCarouselSection } from './TrackCarouselSection';

type Props = {
  track: TrackDetails | null;
  loading: boolean;
  error: string;
  isCurrent: boolean;
  isPlaying: boolean;
  playbackLoading: boolean;
  relatedTracks: Track[];
  relatedLoading: boolean;
  relatedError: string;
  currentTrackId: number | null;
  isPlayingNow: boolean;
  onPlayRelated: (track: Track) => void;
  onOpenRelated: (track: Track) => void;
  onBack: () => void;
  onPlay: () => void;
};

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

function formatDate(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

function Stat({ icon, label, value }: { icon: string; label: string; value: number }) {
  return <div className="track-detail-stat"><span aria-hidden="true">{icon}</span><strong>{Number(value || 0).toLocaleString('ru-RU')}</strong><small>{label}</small></div>;
}

export function TrackDetailsPage({ track, loading, error, isCurrent, isPlaying, playbackLoading, relatedTracks, relatedLoading, relatedError, currentTrackId, isPlayingNow, onPlayRelated, onOpenRelated, onBack, onPlay }: Props) {
  if (loading && !track) return <div className="track-details-loading">Загружаю информацию о треке…</div>;
  if (!track) return <div className="track-details-error"><p>{error || 'Не удалось загрузить трек.'}</p><button type="button" onClick={onBack}>Вернуться к лайкам</button></div>;

  const date = formatDate(track.displayDate || track.createdAt);
  const tags = (track.tags || '').match(/"[^"]+"|\S+/g)?.map((tag) => tag.replace(/^"|"$/g, '')) ?? [];
  const artistName = track.artist.name || 'SoundCloud';

  return (
    <article className="track-detail-page">
      <button className="track-detail-back" type="button" onClick={onBack}><span aria-hidden="true">←</span> Мои лайки</button>
      <section className="track-detail-hero">
        <div className="track-detail-artwork-wrap">
          {track.artwork ? <img className="track-detail-artwork" src={track.artwork} alt={`Обложка: ${track.title}`} /> : <div className="track-detail-artwork track-detail-artwork-fallback">♫</div>}
        </div>
        <div className="track-detail-info">
          <div className="card-kicker">ТРЕК SOUNDCLOUD</div>
          <h1>{track.title}</h1>
          {track.artist.permalink
            ? <a className="track-detail-artist" href={track.artist.permalink} target="_blank" rel="noreferrer">{track.artist.avatar && <img src={track.artist.avatar} alt="" />}<span>{artistName}</span><span aria-hidden="true">↗</span></a>
            : <div className="track-detail-artist"><span>{artistName}</span></div>}
          <div className="track-detail-meta">
            {track.genre && <span>{track.genre}</span>}
            {date && <span>{date}</span>}
            {track.durationMs > 0 && <span>{formatDuration(track.durationMs)}</span>}
          </div>
          <button className="track-detail-play" type="button" disabled={playbackLoading} onClick={onPlay}>
            {playbackLoading ? <span className="player-spinner" /> : isCurrent && isPlaying ? 'Ⅱ' : '▶'}
            <span>{isCurrent && isPlaying ? 'Пауза' : 'Слушать трек'}</span>
          </button>
        </div>
      </section>

      <section className="track-detail-stats" aria-label="Статистика трека">
        <Stat icon="▶" label="прослушиваний" value={track.playCount ?? 0} />
        <Stat icon="♥" label="лайков" value={track.likeCount ?? 0} />
        <Stat icon="↻" label="репостов" value={track.repostCount ?? 0} />
        <Stat icon="▤" label="комментариев" value={track.commentCount ?? 0} />
      </section>

      <div className="track-detail-columns">
        <section className="track-detail-panel">
          <div className="card-kicker">О ТРЕКЕ</div>
          <h2>Описание</h2>
          {track.description ? <p className="track-detail-description">{track.description}</p> : <p className="track-detail-muted">Автор не добавил описание.</p>}
          {tags.length > 0 && <div className="track-detail-tags" aria-label="Теги">{tags.map((tag, index) => <span key={`${tag}-${index}`}>#{tag}</span>)}</div>}
        </section>
        <section className="track-detail-panel track-detail-artist-panel">
          <div className="card-kicker">АВТОР</div>
          <div className="track-detail-profile">
            {track.artist.avatar ? <img src={track.artist.avatar} alt="" /> : <span className="track-detail-profile-fallback">♫</span>}
            <div><strong>{artistName}</strong><small>{Number(track.artist.followerCount || 0).toLocaleString('ru-RU')} подписчиков</small></div>
          </div>
          {track.artist.permalink && <a className="track-detail-profile-link" href={track.artist.permalink} target="_blank" rel="noreferrer">Открыть профиль <span aria-hidden="true">↗</span></a>}
        </section>
      </div>
      {error && <div className="error-message track-detail-inline-error" role="alert">{error}</div>}
      <TrackCarouselSection
        title="Похожие треки"
        kicker="ВАМ МОЖЕТ ПОНРАВИТЬСЯ"
        tracks={relatedTracks}
        loading={relatedLoading}
        error={relatedError}
        currentTrackId={currentTrackId}
        isPlaying={isPlayingNow}
        playbackLoading={playbackLoading}
        onPlayTrack={onPlayRelated}
        onOpenTrack={onOpenRelated}
      />
    </article>
  );
}
