import { useEffect, useRef } from 'react';
import type { SoundCloudTrack } from '../../lib/desktop';

type Widget = {
  bind: (event: string, callback: (data?: unknown) => void) => void;
  unbind: (event: string) => void;
  play: () => void;
  pause: () => void;
  seekTo: (milliseconds: number) => void;
  setVolume: (volume: number) => void;
  getDuration: (callback: (duration: number) => void) => void;
  getPosition: (callback: (position: number) => void) => void;
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
  track: SoundCloudTrack;
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
  const callbacksRef = useRef({ onControlsReady, onReady, onPlaybackStateChange, onProgress, onEnded, onError });
  callbacksRef.current = { onControlsReady, onReady, onPlaybackStateChange, onProgress, onEnded, onError };

  const trackUrl = track.permalinkUrl || `https://api.soundcloud.com/tracks/${track.id}`;
  const iframeUrl = new URL('https://w.soundcloud.com/player/');
  iframeUrl.searchParams.set('url', trackUrl);
  iframeUrl.searchParams.set('auto_play', 'false');
  iframeUrl.searchParams.set('hide_related', 'true');
  iframeUrl.searchParams.set('show_comments', 'false');
  iframeUrl.searchParams.set('show_reposts', 'false');
  iframeUrl.searchParams.set('show_teaser', 'false');
  iframeUrl.searchParams.set('visual', 'false');
  iframeUrl.searchParams.set('color', '#f0c75e');

  useEffect(() => {
    let disposed = false;
    let widget: Widget | null = null;

    void loadWidgetApi().then((api) => {
      const iframe = iframeRef.current;
      if (disposed || !iframe) return;
      widget = api.Widget(iframe);
      widget.bind(api.Widget.Events.READY, () => {
        if (!widget) return;
        widget.setVolume(volume);
        callbacksRef.current.onControlsReady(widget);
        callbacksRef.current.onReady();
        widget.getDuration((duration) => callbacksRef.current.onProgress(0, duration));
      });
      widget.bind(api.Widget.Events.PLAY, () => callbacksRef.current.onPlaybackStateChange(true));
      widget.bind(api.Widget.Events.PAUSE, () => callbacksRef.current.onPlaybackStateChange(false));
      widget.bind(api.Widget.Events.PLAY_PROGRESS, (data) => {
        const progress = data as { currentPosition?: number } | undefined;
        if (typeof progress?.currentPosition === 'number') callbacksRef.current.onProgress(progress.currentPosition);
      });
      widget.bind(api.Widget.Events.SEEK, () => {
        widget?.getPosition((position) => {
          widget?.getDuration((duration) => callbacksRef.current.onProgress(position, duration));
        });
      });
      widget.bind(api.Widget.Events.FINISH, () => {
        callbacksRef.current.onPlaybackStateChange(false);
        callbacksRef.current.onEnded();
      });
      widget.bind(api.Widget.Events.ERROR, () => {
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
      if (widget) {
        for (const event of Object.values(window.SC?.Widget.Events ?? {})) widget.unbind(event);
      }
    };
  }, [track.id]);

  return (
    <div className="soundcloud-widget-engine" aria-hidden="true">
      <iframe
        ref={iframeRef}
        title={`SoundCloud audio engine: ${track.title}`}
        src={iframeUrl.toString()}
        width="1"
        height="1"
        allow="autoplay"
        scrolling="no"
      />
    </div>
  );
}
