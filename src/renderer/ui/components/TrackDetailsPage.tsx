import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Track, TrackDetails } from '../../domain/models';
import { TrackCarouselSection } from './TrackCarouselSection';
import { ErrorMessage } from './ErrorMessage';
import { createWaveform } from '../lib/waveform';
import { measureElementRect, type ElementRect } from '../lib/artworkFlight';

type Props = {
  track: TrackDetails | null;
  loading: boolean;
  error: string;
  isCurrent: boolean;
  isPlaying: boolean;
  playbackLoading: boolean;
  contextTracks: Track[];
  relatedTracks: Track[];
  relatedLoading: boolean;
  relatedError: string;
  currentTrackId: number | null;
  isPlayingNow: boolean;
  onPlayRelated: (track: Track) => void;
  onOpenRelated: (track: Track, context: Track[]) => void;
  onOpenContextTrack: (track: Track) => void;
  onOpenArtist: (artistId: number) => void;
  onBack: () => void;
  onPlay: () => void;
  onToggleRepeat: () => void;
  repeatOne: boolean;
  shuffleLiked: boolean;
  onToggleShuffle: () => void;
  liked: boolean;
  likeBusy: boolean;
  onToggleLike: (track: Track) => void;
  onSeek: (positionMs: number) => void;
  playbackPositionMs: number;
  volume: number;
  onVolumeChange: (volume: number) => void;
  /** Whether the lyrics sidebar currently owns the track artwork. */
  lyricsOpen: boolean;
  lyricsAvailable: boolean;
  onToggleLyrics: (artworkRect: ElementRect | null) => void;
};

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}


function Stat({ icon, label, value }: { icon: 'headphones' | 'heart' | 'repost' | 'comments'; label: string; value: number }) {
  return (
    <div className="track-detail-stat">
      <svg className="track-detail-stat-icon" viewBox="0 0 24 24" aria-hidden="true">
        {icon === 'headphones'
          ? <><path d="M3 14v-3a9 9 0 0 1 18 0v3" /><rect x="3" y="13" width="4" height="7" rx="2" /><rect x="17" y="13" width="4" height="7" rx="2" /></>
          : icon === 'heart'
            ? <path d="M20.8 8.7c0 5.1-8.8 10-8.8 10S3.2 13.8 3.2 8.7a4.7 4.7 0 0 1 8.8-2.3 4.7 4.7 0 0 1 8.8 2.3Z" />
            : icon === 'repost'
              ? <><path d="M17 2l4 4-4 4" /><path d="M3 11V9a3 3 0 0 1 3-3h15" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a3 3 0 0 1-3 3H3" /></>
              : <path d="M21 11.5a8 8 0 0 1-8 8H5l-2 2v-6a8 8 0 1 1 18-4Z" />}
      </svg>
      <span className="track-detail-stat-copy"><strong>{Number(value || 0).toLocaleString('ru-RU')}</strong><small>{label}</small></span>
    </div>
  );
}

function TrackWaveform({ track, isCurrent, positionMs, onSeek }: { track: TrackDetails; isCurrent: boolean; positionMs: number; onSeek: (positionMs: number) => void }) {
  const [waveformFailed, setWaveformFailed] = useState(false);
  const [scrubPositionMs, setScrubPositionMs] = useState<number | null>(null);
  const [pendingSeekPositionMs, setPendingSeekPositionMs] = useState<number | null>(null);
  const scrubPositionRef = useRef<number | null>(null);
  const pendingSeekTimerRef = useRef<number | null>(null);
  const bars = createWaveform(track.id, 176);
  const durationMs = Math.max(0, track.durationMs);
  const position = scrubPositionMs ?? pendingSeekPositionMs ?? (isCurrent ? Math.min(positionMs, durationMs) : 0);
  const progress = durationMs > 0 ? Math.min(100, (position / durationMs) * 100) : 0;

  function updateScrubPosition(value: string) {
    const nextPosition = Math.max(0, Math.min(durationMs, Number(value)));
    scrubPositionRef.current = nextPosition;
    setScrubPositionMs(nextPosition);
  }

  function commitScrub() {
    const requestedPosition = scrubPositionRef.current;
    if (requestedPosition === null) return;
    scrubPositionRef.current = null;
    setScrubPositionMs(null);
    setPendingSeekPositionMs(requestedPosition);
    if (pendingSeekTimerRef.current !== null) window.clearTimeout(pendingSeekTimerRef.current);
    pendingSeekTimerRef.current = window.setTimeout(() => {
      setPendingSeekPositionMs(null);
      pendingSeekTimerRef.current = null;
    }, 4500);
    onSeek(requestedPosition);
  }

  useEffect(() => {
    if (pendingSeekPositionMs === null || !isCurrent || Math.abs(positionMs - pendingSeekPositionMs) > 1500) return;
    setPendingSeekPositionMs(null);
    if (pendingSeekTimerRef.current !== null) {
      window.clearTimeout(pendingSeekTimerRef.current);
      pendingSeekTimerRef.current = null;
    }
  }, [isCurrent, positionMs, pendingSeekPositionMs]);

  useEffect(() => () => {
    if (pendingSeekTimerRef.current !== null) window.clearTimeout(pendingSeekTimerRef.current);
  }, []);

  return (
    <section className="track-detail-waveform" aria-label="Визуализация трека">

      <div className="track-waveform-stage" role="img" aria-label={`Форма звуковой волны${track.durationMs > 0 ? `, длительность ${formatDuration(track.durationMs)}` : ''}`}>
        {track.waveform && !waveformFailed ? (
          <>
            <img className="track-waveform-image" src={track.waveform} alt="" onError={() => setWaveformFailed(true)} />
            <img className="track-waveform-image is-played" src={track.waveform} alt="" aria-hidden="true" style={{ clipPath: `inset(0 ${100 - progress}% 0 0)` }} onError={() => setWaveformFailed(true)} />
          </>
        ) : (
          <div className="track-waveform-bars">
            {bars.map((height, index) => (
              <span
                key={index}
                className={index / bars.length * 100 < progress ? 'is-played' : ''}
                style={{ '--bar-height': `${Math.round(18 + height * 78)}%` } as CSSProperties}
              />
            ))}
          </div>
        )}
        {isCurrent && <span className="track-waveform-playhead" style={{ left: `${progress}%` }} />}
        <input
          className="track-waveform-seek"
          type="range"
          min={0}
          max={durationMs || 1}
          step={1000}
          value={position}
          disabled={!durationMs}
          aria-label={`Перемотка трека ${track.title}`}
          aria-valuetext={`${formatDuration(position)} из ${formatDuration(durationMs)}`}
          onChange={(event) => updateScrubPosition(event.currentTarget.value)}
          onPointerUp={commitScrub}
          onPointerCancel={commitScrub}
          onKeyUp={commitScrub}
          onBlur={commitScrub}
        />
      </div>
      <div className="track-waveform-time">
        <span>{formatDuration(position)}</span>
        <span>{formatDuration(durationMs)}</span>
      </div>
    </section>
  );
}

function TrackCoverflow({ contextTracks, activeTrackId, playingTrackId, isPlayingNow, playbackLoading, onOpenTrack }: {
  contextTracks: Track[];
  activeTrackId: number;
  playingTrackId: number | null;
  isPlayingNow: boolean;
  playbackLoading: boolean;
  onOpenTrack: (track: Track) => void;
}) {
  const list = Array.from(new Map(contextTracks.map((item) => [item.id, item])).values());
  const index = list.findIndex((item) => item.id === activeTrackId);
  const coverflowTrackRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(7);

  useEffect(() => {
    const element = coverflowTrackRef.current;
    if (!element) return;

    const updateVisibleCount = () => {
      const width = element.clientWidth;
      const step = Number.parseFloat(getComputedStyle(element).getPropertyValue('--coverflow-step')) || 112;
      const desiredCount = Math.ceil((width * 0.9) / step) + 1;
      setVisibleCount(Math.min(desiredCount, Math.max(3, list.length * 2 - 1)));
    };

    updateVisibleCount();
    const observer = new ResizeObserver(updateVisibleCount);
    observer.observe(element);
    return () => observer.disconnect();
  }, [list.length]);

  if (index === -1 || list.length < 2) return null;

  const firstOffset = -Math.floor((visibleCount - 1) / 2);
  const visible = Array.from({ length: visibleCount }, (_, itemIndex) => {
    const offset = firstOffset + itemIndex;
    const wrappedIndex = ((index + offset) % list.length + list.length) % list.length;
    return { track: list[wrappedIndex], offset };
  });

  return (
    <section className="track-coverflow" aria-label="Треки этого раздела">
      <div className="section-heading track-coverflow-heading">
        <div><div className="eyebrow">В ЭТОМ РАЗДЕЛЕ</div><h2>Далее и ранее</h2></div>
        <span className="track-coverflow-position">{index + 1} из {list.length}</span>
      </div>
      <div className="track-coverflow-stage">
        <button type="button" className="coverflow-nav prev" aria-label="Предыдущий трек раздела" onClick={() => onOpenTrack(list[(index - 1 + list.length) % list.length])}>‹</button>
        <div className="coverflow-track" ref={coverflowTrackRef}>
          {visible.map(({ track, offset }) => {
            const isCenter = offset === 0;
            const dist = Math.abs(offset);
            const rotation = Math.max(-24, Math.min(24, offset * -8));
            const style = { '--offset': offset, '--dist': dist, '--coverflow-angle': `${rotation}deg`, zIndex: 100 - dist } as CSSProperties;
            const isNowPlaying = playingTrackId === track.id;
            return (
              <button
                key={`${track.id}-${offset}`}
                type="button"
                className={`coverflow-card${isCenter ? ' is-center' : ''}${offset < 0 ? ' is-past' : offset > 0 ? ' is-future' : ''}`}
                style={style}
                disabled={isCenter}
                aria-current={isCenter}
                aria-label={isCenter ? `Сейчас: ${track.title}` : `Открыть трек ${track.title}`}
                onClick={() => !isCenter && onOpenTrack(track)}
              >
                <span className="coverflow-card-inner">
                  {track.artwork ? <img src={track.artwork} alt="" loading="lazy" /> : <span className="coverflow-art-fallback" aria-hidden="true">♫</span>}
                  {isCenter && track.artwork && <img className="coverflow-reflection" src={track.artwork} alt="" aria-hidden="true" />}
                  {isNowPlaying && <span className={`coverflow-live${isPlayingNow ? ' is-playing' : ''}`}>{playbackLoading ? <span className="player-spinner" /> : isPlayingNow ? <span className="coverflow-playing-dots" aria-label="Играет"><i /><i /><i /></span> : '❚❚ Пауза'}</span>}
                </span>
                <span className="coverflow-meta"><b>{track.title}</b><small>{track.artist.name || 'SoundCloud'}</small></span>
              </button>
            );
          })}
        </div>
        <button type="button" className="coverflow-nav next" aria-label="Следующий трек раздела" onClick={() => onOpenTrack(list[(index + 1) % list.length])}>›</button>
      </div>
    </section>
  );
}

export function TrackDetailsPage({ track, loading, error, isCurrent, isPlaying, playbackLoading, playbackPositionMs, contextTracks, relatedTracks, relatedLoading, relatedError, currentTrackId, isPlayingNow, onPlayRelated, onOpenRelated, onOpenContextTrack, onOpenArtist, onBack, onPlay, onToggleRepeat, repeatOne, shuffleLiked, onToggleShuffle, liked, likeBusy, onToggleLike, onSeek, volume, onVolumeChange, lyricsOpen, lyricsAvailable, onToggleLyrics }: Props) {
  const [expandedDescriptionTrackId, setExpandedDescriptionTrackId] = useState<number | null>(null);
  const artworkRef = useRef<HTMLDivElement>(null);

  function toggleLyrics() {
    if (lyricsOpen) {
      onToggleLyrics(null);
      return;
    }
    // Hand the artwork's current rectangle to the sidebar so it knows where the flight starts.
    onToggleLyrics(measureElementRect(artworkRef.current));
  }

  if (loading) return (
    <article className="track-detail-page track-detail-page-loading" aria-busy="true" aria-label="Загрузка страницы трека">
      <button className="track-detail-back" type="button" onClick={onBack}><span aria-hidden="true">←</span> Мои лайки</button>
      <section className="track-detail-hero track-detail-skeleton" aria-hidden="true">
        <div className="track-detail-artwork-wrap"><span className="track-skeleton-art" /></div>
        <div className="track-detail-content">
          <div className="track-detail-info">
            <div className="track-detail-toolbar track-skeleton-toolbar">
              <i /><i /><i />
              <div className="track-detail-copy track-skeleton-copy"><i className="track-skeleton-title" /><i className="track-skeleton-artist" /></div>
              <i />
            </div>
          </div>
          <div className="track-skeleton-waveform" />
          <div className="track-skeleton-stats"><i /><i /><i /><i /></div>
        </div>
      </section>
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
  if (!track) return <div className="track-details-error"><p>{error || 'Не удалось загрузить трек.'}</p><button type="button" onClick={onBack}>Вернуться к лайкам</button></div>;


  const description = track.description?.trim();
  const canExpandDescription = Boolean(description && description.length > 160);
  const descriptionExpanded = expandedDescriptionTrackId === track.id;
  const artistName = track.artist.name || 'SoundCloud';
  const artistId = track.artist.id;
  const artistFollowers = Number(track.artist.followerCount || 0).toLocaleString('ru-RU');
  const artistDetails = <>
    {track.artist.avatar ? <img src={track.artist.avatar} alt="" /> : <span className="track-detail-artist-avatar-fallback" aria-hidden="true">♫</span>}
    <span className="track-detail-artist-copy">
      <span className="track-detail-artist-name">{artistName}</span>
      <small className="track-detail-artist-followers">{artistFollowers} подписчиков</small>
    </span>
  </>;

  return (
    <article className="track-detail-page">
      <button className="track-detail-back" type="button" onClick={onBack}><span aria-hidden="true">←</span> Мои лайки</button>
      <section className="track-detail-hero" key={track.id}>
        <div className="track-detail-artwork-wrap" ref={artworkRef} data-track-artwork="">
          {track.artwork ? <img className="track-detail-artwork" src={track.artwork} alt={`Обложка: ${track.title}`} /> : <div className="track-detail-artwork track-detail-artwork-fallback">♫</div>}
        </div>
        <div className="track-detail-content">
          <div className="track-detail-info">
            <div className="track-detail-toolbar">
              <button
                className={`track-detail-play track-detail-play-icon${isCurrent && isPlaying ? ' is-playing' : ''}`}
                type="button"
                disabled={playbackLoading}
                onClick={onPlay}
                aria-label={isCurrent && isPlaying ? 'Пауза' : 'Слушать трек'}
                title={isCurrent && isPlaying ? 'Пауза' : 'Слушать трек'}
              >
                {playbackLoading
                  ? <span className="player-spinner" />
                  : isCurrent && isPlaying
                    ? <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5" width="4.5" height="14" rx="1.4" /><rect x="13" y="5" width="4.5" height="14" rx="1.4" /></svg>
                    : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 12 7-12 7z" /></svg>}
              </button>
              <button className={`track-detail-repeat${repeatOne ? ' is-active' : ''}`} type="button" onClick={onToggleRepeat} aria-pressed={repeatOne} aria-label={repeatOne ? 'Выключить повтор трека' : 'Повторять трек'} title={repeatOne ? 'Повтор трека включён' : 'Повторять трек'}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 2l4 4-4 4" /><path d="M3 11V9a3 3 0 0 1 3-3h15" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a3 3 0 0 1-3 3H3" /></svg>

              </button>
              <button className={`track-detail-shuffle${shuffleLiked ? ' is-active' : ''}`} type="button" onClick={onToggleShuffle} aria-pressed={shuffleLiked} aria-label={shuffleLiked ? 'Выключить случайное воспроизведение лайкнутых треков' : 'Случайное воспроизведение лайкнутых треков'} title={shuffleLiked ? 'Случайный выбор из лайкнутых включён' : 'Случайный выбор из лайкнутых'}>
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.03 7.03 15.56 4.5l-2.53-2.53-1.06 1.06.72.72h-.45c-1.32 0-2.58.55-3.48 1.52L7.25 6.9 5.74 5.27a4.5 4.5 0 0 0-3.48-1.52H1v1.5h1.26c.9 0 1.76.38 2.38 1.04L6.23 8l-1.59 1.71a3.2 3.2 0 0 1-2.38 1.04H1v1.5h1.26a4.5 4.5 0 0 0 3.48-1.52L7.25 9.1l1.51 1.63a4.5 4.5 0 0 0 3.48 1.52h.45l-.72.72 1.06 1.06 2.53-2.53-2.53-2.53-1.06 1.06.72.72h-.45c-.9 0-1.76-.38-2.38-1.04L8.27 8l1.59-1.71a3.2 3.2 0 0 1 2.38-1.04h.45l-.72.72z" /></svg>
              </button>
              <button
                className={`track-detail-like${liked ? ' is-liked' : ''}`}
                type="button"
                onClick={() => onToggleLike(track)}
                disabled={likeBusy}
                aria-pressed={liked}
                aria-busy={likeBusy}
                aria-label={liked ? 'Убрать из любимых' : 'Добавить в любимые'}
                title={liked ? 'В любимых' : 'Добавить в любимые'}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" /></svg>
              </button>
              {lyricsAvailable && <button
                className={`track-detail-lyrics${lyricsOpen ? ' is-active' : ''}`}
                type="button"
                onClick={toggleLyrics}
                aria-expanded={lyricsOpen}
                aria-controls="lyrics-sidebar"
                aria-label={lyricsOpen ? 'Скрыть текст песни' : 'Показать текст песни'}
                title={lyricsOpen ? 'Скрыть текст песни' : 'Показать текст песни'}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h11M4 10h11M4 15h7" /><path d="M18 14v6M15 17h6" /></svg>
              </button>}
              <div className="track-detail-copy">
                <h1>{track.title}</h1>
                {artistId
                  ? <button className="track-detail-artist" type="button" onClick={() => onOpenArtist(artistId)}>{artistDetails}</button>
                  : track.artist.permalink
                    ? <a className="track-detail-artist" href={track.artist.permalink} target="_blank" rel="noreferrer">{artistDetails}<span className="track-detail-artist-external" aria-hidden="true">↗</span></a>
                    : <div className="track-detail-artist">{artistDetails}</div>}
              </div>
              <label className="track-detail-volume-control" title="Громкость" style={{ '--volume-level': `${volume}%`, '--volume-depth': `${(volume / 100) * 7}deg`, '--volume-glow': `rgba(255, 118, 93, ${volume / 100})` } as CSSProperties}>
                <svg className="track-detail-volume-icon" viewBox="0 0 24 24" aria-hidden="true">
                  {volume === 0
                    ? <><path d="M11 5 6 9H3v6h3l5 4z" /><path d="m16 9 5 6m0-6-5 6" /></>
                    : <><path d="M11 5 6 9H3v6h3l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></>}
                </svg>
                <input className="track-detail-volume-slider" type="range" min={0} max={100} value={volume} aria-label="Громкость" aria-valuetext={`${volume}%`} onChange={(event) => onVolumeChange(Number(event.currentTarget.value))} />
              </label>

            </div>
          </div>
          <TrackWaveform key={track.id} track={track} isCurrent={isCurrent} positionMs={playbackPositionMs} onSeek={onSeek} />
          <section className={`track-detail-stats${description ? '' : ' has-no-description'}`} aria-label="Описание и статистика трека">
            {description && <div className="track-detail-stats-description">
              <div className="track-detail-description-heading">Описание</div>
              <p className={`track-detail-description-text${canExpandDescription && !descriptionExpanded ? ' is-collapsed' : ''}`}>{description}</p>
              {canExpandDescription && <button className="track-detail-description-toggle" type="button" aria-expanded={descriptionExpanded} onClick={() => setExpandedDescriptionTrackId(descriptionExpanded ? null : track.id)}>{descriptionExpanded ? 'Свернуть' : 'Показать больше'}</button>}
            </div>}
            <div className="track-detail-stat-grid">
              <Stat icon="headphones" label="прослушиваний" value={track.playCount ?? 0} />
              <Stat icon="heart" label="лайков" value={track.likeCount ?? 0} />
              <Stat icon="repost" label="репостов" value={track.repostCount ?? 0} />
              <Stat icon="comments" label="комментариев" value={track.commentCount ?? 0} />
            </div>
          </section>
        </div>
      </section>


      {error && <ErrorMessage message={error} className="track-detail-inline-error" />}

      <TrackCoverflow
        contextTracks={contextTracks}
        activeTrackId={track.id}
        playingTrackId={currentTrackId}
        isPlayingNow={isPlayingNow}
        playbackLoading={playbackLoading}
        onOpenTrack={onOpenContextTrack}
      />

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
