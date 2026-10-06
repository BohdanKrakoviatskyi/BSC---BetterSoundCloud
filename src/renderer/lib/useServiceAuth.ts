import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ServiceAccount, ServiceCredentials, ServiceProvider } from '../domain/models';
import { serviceManager } from './serviceManager';
import type { AuthResult } from './serviceAdapter';
import { loadCredentials } from './credentialStore';

export type { ServiceAccount };

type UseServiceAuthResult = {
  account: ServiceAccount;
  /** True while a sign-in, refresh or sign-out is in flight. */
  busy: boolean;
  error: string;
  signIn: (credentials: ServiceCredentials) => Promise<boolean>;
  signOut: () => Promise<void>;
  refresh: () => Promise<boolean>;
  /** Re-reads the stored status without changing anything. */
  check: () => Promise<boolean>;
};

function describeError(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/**
 * Sign-in state for one service.
 *
 * The plan asks for a hook per service. There is nothing service-specific left in this logic once the
 * adapter owns the flow — the differences that used to matter are behind ServiceAdapter's one
 * `authLogin(credentials)` signature, and ServiceCredentials already carries a token for SoundCloud and
 * a client id and secret for the other two. So this is one hook parameterised by service, which means
 * the error handling and the busy flag cannot drift apart between two copies of the same code.
 *
 * What it does NOT do is drive the OAuth window. Each adapter already opens its own window, polls it and
 * exchanges the code, so this hook's job is only the part React needs: what the account looks like, what
 * is in flight, and what went wrong.
 */
export function useServiceAuth(service: ServiceProvider): UseServiceAuthResult {
  const adapter = serviceManager.getAdapter(service);

  const [profile, setProfile] = useState<ServiceAccount['profile']>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Guards against a slow request from a service the user has already navigated away from, which would
  // otherwise land its result on whichever account happens to be current by then.
  const activeRef = useRef(service);
  useEffect(() => {
    activeRef.current = service;
  }, [service]);

  const apply = useCallback((result: AuthResult) => {
    setIsLoggedIn(result.authorized);
    setProfile(result.profile ?? null);
    return result.authorized;
  }, []);

  const run = useCallback(
    async (operation: () => Promise<AuthResult>, requested: ServiceProvider): Promise<boolean> => {
      setBusy(true);
      setError('');
      try {
        const result = await operation();
        if (activeRef.current !== requested) return result.authorized;
        return apply(result);
      } catch (reason) {
        if (activeRef.current === requested) {
          const message = describeError(reason);
          console.error(`[service-auth] ${requested} failed`, { error: message });
          setError(message);
          setIsLoggedIn(false);
          setProfile(null);
        }
        return false;
      } finally {
        // Cleared only for the request that is still current, or a second call in the same instant
        // would leave the flag stuck on for whichever one it did not own.
        if (activeRef.current === requested) setBusy(false);
      }
    },
    [apply],
  );

  const check = useCallback(async (): Promise<boolean> => {
    if (!adapter) {
      setError(`Сервис ${service} не зарегистрирован`);
      return false;
    }
    return run(() => adapter.authStatus(), service);
  }, [adapter, run, service]);

  const signIn = useCallback(
    async (credentials: ServiceCredentials): Promise<boolean> => {
      if (!adapter) {
        setError(`Сервис ${service} не зарегистрирован`);
        return false;
      }
      // Deliberately not storing anything here. Each adapter remembers its own credentials after a
      // successful exchange, and doing it again in the hook would make SoundCloud start persisting a
      // token it currently keeps out of localStorage entirely.
      return run(() => adapter.authLogin(credentials), service);
    },
    [adapter, run, service],
  );

  const signOut = useCallback(async (): Promise<void> => {
    if (!adapter) return;
    const requested = service;
    setBusy(true);
    setError('');
    try {
      // Not through run(): authLogout answers with nothing rather than with a status.
      await adapter.authLogout();
      if (activeRef.current !== requested) return;
      // The stored app credentials survive. They identify the app the user registered, not the session
      // that just ended, and signing in again needs them.
      setProfile(null);
      setIsLoggedIn(false);
    } catch (reason) {
      if (activeRef.current !== requested) return;
      const message = describeError(reason);
      console.error(`[service-auth] ${requested} sign out failed`, { error: message });
      setError(message);
    } finally {
      if (activeRef.current === requested) setBusy(false);
    }
  }, [adapter, service]);

  const refresh = useCallback(async (): Promise<boolean> => {
    if (!adapter?.authRefresh) return false;
    const stored = loadCredentials(service);
    if (!stored) return false;
    return run(() => adapter.authRefresh!(), service);
  }, [adapter, run, service]);

  // Re-check when the service changes, so the switcher shows the right thing without every caller having
  // to remember to ask.
  useEffect(() => {
    let disposed = false;
    setBusy(true);
    void (async () => {
      if (!adapter) {
        setIsLoggedIn(false);
        setProfile(null);
        setBusy(false);
        return;
      }
      try {
        const result = await adapter.authStatus();
        if (disposed) return;
        apply(result);
      } catch (reason) {
        if (disposed) return;
        // A status check that fails is not a reason to show an error: it means signed out as far as the
        // UI is concerned, and a network blip should not put a red banner on screen at launch.
        console.warn(`[service-auth] ${service} status check failed`, { error: describeError(reason) });
        setIsLoggedIn(false);
        setProfile(null);
      } finally {
        if (!disposed) setBusy(false);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [adapter, apply, service]);

  const account = useMemo<ServiceAccount>(
    () => ({ service, profile, isLoggedIn, credentials: loadCredentials(service) ?? undefined }),
    [isLoggedIn, profile, service],
  );

  return { account, busy, error, signIn, signOut, refresh, check };
}
