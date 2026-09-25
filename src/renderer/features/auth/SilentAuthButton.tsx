import { useSoundCloudAuth, type SoundCloudCredentials } from '../../platform/useSoundCloudAuth';

type Props = {
  /** Called once Rust reports captured credentials. */
  onAuthenticated: (credentials: SoundCloudCredentials) => void | Promise<void>;
  disabled?: boolean;
};

/**
 * Opens the official SoundCloud site in the app's sign-in webview. Captured
 * credentials are verified by the backend before the window closes.
 */
export function SilentAuthButton({ onAuthenticated, disabled = false }: Props) {
  const { starting, error, startAuthFlow } = useSoundCloudAuth({ onCredentials: onAuthenticated });

  return (
    <div className="silent-auth">
      <button className="auth-button" type="button" onClick={() => void startAuthFlow()} disabled={disabled || starting}>
        <span className="auth-cta-icon" aria-hidden="true">♫</span>
        <span>{starting ? 'Открываем SoundCloud…' : 'Войти через SoundCloud'}</span>
        <span className="auth-cta-arrow" aria-hidden="true">↗</span>
      </button>
      <p className="auth-hint">Откроется окно SoundCloud в приложении. Если вы уже вошли, подключение произойдёт автоматически.</p>
      {error && <div className="auth-error" role="alert">{error}</div>}
    </div>
  );
}
