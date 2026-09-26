import { useEffect, useRef, useState } from 'react';
import type { Track } from '../../domain/models';
import { SoundCloudWidget, type SoundCloudWidgetControls } from './SoundCloudWidget';
import { DirectStreamPlayer } from './DirectStreamPlayer';

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

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

const soundCloudLogo = 'https://developers.soundcloud.com/assets/logo_big_white-a38cb93cd8fa05a93183280f295e13aff1a4ae0945ca2fb0efbe85b82588431e.png';

export function PlayerBar({ track, seekRequest, onSeekRequestHandled, repeatOne, onToggleRepeat, shuffleLiked, onToggleShuffle, onPlayRandomLikedTrack, loading, shouldPlay, volume, onVolumeChange, error, hasNext, liked, onLike, onOpenTrack, onOpenArtist, onTogglePlayback, onNext, onPrevious, onEnded, onReady, onProgress, onError, onPlaybackStateChange }: Props) {
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
          <button className={`player-icon shuffle-button${shuffleLiked ? ' selected' : ''}`} type="button" aria-label={shuffleLiked ? 'Выключить случайное воспроизведение лайкнутых треков' : 'Случайное воспроизведение лайкнутых треков'} title={shuffleLiked ? 'Случайный выбор из лайкнутых включён' : 'Случайный выбор из лайкнутых'} aria-pressed={shuffleLiked} disabled={!track} onClick={onToggleShuffle}>
            <svg className="shuffleControl" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M13.0303 7.03033L15.5607 4.5L13.0303 1.96967L11.9697 3.03033L12.6894 3.75H12.2443C10.9235 3.75 9.66227 4.29996 8.76351 5.26786L7.25 6.89779L5.73649 5.26786C4.83773 4.29996 3.57655 3.75 2.25572 3.75H1V5.25H2.25572C3.15945 5.25 4.02236 5.62629 4.6373 6.28853L6.22652 8L4.6373 9.71147C4.02236 10.3737 3.15945 10.75 2.25572 10.75H1V12.25H2.25572C3.57655 12.25 4.83773 11.7 5.73649 10.7321L7.25 9.10221L8.76351 10.7321C9.66227 11.7 10.9235 12.25 12.2443 12.25H12.6893L11.9697 12.9697L13.0303 14.0303L15.5607 11.5L13.0303 8.96967L11.9697 10.0303L12.6894 10.75H12.2443C11.3406 10.75 10.4776 10.3737 9.8627 9.71147L8.27348 8L9.8627 6.28853C10.4776 5.62629 11.3406 5.25 12.2443 5.25H12.6893L11.9697 5.96967L13.0303 7.03033Z" fill="currentColor" /></svg>
          </button>
          <button className={`player-icon repeat-one-button ${repeatOne ? 'selected' : ''}`} type="button" aria-label={repeatOne ? 'Выключить повтор песни' : 'Повторять текущую песню'} title={repeatOne ? 'Повтор песни включён' : 'Повторять песню'} aria-pressed={repeatOne} disabled={!track} onClick={onToggleRepeat}>
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
        <div className="player-volume-control">
          <svg className="player-volume-icon" viewBox="0 0 24 24" aria-hidden="true">
            {volumeValue === 0
              ? <><path d="M11 5 6 9H3v6h3l5 4z" /><path d="m16 9 5 6m0-6-5 6" /></>
              : <><path d="M11 5 6 9H3v6h3l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></>}
          </svg>
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
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" /></svg>
          </button>
        </div>
      </div>
    </footer>
  );
}
