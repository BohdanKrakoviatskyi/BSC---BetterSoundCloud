import { useEffect, useRef, useState } from 'react';
import type { Track } from '../../domain/models';
import { SoundCloudWidget, type SoundCloudWidgetControls } from './SoundCloudWidget';
import { DirectStreamPlayer } from './DirectStreamPlayer';
import {
  FaArrowRightFromBracket, FaBackwardStep, FaForwardStep, FaGear, FaHeart,
  FaListUl, FaPause, FaPlay, FaRepeat, FaShuffle, FaVolumeHigh, FaVolumeXmark,
} from '../lib/icons';
import { formatDuration } from '../lib/format';

export type PlayerSeekRequest = { requestId: number; trackId: number; positionMs: number };

type Props = {
  track: Track | null;
  seekRequest: PlayerSeekRequest | null;
  onSeekRequestHandled: (requestId: number) => void;
  repeatOne: boolean;
  onToggleRepeat: () => void;
  shuffleLiked: boolean;
  onToggleShuffle: () => void;
  loading: boolean;
  shouldPlay: boolean;
  volume: number;
  onVolumeChange: (volume: number) => void;
  error: string;
  hasNext: boolean;
  liked: boolean;
  onLike: () => void;
  queueOpen: boolean;
  onToggleQueue: () => void;
  onOpenTrack: () => void;
  onOpenArtist?: (track: Track) => void;
  onTogglePlayback: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onEnded: () => void;
  onReady: () => void;
  onProgress: (positionMs: number) => void;
  onError: (message: string) => void;
  onPlaybackStateChange: (playing: boolean) => void;
};

export function PlayerBar({ track, seekRequest, onSeekRequestHandled, repeatOne, onToggleRepeat, shuffleLiked, onToggleShuffle, loading, shouldPlay, volume, onVolumeChange, error, hasNext, liked, onLike, queueOpen, onToggleQueue, onOpenTrack, onOpenArtist, onTogglePlayback, onNext, onPrevious, onEnded, onReady, onProgress, onError, onPlaybackStateChange }: Props) {
  const [widgetControls, setWidgetControls] = useState<SoundCloudWidgetControls | null>(null);
  const [playbackMode, setPlaybackMode] = useState<'widget' | 'direct'>('widget');

  const [directRetryKey, setDirectRetryKey] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(track ? track.durationMs / 1000 : 0);
  const [volumeValue, setVolumeValue] = useState(volume);
  const [scrubPosition, setScrubPosition] = useState<number | null>(null);
  const scrubPositionRef = useRef<number | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const seekReleaseTimerRef = useRef<number | null>(null);
  const isScrubbingRef = useRef(false);
  const playbackObservedRef = useRef(false);
  const endedRef = useRef(false);
  const handledSeekRequestRef = useRef<number | null>(null);

  useEffect(() => setVolumeValue(volume), [volume]);

  useEffect(() => {
    if (playbackMode === 'direct' && widgetControls && shouldPlay) widgetControls.play();
    else if (playbackMode === 'direct' && widgetControls) widgetControls.pause();
  }, [playbackMode, widgetControls, shouldPlay]);

  useEffect(() => {
    setPlaybackMode('widget');
    setDirectRetryKey(0);
    setWidgetControls(null);
    playbackObservedRef.current = false;
    endedRef.current = false;
    setCurrentTime(0);
    setDuration(track ? track.durationMs / 1000 : 0);
    scrubPositionRef.current = null;
    pendingSeekRef.current = null;
    isScrubbingRef.current = false;
    if (seekReleaseTimerRef.current !== null) {
      window.clearTimeout(seekReleaseTimerRef.current);
      seekReleaseTimerRef.current = null;
    }
    setScrubPosition(null);
  }, [track?.id]);

  useEffect(() => () => {
    if (seekReleaseTimerRef.current !== null) window.clearTimeout(seekReleaseTimerRef.current);
  }, []);

  useEffect(() => {
    if (!track || playbackMode !== 'widget' || !shouldPlay) return;
    playbackObservedRef.current = false;
    const timeout = window.setTimeout(() => {
      if (playbackObservedRef.current) return;
      console.warn('[ui.player] SoundCloud widget did not start; switching to the direct stream', { trackId: track.id });
      setPlaybackMode('direct');
      setWidgetControls(null);
    }, 12_000);
    return () => window.clearTimeout(timeout);
  }, [track?.id, playbackMode, widgetControls, shouldPlay]);

  useEffect(() => {
    widgetControls?.setVolume(Math.max(0, Math.min(100, volumeValue)));
  }, [volumeValue, widgetControls]);

  useEffect(() => {
    if (!widgetControls) return;
    if (!shouldPlay) {
      widgetControls.pause();
      return;
    }
    // A track that already ran to its end sits in the stream's terminal state, where play() is
    // silently ignored — that is what made a finished song unreplayable until another track was
    // picked first. Rewind to the start before resuming, the same move repeat-one already makes.
    if (endedRef.current) {
      endedRef.current = false;
      setCurrentTime(0);
      widgetControls.seekTo(0);
    }
    widgetControls.play();
  }, [shouldPlay, widgetControls]);

  function commitSeek() {
    const requestedSeconds = scrubPositionRef.current;
    if (requestedSeconds === null || !widgetControls) return;
    scrubPositionRef.current = null;
    isScrubbingRef.current = false;
    pendingSeekRef.current = requestedSeconds;
    const targetMs = Math.max(0, Math.min(duration * 1000, Math.round(requestedSeconds * 1000)));
    if (seekReleaseTimerRef.current !== null) window.clearTimeout(seekReleaseTimerRef.current);
    seekReleaseTimerRef.current = window.setTimeout(() => {
      if (pendingSeekRef.current === requestedSeconds) {
        pendingSeekRef.current = null;
        setCurrentTime(requestedSeconds);
        setScrubPosition(null);
      }
      seekReleaseTimerRef.current = null;
    }, 1500);
    // SoundCloud Widget API seekTo expects milliseconds, not seconds.
    widgetControls.seekTo(targetMs);
  }

  useEffect(() => {
    if (!seekRequest || seekRequest.trackId !== track?.id || !widgetControls || !duration || handledSeekRequestRef.current === seekRequest.requestId) return;
    const targetSeconds = Math.max(0, Math.min(duration, seekRequest.positionMs / 1000));
    scrubPositionRef.current = targetSeconds;
    isScrubbingRef.current = true;
    setScrubPosition(targetSeconds);
    commitSeek();
    handledSeekRequestRef.current = seekRequest.requestId;
    onSeekRequestHandled(seekRequest.requestId);
  }, [seekRequest, track?.id, widgetControls, duration, onSeekRequestHandled]);

  function handleProgress(positionMs: number, durationMs?: number) {
    onProgress(positionMs);
    if (positionMs > 1500) playbackObservedRef.current = true;
    const positionSeconds = positionMs / 1000;
    const pendingSeek = pendingSeekRef.current;
    if (!isScrubbingRef.current && pendingSeek === null) setCurrentTime(positionSeconds);
    if (pendingSeek !== null && Math.abs(positionSeconds - pendingSeek) <= 1.25) {
      pendingSeekRef.current = null;
      setCurrentTime(positionSeconds);
      setScrubPosition(null);
      if (seekReleaseTimerRef.current !== null) {
        window.clearTimeout(seekReleaseTimerRef.current);
        seekReleaseTimerRef.current = null;
      }
    }
    if (durationMs !== undefined && durationMs > 0) setDuration(durationMs / 1000);
  }

  function handleTrackEnded() {
    if (!repeatOne || !widgetControls) {
      // Remember the terminal state so the next play rewinds instead of pressing play on a
      // finished stream, which the widget answers with silence.
      endedRef.current = true;
      onEnded();
      return;
    }
    endedRef.current = false;
    onPlaybackStateChange(true);
    setCurrentTime(0);
    widgetControls.seekTo(0);
    window.setTimeout(() => widgetControls.play(), 80);
  }

  return (
    <footer className="player-bar" aria-label="Аудиоплеер">
      {track && playbackMode === 'widget' && (
        <SoundCloudWidget
          track={track}
          volume={volumeValue}
          onControlsReady={setWidgetControls}
          onReady={onReady}
          onPlaybackStateChange={(playing) => {
            onPlaybackStateChange(playing);
          }}
          onProgress={handleProgress}
          onEnded={handleTrackEnded}
          onError={(message) => {
            console.warn('[ui.player] SoundCloud widget failed; switching to the direct stream', { trackId: track.id, error: message });
            setPlaybackMode('direct');
            setWidgetControls(null);
          }}
        />
      )}
      {track && playbackMode === 'direct' && (
        <DirectStreamPlayer
          key={`${track.id}:${directRetryKey}`}
          track={track}
          volume={volumeValue}
          shouldPlay={shouldPlay}
          onControlsReady={setWidgetControls}
          onReady={onReady}
          onPlaybackStateChange={(playing) => {
            onPlaybackStateChange(playing);
          }}
          onProgress={handleProgress}
          onEnded={handleTrackEnded}
          onError={(message) => {
            onPlaybackStateChange(false);
            onError(message);
          }}
        />
      )}

      <div className="player-center">
        <div className="transport">
          <button className="player-icon" type="button" aria-label="Предыдущий трек" onClick={onPrevious} disabled={!track}><FaBackwardStep /></button>
          <button className="play-button" type="button" aria-label={shouldPlay ? 'Пауза' : 'Воспроизвести'} onClick={onTogglePlayback} disabled={!track || loading}>
            {loading ? <span className="player-spinner" /> : shouldPlay ? <FaPause /> : <FaPlay />}
          </button>
          <button className="player-icon" type="button" aria-label="Следующий трек" onClick={onNext} disabled={!hasNext}><FaForwardStep /></button>
          <button className={`player-icon shuffle-button${shuffleLiked ? ' selected' : ''}`} type="button" aria-label={shuffleLiked ? 'Выключить случайное воспроизведение лайкнутых треков' : 'Случайное воспроизведение лайкнутых треков'} title={shuffleLiked ? 'Случайный выбор из лайкнутых включён' : 'Случайный выбор из лайкнутых'} aria-pressed={shuffleLiked} disabled={!track} onClick={onToggleShuffle}>
            <FaShuffle className="shuffleControl" aria-hidden="true" />
          </button>
          <button className={`player-icon repeat-one-button ${repeatOne ? 'selected' : ''}`} type="button" aria-label={repeatOne ? 'Выключить повтор песни' : 'Повторять текущую песню'} title={repeatOne ? 'Повтор песни включён' : 'Повторять песню'} aria-pressed={repeatOne} disabled={!track} onClick={onToggleRepeat}>
            <FaRepeat aria-hidden="true" />
            <span>1</span>
          </button>
        </div>
      </div>

      <div className="timeline">
        <span>{formatDuration((scrubPosition ?? currentTime) * 1000)}</span>
        <input
          aria-label="Позиция воспроизведения"
          type="range"
          min={0}
          max={duration || 1}
          step="any"
          value={Math.min(scrubPosition ?? currentTime, duration || 1)}
          disabled={!widgetControls || !duration}
          style={{ background: `linear-gradient(to right,var(--accent) 0%,var(--accent) ${Math.min(100, ((scrubPosition ?? currentTime) / (duration || 1)) * 100)}%,#555555 ${Math.min(100, ((scrubPosition ?? currentTime) / (duration || 1)) * 100)}%,#555555 100%)` }}
          onChange={(event) => {
            if (seekReleaseTimerRef.current !== null) {
              window.clearTimeout(seekReleaseTimerRef.current);
              seekReleaseTimerRef.current = null;
            }
            pendingSeekRef.current = null;
            isScrubbingRef.current = true;
            const requestedSeconds = Number(event.currentTarget.value);
            scrubPositionRef.current = requestedSeconds;
            setScrubPosition(requestedSeconds);
          }}
          onPointerUp={commitSeek}
          onPointerCancel={commitSeek}
          onBlur={commitSeek}
          onKeyUp={commitSeek}
        />
        <span>{formatDuration(duration * 1000)}</span>
      </div>

      <div className="player-details">
        <div className="player-volume-control">
          {volumeValue === 0
            ? <FaVolumeXmark className="player-volume-icon" aria-hidden="true" />
            : <FaVolumeHigh className="player-volume-icon" aria-hidden="true" />}
          <input
            className="volume"
            type="range"
            min={0}
            max={100}
            value={volumeValue}
            aria-label="Громкость"
            aria-valuetext={`${volumeValue}%`}
            style={{ background: `linear-gradient(to right,#fff 0 ${volumeValue}%,#39393e ${volumeValue}% 100%)` }}
            onChange={(event) => {
              const nextVolume = Number(event.currentTarget.value);
              setVolumeValue(nextVolume);
              onVolumeChange(nextVolume);
            }}
          />
        </div>

        <div className={`now-playing ${track ? '' : 'empty'}`}>
          <button className="now-playing-cover" type="button" disabled={!track} onClick={onOpenTrack} aria-label="Открыть страницу трека">
            {track?.artwork && <img src={track.artwork} alt="" />}
          </button>
          <div className="track-copy">
            <button type="button" className="track-title-button" onClick={onOpenTrack} title={track?.title}><b>{track?.title ?? 'Выбери музыку'}</b></button>
            {track?.artist.name && onOpenArtist
              ? <button type="button" className="track-artist-button" onClick={() => onOpenArtist(track)} title="Открыть профиль автора">{track.artist.name}</button>
              : track?.permalink
                ? <a href={track.permalink} target="_blank" rel="noreferrer">{track.artist.name || 'SoundCloud'}</a>
                : <span>{track?.artist.name || 'Здесь начнётся твоё звучание'}</span>}
            {error && <small className="player-error" title={error}>{error}</small>}
          </div>
          <button className={`like-button ${liked ? 'liked' : ''}`} type="button" onClick={onLike} disabled={!track} aria-pressed={liked} aria-label={liked ? 'Убрать из любимых' : 'Добавить в любимые'} title={liked ? 'В любимых' : 'Добавить в любимые'}>
            <FaHeart aria-hidden="true" />
          </button>
          <button className={`queue-open-button${queueOpen ? ' is-open' : ''}`} type="button" onClick={onToggleQueue} aria-expanded={queueOpen} aria-label="Открыть очередь" title="Очередь воспроизведения">
            <FaListUl aria-hidden="true" />
          </button>
        </div>
      </div>
    </footer>
  );
}
