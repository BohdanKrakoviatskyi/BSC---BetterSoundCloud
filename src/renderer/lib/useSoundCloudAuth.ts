import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Credentials captured by the background SoundCloud webview. */
export type SoundCloudCredentials = {
  token: string;
  clientId: string;
};

/** Must match `CREDENTIALS_EVENT` in `src-tauri/src/main.rs`. */
export const SOUNDCLOUD_CREDENTIALS_EVENT = 'soundcloud:credentials';

type UseSoundCloudAuthOptions = {
  /** Called every time valid credentials arrive from the Rust side. */
  onCredentials?: (credentials: SoundCloudCredentials) => void | Promise<void>;
};

type UseSoundCloudAuthResult = {
  credentials: SoundCloudCredentials | null;
  starting: boolean;
  error: string;
  startAuthFlow: () => Promise<void>;
  showAuthWindow: () => Promise<void>;
};

function describeError(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function isCredentials(payload: unknown): payload is SoundCloudCredentials {
  if (typeof payload !== 'object' || payload === null) return false;
  const candidate = payload as Partial<SoundCloudCredentials>;
  return (
    typeof candidate.token === 'string' &&
    candidate.token.length > 0 &&
    typeof candidate.clientId === 'string' &&
    candidate.clientId.length > 0
  );
}

/**
 * Subscribes to `soundcloud:credentials` emitted by the Rust `save_credentials`
 * command and exposes helpers to drive the silent auth webview.
 */
export function useSoundCloudAuth({ onCredentials }: UseSoundCloudAuthOptions = {}): UseSoundCloudAuthResult {
  const [credentials, setCredentials] = useState<SoundCloudCredentials | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const onCredentialsRef = useRef(onCredentials);
  const listenerReadyRef = useRef<Promise<void> | null>(null);
  const listenerErrorRef = useRef<string | null>(null);

  useEffect(() => {
    onCredentialsRef.current = onCredentials;
  }, [onCredentials]);

  useLayoutEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | null = null;

    listenerReadyRef.current = listen<SoundCloudCredentials>(SOUNDCLOUD_CREDENTIALS_EVENT, (event) => {
      if (!isCredentials(event.payload)) {
        console.warn('[soundcloud-auth] ignored malformed credentials event');
        return;
      }
      setCredentials(event.payload);
      setError('');
      Promise.resolve(onCredentialsRef.current?.(event.payload)).catch((reason: unknown) => {
        console.error('[soundcloud-auth] onCredentials handler failed', { error: describeError(reason) });
      });
    })
      .then((stopListening) => {
        if (disposed) {
          stopListening();
          return;
        }
        unlisten = stopListening;
        listenerErrorRef.current = null;
      })
      .catch((reason: unknown) => {
        if (disposed) return;
        const message = describeError(reason);
        listenerErrorRef.current = message;
        console.error('[soundcloud-auth] listen failed', { error: message });
        setError(message);
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const startAuthFlow = useCallback(async () => {
    setStarting(true);
    setError('');
    try {
      await listenerReadyRef.current;
      if (listenerErrorRef.current) throw new Error(listenerErrorRef.current);
      await invoke('start_auth_flow');
    } catch (reason) {
      const message = describeError(reason);
      console.error('[soundcloud-auth] start_auth_flow failed', { error: message });
      setError(message);
    } finally {
      setStarting(false);
    }
  }, []);

  const showAuthWindow = useCallback(async () => {
    try {
      await invoke('show_auth_window');
    } catch (reason) {
      const message = describeError(reason);
      console.error('[soundcloud-auth] show_auth_window failed', { error: message });
      setError(message);
    }
  }, []);

  return { credentials, starting, error, startAuthFlow, showAuthWindow };
}
