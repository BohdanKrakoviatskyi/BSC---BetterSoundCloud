import { useEffect, useMemo, useState } from 'react';
import type { ServiceAccount, ServiceProvider } from '../../domain/models';
import { desktop } from '../../lib/desktop';
import type { SoundCloudCredentials } from '../../lib/useSoundCloudAuth';
import { useServiceAuth } from '../../lib/useServiceAuth';
import { AuthScreen } from './AuthScreen';
import { CloudGlyph, SpotifyGlyph, YouTubeGlyph } from './AuthIcons';
import { ErrorMessage } from './ErrorMessage';
import './MultiAuthScreen.css';

const BACKGROUND_VIDEO = '/auth_bg.mp4';

type Props = {
  accounts: Partial<Record<ServiceProvider, ServiceAccount>>;
  /** Restored from storage at launch, and preselected. */
  lastService: ServiceProvider;
  /** Whatever App already had to say, passed straight through. */
  error: string;
  /**
   * SoundCloud's sign-in, exactly as it exists today.
   *
   * It is handed in rather than reimplemented because that flow works and is not to be touched. This
   * component renders AuthScreen unchanged when SoundCloud is chosen, so nothing about it moves.
   */
  soundCloud: {
    clientId: string;
    onLogin: (token: string, clientId: string) => void;
    onSilentLogin: (credentials: SoundCloudCredentials) => void | Promise<void>;
  };
  /** Called once any service is authorized; App then leaves the guest screen. */
  onSignedIn: (service: ServiceProvider) => void;
};

const SERVICE_LABELS: Record<ServiceProvider, string> = {
  soundcloud: 'SoundCloud',
  spotify: 'Spotify',
  'youtube-music': 'YouTube Music',
};

const SERVICE_HINTS: Record<ServiceProvider, string> = {
  soundcloud: 'Вставьте токен аккаунта или войдите через встроенное окно',
  spotify: 'Из Spotify for Developers — см. docs/SPOTIFY_SETUP.md',
  'youtube-music': 'Из Google Cloud Console — см. docs/YOUTUBE_MUSIC_SETUP.md',
};

/** The two services whose sign-in goes through OAuth rather than a pasted token. */
type OAuthService = 'spotify' | 'youtube-music';

function ServiceGlyph({ service }: { service: ServiceProvider }) {
  if (service === 'spotify') return <SpotifyGlyph className="multi-auth__glyph" />;
  if (service === 'youtube-music') return <YouTubeGlyph className="multi-auth__glyph" />;
  return <CloudGlyph className="multi-auth__glyph" />;
}

/**
 * The guest screen: a card per service instead of one sign-in form.
 *
 * SoundCloud is the odd one out. Its flow needs a pasted token or a background webview, and it already
 * works, so choosing it hands over to the existing AuthScreen untouched rather than growing a second
 * implementation of it.
 *
 * Spotify and YouTube Music both need the user's own app credentials before OAuth can even start — there
 * is no anonymous sign-in — so their cards carry a small form rather than pretending otherwise.
 *
 * Auto-login is attempted for those two on mount, and only for those two. SoundCloud's restore path
 * belongs to App and already runs; running a second one here would race it.
 */
export function MultiAuthScreen({ accounts, lastService, error, soundCloud, onSignedIn }: Props) {
  const [chosen, setChosen] = useState<ServiceProvider | null>(null);
  // One pair per service. A single pair meant a Spotify Client ID appeared in the YouTube box as soon as
  // the user looked across, since the two cards look alike at a glance.
  const [credentials, setCredentials] = useState<Record<OAuthService, { clientId: string; clientSecret: string }>>({
    spotify: { clientId: '', clientSecret: '' },
    'youtube-music': { clientId: '', clientSecret: '' },
  });

  const spotify = useServiceAuth('spotify');
  const youtube = useServiceAuth('youtube-music');
  // One-click sign-in needs bundled build-time keys. One local invoke per mount; a failure reads
  // as unconfigured and the hand-typed path below still works.
  const [bundledYoutube, setBundledYoutube] = useState(false);
  // The keys block always starts closed: one-click login is the default view, hand-typed keys
  // open on demand through the toggle.
  const [showYoutubeKeys, setShowYoutubeKeys] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void desktop.youtubeBundledCredentials().then(
      (bundled) => {
        if (!cancelled) setBundledYoutube(bundled.configured);
      },
      () => {
        if (!cancelled) setBundledYoutube(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const auth = useMemo(
    () => ({ spotify, 'youtube-music': youtube }) as Record<'spotify' | 'youtube-music', typeof spotify>,
    [spotify, youtube],
  );

  // Any service already connected means the app is usable, so there is no reason to hold the guest
  // screen. This is also what makes the auto-login below leave the screen on success.
  const alreadyConnected = useMemo(
    () => (Object.values(accounts) ?? []).some((account) => account?.isLoggedIn),
    [accounts],
  );

  useEffect(() => {
    if (alreadyConnected) return;
    if (lastService === 'soundcloud') return;

    const target = auth[lastService];
    if (!target.account.credentials) return;
    if (target.account.credentials.clientId && target.account.credentials.clientSecret) {
      void target.signIn({ ...target.account.credentials, service: lastService });
    }
    // Deliberately not depending on the auth objects. They are new on every render, and including them
    // would re-run this after a keystroke anywhere else on the screen, reopening the OAuth window on top
    // of whatever the user was doing.
  }, [alreadyConnected, lastService]);

  function updateCredential(service: OAuthService, field: 'clientId' | 'clientSecret', value: string) {
    setCredentials((current) => ({ ...current, [service]: { ...current[service], [field]: value } }));
  }

  // SoundCloud defers entirely to the existing screen.
  if (chosen === 'soundcloud') {
    return (
      <AuthScreen
        error={error}
        busy={false}
        clientId={soundCloud.clientId}
        onLogin={soundCloud.onLogin}
        onSilentLogin={soundCloud.onSilentLogin}
      />
    );
  }

  async function submit(service: OAuthService) {
    const target = auth[service];
    const entered = credentials[service];
    const signedIn = await target.signIn({
      service,
      clientId: entered.clientId.trim(),
      clientSecret: entered.clientSecret.trim(),
    });
    if (signedIn) onSignedIn(service);
  }

  // YouTube one-click sign-in: no fields needed. Typed values win when present (and are
  // remembered by the adapter on success); otherwise stored-then-bundled keys resolve inside.
  async function submitYoutube() {
    const entered = credentials['youtube-music'];
    const clientId = entered.clientId.trim();
    const clientSecret = entered.clientSecret.trim();
    const signedIn = clientId && clientSecret
      ? await youtube.signIn({ service: 'youtube-music', clientId, clientSecret })
      : await youtube.signIn({ service: 'youtube-music' });
    if (signedIn) onSignedIn('youtube-music');
  }

  return (
    <div className="multi-auth">
      <video className="background" autoPlay muted loop playsInline disablePictureInPicture aria-hidden="true">
        <source src={BACKGROUND_VIDEO} type="video/mp4" />
      </video>

      <div className="multi-auth__inner">
        <h1 className="multi-auth__heading">Выберите сервис</h1>

        {error ? <ErrorMessage message={error} className="multi-auth__error" /> : null}

        <div className="multi-auth__cards">
          {(['soundcloud', 'spotify', 'youtube-music'] as const).map((service) => {
            const account = accounts[service];
            const connected = Boolean(account?.isLoggedIn);
            const isSoundCloud = service === 'soundcloud';

            return (
              <section key={service} className={`multi-auth__card${connected ? ' is-connected' : ''}`}>
                <ServiceGlyph service={service} />
                <h2 className="multi-auth__title">{SERVICE_LABELS[service]}</h2>

                <p className="multi-auth__status">
                  {connected ? `Подключено как ${account?.profile?.username ?? 'пользователь'}` : 'Не подключено'}
                </p>

                {/*
                  SoundCloud's button only chooses the card: its sign-in is the existing screen, which
                  renders above and is not modified in any way.
                */}
                {isSoundCloud ? (
                  <button type="button" className="multi-auth__action" onClick={() => setChosen('soundcloud')}>
                    {connected ? 'Открыть настройки входа' : 'Войти'}
                  </button>
                ) : service === 'youtube-music' ? (
                  <>
                    <p className="multi-auth__hint">
                      {bundledYoutube
                        ? 'Вход в один клик — общие ключи уже в приложении.'
                        : 'Вход без своих ключей недоступен в этой сборке — введи их ниже.'}
                    </p>
                    <button
                      type="button"
                      className="multi-auth__action"
                      disabled={youtube.busy}
                      onClick={() => void submitYoutube()}
                    >
                      {youtube.busy ? 'Открываем окно…' : 'Войти'}
                    </button>
                    <button
                      type="button"
                      className="text-action"
                      onClick={() => setShowYoutubeKeys((shown) => !shown)}
                      aria-expanded={showYoutubeKeys}
                    >
                      {showYoutubeKeys ? 'Скрыть свои ключи' : 'У меня свои ключи'}
                    </button>
                    {showYoutubeKeys ? (
                      <form
                        className="multi-auth__form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void submitYoutube();
                        }}
                      >
                        <label className="multi-auth__field">
                          <span>Client ID</span>
                          <input
                            value={credentials[service].clientId}
                            onChange={(event) => updateCredential(service, 'clientId', event.target.value)}
                            autoComplete="off"
                            spellCheck={false}
                          />
                        </label>
                        <label className="multi-auth__field">
                          <span>Client Secret</span>
                          <input
                            type="password"
                            value={credentials[service].clientSecret}
                            onChange={(event) => updateCredential(service, 'clientSecret', event.target.value)}
                            autoComplete="off"
                            spellCheck={false}
                          />
                        </label>
                        <p className="multi-auth__hint">{SERVICE_HINTS[service]}</p>
                      </form>
                    ) : null}
                    {youtube.error ? (
                      <ErrorMessage message={youtube.error} className="multi-auth__error" />
                    ) : null}
                  </>
                ) : (
                  <form
                    className="multi-auth__form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submit(service);
                    }}
                  >
                    <label className="multi-auth__field">
                      <span>Client ID</span>
                      <input
                        value={credentials[service].clientId}
                        onChange={(event) => updateCredential(service, 'clientId', event.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                        required
                      />
                    </label>
                    <label className="multi-auth__field">
                      <span>Client Secret</span>
                      <input
                        type="password"
                        value={credentials[service].clientSecret}
                        onChange={(event) => updateCredential(service, 'clientSecret', event.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                        required
                      />
                    </label>

                    <p className="multi-auth__hint">{SERVICE_HINTS[service]}</p>

                    {auth[service].error ? (
                      <ErrorMessage message={auth[service].error} className="multi-auth__error" />
                    ) : null}

                    <button
                      type="submit"
                      className="multi-auth__action"
                      disabled={
                        auth[service].busy
                        || !credentials[service].clientId.trim()
                        || !credentials[service].clientSecret.trim()
                      }
                    >
                      {auth[service].busy ? 'Открываем окно…' : 'Войти'}
                    </button>
                  </form>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
