import { useEffect, useRef, useState } from 'react';
import type { Track } from '../../domain/models';
import { SoundCloudWidget, type SoundCloudWidgetControls } from './SoundCloudWidget';
import { DirectStreamPlayer } from './DirectStreamPlayer';

type Props = {
  track: Track | null;
  loading: boolean;
  shouldPlay: boolean;
  volume: number;
  error: string;
  hasNext: boolean;
  liked: boolean;
  onLike: () => void;
  onOpenTrack: () => void;
  onTogglePlayback: () => void;
  onVolumeCommit: (volume: number) => void;
  onNext: () => void;
  onPrevious: () => void;
  onEnded: () => void;
  onReady: () => void;
  onError: (message: string) => void;
  onPlaybackStateChange: (playing: boolean) => void;
};

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

const soundCloudLogo = 'https://developers.soundcloud.com/assets/logo_big_white-a38cb93cd8fa05a93183280f295e13aff1a4ae0945ca2fb0efbe85b82588431e.png';

export function PlayerBar({ track, loading, shouldPlay, volume, error, hasNext, liked, onLike, onOpenTrack, onTogglePlayback, onVolumeCommit, onNext, onPrevious, onEnded, onReady, onError, onPlaybackStateChange }: Props) {
  const [widgetControls, setWidgetControls] = useState<SoundCloudWidgetControls | null>(null);
  const [playbackMode, setPlaybackMode] = useState<'widget' | 'direct'>('widget');
  const [repeatOne, setRepeatOne] = useState(false);
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
    if (shouldPlay) widgetControls.play();
    else widgetControls.pause();
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

  function handleProgress(positionMs: number, durationMs?: number) {
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
      onEnded();
      return;
    }
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
          <button className="player-icon" type="button" aria-label="Предыдущий трек" onClick={onPrevious} disabled={!track}>⏮</button>
          <button className="play-button" type="button" aria-label={shouldPlay ? 'Пауза' : 'Воспроизвести'} onClick={onTogglePlayback} disabled={!track || loading}>
            {loading || (track && !widgetControls) ? <span className="player-spinner" /> : shouldPlay ? 'Ⅱ' : '▶'}
          </button>
          <button className="player-icon" type="button" aria-label="Следующий трек" onClick={onNext} disabled={!hasNext}>⏭</button>
          <button className={`player-icon repeat-one-button ${repeatOne ? 'selected' : ''}`} type="button" aria-label={repeatOne ? 'Выключить повтор песни' : 'Повторять текущую песню'} title={repeatOne ? 'Повтор песни включён' : 'Повторять песню'} aria-pressed={repeatOne} disabled={!track} onClick={() => setRepeatOne((enabled) => !enabled)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 2l4 4-4 4" /><path d="M3 11V9a3 3 0 0 1 3-3h15" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a3 3 0 0 1-3 3H3" /></svg>
            <span>1</span>
          </button>
        </div>
      </div>

      <div className="timeline">
        <span>{formatTime(scrubPosition ?? currentTime)}</span>
        <input
          aria-label="Позиция воспроизведения"
          type="range"
          min={0}
          max={duration || 1}
          step="any"
          value={Math.min(scrubPosition ?? currentTime, duration || 1)}
          disabled={!widgetControls || !duration}
          style={{ background: `linear-gradient(to right,var(--player-progress,#ff5a1f) 0%,var(--player-progress,#ff5a1f) ${Math.min(100, ((scrubPosition ?? currentTime) / (duration || 1)) * 100)}%,#555555 ${Math.min(100, ((scrubPosition ?? currentTime) / (duration || 1)) * 100)}%,#555555 100%)` }}
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
        <span>{formatTime(duration)}</span>
      </div>

      <div className="player-details">
        <label className="player-right" title={`Громкость ${volumeValue}%`}>
          <span className="volume-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4V5Z" />{volumeValue === 0 ? <path d="m16 9 5 6m0-6-5 6" /> : <><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></>}</svg>
          </span>
          <input
            className="volume"
            aria-label="Громкость"
            type="range"
            min={0}
            max={100}
            value={volumeValue}
            style={{ background: `linear-gradient(to right,#eeeeee 0%,#eeeeee ${volumeValue}%,#555555 ${volumeValue}%,#555555 100%)` }}
            onChange={(event) => setVolumeValue(Number(event.currentTarget.value))}
            onPointerUp={() => onVolumeCommit(volumeValue)}
            onBlur={() => onVolumeCommit(volumeValue)}
            onKeyUp={() => onVolumeCommit(volumeValue)}
          />
        </label>

        <div className={`now-playing ${track ? '' : 'empty'}`}>
          <button className="now-playing-cover" type="button" disabled={!track} onClick={onOpenTrack} aria-label="Открыть страницу трека">
            {track?.artwork && <img src={track.artwork} alt="" />}
          </button>
          <div className="track-copy">
            <button type="button" className="track-title-button" onClick={onOpenTrack} title={track?.title}><b>{track?.title ?? 'Выбери музыку'}</b></button>
            {track?.permalink ? <a href={track.permalink} target="_blank" rel="noreferrer">{track.artist.name || 'SoundCloud'}</a> : <span>{track?.artist.name || 'Здесь начнётся твоё звучание'}</span>}
            {error && <small className="player-error" title={error}>{error}</small>}
          </div>
          <button className={`like-button ${liked ? 'liked' : ''}`} type="button" onClick={onLike} disabled={!track} aria-label={liked ? 'Убрать из любимых' : 'Добавить в любимые'} title={liked ? 'В любимых' : 'Добавить в любимые'}>♥</button>
        </div>
      </div>
    </footer>
  );
}
