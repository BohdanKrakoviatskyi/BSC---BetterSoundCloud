import {
  DEFAULT_SERVICE,
  isServiceProvider,
  type ServiceCredentials,
  type ServiceProvider,
} from '../domain/models';

/**
 * Per-service session storage.
 *
 * ══ SECURITY ══
 * These functions keep credentials in the webview's localStorage, which the plan specifies. That is
 * acceptable only while nothing real is written here — and right now nothing is: no Spotify or YouTube
 * flow exists yet, so this module holds no secrets at all.
 *
 * Before Phase 1 writes a real refresh token it has to move. localStorage is readable by any script
 * that reaches the webview, so an OAuth refresh token parked there is one XSS away from being
 * replayed, and it outlives the session. The sidecar already does this properly: auth.json goes
 * through writeSecretFile with a 0600 mode. Tokens belong beside it.
 *
 * localStorage is still the right home for getLastActiveService and setLastActiveService — that is a
 * preference, not a secret, and the app already keeps sidebar widths there.
 *
 * Every entry point is wrapped: storage can throw on a quota, in private mode, or when disabled
 * outright, and an exception here would take the whole app down on start.
 */

const CREDENTIAL_PREFIX = 'bsc.credentials.';
const LAST_SERVICE_KEY = 'bsc.lastService';

/** localStorage access is not guaranteed to work, or to work the same way twice. */
function store(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function saveCredentials(service: ServiceProvider, data: Omit<ServiceCredentials, 'service'>): boolean {
  const storage = store();
  if (!storage) return false;
  try {
    storage.setItem(CREDENTIAL_PREFIX + service, JSON.stringify({ ...data, service }));
    return true;
  } catch (reason) {
    console.warn(`[ui.credentials] не удалось сохранить ${service}`, reason);
    return false;
  }
}

export function loadCredentials(service: ServiceProvider): ServiceCredentials | null {
  const storage = store();
  if (!storage) return null;
  try {
    const raw = storage.getItem(CREDENTIAL_PREFIX + service);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    // Trust the stored shape only as far as the field we branch on.
    const record = parsed as Partial<ServiceCredentials>;
    if (record.service !== service) return null;
    return { ...record, service };
  } catch (reason) {
    console.warn(`[ui.credentials] не удалось прочитать ${service}`, reason);
    return null;
  }
}

export function clearCredentials(service: ServiceProvider): void {
  const storage = store();
  if (!storage) return;
  try {
    storage.removeItem(CREDENTIAL_PREFIX + service);
  } catch (reason) {
    console.warn(`[ui.credentials] не удалось удалить ${service}`, reason);
  }
}

/** Which services have something stored, in a stable order. */
export function listStoredServices(): ServiceProvider[] {
  const storage = store();
  if (!storage) return [];
  try {
    const found = new Set<ServiceProvider>();
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key?.startsWith(CREDENTIAL_PREFIX)) continue;
      const service = key.slice(CREDENTIAL_PREFIX.length);
      if (isServiceProvider(service) && loadCredentials(service)) found.add(service);
    }
    return [...found].sort();
  } catch {
    return [];
  }
}

/**
 * The service to restore on launch. SoundCloud is the default, both on a first run and whenever the
 * stored value is missing or unreadable — an unknown string must not leave the app with no service.
 */
export function getLastActiveService(): ServiceProvider {
  const storage = store();
  if (!storage) return DEFAULT_SERVICE;
  try {
    const value = storage.getItem(LAST_SERVICE_KEY);
    return isServiceProvider(value) ? value : DEFAULT_SERVICE;
  } catch {
    return DEFAULT_SERVICE;
  }
}

export function setLastActiveService(service: ServiceProvider): void {
  const storage = store();
  if (!storage) return;
  try {
    storage.setItem(LAST_SERVICE_KEY, service);
  } catch (reason) {
    console.warn('[ui.credentials] не удалось запомнить активный сервис', reason);
  }
}
