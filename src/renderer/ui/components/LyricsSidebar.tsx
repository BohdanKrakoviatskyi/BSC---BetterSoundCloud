import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { Track, TrackLyrics } from '../../domain/models';
import type { LyricsPanelPhase } from '../types';
import { measureElementRect, playArtworkFlight, type ElementRect } from '../lib/artworkFlight';
import './LyricsSidebar.css';
import { ResizeHandle } from './ResizeHandle';

// three is a large dependency and the surface only exists in focus mode, so the module is
// fetched the first time the fullscreen lyrics are opened instead of on every app start.
const LazyDottedSurface = lazy(() => import('./DottedSurface'));

type Props = {
  phase: LyricsPanelPhase;
  track: Track;
  lyrics: TrackLyrics | null;
  loading: boolean;
  error: string;
  /** Whether the panel shows the words of the track that is actually playing. */
  isCurrentTrack: boolean;
  /** Whether the track is actually playing right now, so the transport button shows the right glyph. */
  isPlaying: boolean;
  onTogglePlayback: () => void;
  /** Seeks the playing track; the owner also starts playback first when needed. */
  onSeek: (positionMs: number) => void;
  repeatOne: boolean;
  onToggleRepeat: () => void;
  /** 0-100, shared with the player bar so both controls always agree. */
  volume: number;
  onVolumeChange: (volume: number) => void;
  playbackPositionMs: number;
  /**
   * The other end of the flight: the artwork rectangle on the track page while opening, and its
   * home rectangle again while closing. The owner measures it right before each transition.
   */
  originRect: ElementRect | null;
  onClose: () => void;
  /** The flight finished, so the owner may move to the next phase. */
  onSettled: () => void;
  onResize: (delta: number) => void;
};

/** How long a manual scroll suppresses the automatic "follow the active line" behaviour. */
const FOLLOW_RESUME_MS = 5000;

/** m:ss, the format the player bar already uses. */
function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

function findActiveLineIndex(lines: TrackLyrics['lines'], positionMs: number): number {
  let active = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].startMs <= positionMs) active = index;
    else break;
  }
  return active;
}

export function LyricsSidebar({ phase, track, lyrics, loading, error, isCurrentTrack, isPlaying, onTogglePlayback, onSeek, repeatOne, onToggleRepeat, volume, onVolumeChange, playbackPositionMs, originRect, onClose, onSettled, onResize }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [slotRect, setSlotRect] = useState<ElementRect | null>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const flightRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<Array<HTMLParagraphElement | null>>([]);
  const focusLineRefs = useRef<Array<HTMLParagraphElement | null>>([]);
  const focusBodyRef = useRef<HTMLDivElement>(null);
  const manuallyScrolledAtRef = useRef(0);
  const [activeLineCentered, setActiveLineCentered] = useState(true);
  // Set while the reader drags, so the thumb follows the pointer instead of playback.
  const [scrubSeconds, setScrubSeconds] = useState<number | null>(null);
  // Kept in refs so a re-render of the owner can never restart a flight that is already running.
  const onCloseRef = useRef(onClose);
  const onSettledRef = useRef(onSettled);
  // Read by the Escape handler without re-registering the listener on every state change.
  const focusModeRef = useRef(focusMode);
  const togglePlaybackRef = useRef(onTogglePlayback);
  const seekRef = useRef(onSeek);
  const toggleRepeatRef = useRef(onToggleRepeat);
  const volumeChangeRef = useRef(onVolumeChange);
  // Remembered so unmuting returns to the level the reader had, not to a fixed one.
  const restoreVolumeRef = useRef(volume > 0 ? volume : 70);
  onCloseRef.current = onClose;
  onSettledRef.current = onSettled;
  focusModeRef.current = focusMode;
  togglePlaybackRef.current = onTogglePlayback;
  seekRef.current = onSeek;
  toggleRepeatRef.current = onToggleRepeat;
  volumeChangeRef.current = onVolumeChange;

  const isMounted = phase !== 'closed';
  const isFlying = phase === 'opening' || phase === 'closing';
  const lines = lyrics?.lines ?? [];
  const hasLines = lines.length > 0;
  // Only timestamped sources can follow playback accurately.
  const hasTimedLyrics = Boolean(lyrics?.isSynced || lyrics?.isDemo);
  const activeIndex = hasTimedLyrics ? findActiveLineIndex(lines, isCurrentTrack ? playbackPositionMs : 0) : -1;
  const durationSeconds = (track.durationMs || 0) / 1000;
  const scrubSecond = scrubSeconds ?? playbackPositionMs / 1000;

  const seekMax = Math.max(1, Math.round(durationSeconds));
  const seekFraction = durationSeconds > 0
    ? Math.min(1, Math.max(0, scrubSecond / durationSeconds))
    : 0;
  const canCollapse = lines.length > 6;

  const handleClose = useCallback(() => onCloseRef.current(), []);

  // Leaving focus mode only collapses the fullscreen layer, so the reader lands back on the
  // track card with the lyrics panel still in place.
  const handleExitFocus = useCallback(() => {
    manuallyScrolledAtRef.current = 0;
    setFocusMode(false);
  }, []);

  const handleTogglePlayback = useCallback(() => togglePlaybackRef.current(), []);
  const handleToggleRepeat = useCallback(() => toggleRepeatRef.current(), []);

  const handleToggleMute = useCallback(() => {
    if (volume > 0) {
      restoreVolumeRef.current = volume;
      volumeChangeRef.current(0);
      return;
    }
    volumeChangeRef.current(restoreVolumeRef.current);
  }, [volume]);

  const updateActiveLinePosition = useCallback(() => {
    const body = focusBodyRef.current;
    const line = focusLineRefs.current[activeIndex];
    if (!body || !line || !isCurrentTrack || activeIndex < 0) {
      setActiveLineCentered(true);
      return;
    }
    const bodyRect = body.getBoundingClientRect();
    const lineRect = line.getBoundingClientRect();
    const lineCenter = lineRect.top + lineRect.height / 2;
    const safeTop = bodyRect.top + bodyRect.height * 0.27;
    const safeBottom = bodyRect.bottom - bodyRect.height * 0.27;
    setActiveLineCentered(lineCenter >= safeTop && lineCenter <= safeBottom);
  }, [activeIndex, isCurrentTrack]);

  const syncToCurrentLine = useCallback(() => {
    manuallyScrolledAtRef.current = 0;
    focusLineRefs.current[activeIndex]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    window.setTimeout(updateActiveLinePosition, 350);
  }, [activeIndex, updateActiveLinePosition]);

  // The panel frame itself is never transformed, otherwise the artwork slot would drift while the
  // artwork is being measured against it. The motion lives in the inner text blocks instead.
  useLayoutEffect(() => {
    setSlotRect(measureElementRect(slotRef.current));
  }, [track.id, focusMode]);

  useEffect(() => {
    if (phase === 'closed') return;
    const onKeyDown = (event: KeyboardEvent) => {
      // Only the settled panel reacts, so a flight is never interrupted halfway.
      if (event.key !== 'Escape' || phase !== 'open') return;
      event.stopPropagation();
      // The first Escape leaves the fullscreen layer, the next one closes the panel.
      if (focusModeRef.current) {
        handleExitFocus();
        return;
      }
      onCloseRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [phase, handleExitFocus]);

  // Keep the line that is being sung in view, unless the reader is scrolling on their own.
  useEffect(() => {
    if (!isCurrentTrack || focusMode || !hasLines) return;
    const lastManualScroll = manuallyScrolledAtRef.current;
    if (!hasTimedLyrics || (lastManualScroll && Date.now() - lastManualScroll < FOLLOW_RESUME_MS)) return;
    lineRefs.current[activeIndex]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [playbackPositionMs, activeIndex, isCurrentTrack, focusMode, hasLines, hasTimedLyrics]);

  useEffect(() => {
    if (!focusMode || !isCurrentTrack || activeIndex < 0) {
      setActiveLineCentered(true);
      return;
    }
    const lastManualScroll = manuallyScrolledAtRef.current;
    if (lastManualScroll && Date.now() - lastManualScroll < FOLLOW_RESUME_MS) {
      updateActiveLinePosition();
      return;
    }
    focusLineRefs.current[activeIndex]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    window.setTimeout(updateActiveLinePosition, 350);
  }, [playbackPositionMs, activeIndex, focusMode, isCurrentTrack, updateActiveLinePosition]);

  // A track change or a reset of the reader's view must not leave stale toggles behind.
  useEffect(() => {
    setExpanded(false);
    setFocusMode(false);
  }, [track.id]);

  useEffect(() => {
    if (!isFlying) return;
    const element = flightRef.current;
    const from = phase === 'closing' ? slotRect : originRect;
    const to = phase === 'closing' ? originRect : slotRect;
    // Nothing to travel between: settle straight away so the owner is never stuck in a flight phase.
    if (!element || !from || !to) {
      onSettledRef.current();
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    void playArtworkFlight(element, from, to, { radius: [15, 12] }, controller.signal).then(() => {
      if (!cancelled) onSettledRef.current();
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [phase, isFlying, originRect, slotRect]);

  if (!isMounted) return null;

  const destination = phase === 'closing' ? originRect : slotRect;
  const flight = isFlying && destination ? createPortal(
    <div
      className="lyrics-flight"
      ref={flightRef}
      style={{ left: destination.left, top: destination.top, width: destination.width, height: destination.height }}
      aria-hidden="true"
    >
      {track.artwork ? <img src={track.artwork} alt="" /> : <span className="lyrics-artwork-fallback">♫</span>}
    </div>,
    document.body,
  ) : null;

  return (
    <>
      {flight}
      <aside
        className={`lyrics-sidebar${isFlying ? ' is-flying' : ''}${focusMode ? ' is-focus' : ''}`}
        aria-label="Текст песни"
      >
        <ResizeHandle side="right" label="Изменить ширину панели текста" onResize={onResize} />
        <header className="lyrics-sidebar-head">
          {/* Reserves the artwork slot. The travelling artwork is painted on top of it, and because
              the two are pixel-identical the hand-off is invisible. */}
          <div className="lyrics-artwork-slot" ref={slotRef}>
            {track.artwork ? <img src={track.artwork} alt={`Обложка: ${track.title}`} /> : <span className="lyrics-artwork-fallback" aria-hidden="true">♫</span>}
          </div>
          <div className="lyrics-sidebar-copy">
            <h2>{track.title}</h2>
            <p>{track.artist.name || 'SoundCloud'}</p>
          </div>
          <button className="lyrics-icon-button lyrics-close" type="button" onClick={handleClose} aria-label="Закрыть текст песни" title="Закрыть">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </header>

        <div className="lyrics-sidebar-toolbar">
          <div className="lyrics-heading">
            <span>Текст песни</span>
            {lyrics?.isDemo && (
              <span className="lyrics-demo-badge" title="Демонстрационный текст: подключение настоящего источника ещё не готово">демо</span>
            )}
          </div>
          <div className="lyrics-toolbar-actions">
            <button
              className="lyrics-icon-button"
              type="button"
              onClick={() => {
                manuallyScrolledAtRef.current = 0;
                setFocusMode((value) => !value);
              }}
              aria-pressed={focusMode}
              aria-label={focusMode ? 'Вернуть обычный вид' : 'Развернуть текст на весь экран'}
              title={focusMode ? 'Обычный вид' : 'Во весь экран'}
            >
              {focusMode
                ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" /></svg>
                : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>}
            </button>
          </div>
        </div>

        <div
          className={`lyrics-body${expanded ? ' is-expanded' : ''}`}
          onWheel={() => { manuallyScrolledAtRef.current = Date.now(); }}
          onPointerDown={() => { manuallyScrolledAtRef.current = Date.now(); }}
        >
          {loading && <div className="lyrics-state lyrics-state-loading"><span className="player-spinner" />Загружаю текст…</div>}
          {!loading && error && <div className="lyrics-state lyrics-state-error">{error}</div>}
          {!loading && !error && !hasLines && <div className="lyrics-state">Текст для этого трека не найден на Genius.</div>}
          {!loading && !error && hasLines && (
            <div className="lyrics-lines">
              {lines.map((line, index) => (
                <p
                  key={line.id}
                  ref={(element) => { lineRefs.current[index] = element; }}
                  className={`lyrics-line${index === activeIndex && isCurrentTrack ? ' is-active' : ''}`}
                  style={{ '--lyrics-line-index': index } as CSSProperties}
                  aria-current={index === activeIndex && isCurrentTrack ? 'true' : undefined}
                >
                  {line.text}
                </p>
              ))}
            </div>
          )}
        </div>

        {canCollapse && !focusMode && (
          <button className="lyrics-collapse-toggle" type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
            {expanded ? 'Свернуть' : 'Показать все'}
          </button>
        )}

        {focusMode && (
          <div className="lyrics-focus-layer">
            <Suspense fallback={null}>
              <LazyDottedSurface className="lyrics-dotted-surface" />
            </Suspense>
            <div className="lyrics-focus-head">
              <button className="lyrics-icon-button lyrics-focus-exit" type="button" onClick={handleExitFocus} aria-label="Вернуться к карточке трека" title="Вернуться к карточке трека">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6M9 12h11M4 5v14" /></svg>
              </button>
            </div>
            <div
              className="lyrics-focus-body"
              ref={focusBodyRef}
              onWheel={() => { manuallyScrolledAtRef.current = Date.now(); }}
              onPointerDown={() => { manuallyScrolledAtRef.current = Date.now(); }}
              onScroll={() => {
                updateActiveLinePosition();
              }}
            >
              {lines.map((line, index) => {
                const distance = activeIndex < 0 ? 3 : Math.abs(index - activeIndex);
                return <p
                  key={line.id}
                  ref={(element) => { focusLineRefs.current[index] = element; }}
                  className={`lyrics-line lyrics-line-lg${index === activeIndex && isCurrentTrack ? ' is-active' : ''}${index < activeIndex && isCurrentTrack ? ' is-past' : ''}${index > activeIndex && isCurrentTrack ? ' is-upcoming' : ''}`}
                  style={{ '--lyrics-distance': Math.min(distance, 5) } as CSSProperties}
                >
                  {line.text}
                </p>;
              })}
            </div>
            {isCurrentTrack && (
              <div className="lyrics-focus-transport">
                <button
                  className="lyrics-focus-play"
                  type="button"
                  onClick={handleTogglePlayback}
                  aria-label={isPlaying ? 'Пауза' : 'Продолжить'}
                  title={isPlaying ? 'Пауза' : 'Продолжить'}
                >
                  {isPlaying
                    ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5v14M15 5v14" /></svg>
                    : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" /></svg>}
                </button>
                <button
                  className={`lyrics-focus-repeat${repeatOne ? ' is-on' : ''}`}
                  type="button"
                  onClick={handleToggleRepeat}
                  aria-pressed={repeatOne}
                  aria-label={repeatOne ? 'Выключить повтор' : 'Повторять трек'}
                  title={repeatOne ? 'Повтор выключен' : 'Повторять трек'}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M17 2l4 4-4 4" />
                    <path d="M3 11V9a3 3 0 0 1 3-3h15" />
                    <path d="M7 22l-4-4 4-4" />
                    <path d="M21 13v2a3 3 0 0 1-3 3H3" />
                  </svg>
                  <span>1</span>
                </button>
              </div>
            )}

            <div className="lyrics-focus-left">
            {isCurrentTrack && durationSeconds > 0 && (
              <div
                className={`lyrics-focus-seek${scrubSeconds !== null ? ' is-scrubbing' : ''}`}
                style={{ '--fill': seekFraction } as CSSProperties}
              >
                {/* The rail is painted here so it can carry the gradient and the moving
                    highlight; the range input above it stays transparent and only handles
                    the pointer and the keyboard. */}
                <div className="lyrics-focus-rail">
                  <div className="lyrics-focus-track" aria-hidden="true">
                    <div className="lyrics-focus-track-fill" />
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={seekMax}
                    step={1}
                    value={Math.min(Math.round(scrubSecond), seekMax)}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setScrubSeconds(next);
                      seekRef.current(next * 1000);
                    }}
                    onPointerUp={() => setScrubSeconds(null)}
                    onPointerCancel={() => setScrubSeconds(null)}
                    onBlur={() => setScrubSeconds(null)}
                    aria-label="Перемотка трека"
                  />
                </div>
                <span className="lyrics-focus-clock">
                  {formatClock(scrubSecond)} / {formatClock(durationSeconds)}
                </span>
              </div>
            )}

            {isCurrentTrack && (
              <div className="lyrics-focus-volume">
                <button
                  className={`lyrics-focus-volume-btn${volume === 0 ? ' is-muted' : ''}`}
                  type="button"
                  onClick={handleToggleMute}
                  aria-label={volume === 0 ? 'Включить звук' : 'Выключить звук'}
                  title={volume === 0 ? 'Включить звук' : 'Выключить звук'}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    {volume === 0
                      ? <><path d="M11 5 6 9H3v6h3l5 4z" /><path d="m16 9 5 6m0-6-5 6" /></>
                      : <><path d="M11 5 6 9H3v6h3l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></>}
                  </svg>
                </button>
                <div className="lyrics-focus-volume-slider" style={{ '--fill': volume / 100 } as CSSProperties}>
                  <div className="lyrics-focus-rail">
                    <div className="lyrics-focus-track" aria-hidden="true">
                      <div className="lyrics-focus-track-fill" />
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={volume}
                      onChange={(event) => volumeChangeRef.current(Number(event.target.value))}
                      aria-label="Громкость"
                    />
                  </div>
                  <span className="lyrics-focus-clock">{volume}</span>
                </div>
              </div>
            )}
            </div>
            {isCurrentTrack && hasTimedLyrics && activeIndex >= 0 && !activeLineCentered && (
              <button className="lyrics-sync-button" type="button" onClick={syncToCurrentLine}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
                К текущей строке
              </button>
            )}
          </div>
        )}
      </aside>
    </>
  );
}
