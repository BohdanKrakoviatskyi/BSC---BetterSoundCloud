import { useEffect, useRef, useState } from 'react';
import type { SoundCloudTrack } from '../../lib/desktop';
import { SoundCloudWidget, type SoundCloudWidgetControls } from './SoundCloudWidget';

type Props = {
  track: SoundCloudTrack | null;
  loading: boolean;
  shouldPlay: boolean;
  volume: number;
  error: string;
  hasNext: boolean;
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

export function PlayerBar({ track, loading, shouldPlay, volume, error, hasNext, onTogglePlayback, onVolumeCommit, onNext, onPrevious, onEnded, onReady, onError, onPlaybackStateChange }: Props) {
  const [widgetControls, setWidgetControls] = useState<SoundCloudWidgetControls | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volumeValue, setVolumeValue] = useState(volume);
  const [scrubPosition, setScrubPosition] = useState<number | null>(null);
  const scrubPositionRef = useRef<number | null>(null);

  useEffect(() => setVolumeValue(volume), [volume]);

  useEffect(() => {
    setWidgetControls(null);
    setCurrentTime(0);
    setDuration(0);
    scrubPositionRef.current = null;
    setScrubPosition(null);
  }, [track?.id]);

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
    setScrubPosition(null);
    const targetMs = Math.max(0, Math.min(duration * 1000, Math.round(requestedSeconds * 1000)));
    // SoundCloud Widget API seekTo expects milliseconds, not seconds.
    widgetControls.seekTo(targetMs);
  }

  return (
    <div className="player-bar" aria-label="Аудиоплеер">
      {track && (
        <SoundCloudWidget
          key={track.id}
          track={track}
          volume={volumeValue}
          onControlsReady={setWidgetControls}
          onReady={onReady}
          onPlaybackStateChange={onPlaybackStateChange}
          onProgress={(positionMs, durationMs) => {
            setCurrentTime(positionMs / 1000);
            if (durationMs !== undefined) setDuration(durationMs / 1000);
          }}
          onEnded={onEnded}
          onError={onError}
        />
      )}

      <div className="player-track">
        {track?.artworkUrl
          ? <img className="player-artwork" src={track.artworkUrl} alt="" />
          : <div className="player-artwork player-artwork-fallback" aria-hidden="true">♫</div>}
        <div className="player-track-meta">
          {track?.permalinkUrl
            ? <a className="player-track-title" href={track.permalinkUrl} target="_blank" rel="noreferrer" title={track.title}>{track.title}</a>
            : <strong title={track?.title}>{track?.title ?? 'Выберите трек'}</strong>}
          {track && (
            <a className="player-attribution" href={track.permalinkUrl || 'https://soundcloud.com/'} target="_blank" rel="noreferrer">
              <img src={soundCloudLogo} alt="SoundCloud" />
              <span>от {track.user.username}</span>
            </a>
          )}
          {error && <span className="player-error" title={error}>{error}</span>}
        </div>
      </div>

      <div className="player-center">
        <div className="player-controls">
          <button type="button" aria-label="Предыдущий трек" onClick={onPrevious} disabled={!track}>⏮</button>
          <button className="player-play-button" type="button" aria-label={shouldPlay ? 'Пауза' : 'Воспроизвести'} onClick={onTogglePlayback} disabled={!track || loading || !widgetControls}>
            {loading || (track && !widgetControls) ? <span className="player-spinner" /> : shouldPlay ? 'Ⅱ' : '▶'}
          </button>
          <button type="button" aria-label="Следующий трек" onClick={onNext} disabled={!hasNext}>⏭</button>
        </div>
        <div className="player-seek-row">
          <span>{formatTime(currentTime)}</span>
          <input
            aria-label="Позиция воспроизведения"
            type="range"
            min={0}
            max={duration || 1}
            step={1}
            value={Math.min(scrubPosition ?? currentTime, duration || 1)}
            disabled={!widgetControls || !duration}
            onChange={(event) => {
              const requestedSeconds = Number(event.currentTarget.value);
              scrubPositionRef.current = requestedSeconds;
              setScrubPosition(requestedSeconds);
            }}
            onPointerUp={commitSeek}
            onBlur={commitSeek}
            onKeyUp={commitSeek}
          />
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      <label className="player-volume" title={`Громкость ${volumeValue}%`}>
        <span aria-hidden="true">{volumeValue === 0 ? '◖' : '◖))'}</span>
        <input
          aria-label="Громкость"
          type="range"
          min={0}
          max={100}
          value={volumeValue}
          onChange={(event) => setVolumeValue(Number(event.currentTarget.value))}
          onPointerUp={() => onVolumeCommit(volumeValue)}
          onBlur={() => onVolumeCommit(volumeValue)}
          onKeyUp={() => onVolumeCommit(volumeValue)}
        />
      </label>
    </div>
  );
}
