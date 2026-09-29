import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import type { SoundCloudCredentials } from '../../lib/useSoundCloudAuth';
import { useSoundCloudAuth } from '../../lib/useSoundCloudAuth';
import { ChevronGlyph, CloudGlyph } from './AuthIcons';
import { ErrorMessage } from './ErrorMessage';
import { normalizeToken } from '../lib/format';
import './AuthScreen.css';

const BACKGROUND_VIDEO = '/auth_bg.mp4';

type Props = {
  error: string;
  busy: boolean;
  clientId: string;
  onLogin: (token: string, clientId: string) => void;
  onSilentLogin: (credentials: SoundCloudCredentials) => void | Promise<void>;
};

function applyLineScales(lineOne: HTMLElement | null, lineTwo: HTMLElement | null) {
  if (!lineOne || !lineTwo) return;
  lineOne.style.setProperty('--line-scale', '1');
  lineTwo.style.setProperty('--line-scale', '1');
  const w1 = lineOne.scrollWidth;
  const w2 = lineTwo.scrollWidth;
  if (w1 <= 0 || w2 <= 0) return;
  const target = Math.max(w1, w2);
  lineOne.style.setProperty('--line-scale', String(target / w1));
  lineTwo.style.setProperty('--line-scale', String(target / w2));
}

export function AuthScreen({ error, busy, clientId, onLogin, onSilentLogin }: Props) {
  const [token, setToken] = useState('');
  const [manualClientId, setManualClientId] = useState(clientId);
  const [manualOpen, setManualOpen] = useState(false);
  const [motionReady, setMotionReady] = useState(false);
  const [manualPending, setManualPending] = useState(false);
  const lineOneRef = useRef<HTMLSpanElement>(null);
  const lineTwoRef = useRef<HTMLSpanElement>(null);
  const { starting, error: silentError, startAuthFlow } = useSoundCloudAuth({ onCredentials: onSilentLogin });

  const oauthBusy = busy || starting;
  const canConnect = Boolean(token.trim() && manualClientId.trim()) && !busy;

  useEffect(() => {
    setManualClientId(clientId);
  }, [clientId]);

  useEffect(() => {
    if (!manualPending || busy) return;
    setManualPending(false);
  }, [busy, manualPending]);

  useEffect(() => {
    document.title = 'Вход в SoundCloud';
    document.documentElement.style.colorScheme = 'dark';
    let theme = document.querySelector('meta[name="theme-color"]');
    if (!theme) {
      theme = document.createElement('meta');
      theme.setAttribute('name', 'theme-color');
      document.head.appendChild(theme);
    }
    theme.setAttribute('content', '#000000');
    // This screen is the first thing a user sees; the app shell owns the title once it takes over.
    return () => { document.title = 'BetterSoundCloud'; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const start = () => {
      if (!cancelled) setMotionReady(true);
    };
    const fallback = window.setTimeout(start, 3500);
    if (document.fonts?.ready) {
      void document.fonts.ready.then(() => {
        window.clearTimeout(fallback);
        start();
      });
    }
    return () => {
      cancelled = true;
      window.clearTimeout(fallback);
    };
  }, []);

  useLayoutEffect(() => {
    applyLineScales(lineOneRef.current, lineTwoRef.current);
    const onResize = () => applyLineScales(lineOneRef.current, lineTwoRef.current);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [motionReady]);

  function handleManualConnect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const accessToken = normalizeToken(token);
    const id = manualClientId.trim();
    if (!accessToken || !id) return;
    setManualPending(true);
    onLogin(accessToken, id);
  }

  return (
    <main className={`viewport${motionReady ? '' : ' motion-pending'}`}>
      <section className="screen" id="screen">
        <video className="background" autoPlay muted loop playsInline disablePictureInPicture aria-hidden="true">
          <source src={BACKGROUND_VIDEO} type="video/mp4" />
        </video>

        <header className="header">
          <a className="brand" href="https://soundcloud.com" aria-label="SoundCloud" target="_blank" rel="noreferrer">
            <CloudGlyph className="brand-mark" />
          </a>

          <div className="header-actions">
            <button
              className="primary-cta header-cta"
              type="button"
              onClick={() => void startAuthFlow()}
              disabled={oauthBusy}
            >
              <span className="label">{oauthBusy ? 'Открываем SoundCloud…' : 'Войти через SoundCloud'}</span>
              <span className="arrow-box" aria-hidden="true">
                <CloudGlyph className="cta-cloud" />
              </span>
            </button>
          </div>
        </header>

        <section className="hero">
          <div className="hero-content">
            <h1 className="hero-title">
              <span className="line line-one" ref={lineOneRef}>
                <span className="line-reveal">Войдите через</span>
              </span>
              <span className="line line-two" ref={lineTwoRef}>
                <span className="line-reveal">SoundCloud.</span>
              </span>
            </h1>

            <p className="hero-copy">
              Подключите аккаунт, чтобы синхронизировать треки и статистику.
              <br />
              Один клик — и вы внутри. Если автоматический вход недоступен,
              <br />
              укажите access token и client ID вручную слева вверху.
            </p>

            {oauthBusy && (
              <p className="hero-status" role="status">
                Проверяем подключение…
              </p>
            )}
            {silentError && <ErrorMessage message={silentError} className="auth-inline-error" />}
          </div>

          <aside className={`manual-panel${manualOpen ? ' is-open' : ''}`}>
            <button
              className="manual-link"
              type="button"
              aria-expanded={manualOpen}
              onClick={() => setManualOpen((open) => !open)}
            >
              <CloudGlyph className="manual-link-icon" />
              <span>Ввести данные вручную</span>
              <ChevronGlyph className="manual-link-chevron" />
            </button>

            <form className="manual-inline" onSubmit={handleManualConnect} aria-hidden={!manualOpen}>
              <input
                id="access-token"
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="Access token"
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
                tabIndex={manualOpen ? 0 : -1}
                aria-label="Access token"
              />
              <input
                id="client-id"
                type="text"
                value={manualClientId}
                onChange={(event) => setManualClientId(event.target.value)}
                placeholder="Client ID"
                minLength={8}
                maxLength={128}
                pattern="[A-Za-z0-9_-]+"
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
                tabIndex={manualOpen ? 0 : -1}
                aria-label="Client ID"
              />
              <button className="connect-button" type="submit" disabled={!canConnect} tabIndex={manualOpen ? 0 : -1}>
                {busy || manualPending ? 'Подключаем…' : 'Подключить аккаунт'}
              </button>
              {manualOpen && error && (
                <p className="manual-error" role="alert">
                  {error}
                </p>
              )}
            </form>
          </aside>
        </section>
      </section>
    </main>
  );
}
