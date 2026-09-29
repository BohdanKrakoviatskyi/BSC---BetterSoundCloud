import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { Track, TrackLyrics } from '../../domain/models';
import type { LyricsPanelPhase } from '../types';
import { measureElementRect, playArtworkFlight, type ElementRect } from '../lib/artworkFlight';
import './LyricsSidebar.css';
import { ResizeHandle } from './ResizeHandle';
import { RibbonGlow } from './RibbonGlow';
import {
  FaArrowDown, FaArrowLeft, FaArrowUp, FaBackwardStep, FaForwardStep, FaMaximize, FaMinimize,
  FaMusic, FaPause, FaPlay, FaRepeat, FaVolumeHigh, FaVolumeXmark, FaXmark,
} from '../lib/icons';
import { formatDuration } from '../lib/format';
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
  onPreviousTrack: () => void;
  onNextTrack: () => void;
  canPreviousTrack: boolean;
  canNextTrack: boolean;
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

function findActiveLineIndex(lines: TrackLyrics['lines'], positionMs: number): number {
  let active = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].startMs <= positionMs) active = index;
    else break;
  }
  return active;
}

export function LyricsSidebar({ phase, track, lyrics, loading, error, isCurrentTrack, isPlaying, onTogglePlayback, onPreviousTrack, onNextTrack, canPreviousTrack, canNextTrack, onSeek, repeatOne, onToggleRepeat, volume, onVolumeChange, playbackPositionMs, originRect, onClose, onSettled, onResize }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [slotRect, setSlotRect] = useState<ElementRect | null>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const flightRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<Array<HTMLParagraphElement | null>>([]);
  const focusLineRefs = useRef<Array<HTMLParagraphElement | null>>([]);
  const focusBodyRef = useRef<HTMLDivElement>(null);
  const syncButtonRef = useRef<HTMLButtonElement>(null);
  const focusScrollAnimationRef = useRef<number | null>(null);
  const manuallyScrolledAtRef = useRef(0);
  const [activeLineCentered, setActiveLineCentered] = useState(true);
  const [currentLineDirection, setCurrentLineDirection] = useState<'up' | 'down'>('up');
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
    const bodyCenter = bodyRect.top + bodyRect.height / 2;
    setCurrentLineDirection(lineCenter < bodyCenter ? 'up' : 'down');
    const focusTop = bodyRect.top + 58;
    const focusBottom = Math.min(bodyRect.bottom - 24, window.innerHeight - 170);
    const lineIsInFocus = lineRect.bottom > focusTop && lineRect.top < focusBottom;
    setActiveLineCentered(lineIsInFocus);
  }, [activeIndex, isCurrentTrack]);

  const syncToCurrentLine = useCallback(() => {
    manuallyScrolledAtRef.current = 0;
    const body = focusBodyRef.current;
    const line = focusLineRefs.current[activeIndex];
    if (!body || !line) return;
    if (focusScrollAnimationRef.current !== null) {
      cancelAnimationFrame(focusScrollAnimationRef.current);
    }
    const from = body.scrollTop;
    const bodyRect = body.getBoundingClientRect();
    const lineRect = line.getBoundingClientRect();
    const to = Math.max(0, Math.min(
      body.scrollHeight - body.clientHeight,
      from + (lineRect.top + lineRect.height / 2) - (bodyRect.top + bodyRect.height / 2),
    ));
    const startedAt = performance.now();
    const duration = 760;
    const animate = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = progress * progress * (3 - 2 * progress);
      body.scrollTop = from + (to - from) * eased;
      if (progress < 1) {
        focusScrollAnimationRef.current = requestAnimationFrame(animate);
      } else {
        focusScrollAnimationRef.current = null;
        updateActiveLinePosition();
      }
    };
    focusScrollAnimationRef.current = requestAnimationFrame(animate);
  }, [activeIndex, updateActiveLinePosition]);

  useLayoutEffect(() => {
    if (activeLineCentered) return;
    const button = syncButtonRef.current;
    if (!button) return;
    const animation = button.animate(
      [
        { opacity: 0, transform: 'translateX(-50%) translateY(14px) scale(.94)' },
        { opacity: 1, transform: 'translateX(-50%) translateY(0) scale(1)' },
      ],
      { duration: 420, easing: 'cubic-bezier(.22, 1, .36, 1)' },
    );
    return () => animation.cancel();
  }, [activeLineCentered]);

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
    // Once the reader scrolls manually, leave the viewport under their control. The
    // sync button explicitly resumes following the currently sung line.
    if (manuallyScrolledAtRef.current) {
      updateActiveLinePosition();
      return;
    }
    const body = focusBodyRef.current;
    const line = focusLineRefs.current[activeIndex];
    if (!body || !line) return;

    if (focusScrollAnimationRef.current !== null) {
      cancelAnimationFrame(focusScrollAnimationRef.current);
    }
    const from = body.scrollTop;
    const bodyRect = body.getBoundingClientRect();
    const lineRect = line.getBoundingClientRect();
    const to = Math.max(0, Math.min(
      body.scrollHeight - body.clientHeight,
      from + (lineRect.top + lineRect.height / 2) - (bodyRect.top + bodyRect.height / 2),
    ));
    const startedAt = performance.now();
    const duration = 620;
    const animate = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      // Smoothstep keeps both ends gentle, like a carousel settling onto its next item.
      const eased = progress * progress * (3 - 2 * progress);
      body.scrollTop = from + (to - from) * eased;
      if (progress < 1) {
        focusScrollAnimationRef.current = requestAnimationFrame(animate);
      } else {
        focusScrollAnimationRef.current = null;
        updateActiveLinePosition();
      }
    };
    focusScrollAnimationRef.current = requestAnimationFrame(animate);
    return () => {
      if (focusScrollAnimationRef.current !== null) {
        cancelAnimationFrame(focusScrollAnimationRef.current);
        focusScrollAnimationRef.current = null;
      }
    };
  }, [activeIndex, focusMode, isCurrentTrack, updateActiveLinePosition]);

  // A track change resets the reader's scroll position while keeping fullscreen lyrics open.
  useEffect(() => {
    setExpanded(false);
    manuallyScrolledAtRef.current = 0;
    if (focusBodyRef.current) focusBodyRef.current.scrollTop = 0;
  }, [track.id]);

  // Keep the lyric view while the next song loads, then smoothly return to its track page if
  // that song has no lyrics.
  useEffect(() => {
    if (!focusMode || !isCurrentTrack || loading || hasLines) return;
    setFocusMode(false);
    const timeout = window.setTimeout(() => onCloseRef.current(), 260);
    return () => window.clearTimeout(timeout);
  }, [focusMode, hasLines, isCurrentTrack, loading, track.id]);

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
      {track.artwork ? <img src={track.artwork} alt="" /> : <span className="lyrics-artwork-fallback"><FaMusic /></span>}
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
            {track.artwork ? <img src={track.artwork} alt={`Обложка: ${track.title}`} /> : <span className="lyrics-artwork-fallback" aria-hidden="true"><FaMusic /></span>}
          </div>
          <div className="lyrics-sidebar-copy">
            <h2>{track.title}</h2>
            <p>{track.artist.name || 'SoundCloud'}</p>
          </div>
          <button className="lyrics-icon-button lyrics-close" type="button" onClick={handleClose} aria-label="Закрыть текст песни" title="Закрыть">
            <FaXmark aria-hidden="true" />
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
                ? <FaMinimize aria-hidden="true" />
                : <FaMaximize aria-hidden="true" />}
            </button>
          </div>
        </div>

        <div
          className={`lyrics-body${expanded ? ' is-expanded' : ''}`}
          onWheel={() => { manuallyScrolledAtRef.current = Date.now(); }}
          onPointerDown={() => { manuallyScrolledAtRef.current = Date.now(); }}
        >
          {loading && (
            <div className="lyrics-skeleton" role="status" aria-label="Загружаю текст песни">
              <span className="lyrics-skeleton-caption" />
              <span />
              <span className="is-short" />
              <span />
              <span className="is-medium" />
              <span />
              <span className="is-short" />
            </div>
          )}
          {!loading && error && <div className="lyrics-state lyrics-state-error">{error}</div>}
          {!loading && !error && !hasLines && <div className="lyrics-state">Текст для этого трека не найден.</div>}
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
            {track.artwork
              ? <div className="lyrics-focus-backdrop" style={{ backgroundImage: `url("${track.artwork.replaceAll('"', '%22')}")` }} aria-hidden="true" />
              : <RibbonGlow className="lyrics-focus-glow" />}
            <div className="lyrics-focus-head">
              <button className="lyrics-icon-button lyrics-focus-exit" type="button" onClick={handleExitFocus} aria-label="Назад" title="Назад">
                <FaArrowLeft aria-hidden="true" />
                <span>Назад</span>
              </button>
            </div>
            <div className="lyrics-focus-artwork-card">
              {track.artwork
                ? <img src={track.artwork} alt={`Обложка: ${track.title}`} />
                : <span className="lyrics-focus-track-art-fallback" aria-hidden="true"><FaMusic /></span>}
              <h2 title={track.title}>{track.title}</h2>
              <p>{track.artist.name || 'SoundCloud'}</p>
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
                  aria-current={index === activeIndex && isCurrentTrack ? 'true' : undefined}
                  style={{ '--lyrics-distance': Math.min(distance, 5) } as CSSProperties}
                >
                  {line.text}
                </p>;
              })}
            </div>
            <div className="lyrics-focus-controls">
                {isCurrentTrack && durationSeconds > 0 && (
                  <div className={`lyrics-focus-seek${scrubSeconds !== null ? ' is-scrubbing' : ''}`} style={{ '--fill': seekFraction } as CSSProperties}>
                    <span>{formatDuration(scrubSecond * 1000)}</span>
                    <div className="lyrics-focus-rail">
                      <div className="lyrics-focus-track" aria-hidden="true"><div className="lyrics-focus-track-fill" /></div>
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
                    <span>{formatDuration(durationSeconds * 1000)}</span>
                  </div>
                )}
                <div className="lyrics-focus-transport">
                <button className="lyrics-focus-skip" type="button" onClick={onPreviousTrack} aria-label="Предыдущий трек" title="Предыдущий трек" disabled={!canPreviousTrack}>
                  <FaBackwardStep aria-hidden="true" />
                </button>
                <button
                  className="lyrics-focus-play"
                  type="button"
                  onClick={handleTogglePlayback}
                  aria-label={isPlaying ? 'Пауза' : 'Продолжить'}
                  title={isPlaying ? 'Пауза' : 'Продолжить'}
                >
                  {isPlaying
                    ? <FaPause aria-hidden="true" />
                    : <FaPlay aria-hidden="true" />}
                </button>
                <button className="lyrics-focus-skip" type="button" onClick={onNextTrack} aria-label="Следующий трек" title="Следующий трек" disabled={!canNextTrack}>
                  <FaForwardStep aria-hidden="true" />
                </button>
                <button
                  className={`lyrics-focus-repeat${repeatOne ? ' is-on' : ''}`}
                  type="button"
                  onClick={handleToggleRepeat}
                  aria-pressed={repeatOne}
                  aria-label={repeatOne ? 'Выключить повтор' : 'Повторять трек'}
                  title={repeatOne ? 'Повтор песни включён' : 'Повторять трек'}
                >
                  <FaRepeat aria-hidden="true" />
                </button>
                <div className="lyrics-focus-volume">
                  <button
                    className={`lyrics-focus-volume-btn${volume === 0 ? ' is-muted' : ''}`}
                    type="button"
                    onClick={handleToggleMute}
                    aria-label={volume === 0 ? 'Включить звук' : 'Выключить звук'}
                    title={volume === 0 ? 'Включить звук' : 'Выключить звук'}
                  >
                    {volume === 0 ? <FaVolumeXmark aria-hidden="true" /> : <FaVolumeHigh aria-hidden="true" />}
                  </button>
                  <div className="lyrics-focus-volume-range" style={{ '--volume-fill': `${volume}%` } as CSSProperties}>
                    <input type="range" min={0} max={100} step={1} value={volume} onChange={(event) => volumeChangeRef.current(Number(event.target.value))} aria-label="Громкость" aria-valuetext={`${volume}%`} />
                  </div>
                  <span className="lyrics-focus-volume-value">{volume}%</span>
                </div>
                </div>
              </div>
            {isCurrentTrack && hasTimedLyrics && activeIndex >= 0 && (
              <button
                ref={syncButtonRef}
                className={`lyrics-sync-button${activeLineCentered ? '' : ' is-visible'}`}
                type="button"
                onClick={syncToCurrentLine}
                aria-hidden={activeLineCentered}
                tabIndex={activeLineCentered ? -1 : 0}
              >
                {currentLineDirection === 'up' ? <FaArrowUp aria-hidden="true" /> : <FaArrowDown aria-hidden="true" />}
                К текущей строке
              </button>
            )}
          </div>
        )}
      </aside>
    </>
  );
}
