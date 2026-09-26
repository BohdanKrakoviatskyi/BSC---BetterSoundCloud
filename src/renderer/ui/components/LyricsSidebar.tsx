import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { Track, TrackLyrics } from '../../domain/models';
import type { LyricsPanelPhase } from '../types';
import { measureElementRect, playArtworkFlight, type ElementRect } from '../lib/artworkFlight';
import './LyricsSidebar.css';
import { ResizeHandle } from './ResizeHandle';

type Props = {
  phase: LyricsPanelPhase;
  track: Track;
  lyrics: TrackLyrics | null;
  loading: boolean;
  error: string;
  /** Whether the panel shows the words of the track that is actually playing. */
  isCurrentTrack: boolean;
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

function findActiveLineIndex(lines: TrackLyrics['lines'], positionMs: number): number {
  let active = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].startMs <= positionMs) active = index;
    else break;
  }
  return active;
}

export function LyricsSidebar({ phase, track, lyrics, loading, error, isCurrentTrack, playbackPositionMs, originRect, onClose, onSettled, onResize }: Props) {
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
  // Kept in refs so a re-render of the owner can never restart a flight that is already running.
  const onCloseRef = useRef(onClose);
  const onSettledRef = useRef(onSettled);
  onCloseRef.current = onClose;
  onSettledRef.current = onSettled;

  const isMounted = phase !== 'closed';
  const isFlying = phase === 'opening' || phase === 'closing';
  const lines = lyrics?.lines ?? [];
  const hasLines = lines.length > 0;
  // Only timestamped sources can follow playback accurately.
  const hasTimedLyrics = Boolean(lyrics?.isSynced || lyrics?.isDemo);
  const activeIndex = hasTimedLyrics ? findActiveLineIndex(lines, isCurrentTrack ? playbackPositionMs : 0) : -1;
  const canCollapse = lines.length > 6;

  const handleClose = useCallback(() => onCloseRef.current(), []);

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
      onCloseRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [phase]);

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
            <div className="lyrics-focus-head">
              <button className="lyrics-icon-button" type="button" onClick={() => setFocusMode(false)} aria-label="Вернуть обычный вид" title="Обычный вид">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" /></svg>
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
                  className={`lyrics-line lyrics-line-lg${index === activeIndex && isCurrentTrack ? ' is-active' : ''}`}
                  style={{ '--lyrics-distance': Math.min(distance, 5) } as CSSProperties}
                >
                  {line.text}
                </p>;
              })}
            </div>
            {isCurrentTrack && hasTimedLyrics && activeIndex >= 0 && !activeLineCentered && (
              <button className="lyrics-sync-button" type="button" onClick={syncToCurrentLine}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12l7 7 7-7" /></svg>
                К текущей строке
              </button>
            )}
          </div>
        )}
      </aside>
    </>
  );
}
