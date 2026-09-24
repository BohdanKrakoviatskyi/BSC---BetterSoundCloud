import { useState, type FormEvent } from 'react';
import type { SoundCloudCredentials } from '../../lib/useSoundCloudAuth';
import { SilentAuthButton } from './SilentAuthButton';

type Props = {
  error: string;
  busy: boolean;
  onLogin: (token: string) => void;
  onSilentLogin: (credentials: SoundCloudCredentials) => void | Promise<void>;
};

export function AuthScreen({ error, busy, onLogin, onSilentLogin }: Props) {
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onLogin(token.trim());
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="brand auth-brand">Better<span>SoundCloud</span></div>
        <div className="eyebrow">ПОДКЛЮЧЕНИЕ АККАУНТА</div>
        <h1>Подключите SoundCloud</h1>
        <p className="auth-note">
          Нажмите кнопку ниже — приложение откроет фоновое окно SoundCloud и заберёт
          access token из вашей сессии. Если вы ещё не вошли, окно покажется,
          чтобы вы ввели логин и пароль.
        </p>
        <SilentAuthButton onAuthenticated={onSilentLogin} disabled={busy} />
        <div className="auth-divider"><span>или вставьте токен вручную</span></div>
        <form className="auth-form" onSubmit={submit}>
          <label className="auth-field">
            <span>Access token</span>
            <div className="auth-input-row">
              <input type={showToken ? 'text' : 'password'} value={token} onChange={(event) => setToken(event.target.value)} placeholder="2-000000-000000000-XXXXXXXXXXXXXXXX" autoComplete="off" spellCheck={false} disabled={busy} autoFocus />
              <button type="button" className="auth-ghost" onClick={() => setShowToken((visible) => !visible)}>{showToken ? 'Скрыть' : 'Показать'}</button>
            </div>
          </label>
          <button className="auth-button" type="submit" disabled={busy || !token.trim()}>{busy ? 'Проверяю токен…' : 'Войти'}</button>
        </form>
        {error && <div className="error-message auth-error" role="alert">{error}</div>}
        <p className="auth-hint">Токен хранится в файле с правами 0600 в папке конфигурации приложения.</p>
      </div>
    </div>
  );
}
