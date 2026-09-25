import type { Track } from '../../domain/models';
import { TrackCard } from '../tracks/TrackCard';
import { useEffect, useRef, useState } from 'react';
import './LikedTracksSection.css';

type Props = {
  tracks: Track[];
  likedTracks: Record<number, boolean>;
  likeBusy: Record<number, boolean>;
  loading: boolean;
  error: string;
  artistFallback?: string;
  onToggleLike: (track: Track) => void;
  onPlayTrack: (track: Track) => void;
  onOpenTrack: (track: Track) => void;
  currentTrackId: number | null;
  isPlaying: boolean;
  playbackLoading: boolean;
};

const PULL_RELOAD_THRESHOLD = 92;
const PULL_RELOAD_MAX = 104;
const RELOAD_ANIMATION_MS = 650;

export function LikedTracksSection({ tracks, likedTracks, likeBusy, loading, error, artistFallback, onToggleLike, onPlayTrack, onOpenTrack, currentTrackId, isPlaying, playbackLoading }: Props) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(36);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
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

  useEffect(() => {
    const scrollArea = document.querySelector<HTMLElement>('.main-scroll');
    if (!scrollArea) return;

    const previousOverscrollBehavior = scrollArea.style.overscrollBehaviorY;
    scrollArea.style.overscrollBehaviorY = 'contain';

    let touchStartY: number | null = null;
    let touchDistance = 0;
    let wheelDistance = 0;
    let wheelResetTimer: number | undefined;
    let reloadTimer: number | undefined;
    let reloadStarted = false;

    const isAtTop = () => scrollArea.scrollTop <= 1;
    const resetPull = () => setPullDistance(0);
    const reloadApp = () => {
      if (reloadStarted) return;
      reloadStarted = true;
      setRefreshing(true);
      setPullDistance(PULL_RELOAD_MAX);
      reloadTimer = window.setTimeout(() => window.location.reload(), RELOAD_ANIMATION_MS);
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (reloadStarted || !isAtTop() || event.touches.length !== 1) {
        touchStartY = null;
        return;
      }
      touchStartY = event.touches[0].clientY;
      touchDistance = 0;
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (touchStartY === null || reloadStarted || !isAtTop() || event.touches.length !== 1) return;
      touchDistance = Math.max(0, event.touches[0].clientY - touchStartY);
      setPullDistance(Math.min(touchDistance, PULL_RELOAD_MAX));
      if (touchDistance > 0 && event.cancelable) event.preventDefault();
    };

    const finishTouch = () => {
      if (touchDistance >= PULL_RELOAD_THRESHOLD) reloadApp();
      else if (!reloadStarted) resetPull();
      touchStartY = null;
      touchDistance = 0;
    };

    const cancelTouch = () => {
      touchStartY = null;
      touchDistance = 0;
      if (!reloadStarted) resetPull();
    };

    const handleWheel = (event: WheelEvent) => {
      if (reloadStarted) return;
      if (!isAtTop() || event.deltaY >= 0 || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        wheelDistance = 0;
        if (!reloadStarted) resetPull();
        return;
      }

      wheelDistance += -event.deltaY;
      setPullDistance(Math.min(wheelDistance * 0.8, PULL_RELOAD_MAX));
      if (wheelResetTimer !== undefined) window.clearTimeout(wheelResetTimer);
      wheelResetTimer = window.setTimeout(() => {
        if (wheelDistance >= PULL_RELOAD_THRESHOLD) reloadApp();
        else {
          wheelDistance = 0;
          resetPull();
        }
      }, 180);
    };

    scrollArea.addEventListener('touchstart', handleTouchStart, { passive: true });
    scrollArea.addEventListener('touchmove', handleTouchMove, { passive: false });
    scrollArea.addEventListener('touchend', finishTouch, { passive: true });
    scrollArea.addEventListener('touchcancel', cancelTouch, { passive: true });
    scrollArea.addEventListener('wheel', handleWheel, { passive: true });

    return () => {
      scrollArea.removeEventListener('touchstart', handleTouchStart);
      scrollArea.removeEventListener('touchmove', handleTouchMove);
      scrollArea.removeEventListener('touchend', finishTouch);
      scrollArea.removeEventListener('touchcancel', cancelTouch);
      scrollArea.removeEventListener('wheel', handleWheel);
      scrollArea.style.overscrollBehaviorY = previousOverscrollBehavior;
      if (wheelResetTimer !== undefined) window.clearTimeout(wheelResetTimer);
      if (reloadTimer !== undefined) window.clearTimeout(reloadTimer);
    };
  }, []);

  return (
    <section className="liked-tracks-page" aria-label="Мои лайки">
      <div
        className={`liked-refresh-indicator${pullDistance > 0 ? ' is-visible' : ''}${refreshing ? ' is-refreshing' : ''}`}
        style={{
          height: `${pullDistance}px`,
          opacity: refreshing ? 1 : Math.min(pullDistance / PULL_RELOAD_THRESHOLD, 1),
        }}
        aria-hidden="true"
      >
        <span
          className="liked-refresh-icon"
          style={{ transform: refreshing ? undefined : `rotate(${Math.round((pullDistance / PULL_RELOAD_THRESHOLD) * 300)}deg)` }}
        >↻</span>
      </div>
      <div className="section-heading">
        <div>
          <div className="eyebrow">МЕДИАТЕКА SOUNDCLOUD</div>
          <h2>Треки из моих лайков <span className="track-count">{uniqueTracks.length}</span></h2>
        </div>
      </div>
      {error && <div className="error-message" role="alert">{error}</div>}
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
                onOpenDetails={() => onOpenTrack(track)}
              />
            ))}
            </div>
            {visibleCount < uniqueTracks.length && <div ref={sentinelRef} className="liked-tracks-sentinel" aria-label="Загружаю следующие треки">Загружаю ещё треки…</div>}
          </>}
    </section>
  );
}
