import { useEffect, useState } from 'react';
import { SERVICE_PROVIDERS, type ServiceAccount, type ServiceProvider } from '../../domain/models';
import { desktop } from '../../lib/desktop';
import { clearCredentials, loadCredentials, saveCredentials } from '../../lib/credentialStore';
import { useServiceAuth } from '../../lib/useServiceAuth';
import { CloudGlyph, SpotifyGlyph, YouTubeGlyph } from './AuthIcons';
import { ErrorMessage } from './ErrorMessage';
import './ConnectedAccounts.css';

type Props = {
  accounts: Partial<Record<ServiceProvider, ServiceAccount>>;
  activeService: ServiceProvider;
  onSwitch: (service: ServiceProvider) => void;
  /**
   * SoundCloud's own sign-out.
   *
   * Passed in rather than reached for: its session is ended through the app's logout, which owns the
   * confirmation dialog and clears the player. This component only holds hooks for the two OAuth
   * services, so calling one of them for SoundCloud indexed a key that is not there and did nothing —
   * a button that looked like it worked.
   */
  onSignOutSoundCloud: () => void;
};

type OAuthService = 'spotify' | 'youtube-music';

const SERVICE_LABELS: Record<ServiceProvider, string> = {
  soundcloud: 'SoundCloud',
  spotify: 'Spotify',
  'youtube-music': 'YouTube Music',
};

const SERVICE_DOCS: Record<OAuthService, string> = {
  spotify: 'docs/SPOTIFY_SETUP.md',
  'youtube-music': 'docs/YOUTUBE_MUSIC_SETUP.md',
};

function ServiceGlyph({ service }: { service: ServiceProvider }) {
  if (service === 'spotify') return <SpotifyGlyph className="accounts-row__glyph" />;
  if (service === 'youtube-music') return <YouTubeGlyph className="accounts-row__glyph" />;
  return <CloudGlyph className="accounts-row__glyph" />;
}

function isOAuthService(service: ServiceProvider): service is OAuthService {
  return service === 'spotify' || service === 'youtube-music';
}

/**
 * The connected-accounts section of the settings page.
 *
 * The app credentials live in credentialStore, not in the settings file, and this is why. The plan puts
 * them in Settings, which the Go sidecar persists — but the sidecar is the same process that holds the
 * OAuth tokens already, and writing the client secret to a second place means two stores to keep in step
 * and two places to forget about when a user asks what the app has saved. One store, described in one
 * place, was the better trade; credentialStore's own warning says what that costs.
 *
 * SoundCloud's row is status only. Its sign-in needs a pasted access token and lives in the form directly
 * below, which is untouched.
 */
type YoutubeBlockProps = {
  target: ReturnType<typeof useServiceAuth>;
  values: { clientId: string; clientSecret: string };
  remembered: boolean;
  bundledConfigured: boolean;
  showKeys: boolean;
  onToggleKeys: () => void;
  onChange: (values: { clientId: string; clientSecret: string }) => void;
  onSave: (values: { clientId: string; clientSecret: string }) => void;
  onForget: () => void;
};

/**
 * YouTube sign-in: one click when the build carries bundled keys or stored ones, hand-typed keys
 * behind a text toggle. Typing means editing, and editing belongs to Save — sign-in then needs
 * stored or bundled keys, never half-typed fields.
 */
function YoutubeOauthBlock({ target, values, remembered, bundledConfigured, showKeys, onToggleKeys, onChange, onSave, onForget }: YoutubeBlockProps) {
  const isEditing = values.clientId.trim() !== '' || values.clientSecret.trim() !== '';
  const canSignIn = !target.busy && (remembered || bundledConfigured) && !isEditing;

  const signIn = () => {
    if (remembered && !isEditing) {
      const stored = loadCredentials('youtube-music');
      if (!stored?.clientId || !stored.clientSecret) return;
      void target.signIn({ ...stored, service: 'youtube-music' });
      return;
    }
    // No explicit keys: the adapter resolves stored-then-bundled on its own.
    void target.signIn({ service: 'youtube-music' });
  };

  return (
    <div className="accounts-oauth-row">
      <div className="accounts-copy">
        <b>{SERVICE_LABELS['youtube-music']}</b>
        <small>
          {bundledConfigured && !remembered
            ? 'Вход в один клик — общие ключи уже в приложении.'
            : remembered
              ? 'Вход по сохранённым ключам.'
              : <>Вход идёт через OAuth и требует приложения, которое ты зарегистрировал сам — см. <code>{SERVICE_DOCS['youtube-music']}</code>.</>}
        </small>
      </div>

      <div className="accounts-actions">
        <button
          type="button"
          className="primary-button"
          disabled={!canSignIn}
          onClick={signIn}
        >
          {target.busy ? 'Открываем окно…' : 'Войти через YouTube'}
        </button>
        <button type="button" className="text-action" onClick={onToggleKeys} aria-expanded={showKeys}>
          {showKeys ? 'Скрыть свои ключи' : remembered ? 'Заменить ключи своими' : 'У меня свои ключи'}
        </button>
      </div>

      {showKeys ? (
        <>
          <label className="accounts-field">
            <span>Client ID</span>
            <input
              value={values.clientId}
              autoComplete="off"
              spellCheck={false}
              placeholder={remembered ? 'Сохранён — введи, чтобы заменить' : 'Из консоли разработчика'}
              onChange={(event) => onChange({ ...values, clientId: event.currentTarget.value })}
            />
          </label>

          <label className="accounts-field">
            <span>Client Secret</span>
            <input
              type="password"
              value={values.clientSecret}
              autoComplete="new-password"
              spellCheck={false}
              placeholder={remembered ? 'Сохранён — введи, чтобы заменить' : 'Показывается один раз'}
              onChange={(event) => onChange({ ...values, clientSecret: event.currentTarget.value })}
            />
          </label>

          <div className="accounts-actions">
            <button
              type="button"
              className="outline-button"
              disabled={!values.clientId.trim() || !values.clientSecret.trim()}
              onClick={() => onSave({ clientId: values.clientId.trim(), clientSecret: values.clientSecret.trim() })}
            >
              Сохранить
            </button>
            {remembered ? (
              <button type="button" className="outline-button" onClick={onForget}>
                Забыть учётные данные
              </button>
            ) : null}
          </div>
        </>
      ) : null}

      {target.error ? <ErrorMessage message={target.error} /> : null}
    </div>
  );
}

export function ConnectedAccounts({ accounts, activeService, onSwitch, onSignOutSoundCloud }: Props) {
  const spotify = useServiceAuth('spotify');
  const youtube = useServiceAuth('youtube-music');
  const auth = { spotify, 'youtube-music': youtube } as Record<OAuthService, typeof spotify>;

  const [entered, setEntered] = useState<Record<OAuthService, { clientId: string; clientSecret: string }>>({
    spotify: { clientId: '', clientSecret: '' },
    'youtube-music': { clientId: '', clientSecret: '' },
  });
  const [remembered, setRemembered] = useState<Record<OAuthService, boolean>>({ spotify: false, 'youtube-music': false });
  const [notice, setNotice] = useState('');
  const [bundledYoutube, setBundledYoutube] = useState(false);
  const [showYoutubeKeys, setShowYoutubeKeys] = useState(false);

  // One local invoke per mount: bundled keys are build-time constants, so this never changes
  // within a session. A failure reads as unconfigured — the hand-typed path still works.
  // The keys block always starts closed: one-click login is the default view, hand-typed keys
  // open on demand through the toggle.
  useEffect(() => {
    let cancelled = false;
    void desktop.youtubeBundledCredentials().then(
      (bundled) => {
        if (cancelled) return;
        setBundledYoutube(bundled.configured);
      },
      () => {
        if (cancelled) return;
        setBundledYoutube(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // Read once on mount rather than on every render: this is a snapshot of what is stored, and the hooks
  // above already report the live connection state.
  useEffect(() => {
    setRemembered({
      spotify: Boolean(loadCredentials('spotify')?.clientId),
      'youtube-music': Boolean(loadCredentials('youtube-music')?.clientId),
    });
  }, []);

  function remember(service: OAuthService, values: { clientId: string; clientSecret: string }) {
    saveCredentials(service, values);
    setEntered((current) => ({ ...current, [service]: { clientId: '', clientSecret: '' } }));
    setRemembered((current) => ({ ...current, [service]: true }));
    setNotice(`${SERVICE_LABELS[service]}: учётные данные сохранены на этом устройстве`);
  }

  function forget(service: OAuthService) {
    clearCredentials(service);
    setRemembered((current) => ({ ...current, [service]: false }));
    setNotice(`${SERVICE_LABELS[service]}: учётные данные удалены`);
  }

  return (
    <section className="settings-card settings-accounts" aria-labelledby="accounts-title">
      <div className="settings-card-heading">
        <div>
          <h2 id="accounts-title">Подключённые аккаунты</h2>
        </div>
      </div>

      {notice ? <p className="accounts-notice" role="status">{notice}</p> : null}

      <div className="accounts-list">
        {SERVICE_PROVIDERS.map((service) => {
          const account = accounts[service];
          const connected = Boolean(account?.isLoggedIn);
          const isCurrent = service === activeService;

          return (
            <article key={service} className={`accounts-row${connected ? ' is-connected' : ''}${isCurrent ? ' is-current' : ''}`}>
              <ServiceGlyph service={service} />

              <div className="accounts-copy">
                <b>{SERVICE_LABELS[service]}</b>
                <small>
                  {connected
                    ? `Подключено как ${account?.profile?.username ?? 'пользователь'}`
                    : 'Не подключено'}
                </small>
              </div>

              {isCurrent ? (
                <span className="accounts-current" aria-label="Текущий сервис">активен</span>
              ) : (
                <button type="button" className="outline-button" onClick={() => onSwitch(service)}>
                  Переключить
                </button>
              )}

              {connected ? (
                isOAuthService(service) ? (
                  <button
                    type="button"
                    className="outline-button"
                    disabled={auth[service].busy}
                    onClick={() => void auth[service].signOut()}
                  >
                    Отключить
                  </button>
                ) : (
                  <button type="button" className="outline-button" onClick={onSignOutSoundCloud}>
                    Выйти
                  </button>
                )
              ) : null}
            </article>
          );
        })}
      </div>

      <div className="accounts-oauth">
        {SERVICE_PROVIDERS.filter(isOAuthService).map((service) => {
          if (service === 'youtube-music') {
            return (
              <YoutubeOauthBlock
                key={service}
                target={auth[service]}
                values={entered[service]}
                remembered={remembered[service]}
                bundledConfigured={bundledYoutube}
                showKeys={showYoutubeKeys}
                onToggleKeys={() => setShowYoutubeKeys((shown) => !shown)}
                onChange={(values) => setEntered((current) => ({ ...current, [service]: values }))}
                onSave={(values) => remember(service, values)}
                onForget={() => forget(service)}
              />
            );
          }
          const target = auth[service];
          const values = entered[service];
          // Signing in uses whatever is stored, so both fields must be empty. Typing either one means
          // the user is editing the credentials, which is the Save button's job and not this one's.
          const isEditing = values.clientId.trim() !== '' || values.clientSecret.trim() !== '';
          const canSignIn = remembered[service] && !isEditing;

          return (
            <div key={service} className="accounts-oauth-row">
              <div className="accounts-copy">
                <b>{SERVICE_LABELS[service]}</b>
                <small>
                  Вход идёт через OAuth и требует приложения, которое ты зарегистрировал сам — см.{' '}
                  <code>{SERVICE_DOCS[service]}</code>.
                </small>
              </div>

              <label className="accounts-field">
                <span>Client ID</span>
                <input
                  value={values.clientId}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={remembered[service] ? 'Сохранён — введи, чтобы заменить' : 'Из консоли разработчика'}
                  onChange={(event) => setEntered((current) => ({ ...current, [service]: { ...current[service], clientId: event.currentTarget.value } }))}
                />
              </label>

              <label className="accounts-field">
                <span>Client Secret</span>
                <input
                  type="password"
                  value={values.clientSecret}
                  autoComplete="new-password"
                  spellCheck={false}
                  placeholder={remembered[service] ? 'Сохранён — введи, чтобы заменить' : 'Показывается один раз'}
                  onChange={(event) => setEntered((current) => ({ ...current, [service]: { ...current[service], clientSecret: event.currentTarget.value } }))}
                />
              </label>

              <div className="accounts-actions">
                <button
                  type="button"
                  className="outline-button"
                  disabled={!values.clientId.trim() || !values.clientSecret.trim()}
                  onClick={() => remember(service, { clientId: values.clientId.trim(), clientSecret: values.clientSecret.trim() })}
                >
                  Сохранить
                </button>
                <button
                  type="button"
                  className="primary-button"
                  disabled={!canSignIn || target.busy}
                  onClick={() => {
                    const stored = loadCredentials(service);
                    if (!stored?.clientId || !stored.clientSecret) return;
                    void target.signIn({ ...stored, service });
                  }}
                >
                  {target.busy ? 'Открываем окно…' : 'Войти'}
                </button>
                {remembered[service] ? (
                  <button type="button" className="outline-button" onClick={() => forget(service)}>
                    Забыть учётные данные
                  </button>
                ) : null}
              </div>

              {target.error ? <ErrorMessage message={target.error} /> : null}
            </div>
          );
        })}
      </div>

      <p className="accounts-note">
        Учётные данные приложения хранятся только на этом устройстве, в браузерном хранилище окна. OAuth-токены
        лежат отдельно, в локальном backend, в файле с правами 0600. Ничего никуда не отправляется.
      </p>
    </section>
  );
}
