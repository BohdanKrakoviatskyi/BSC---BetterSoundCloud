import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Button, type Vars } from '../components/ui';
import {
  soundCloudAuthLogin,
  soundCloudAuthLogout,
  soundCloudAuthRefresh,
  soundCloudAuthStatus,
  soundCloudSetClientId,
  ytMusicAuthSave,
  ytMusicAuthLogout,
  ytMusicAuthStatus,
  type SoundCloudAuthStatus,
  type YtMusicAuthStatus,
} from '../lib/providers-api';
import {
  clearSoundCloudLibrary,
  clearYtMusicLibrary,
  library,
  loadSoundCloudLibrary,
  loadYtMusicLibrary,
} from '../state/library';

type ProviderId = 'soundcloud' | 'ytmusic';
type Connection = { connected: boolean; account?: string };
type ProviderConfig = {
  id: ProviderId;
  name: string;
  description: string;
  note: string;
};
type YtMusicCapturePayload = { headers?: Record<string, string> };

const PROVIDERS: ProviderConfig[] = [
  {
    id: 'soundcloud',
    name: 'SoundCloud',
    description: 'Sign in to SoundCloud in a dedicated browser window.',
    note: 'Press Login with SoundCloud. Resonance captures the client ID and session token from SoundCloud API requests, validates the token, and stores the session in the local app data directory.',
  },
  {
    id: 'ytmusic',
    name: 'YouTube Music',
    description: 'Sign in to YouTube Music in a dedicated browser window.',
    note: 'Resonance opens YouTube Music, waits for the signed-in account request, and reads the session cookie from the embedded window. Your library is read-only, and every track plays through the existing yt-dlp stream path.',
  },
];

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'The provider request failed. Check the settings and try again.';
}

async function fetchConnection(id: ProviderId): Promise<Connection> {
  if (id === 'soundcloud') {
    const result: SoundCloudAuthStatus = await soundCloudAuthStatus();
    return { connected: result.authorized, account: result.profile?.fullName || result.profile?.username };
  }

  const result: YtMusicAuthStatus = await ytMusicAuthStatus();
  return { connected: result.authorized, account: result.profile?.name || result.profile?.handle };
}

function ProviderCard({ provider, index }: { provider: ProviderConfig; index: number }) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const loginCleanup = useRef<(() => void) | undefined>(undefined);

  useEffect(() => () => loginCleanup.current?.(), []);

  const loadStatus = async () => {
    try {
      setConnection(await fetchConnection(provider.id));
    } catch (requestError) {
      setConnection({ connected: false });
      setError(errorMessage(requestError));
    }
  };

  useEffect(() => {
    void loadStatus();
    // This card is scoped to one provider for its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider.id]);

  const run = async (action: () => Promise<void>, success: string) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      await loadStatus();
      setMessage(success);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  };

  const login = () => run(async () => {
    if (!token.trim()) throw new Error('Enter a SoundCloud access token.');
    await soundCloudAuthLogin(token.trim());
    await loadSoundCloudLibrary(true);
    setToken('');
  }, 'SoundCloud connected.');

  const soundCloudBrowserLogin = async () => {
    setBusy(true);
    setError('');
    setMessage('Finish signing in in the SoundCloud window…');
    let settled = false;
    let timer = 0;
    let unlistenCaptured: (() => void) | undefined;
    let unlistenCancelled: (() => void) | undefined;
    const cleanup = () => {
      window.clearTimeout(timer);
      unlistenCaptured?.();
      unlistenCancelled?.();
      loginCleanup.current = undefined;
    };
    const finish = async (payload?: { clientId: string; token: string }) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        if (!payload) throw new Error('SoundCloud sign-in was cancelled or timed out.');
        try {
          await soundCloudSetClientId(payload.clientId);
        } catch (requestError) {
          throw new Error(`Could not save the SoundCloud client ID: ${errorMessage(requestError)}`);
        }
        try {
          await soundCloudAuthLogin(payload.token);
        } catch (requestError) {
          throw new Error(`SoundCloud rejected the captured session: ${errorMessage(requestError)}`);
        }
        await loadSoundCloudLibrary(true);
        await loadStatus();
        setMessage('SoundCloud connected.');
        setToken('');
      } catch (requestError) {
        setError(errorMessage(requestError));
        setMessage('');
      } finally {
        setBusy(false);
      }
    };
    try {
      unlistenCaptured = await listen<{ clientId: string; token: string }>('soundcloud-auth-captured', ({ payload }) => void finish(payload));
      unlistenCancelled = await listen('soundcloud-login-cancelled', () => void finish());
      loginCleanup.current = () => { settled = true; cleanup(); };
      timer = window.setTimeout(() => void finish(), 5 * 60 * 1000);
      await invoke('start_soundcloud_login');
    } catch (requestError) {
      if (!settled) {
        settled = true;
        cleanup();
        setError(errorMessage(requestError));
        setMessage('');
        setBusy(false);
      }
    }
  };

  const ytMusicBrowserLogin = async () => {
    setBusy(true);
    setError('');
    setMessage('Finish signing in to YouTube Music in the opened window…');
    let settled = false;
    let timer = 0;
    let unlistenCaptured: (() => void) | undefined;
    let unlistenCancelled: (() => void) | undefined;
    const cleanup = () => {
      window.clearTimeout(timer);
      unlistenCaptured?.();
      unlistenCancelled?.();
      loginCleanup.current = undefined;
    };
    const finish = async (payload?: YtMusicCapturePayload) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        if (!payload?.headers) throw new Error('YouTube Music sign-in was cancelled or timed out.');
        try {
          await ytMusicAuthSave(payload.headers);
        } catch (requestError) {
          throw new Error(`YouTube Music rejected the captured session: ${errorMessage(requestError)}`);
        }
        await loadYtMusicLibrary(true);
        await loadStatus();
        const libraryError = library.get().ytmusicLibraryError;
        if (libraryError) throw new Error(libraryError);
        setMessage('YouTube Music connected.');
      } catch (requestError) {
        setError(errorMessage(requestError));
        setMessage('');
      } finally {
        setBusy(false);
      }
    };
    try {
      unlistenCaptured = await listen<YtMusicCapturePayload>('ytmusic-auth-captured', ({ payload }) => void finish(payload));
      unlistenCancelled = await listen('ytmusic-login-cancelled', () => void finish());
      loginCleanup.current = () => { settled = true; cleanup(); };
      timer = window.setTimeout(() => void finish(), 5 * 60 * 1000);
      await invoke('start_ytmusic_login');
    } catch (requestError) {
      if (!settled) {
        settled = true;
        cleanup();
        setError(errorMessage(requestError));
        setMessage('');
        setBusy(false);
      }
    }
  };

  const refresh = () => run(async () => {
    if (provider.id === 'soundcloud') {
      await soundCloudAuthRefresh();
      await loadSoundCloudLibrary(true);
      return;
    }
    await loadYtMusicLibrary(true);
    const libraryError = library.get().ytmusicLibraryError;
    if (libraryError) throw new Error(libraryError);
  }, provider.id === 'soundcloud' ? 'Connection refreshed.' : 'YouTube Music library refreshed.');

  const disconnect = () => run(async () => {
    if (provider.id === 'soundcloud') {
      await soundCloudAuthLogout();
      clearSoundCloudLibrary();
      return;
    }
    await ytMusicAuthLogout();
    clearYtMusicLibrary();
  }, 'Provider disconnected.');

  const connected = Boolean(connection?.connected);

  return (
    <section className="card anim-in min-w-0" style={{ '--i': index } as Vars} aria-labelledby={`${provider.id}-title`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`${provider.id}-title`} className="headline text-xl">{provider.name}</h2>
          <p className="mt-1 text-sm text-on-surface-variant">{provider.description}</p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-2 rounded-full bg-surface-container-high px-3 py-1.5 text-sm font-semibold" aria-label={`Connection status: ${connected ? 'Connected' : connection ? 'Not connected' : 'Loading status'}`}>
          <span className={`h-2 w-2 rounded-full ${connected ? 'bg-primary' : 'bg-on-surface-variant'}`} aria-hidden="true" />
          {connected ? 'Connected' : connection ? 'Not connected' : 'Checking…'}
        </span>
      </div>

      {connection?.account && <p className="mt-3 text-sm">Account: <span className="font-semibold">{connection.account}</span></p>}
      <p className="mt-4 rounded-2xl bg-surface-container-low p-3 text-sm text-on-surface-variant">{provider.note}</p>



      <div className="mt-4 flex flex-wrap gap-2">
        {provider.id === 'soundcloud' ? (
          <>
            <Button variant="filled" disabled={busy} onClick={() => void soundCloudBrowserLogin()}>{busy ? 'Waiting for SoundCloud…' : 'Login with SoundCloud'}</Button>
            {token && <Button variant="outlined" disabled={busy} onClick={() => void login()}>Use existing access token</Button>}
          </>
        ) : (
          <Button variant="filled" disabled={busy} onClick={() => void ytMusicBrowserLogin()}>{busy ? 'Waiting for YouTube Music…' : 'Connect YouTube Music'}</Button>
        )}
        <Button variant="tonal" disabled={busy || !connected} onClick={() => void refresh()}>{provider.id === 'soundcloud' ? 'Refresh' : 'Refresh library'}</Button>
        <Button variant="outlined" disabled={busy || !connected} onClick={() => void disconnect()}>Disconnect</Button>
      </div>
      {message && <p className="mt-3 text-sm text-primary" role="status">{message}</p>}
      {error && <p className="mt-3 text-sm text-error" role="alert">{error}</p>}
    </section>
  );
}

export default function Providers() {
  return (
    <div className="page max-w-[980px]">
      <header className="anim-in mb-6 mt-2">
        <h1 className="display text-[clamp(32px,5.5cqw,54px)]">Providers</h1>
        <p className="mt-2 max-w-2xl text-lg text-on-surface-variant">Connect music services in a dedicated sign-in window. Resonance keeps each provider session in the local app data directory and never stores credentials in the page or in source control.</p>
      </header>
      <div className="grid gap-4">
        {PROVIDERS.map((provider, index) => <ProviderCard key={provider.id} provider={provider} index={index + 1} />)}
      </div>

    </div>
  );
}
