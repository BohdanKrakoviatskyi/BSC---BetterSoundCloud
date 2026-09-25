import { useEffect, useState, type FormEvent } from 'react';
import type { Profile, Settings } from '../../app/types';
import { ConfirmDialog } from '../../shared/components/ConfirmDialog';
import './SettingsPanel.css';

type Props = {
  settings: Settings;
  saved: boolean;
  error: string;
  onUpdate: (patch: Partial<Settings>) => void;
  profile: Profile | null;
  tokenError: string;
  tokenBusy: boolean;
  onSaveToken: (token: string) => Promise<boolean>;
  onClearData: () => Promise<boolean>;
};

export function SettingsPanel({ settings, saved, error, profile, tokenError, tokenBusy, onUpdate, onSaveToken, onClearData }: Props) {
  const [clientId, setClientId] = useState(settings.clientId);
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);

  useEffect(() => {
    setClientId(settings.clientId);
  }, [settings.clientId]);

  async function submitToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token.trim()) return;
    const saved = await onSaveToken(token.trim());
    if (saved) {
      setToken('');
      setShowToken(false);
    }
  }

  async function confirmClearData() {
    setClearBusy(true);
    try {
      const cleared = await onClearData();
      if (cleared) {
        setToken('');
        setShowToken(false);
        setClearDialogOpen(false);
      }
    } finally {
      setClearBusy(false);
    }
  }

  return (
    <section className="page-content settings-page">
      <header className="page-heading settings-hero">
        <div className="settings-hero-copy">
          <span className="eyebrow">ПРОСТРАНСТВО ПОД ТЕБЯ</span>
          <h1>Настройки</h1>
          <p>Настрой звучание и атмосферу. Остальное оставь музыке.</p>
        </div>
        <span className={`save-state ${error ? 'has-error' : saved ? 'is-saved' : 'is-saving'}`} role="status" aria-live="polite">
          {error ? 'Ошибка сохранения' : saved ? 'Сохранено на устройстве' : 'Сохраняю…'}
        </span>
      </header>

      <div className="settings-layout">
        <section className="settings-card settings-personalization" aria-labelledby="personalization-title">
          <div className="settings-card-heading">
            <span className="settings-card-icon" aria-hidden="true">✦</span>
            <div>
              <span className="eyebrow">ТВОЙ СТИЛЬ</span>
              <h2 id="personalization-title">Персонализация</h2>
              <p>Маленькие детали, которые делают приложение твоим.</p>
            </div>
          </div>
          <div className="settings-options">
            <label className="setting-row color-setting">
              <span><b>Цвет акцента</b><small>Цвет активных элементов интерфейса</small></span>
              <input aria-label="Цвет акцента" type="color" value={settings.accent} onChange={(event) => onUpdate({ accent: event.target.value })} />
            </label>
            <label className="setting-row compact-setting">
              <span><b>Компактный интерфейс</b><small>Больше музыки на одном экране</small></span>
              <span className="switch"><input type="checkbox" checked={settings.compact} onChange={(event) => onUpdate({ compact: event.target.checked })} /><i /></span>
            </label>
            <label className="setting-row volume-setting">
              <span><b>Начальная громкость</b><small>Сохраняется локально для следующего запуска</small></span>
              <span className="volume-control"><input aria-label="Начальная громкость" type="range" min="0" max="100" value={settings.volume} onChange={(event) => onUpdate({ volume: Number(event.target.value) })} /><output>{settings.volume}%</output></span>
            </label>
          </div>
        </section>

        <section className="settings-card settings-credentials" aria-labelledby="credentials-title">
          <div className="settings-card-heading credentials-heading">
            <span className="settings-card-icon" aria-hidden="true">↗</span>
            <div>
              <span className="eyebrow">SOUNDCLOUD API</span>
              <h2 id="credentials-title">Подключение</h2>
              <p>Два ключа к твоей музыке: Client ID и access token.</p>
            </div>
          </div>
          <div className={`connection-status ${profile ? 'is-connected' : ''}`} role="status" aria-live="polite">
            <span className="connection-dot" aria-hidden="true" />
            <span>{tokenBusy ? 'Проверяем подключение…' : profile ? `Подключён аккаунт @${profile.username}` : 'Аккаунт не подключён'}</span>
          </div>
          <form className="credential-form" onSubmit={(event) => void submitToken(event)}>
            <div className="credential-group">
              <label className="credential-field" htmlFor="settings-client-id">
                <span>Client ID</span><small>Публичный идентификатор приложения</small>
              </label>
              <input id="settings-client-id" className="credential-input" value={clientId} minLength={8} maxLength={128} pattern="[A-Za-z0-9_-]+" autoComplete="off" spellCheck={false} onChange={(event) => setClientId(event.currentTarget.value)} placeholder="Введи client_id" />
              <div className="credential-actions">
                <span className={`field-status ${clientId !== settings.clientId ? 'is-pending' : ''}`}>{clientId !== settings.clientId ? 'Есть несохранённые изменения' : settings.clientId ? 'Client ID сохранён' : 'Client ID не задан'}</span>
                <button className="outline-button" type="button" disabled={clientId === settings.clientId} onClick={() => onUpdate({ clientId })}>Сохранить ID</button>
              </div>
            </div>
            <div className="credential-group token-group">
              <label className="credential-field" htmlFor="settings-access-token">
                <span>Access token</span><small>{profile ? 'Введи новый токен, чтобы заменить текущий.' : 'Проверяется и хранится локальным backend.'}</small>
              </label>
              <div className="token-input-wrap">
                <input id="settings-access-token" className="credential-input" type={showToken ? 'text' : 'password'} value={token} onChange={(event) => setToken(event.currentTarget.value)} autoComplete="new-password" spellCheck={false} placeholder="Вставь access token" />
                <button className="token-visibility" type="button" aria-label={showToken ? 'Скрыть access token' : 'Показать access token'} aria-pressed={showToken} onClick={() => setShowToken((visible) => !visible)}>{showToken ? 'Скрыть' : 'Показать'}</button>
              </div>
              {tokenError && <div className="error-message" role="alert">{tokenError}</div>}
              <div className="credential-actions"><button className="primary-button" type="submit" disabled={!token.trim() || tokenBusy}>{tokenBusy ? 'Проверяю токен…' : 'Проверить и сохранить'}</button></div>
            </div>
          </form>
          <p className="credential-security">Токен не попадает в настройки интерфейса: Go проверяет его и хранит отдельно в локальном защищённом файле.</p>
        </section>

        <section className="settings-card settings-danger-zone" aria-labelledby="clear-data-heading">
          <div>
            <span className="eyebrow">УПРАВЛЕНИЕ ДАННЫМИ</span>
            <h2 id="clear-data-heading">Начать с чистого листа</h2>
            <p>Удалить сохранённый токен, Client ID и сбросить настройки приложения.</p>
          </div>
          <button className="danger-button" type="button" onClick={() => setClearDialogOpen(true)}>Очистить данные</button>
        </section>
      </div>
      {error && !clearDialogOpen && <div className="error-message settings-page-error" role="alert">{error}</div>}
      {clearDialogOpen && <ConfirmDialog
        eyebrow="СБРОС ПРИЛОЖЕНИЯ"
        title="Очистить все данные?"
        description="Сохранённый токен будет удалён, а Client ID и настройки сбросятся к значениям по умолчанию. Приложение выйдет из аккаунта SoundCloud. Это действие нельзя отменить."
        confirmLabel="Да, очистить"
        busyLabel="Очищаю…"
        busy={clearBusy}
        variant="danger"
        onClose={() => setClearDialogOpen(false)}
        onConfirm={() => void confirmClearData()}
      >
        {error && <div className="error-message" role="alert">{error}</div>}
      </ConfirmDialog>}
    </section>
  );
}
