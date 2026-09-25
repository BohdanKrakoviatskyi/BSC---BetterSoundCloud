import { useState, type FormEvent } from 'react';
import type { SoundCloudCredentials } from '../../lib/useSoundCloudAuth';
import { SilentAuthButton } from './SilentAuthButton';
import './AuthScreen.css';

type Props = {
  error: string;
  busy: boolean;
  clientId: string;
  onLogin: (token: string, clientId: string) => void;
  onSilentLogin: (credentials: SoundCloudCredentials) => void | Promise<void>;
};

export function AuthScreen({ error, busy, clientId, onLogin, onSilentLogin }: Props) {
  const [token, setToken] = useState('');
  const [manualClientId, setManualClientId] = useState(clientId);
  const [showToken, setShowToken] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (token.trim() && manualClientId.trim()) onLogin(token.trim(), manualClientId.trim());
  }

  return (
    <main className="auth-shell">
      <section className="auth-card auth-entry-card" aria-labelledby="auth-title">
        <div className="auth-content">
          <div className="auth-brand" aria-label="BetterSoundCloud">
            <span className="auth-brand-mark" aria-hidden="true">♫</span>
            <span>Better<span>SoundCloud</span></span>
          </div>

          <div className="auth-intro">
            <span className="auth-eyebrow"><span className="auth-eyebrow-dot" /> ВАША МУЗЫКА — БЛИЖЕ</span>
            <h1 id="auth-title">SoundCloud.<br /><span>По-новому.</span></h1>
            <p className="auth-note">Подключите аккаунт, чтобы слушать любимые треки и собирать свою коллекцию в BetterSoundCloud.</p>
          </div>

          <div className="auth-actions">
            <SilentAuthButton onAuthenticated={onSilentLogin} disabled={busy} />
            {busy && <p className="auth-status" role="status">Проверяем подключение…</p>}
            {error && <div className="auth-error" role="alert">{error}</div>}
          </div>

          <details className="auth-manual">
            <summary>Ввести данные вручную <span className="auth-chevron" aria-hidden="true" /></summary>
            <div className="auth-manual-content">
              <p>Если автоматический вход не сработал, укажите access token и client_id SoundCloud.</p>
              <form className="auth-form" onSubmit={submit}>
                <label className="auth-field" htmlFor="auth-token">Access token</label>
                <div className="auth-input-row">
                  <input id="auth-token" type={showToken ? 'text' : 'password'} value={token} onChange={(event) => setToken(event.target.value)} placeholder="Вставьте access token" autoComplete="off" spellCheck={false} disabled={busy} />
                  <button type="button" className="auth-ghost" aria-pressed={showToken} onClick={() => setShowToken((visible) => !visible)}>{showToken ? 'Скрыть' : 'Показать'}</button>
                </div>
                <label className="auth-field" htmlFor="auth-client-id">Client ID</label>
                <div className="auth-input-row">
                  <input id="auth-client-id" type="text" value={manualClientId} onChange={(event) => setManualClientId(event.target.value)} placeholder="Введите client_id" minLength={8} maxLength={128} pattern="[A-Za-z0-9_-]+" autoComplete="off" spellCheck={false} disabled={busy} required />
                </div>
                <button className="auth-manual-submit" type="submit" disabled={busy || !token.trim() || !manualClientId.trim()}>{busy ? 'Проверяем токен…' : 'Подключить аккаунт'}</button>
              </form>
            </div>
          </details>
        </div>

        <div className="auth-art" aria-hidden="true">
          <div className="auth-art-glow" />
          <div className="auth-record"><div className="auth-record-label"><span>BETTER<br />SOUND<br />CLOUD</span><i /></div></div>
          <div className="auth-art-caption"><span>01 / ВАШ ЗВУК</span><span>ВСЕГДА РЯДОМ ↗</span></div>
        </div>
      </section>
      <p className="auth-footer">BETTERSOUNDCLOUD <span aria-hidden="true">✳</span> СЛУШАЙТЕ ПО-СВОЕМУ</p>
    </main>
  );
}
