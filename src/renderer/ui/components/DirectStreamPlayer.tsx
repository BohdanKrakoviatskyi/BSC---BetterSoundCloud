import { useEffect, useRef } from 'react';
import Hls from 'hls.js';
import type { Track } from '../../domain/models';
import { serviceManager } from '../../lib/serviceManager';
import type { TrackStreamOption } from '../../lib/desktop';
import type { SoundCloudWidgetControls } from './SoundCloudWidget';

type Props = {
  track: Track;
  volume: number;
  shouldPlay: boolean;
  /**
   * Duration to report instead of the audio element's own.
   *
   * YouTube serves DASH containers whose moov arrives late or not at all on a stalled connection,
   * and until then the element guesses — wildly (double the real length seen in the wild). The
   * Data API duration is verified against the actual bytes, so for YouTube it is the source of
   * truth. Position, seeking and end-of-track still come from the element.
   */
  exactDurationMs?: number;
  onControlsReady: (controls: SoundCloudWidgetControls) => void;
  onReady: () => void;
  onPlaybackStateChange: (playing: boolean) => void;
  onProgress: (position: number, duration?: number) => void;
  onEnded: () => void;
  onError: (message: string) => void;
};

// Human name for error messages. The player serves every non-widget service now, so the
// strings cannot all say SoundCloud.
function serviceLabel(source?: string): string {
  if (source === 'spotify') return 'Spotify';
  if (source === 'youtube-music') return 'YouTube';
  return 'SoundCloud';
}

export function DirectStreamPlayer({ track, volume, shouldPlay, exactDurationMs, onControlsReady, onReady, onPlaybackStateChange, onProgress, onEnded, onError }: Props) {
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

    // YouTube's DASH containers can declare a bogus timeline (double the real one seen in the
    // wild: the OS Now Playing widget counts down from it while the samples end halfway). The
    // element's own 'ended' then fires late or never, so the queue only advances on the API
    // duration — but only when the element disagrees with it. Honest files keep native behaviour.
    const exactSec = Number.isFinite(exactDurationMs) && (exactDurationMs as number) > 0
      ? (exactDurationMs as number) / 1000
      : null;
    let virtualEndedFired = false;
    let lastAdvanceAt = 0;
    let lastTime = -1;
    const fireVirtualEnded = () => {
      if (!active || virtualEndedFired || candidateIndex < 0) return;
      virtualEndedFired = true;
      disarmResume();
      audio.pause();
      callbacksRef.current.onEnded();
    };
    const moovLies = () => {
      if (exactSec === null) return false;
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) return true;
      return Math.abs(audio.duration - exactSec) > 2;
    };

    // Resolving a stream (yt-dlp spawn, sidecar round-trip) takes seconds, and by then the
    // click's user gesture has expired: the browser rejects programmatic play() with
    // NotAllowedError. That is not a broken track, so instead of erroring out, resume on the next
    // user gesture — the very next click or keypress starts the sound.
    let resumeArmed = false;
    const disarmResume = () => {
      if (!resumeArmed) return;
      resumeArmed = false;
      window.removeEventListener('pointerdown', resumeOnGesture);
      window.removeEventListener('keydown', resumeOnGesture);
    };
    function resumeOnGesture() {
      if (!active || !resumeArmed) return;
      disarmResume();
      void audio.play().catch((error: unknown) => {
        if (active) callbacksRef.current.onError(error instanceof Error ? error.message : 'Не удалось запустить аудио.');
      });
    }
    const armResume = () => {
      if (resumeArmed || !active) return;
      resumeArmed = true;
      window.addEventListener('pointerdown', resumeOnGesture);
      window.addEventListener('keydown', resumeOnGesture);
    };
    const isAutoplayBlocked = (error: unknown) => error instanceof DOMException && error.name === 'NotAllowedError';
    const tryPlay = () => {
      void audio.play().catch((error: unknown) => {
        if (!active) return;
        if (isAutoplayBlocked(error)) {
          console.info('[ui.player] play blocked until next user gesture', { trackId: track.id });
          armResume();
          return;
        }
        callbacksRef.current.onError(error instanceof Error ? error.message : 'Не удалось запустить аудио.');
      });
    };

    const resolveDurationMs = () => {
      if (Number.isFinite(exactDurationMs) && (exactDurationMs as number) > 0) return exactDurationMs as number;
      return (Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : track.durationMs / 1000) * 1000;
    };

    const controls: SoundCloudWidgetControls = {
      play: () => { tryPlay(); },
      pause: () => audio.pause(),
      seekTo: (milliseconds) => {
        // Clamp to the true end when the container overstates it: seeking past the last sample
        // stalls the element instead of finishing the track.
        const ceiling = exactSec !== null && moovLies() ? exactSec : (Number.isFinite(audio.duration) ? audio.duration : Number.POSITIVE_INFINITY);
        if (Number.isFinite(audio.duration) || exactSec !== null) {
          audio.currentTime = Math.max(0, Math.min(ceiling, milliseconds / 1000));
        }
      },
      setVolume: (nextVolume) => { audio.volume = Math.max(0, Math.min(100, nextVolume)) / 100; },
      getDuration: (callback) => callback(resolveDurationMs()),
      getPosition: (callback) => callback(audio.currentTime * 1000),
    };

    const reportProgress = () => {
      const positionSec = audio.currentTime;
      // Re-arm after a rewind (repeat-one, replay): the fired flag belongs to the finished pass,
      // not to the track.
      if (virtualEndedFired && exactSec !== null && positionSec < exactSec - 5) {
        virtualEndedFired = false;
      }
      if (positionSec !== lastTime) {
        lastTime = positionSec;
        lastAdvanceAt = Date.now();
      } else if (
        exactSec !== null && moovLies() && !audio.paused && !virtualEndedFired &&
        exactSec - positionSec < 2 && Date.now() - lastAdvanceAt > 2000
      ) {
        // Samples ran out but the bogus timeline never ends: stalled at the true end.
        console.info('[ui.player] virtual track end (stalled)', { trackId: track.id, positionSec, elementDuration: audio.duration, exactSec });
        fireVirtualEnded();
        return;
      }
      // True end reached on a lying timeline: finish on the API duration, not the container's.
      if (
        exactSec !== null && moovLies() && !virtualEndedFired &&
        positionSec >= exactSec - 1
      ) {
        console.info('[ui.player] virtual track end', { trackId: track.id, positionSec, elementDuration: audio.duration, exactSec });
        fireVirtualEnded();
        return;
      }
      // The OS Now Playing widget (Touch Bar, Control Center) reads the element's own timeline,
      // which is the lying one here — hand it the true numbers instead.
      updateMediaSession(positionSec);
      callbacksRef.current.onProgress(audio.currentTime * 1000, resolveDurationMs());
    };
    let lastMediaSecond = -1;
    const updateMediaSession = (positionSec: number) => {
      if (exactSec === null) return;
      const mediaSession = navigator.mediaSession;
      if (!mediaSession || typeof mediaSession.setPositionState !== 'function') return;
      const wholeSecond = Math.floor(positionSec);
      if (wholeSecond === lastMediaSecond) return;
      lastMediaSecond = wholeSecond;
      try {
        mediaSession.setPositionState({ duration: exactSec, playbackRate: audio.playbackRate || 1, position: Math.min(positionSec, exactSec) });
      } catch {
        // Position state is a hint, not a contract: a rejection must not disturb playback.
      }
    };
    const handleMetadata = () => {
      if (!active) return;
      console.info('[ui.player] engine duration check', { trackId: track.id, trackDurationMs: track.durationMs, audioDurationSec: audio.duration, lockedDurationMs: resolveDurationMs() });
      callbacksRef.current.onControlsReady(controls);
      callbacksRef.current.onReady();
      reportProgress();
    };
    const failOrAdvance = (message: string) => {
      if (!active) return;
      if (candidateIndex + 1 < candidates.length) {
        console.warn('[ui.player] stream format failed; trying another stream', { trackId: track.id, failedQuality: candidates[candidateIndex]?.quality, nextQuality: candidates[candidateIndex + 1]?.quality, message });
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
        : `${serviceLabel(track.source)} не смог загрузить аудиопоток этого трека.`;
      failOrAdvance(detail);
    };
    const handlePlay = () => callbacksRef.current.onPlaybackStateChange(true);
    const handleEndedDiag = () => {
      console.info('[ui.player] audio element ended', { trackId: track.id, currentTime: audio.currentTime, elementDuration: audio.duration, lockedDurationMs: resolveDurationMs(), srcHost: (() => { try { return new URL(audio.currentSrc).host; } catch { return ''; } })() });
    };
    // Pausing means the user took over: a pending autoplay resume must not start the sound after
    // an explicit pause.
    const handlePause = () => { disarmResume(); callbacksRef.current.onPlaybackStateChange(false); };
    const handleEnded = () => callbacksRef.current.onEnded();

    function startCandidate(nextIndex: number) {
      if (!active || nextIndex < 0 || nextIndex >= candidates.length) return;
      candidateIndex = nextIndex;
      recoveredMediaError = false;
      virtualEndedFired = false;
      lastAdvanceAt = Date.now();
      lastTime = -1;
      lastMediaSecond = -1;
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
          if (shouldPlayRef.current) {
            // A play failure here tries the next candidate, like any format failure — except an
            // autoplay block, which arms the gesture resume instead of failing the track.
            void audio.play().catch((error: unknown) => {
              if (!active) return;
              if (isAutoplayBlocked(error)) {
                console.info('[ui.player] play blocked until next user gesture', { trackId: track.id });
                armResume();
                return;
              }
              failOrAdvance(error instanceof Error ? error.message : 'Не удалось запустить аудио.');
            });
          }
        });
        instance.on(Hls.Events.ERROR, (_event, data) => {
          if (!active || hls !== instance || !data.fatal) return;
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recoveredMediaError) {
            recoveredMediaError = true;
            instance.recoverMediaError();
            return;
          }
          failOrAdvance(`Не удалось загрузить поток ${serviceLabel(track.source)} (${data.details}).`);
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
      callbacksRef.current.onError(`У этого трека нет идентификатора ${serviceLabel(track.source)} для прямого потока.`);
      return () => { active = false; };
    }

    audio.addEventListener('loadedmetadata', handleMetadata);
    audio.addEventListener('durationchange', reportProgress);
    audio.addEventListener('timeupdate', reportProgress);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('ended', handleEndedDiag);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    // Through the active adapter rather than appGateway directly. The SoundCloud adapter forwards to
    // the same call with the same URN, so that path is byte-identical; Spotify's answers with its
    // thirty-second preview instead, which is the most the Web API gives without Premium.
    void serviceManager.active.trackStream(track).then((stream) => {
      if (!active) return;
      candidates = [{ url: stream.url, preview: stream.preview, hls: stream.hls, quality: stream.quality }, ...(stream.alternatives ?? [])];
      startCandidate(0);
    }).catch((error: unknown) => {
      if (!active) return;
      callbacksRef.current.onPlaybackStateChange(false);
      callbacksRef.current.onError(
        error instanceof Error ? error.message : `Не удалось получить аудиопоток ${track.source ?? 'SoundCloud'}.`,
      );
    });

    return () => {
      active = false;
      audio.pause();
      audio.removeEventListener('loadedmetadata', handleMetadata);
      audio.removeEventListener('durationchange', reportProgress);
      audio.removeEventListener('timeupdate', reportProgress);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('ended', handleEndedDiag);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
      disarmResume();
      hls?.destroy();
      audio.removeAttribute('src');
      audio.load();
    };
  }, [track.id, track.urn, track.durationMs]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = Math.max(0, Math.min(100, volume)) / 100;
  }, [volume]);

  return <audio ref={audioRef} className="direct-stream-engine" preload="auto" aria-hidden="true" />;
}
