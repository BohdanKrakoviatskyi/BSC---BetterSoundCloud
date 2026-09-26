import type { Track } from '../../domain/models';
import { TrackCard } from './TrackCard';
import { useEffect, useRef, useState } from 'react';
import { ErrorMessage } from './ErrorMessage';
import './LikedTracksSection.css';

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
  onOpenTrack: (track: Track, context: Track[]) => void;
  onOpenArtist?: (track: Track) => void;
  currentTrackId: number | null;
  isPlaying: boolean;
  playbackLoading: boolean;
};

export function LikedTracksSection({ tracks, likedTracks, likeBusy, loading, error, artistFallback, onRefresh, onToggleLike, onPlayTrack, onOpenTrack, onOpenArtist, currentTrackId, isPlaying, playbackLoading }: Props) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(36);
  const uniqueTracks = Array.from(new Map(tracks.map((track) => [track.id, track])).values());
  const visibleTracks = uniqueTracks.slice(0, visibleCount);

  useEffect(() => setVisibleCount(36), [tracks]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || visibleCount >= uniqueTracks.length) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setVisibleCount((count) => Math.min(count + 36, uniqueTracks.length));
    }, { root: document.querySelector('.main-scroll'), rootMargin: '360px 0px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [uniqueTracks.length, visibleCount]);

  return (
    <section className="liked-tracks-page" aria-label="Мои лайки">
      <div className="section-heading">
        <div>
          <div className="eyebrow">МЕДИАТЕКА SOUNDCLOUD</div>
          <h2>Треки из моих лайков <span className="track-count">{uniqueTracks.length}</span></h2>
        </div>
        <div className="tracks-actions">
          <button className="text-action" type="button" onClick={onRefresh} disabled={loading}>
            {loading ? 'Загружаю…' : 'Обновить'} <span aria-hidden="true">↻</span>
          </button>
        </div>
      </div>
      {error && <ErrorMessage message={error} />}
      {loading && tracks.length === 0
        ? <p className="tracks-empty">Загружаю ваши треки…</p>
          : uniqueTracks.length === 0
            ? <p className="tracks-empty">В лайках пока нет треков.</p>
          : <>
            <div className="liked-tracks-grid">
            {visibleTracks.map((track) => (
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
                onOpenDetails={() => onOpenTrack(track, uniqueTracks)}
                onOpenArtist={onOpenArtist ? () => onOpenArtist(track) : undefined}
              />
            ))}
            </div>
            {visibleCount < uniqueTracks.length && <div ref={sentinelRef} className="liked-tracks-sentinel" aria-label="Загружаю следующие треки">Загружаю ещё треки…</div>}
          </>}
    </section>
  );
}
