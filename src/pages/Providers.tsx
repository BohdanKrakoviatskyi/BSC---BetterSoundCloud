import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-shell';
import { Button, type Vars } from '../components/ui';
import {
  soundCloudAuthLogin,
  soundCloudAuthLogout,
  soundCloudAuthRefresh,
  soundCloudAuthStatus,
  soundCloudSetClientId,
  youtubeAuthExchange,
  youtubeAuthLogout,
  youtubeAuthRefresh,
  youtubeAuthStatus,
  type SoundCloudAuthStatus,
  type YouTubeAuthStatus,
} from '../lib/providers-api';
import { clearSoundCloudLibrary, loadSoundCloudLibrary } from '../state/library';

type ProviderId = 'soundcloud' | 'youtube';
type Credentials = { clientId: string; clientSecret: string; redirectUri: string };
type Connection = { connected: boolean; account?: string; expiresAt?: number };
type ProviderConfig = {
  id: ProviderId;
  name: string;
  description: string;
  clientLabel?: string;
  secretLabel?: string;
  note: string;
};

const PROVIDERS: ProviderConfig[] = [
  {
    id: 'soundcloud',
    name: 'SoundCloud',
    description: 'Sign in to SoundCloud in a dedicated browser window.',
    note: 'Press Login with SoundCloud. Resonance captures the client ID and session token from SoundCloud API requests, validates the token, and stores the session in the local app data directory.'
  },
  {
    id: 'youtube',
    name: 'YouTube Music',
    description: 'Connect through Google OAuth for YouTube access.',
    clientLabel: 'Google OAuth client ID',
    secretLabel: 'Google OAuth client secret',
    note: 'Create an OAuth client in Google Cloud, register the callback URL below, configure consent, and enable YouTube Data API v3. YouTube Music has no separate public OAuth registration. Playback uses YouTube’s visible embedded player.'
  },
];

const EMPTY_CREDENTIALS: Credentials = { clientId: '', clientSecret: '', redirectUri: '' };

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

  const result: YouTubeAuthStatus = await youtubeAuthStatus();
  return { connected: result.authorized, account: result.profile?.name || result.profile?.email, expiresAt: result.expiresAt };
}

function ProviderCard({ provider, index }: { provider: ProviderConfig; index: number }) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [credentials, setCredentials] = useState<Credentials>(EMPTY_CREDENTIALS);
  const [token, setToken] = useState('');
  const [code, setCode] = useState('');
  const [oauthState, setOauthState] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const loginCleanup = useRef<(() => void) | undefined>(undefined);

  useEffect(() => () => loginCleanup.current?.(), []);

  const updateCredentials = (field: keyof Credentials, value: string) => {
    setCredentials((current) => ({ ...current, [field]: value }));
  };

  const loadStatus = async () => {
    try {
      setConnection(await fetchConnection(provider.id));
    } catch (requestError) {
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

  const authorizationUrl = () => {
    if (provider.id === 'soundcloud') throw new Error('Use the SoundCloud login window.');
    if (!credentials.clientId || !credentials.redirectUri) throw new Error('Enter the client ID and registered callback URL first.');
    const state = crypto.randomUUID();
    setOauthState(state);
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', credentials.clientId);
    url.searchParams.set('redirect_uri', credentials.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);
    url.searchParams.set('scope', 'https://www.googleapis.com/auth/youtube.readonly openid email profile');
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    return url.toString();
  };

  const startAuthorization = () => run(async () => {
    await open(authorizationUrl());
  }, 'Provider authorization opened in your browser. Paste the full callback URL below.');

  const exchange = () => run(async () => {
    if (!code.trim()) throw new Error('Paste the full callback URL returned by the provider.');
    if (!credentials.clientId || !credentials.clientSecret || !credentials.redirectUri) {
      throw new Error('Enter the client ID, client secret, and exact registered callback URL.');
    }
    let authorizationCode = code.trim();
    try {
      const callback = new URL(authorizationCode);
      if (oauthState && callback.searchParams.get('state') !== oauthState) throw new Error('OAuth state did not match. Start authorization again.');
      authorizationCode = callback.searchParams.get('code') || '';
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('OAuth state')) throw error;
    }
    if (!authorizationCode) throw new Error('The callback URL did not include an authorization code.');
    const params = { ...credentials, code: authorizationCode };
    await youtubeAuthExchange(params);
    setCode('');
  }, 'Authorization code exchanged.');

  const refresh = () => run(async () => {
    if (provider.id === 'soundcloud') {
      await soundCloudAuthRefresh();
      await loadSoundCloudLibrary(true);
    }
    else {
      if (!credentials.clientId || !credentials.clientSecret) throw new Error('Enter the client ID and client secret to refresh this connection.');
      const authCredentials = { clientId: credentials.clientId, clientSecret: credentials.clientSecret };
      await youtubeAuthRefresh(authCredentials);
    }
  }, 'Connection refreshed.');

  const disconnect = () => run(async () => {
    if (provider.id === 'soundcloud') {
      await soundCloudAuthLogout();
      clearSoundCloudLibrary();
    }
    else await youtubeAuthLogout();
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
      {connection?.expiresAt && <p className="mt-1 text-xs text-on-surface-variant">Token expires {new Date(connection.expiresAt).toLocaleString()}</p>}
      <p className="mt-4 rounded-2xl bg-surface-container-low p-3 text-sm text-on-surface-variant">{provider.note}</p>

      {provider.id === 'soundcloud' ? (
        <label className="mt-4 grid gap-1.5 text-sm font-semibold">
          Existing access token (optional fallback)
          <input className="field min-w-0 w-full" type="password" autoComplete="new-password" value={token} onChange={(event) => setToken(event.target.value)} aria-label="SoundCloud access token" />
        </label>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="grid min-w-0 gap-1.5 text-sm font-semibold">
            {provider.clientLabel}
            <input className="field min-w-0 w-full" type="text" autoComplete="off" value={credentials.clientId} onChange={(event) => updateCredentials('clientId', event.target.value)} aria-label={`${provider.name} client ID`} />
          </label>
          <label className="grid min-w-0 gap-1.5 text-sm font-semibold">
            {provider.secretLabel}
            <input className="field min-w-0 w-full" type="password" autoComplete="new-password" value={credentials.clientSecret} onChange={(event) => updateCredentials('clientSecret', event.target.value)} aria-label={`${provider.name} client secret`} />
          </label>
          <label className="grid min-w-0 gap-1.5 text-sm font-semibold sm:col-span-2">
            Registered callback / redirect URL
            <input className="field min-w-0 w-full" type="url" autoComplete="url" value={credentials.redirectUri} onChange={(event) => updateCredentials('redirectUri', event.target.value)} aria-label={`${provider.name} callback or redirect URL`} placeholder="http://127.0.0.1:43821/callback" />
          </label>
          <label className="grid min-w-0 gap-1.5 text-sm font-semibold sm:col-span-2">
            Full callback URL
            <input className="field min-w-0 w-full" type="url" autoComplete="off" value={code} onChange={(event) => setCode(event.target.value)} aria-label={`${provider.name} callback URL`} placeholder="Paste the full redirected URL" />
          </label>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {provider.id === 'soundcloud' ? (
          <>
            <Button variant="filled" disabled={busy} onClick={() => void soundCloudBrowserLogin()}>{busy ? 'Waiting for SoundCloud…' : 'Login with SoundCloud'}</Button>
            {token && <Button variant="outlined" disabled={busy} onClick={() => void login()}>Use existing access token</Button>}
          </>
        ) : (
          <>
            <Button variant="tonal" disabled={busy || !credentials.clientId || !credentials.redirectUri} onClick={() => void startAuthorization()}>{busy ? 'Working…' : 'Open provider login'}</Button>
            <Button variant="filled" disabled={busy || !credentials.clientId || !credentials.clientSecret || !credentials.redirectUri || !code.trim()} onClick={() => void exchange()}>{busy ? 'Working…' : 'Exchange code / connect'}</Button>
          </>
        )}
        <Button variant="tonal" disabled={busy || !connected || (provider.id !== 'soundcloud' && (!credentials.clientId || !credentials.clientSecret))} onClick={() => void refresh()}>Refresh</Button>
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
        <p className="mb-2 text-sm font-bold uppercase tracking-[0.14em] text-primary">Listening accounts</p>
        <h1 className="display text-[clamp(32px,5.5cqw,54px)]">Providers</h1>
        <p className="mt-2 max-w-2xl text-lg text-on-surface-variant">Connect music services using their developer credentials. Tokens, secrets, and authorization codes stay in this page’s memory and are cleared when you leave or reload it.</p>
      </header>
      <div className="grid gap-4">
        {PROVIDERS.map((provider, index) => <ProviderCard key={provider.id} provider={provider} index={index + 1} />)}
      </div>
      <p className="mt-4 text-xs text-on-surface-variant">Never expose a production client secret in a public client application. Confidential OAuth exchanges should be performed by a trusted backend; the current API accepts secrets from this UI, so use it only in an appropriate trusted environment.</p>
    </div>
  );
}
