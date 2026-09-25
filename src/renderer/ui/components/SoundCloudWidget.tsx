import { useEffect, useRef } from 'react';
import type { Track } from '../../domain/models';

type Widget = {
  bind: (event: string, callback: (data?: unknown) => void) => void;
  unbind: (event: string) => void;
  play: () => void;
  pause: () => void;
  seekTo: (milliseconds: number) => void;
  setVolume: (volume: number) => void;
  getDuration: (callback: (duration: number) => void) => void;
  getPosition: (callback: (position: number) => void) => void;
  load: (url: string, options?: Record<string, unknown>) => void;
};

export type SoundCloudWidgetControls = Pick<Widget, 'play' | 'pause' | 'seekTo' | 'setVolume' | 'getDuration' | 'getPosition'>;

type WidgetApi = {
  Widget: {
    (iframe: HTMLIFrameElement): Widget;
    Events: {
      READY: string;
      PLAY: string;
      PAUSE: string;
      FINISH: string;
      ERROR: string;
      PLAY_PROGRESS: string;
      SEEK: string;
    };
  };
};

declare global {
  interface Window {
    SC?: WidgetApi;
  }
}

let widgetApiPromise: Promise<WidgetApi> | null = null;

function loadWidgetApi(): Promise<WidgetApi> {
  if (window.SC) return Promise.resolve(window.SC);
  if (widgetApiPromise) return widgetApiPromise;

  widgetApiPromise = new Promise<WidgetApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-soundcloud-widget-api]');
    const script = existing ?? document.createElement('script');
    const onLoad = () => window.SC ? resolve(window.SC) : reject(new Error('SoundCloud Widget API не загрузился'));
    const onError = () => reject(new Error('Не удалось загрузить SoundCloud Widget API'));
    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });
    if (!existing) {
      script.src = 'https://w.soundcloud.com/player/api.js';
      script.async = true;
      script.dataset.soundcloudWidgetApi = 'true';
      document.head.appendChild(script);
    }
  }).catch((reason: unknown) => {
    widgetApiPromise = null;
    throw reason;
  });
  return widgetApiPromise;
}

type Props = {
  track: Track;
  volume: number;
  onControlsReady: (controls: SoundCloudWidgetControls) => void;
  onReady: () => void;
  onPlaybackStateChange: (playing: boolean) => void;
  onProgress: (position: number, duration?: number) => void;
  onEnded: () => void;
  onError: (message: string) => void;
};

export function SoundCloudWidget({ track, volume, onControlsReady, onReady, onPlaybackStateChange, onProgress, onEnded, onError }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const widgetRef = useRef<Widget | null>(null);
  const widgetReadyRef = useRef(false);
  const awaitingPlaybackRef = useRef(true);
  const loadedTrackIdRef = useRef(track.id);
  const currentTrackIdRef = useRef(track.id);
  const currentTrackUrlRef = useRef(track.permalink || `https://api.soundcloud.com/tracks/${track.id}`);
  const currentVolumeRef = useRef(volume);
  const readyHandlerRef = useRef<(() => void) | null>(null);
  const callbacksRef = useRef({ onControlsReady, onReady, onPlaybackStateChange, onProgress, onEnded, onError });
  callbacksRef.current = { onControlsReady, onReady, onPlaybackStateChange, onProgress, onEnded, onError };
  currentTrackIdRef.current = track.id;
  currentTrackUrlRef.current = track.permalink || `https://api.soundcloud.com/tracks/${track.id}`;
  currentVolumeRef.current = volume;

  const initialUrlRef = useRef<string | null>(null);
  if (!initialUrlRef.current) {
    const initialUrl = new URL('https://w.soundcloud.com/player/');
    initialUrl.searchParams.set('url', currentTrackUrlRef.current);
    initialUrl.searchParams.set('auto_play', 'false');
    initialUrl.searchParams.set('hide_related', 'true');
    initialUrl.searchParams.set('show_comments', 'false');
    initialUrl.searchParams.set('show_reposts', 'false');
    initialUrl.searchParams.set('show_teaser', 'false');
    initialUrl.searchParams.set('visual', 'false');
    initialUrl.searchParams.set('color', '#ff765d');
    initialUrlRef.current = initialUrl.toString();
  }

  function loadTrack(widget: Widget, url: string, onReady: () => void) {
    widgetReadyRef.current = false;
    awaitingPlaybackRef.current = true;
    widget.load(url, {
      auto_play: false,
      hide_related: true,
      show_comments: false,
      show_reposts: false,
      show_teaser: false,
      visual: false,
      color: '#ff765d',
      callback: onReady,
    });
  }

  function createSafeControls(widget: Widget): SoundCloudWidgetControls {
    const invoke = (operation: string, command: () => void) => {
      if (!widgetReadyRef.current) return;
      try { command(); } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason);
        console.warn('[ui.player.widget] command failed', { operation, error: message });
        callbacksRef.current.onError('Плеер SoundCloud перезапускается. Попробуйте ещё раз через секунду.');
      }
    };
    return {
      play: () => invoke('play', () => widget.play()),
      pause: () => invoke('pause', () => widget.pause()),
      seekTo: (milliseconds) => invoke('seekTo', () => widget.seekTo(milliseconds)),
      setVolume: (nextVolume) => invoke('setVolume', () => widget.setVolume(nextVolume)),
      getDuration: (callback) => invoke('getDuration', () => widget.getDuration(callback)),
      getPosition: (callback) => invoke('getPosition', () => widget.getPosition(callback)),
    };
  }

  useEffect(() => {
    let disposed = false;
    let widget: Widget | null = null;

    void loadWidgetApi().then((api) => {
      const iframe = iframeRef.current;
      if (disposed || !iframe) return;
      widget = api.Widget(iframe);
      widgetRef.current = widget;
      const handleReady = () => {
        if (disposed || !widget || widgetReadyRef.current) return;
        if (loadedTrackIdRef.current !== currentTrackIdRef.current) {
          loadedTrackIdRef.current = currentTrackIdRef.current;
          try {
            loadTrack(widget, currentTrackUrlRef.current, handleReady);
          } catch (reason) {
            const message = reason instanceof Error ? reason.message : 'Не удалось переключить трек в SoundCloud';
            callbacksRef.current.onError(message);
          }
          return;
        }
        widgetReadyRef.current = true;
        try {
          widget.setVolume(currentVolumeRef.current);
          callbacksRef.current.onControlsReady(createSafeControls(widget));
          callbacksRef.current.onReady();
          widget.getDuration((duration) => { if (!disposed) callbacksRef.current.onProgress(0, duration); });
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : String(reason);
          console.warn('[ui.player.widget] ready handler failed', { error: message });
          callbacksRef.current.onError('Не удалось связаться с плеером SoundCloud. Попробуйте переключить трек.');
        }
      };
      readyHandlerRef.current = handleReady;
      widget.bind(api.Widget.Events.READY, handleReady);
      widget.bind(api.Widget.Events.PLAY, () => {
        awaitingPlaybackRef.current = false;
        callbacksRef.current.onPlaybackStateChange(true);
      });
      widget.bind(api.Widget.Events.PAUSE, () => {
        if (awaitingPlaybackRef.current) {
          console.debug('[ui.player.widget] ignored pause while loading track', { trackId: currentTrackIdRef.current });
          return;
        }
        callbacksRef.current.onPlaybackStateChange(false);
      });
      widget.bind(api.Widget.Events.PLAY_PROGRESS, (data) => {
        if (awaitingPlaybackRef.current) return;
        const progress = data as { currentPosition?: number } | undefined;
        if (typeof progress?.currentPosition === 'number') callbacksRef.current.onProgress(progress.currentPosition);
      });
      widget.bind(api.Widget.Events.SEEK, () => {
        if (disposed) return;
        widget?.getPosition((position) => {
          if (disposed) return;
          widget?.getDuration((duration) => { if (!disposed) callbacksRef.current.onProgress(position, duration); });
        });
      });
      widget.bind(api.Widget.Events.FINISH, () => {
        awaitingPlaybackRef.current = false;
        callbacksRef.current.onEnded();
      });
      widget.bind(api.Widget.Events.ERROR, () => {
        awaitingPlaybackRef.current = false;
        callbacksRef.current.onPlaybackStateChange(false);
        callbacksRef.current.onError('SoundCloud не смог загрузить этот трек в виджете. Проверьте, разрешено ли встраивание.');
      });
    }).catch((reason: unknown) => {
      if (disposed) return;
      const message = reason instanceof Error ? reason.message : 'Не удалось загрузить официальный плеер SoundCloud';
      callbacksRef.current.onError(message);
    });

    return () => {
      disposed = true;
      widgetReadyRef.current = false;
      if (widgetRef.current === widget) widgetRef.current = null;
      if (widget) {
        for (const event of Object.values(window.SC?.Widget.Events ?? {})) {
          try { widget.unbind(event); } catch (reason) {
            console.debug('[ui.player.widget] listener cleanup skipped', { event, error: reason instanceof Error ? reason.message : String(reason) });
          }
        }
      }
    };
  }, []);

  useEffect(() => {
    const widget = widgetRef.current;
    if (!widget || !widgetReadyRef.current || loadedTrackIdRef.current === track.id) return;
    loadedTrackIdRef.current = track.id;
    try {
      const onReady = readyHandlerRef.current;
      if (!onReady) return;
      loadTrack(widget, currentTrackUrlRef.current, onReady);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Не удалось переключить трек в SoundCloud';
      callbacksRef.current.onError(message);
    }
  }, [track.id]);

  return (
    <div className="soundcloud-widget-engine" aria-hidden="true" style={{ position: 'fixed', left: -10_000, top: 0, width: 400, height: 166, opacity: 0 }}>
      <iframe
        ref={iframeRef}
        title={`SoundCloud audio engine: ${track.title}`}
        src={initialUrlRef.current}
        width="400"
        height="166"
        style={{ display: 'block', width: 400, height: 166, border: 0 }}
        allow="autoplay"
        scrolling="no"
      />
    </div>
  );
}
