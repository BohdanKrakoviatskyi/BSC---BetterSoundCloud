import { useSoundCloudAuth, type SoundCloudCredentials } from '../../lib/useSoundCloudAuth';

type Props = {
  /** Called once Rust reports captured credentials. */
  onAuthenticated: (credentials: SoundCloudCredentials) => void | Promise<void>;
  disabled?: boolean;
};

/**
 * Button + subscription for silent SoundCloud authentication.
 *
 * Clicking the button asks Rust to open a hidden `soundcloud-auth` webview.
 * The injected script grabs `client_id`/`oauth_token` and emits an event that
 * this hook turns into `onAuthenticated(credentials)`.
 */
export function SilentAuthButton({ onAuthenticated, disabled = false }: Props) {
  const { starting, error, startAuthFlow } = useSoundCloudAuth({ onCredentials: onAuthenticated });

  return (
    <div className="silent-auth">
      <button className="auth-button" type="button" onClick={() => void startAuthFlow()} disabled={disabled || starting}>
        {starting ? 'Открываю SoundCloud…' : 'Войти через SoundCloud'}
      </button>
      <p className="auth-hint">
        Откроется фоновое окно SoundCloud. Если вы уже вошли в аккаунт, приложение получит токен автоматически.
      </p>
      {error && <div className="error-message auth-error" role="alert">{error}</div>}
    </div>
  );
}
