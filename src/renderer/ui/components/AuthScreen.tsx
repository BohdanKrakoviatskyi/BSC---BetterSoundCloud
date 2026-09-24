import { useState, type FormEvent } from 'react';

type Props = {
  error: string;
  busy: boolean;
  onLogin: (token: string) => void;
};

export function AuthScreen({ error, busy, onLogin }: Props) {
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
        <h1>Вставьте токен SoundCloud</h1>
        <p className="auth-note">
          Пока OAuth-вход не подключён. Скопируйте access token из запроса к SoundCloud
          (заголовок <code>Authorization: OAuth …</code>), вставьте его сюда — локальный Go backend
          проверит токен, сохранит его только на этом устройстве и не передаст renderer-у.
        </p>
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
