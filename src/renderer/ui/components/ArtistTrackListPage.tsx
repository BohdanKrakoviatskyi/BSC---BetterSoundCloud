import { useEffect } from 'react';
import type { Track } from '../../domain/models';
import { TrackCard } from './TrackCard';
import { FaArrowLeft } from '../lib/icons';
import { formatCount } from '../lib/format';
import './ArtistTrackListPage.css';

type Props = {
  title: string;
  artistName: string;
  tracks: Track[];
  totalCount?: number;
  loading?: boolean;
  error?: string;
  hasMore?: boolean;
  onLoadMore?: () => void;
  currentTrackId: number | null;
  isPlaying: boolean;
  playbackLoading: boolean;
  onBack: () => void;
  onPlay: (track: Track) => void;
  onOpen: (track: Track, context: Track[]) => void;
  onOpenArtist: (track: Track) => void;
};

export function ArtistTrackListPage({ title, artistName, tracks, totalCount, loading = false, error = '', hasMore = false, onLoadMore, currentTrackId, isPlaying, playbackLoading, onBack, onPlay, onOpen, onOpenArtist }: Props) {
  useEffect(() => {
    const scrollArea = document.querySelector('.main-scroll');
    if (!scrollArea || !hasMore || loading || !onLoadMore) return;
    const loadNearBottom = () => {
      if (scrollArea.scrollHeight - scrollArea.scrollTop - scrollArea.clientHeight < 300) onLoadMore();
    };
    scrollArea.addEventListener('scroll', loadNearBottom, { passive: true });
    return () => scrollArea.removeEventListener('scroll', loadNearBottom);
  }, [hasMore, loading, onLoadMore]);

  return <article className="page-content artist-track-list-page">
    <button className="track-detail-back" type="button" onClick={onBack}><FaArrowLeft aria-hidden="true" /> Профиль автора</button>
    <header className="artist-track-list-header"><h1>{title}</h1><p>{artistName} · {formatCount(totalCount ?? tracks.length)} треков</p></header>
    {tracks.length === 0 && loading
      ? <p className="tracks-empty">Загружаю лайки…</p>
      : tracks.length === 0
      ? <p className="tracks-empty">Треки не найдены.</p>
      : <div className="artist-track-card-grid">{tracks.map((track, index) => <TrackCard
          key={`${track.id}-${index}`}
          track={track}
          artistFallback={artistName}
          liked={false}
          busy={false}
          onToggleLike={() => undefined}
          isCurrent={currentTrackId === track.id}
          isPlaying={currentTrackId === track.id && isPlaying}
          isLoading={currentTrackId === track.id && playbackLoading}
          onPlay={() => onPlay(track)}
          onOpenDetails={() => onOpen(track, tracks)}
          onOpenArtist={() => onOpenArtist(track)}
        />)}</div>}
    {error && <div className="artist-track-list-status" role="status">{error}<button type="button" onClick={onLoadMore}>Повторить</button></div>}
    {loading && tracks.length > 0 && <p className="artist-track-list-status">Загружаю следующие 20…</p>}
    {!loading && hasMore && onLoadMore && <div className="artist-track-list-status"><button type="button" onClick={onLoadMore}>Показать ещё 20</button></div>}
  </article>;
}
