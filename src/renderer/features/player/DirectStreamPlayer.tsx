import { useEffect, useRef } from 'react';
import Hls from 'hls.js';
import type { Track } from '../../domain/models';
import { appGateway } from '../../application/appGateway';
import type { TrackStreamOption } from '../../platform/desktop';
import type { SoundCloudWidgetControls } from './SoundCloudWidget';

type Props = {
  track: Track;
  volume: number;
  shouldPlay: boolean;
  onControlsReady: (controls: SoundCloudWidgetControls) => void;
  onReady: () => void;
  onPlaybackStateChange: (playing: boolean) => void;
  onProgress: (position: number, duration?: number) => void;
  onEnded: () => void;
  onError: (message: string) => void;
};

export function DirectStreamPlayer({ track, volume, shouldPlay, onControlsReady, onReady, onPlaybackStateChange, onProgress, onEnded, onError }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const callbacksRef = useRef({ onControlsReady, onReady, onPlaybackStateChange, onProgress, onEnded, onError });
  const volumeRef = useRef(volume);
  const shouldPlayRef = useRef(shouldPlay);
  callbacksRef.current = { onControlsReady, onReady, onPlaybackStateChange, onProgress, onEnded, onError };
  volumeRef.current = volume;
  shouldPlayRef.current = shouldPlay;

  useEffect(() => {
    const audioElement = audioRef.current;
    if (!audioElement) return;
    const audio: HTMLAudioElement = audioElement;
    let active = true;
    let hls: Hls | null = null;
    let candidates: TrackStreamOption[] = [];
    let candidateIndex = -1;
    let recoveredMediaError = false;
    audio.pause();
    audio.removeAttribute('src');
    audio.volume = Math.max(0, Math.min(100, volumeRef.current)) / 100;
    audio.load();

    const controls: SoundCloudWidgetControls = {
      play: () => { void audio.play().catch((error: unknown) => {
        if (active) callbacksRef.current.onError(error instanceof Error ? error.message : 'Не удалось запустить аудио.');
      }); },
      pause: () => audio.pause(),
      seekTo: (milliseconds) => { if (Number.isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(audio.duration, milliseconds / 1000)); },
      setVolume: (nextVolume) => { audio.volume = Math.max(0, Math.min(100, nextVolume)) / 100; },
      getDuration: (callback) => callback((Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : track.durationMs / 1000) * 1000),
      getPosition: (callback) => callback(audio.currentTime * 1000),
    };

    const reportProgress = () => {
      const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : track.durationMs / 1000;
      callbacksRef.current.onProgress(audio.currentTime * 1000, duration * 1000);
    };
    const handleMetadata = () => {
      if (!active) return;
      callbacksRef.current.onControlsReady(controls);
      callbacksRef.current.onReady();
      reportProgress();
    };
    const failOrAdvance = (message: string) => {
      if (!active) return;
      if (candidateIndex + 1 < candidates.length) {
        console.warn('[ui.player] stream format failed; trying another SoundCloud stream', { trackId: track.id, failedQuality: candidates[candidateIndex]?.quality, nextQuality: candidates[candidateIndex + 1]?.quality, message });
        startCandidate(candidateIndex + 1);
        return;
      }
      callbacksRef.current.onPlaybackStateChange(false);
      callbacksRef.current.onError(message);
    };
    const handleError = () => {
      if (!active || candidateIndex < 0) return;
      const code = audio.error?.code;
      const detail = code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
        ? 'Формат потока не поддерживается этим плеером.'
        : 'SoundCloud не смог загрузить аудиопоток этого трека.';
      failOrAdvance(detail);
    };
    const handlePlay = () => callbacksRef.current.onPlaybackStateChange(true);
    const handlePause = () => callbacksRef.current.onPlaybackStateChange(false);
    const handleEnded = () => callbacksRef.current.onEnded();

    function startCandidate(nextIndex: number) {
      if (!active || nextIndex < 0 || nextIndex >= candidates.length) return;
      candidateIndex = nextIndex;
      recoveredMediaError = false;
      hls?.destroy();
      hls = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      const candidate = candidates[candidateIndex];

      if (candidate.hls && Hls.isSupported()) {
        const instance = new Hls({ enableWorker: true });
        hls = instance;
        instance.on(Hls.Events.MEDIA_ATTACHED, () => instance.loadSource(candidate.url));
        instance.on(Hls.Events.MANIFEST_PARSED, () => {
          if (!active || hls !== instance) return;
          callbacksRef.current.onControlsReady(controls);
          callbacksRef.current.onReady();
          if (shouldPlayRef.current) void audio.play().catch((error: unknown) => {
            failOrAdvance(error instanceof Error ? error.message : 'Не удалось запустить аудио.');
          });
        });
        instance.on(Hls.Events.ERROR, (_event, data) => {
          if (!active || hls !== instance || !data.fatal) return;
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recoveredMediaError) {
            recoveredMediaError = true;
            instance.recoverMediaError();
            return;
          }
          failOrAdvance(`Не удалось загрузить поток SoundCloud (${data.details}).`);
        });
        instance.attachMedia(audio);
      } else if (candidate.hls && audio.canPlayType('application/vnd.apple.mpegurl')) {
        audio.src = candidate.url;
        audio.load();
      } else if (!candidate.hls) {
        audio.src = candidate.url;
        audio.load();
      } else {
        failOrAdvance('Браузер не поддерживает HLS-поток этого трека.');
      }
    }

    if (!track.urn) {
      callbacksRef.current.onError('У этого трека нет SoundCloud URN для прямого потока.');
      return () => { active = false; };
    }

    audio.addEventListener('loadedmetadata', handleMetadata);
    audio.addEventListener('durationchange', reportProgress);
    audio.addEventListener('timeupdate', reportProgress);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    void appGateway.trackStream(track.urn).then((stream) => {
      if (!active) return;
      candidates = [{ url: stream.url, preview: stream.preview, hls: stream.hls, quality: stream.quality }, ...(stream.alternatives ?? [])];
      startCandidate(0);
    }).catch((error: unknown) => {
      if (!active) return;
      callbacksRef.current.onPlaybackStateChange(false);
      callbacksRef.current.onError(error instanceof Error ? error.message : 'Не удалось получить аудиопоток SoundCloud.');
    });

    return () => {
      active = false;
      audio.pause();
      audio.removeEventListener('loadedmetadata', handleMetadata);
      audio.removeEventListener('durationchange', reportProgress);
      audio.removeEventListener('timeupdate', reportProgress);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
      hls?.destroy();
      audio.removeAttribute('src');
      audio.load();
    };
  }, [track.id, track.urn, track.durationMs]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = Math.max(0, Math.min(100, volume)) / 100;
  }, [volume]);

  return <audio ref={audioRef} className="direct-stream-engine" preload="metadata" aria-hidden="true" />;
}
