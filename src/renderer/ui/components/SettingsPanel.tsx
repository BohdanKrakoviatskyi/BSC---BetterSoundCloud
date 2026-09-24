import { useState, type FormEvent } from 'react';
import type { Settings } from '../types';
import type { Profile } from '../types';
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

  async function submitToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token.trim()) return;
    const saved = await onSaveToken(token.trim());
    if (saved) setToken('');
  }

  async function confirmClearData() {
    setClearBusy(true);
    const cleared = await onClearData();
    setClearBusy(false);
    if (cleared) setClearDialogOpen(false);
  }

  return (
    <section className="page-content settings-page">
      <div className="page-heading"><span className="eyebrow">ТВОЁ ПРИЛОЖЕНИЕ</span><div className="heading-line"><h1>Настройки</h1><span className={`save-state ${saved ? 'is-saved' : ''}`}>{saved ? 'Сохранено на устройстве' : 'Сохраняю…'}</span></div><p>Персонализируй внешний вид и звучание.</p></div>
      <div className="settings-layout"><nav className="settings-nav" aria-label="Настройки"><button className="settings-tab selected" type="button">Внешний вид</button><button className="settings-tab" type="button" disabled>Воспроизведение</button><button className="settings-tab" type="button" disabled>Аккаунт</button></nav>
      <div className="settings-body"><h2>Персонализация</h2>
      <label className="setting-row color-setting">
        <span><b>Цвет акцента</b><small>Цвет активных элементов интерфейса</small></span>
        <input aria-label="Цвет акцента" type="color" value={settings.accent} onChange={(event) => onUpdate({ accent: event.target.value })} />
      </label>
      <label className="setting-row">
        <span><b>Компактный интерфейс</b><small>Уменьшить расстояния между элементами</small></span>
        <span className="switch"><input type="checkbox" checked={settings.compact} onChange={(event) => onUpdate({ compact: event.target.checked })} /><i /></span>
      </label>
      <label className="setting-row volume-setting">
        <span><b>Начальная громкость</b><small>Сохраняется локально как настройка приложения</small></span>
        <span className="volume-control"><input type="range" min="0" max="100" value={settings.volume} onChange={(event) => onUpdate({ volume: Number(event.target.value) })} /><output>{settings.volume}%</output></span>
      </label>
      <div className="settings-credentials">
        <div className="credentials-heading"><span className="eyebrow">SOUNDCLOUD API</span><h2>Подключение SoundCloud</h2><p>Для запросов нужны публичный Client ID и access token твоего аккаунта.</p></div>
        <form className="credential-form" onSubmit={(event) => void submitToken(event)}>
          <label className="credential-field"><span>Client ID <small>Публичный идентификатор приложения</small></span><input value={clientId} minLength={8} maxLength={128} pattern="[A-Za-z0-9_-]+" autoComplete="off" spellCheck={false} onChange={(event) => setClientId(event.currentTarget.value)} placeholder="Введи client_id" /></label>
          <div className="credential-actions"><button className="outline-button" type="button" disabled={clientId === settings.clientId} onClick={() => onUpdate({ clientId })}>Сохранить Client ID</button></div>
          <label className="credential-field"><span>Access token <small>{profile ? `Подключён аккаунт @${profile.username}. Введи новый токен для замены.` : 'Токен проверяется и хранится локальным backend.'}</small></span><span className="token-input-wrap"><input type={showToken ? 'text' : 'password'} value={token} onChange={(event) => setToken(event.currentTarget.value)} autoComplete="new-password" spellCheck={false} placeholder="Вставь access token" /><button className="token-visibility" type="button" onClick={() => setShowToken((visible) => !visible)}>{showToken ? 'Скрыть' : 'Показать'}</button></span></label>
          {tokenError && <div className="error-message" role="alert">{tokenError}</div>}
          <div className="credential-actions"><button className="primary-button" type="submit" disabled={!token.trim() || tokenBusy}>{tokenBusy ? 'Проверяю токен…' : 'Проверить и сохранить токен'}</button></div>
          <p className="credential-security">Токен не попадает в настройки интерфейса: Go проверяет его и хранит отдельно в локальном защищённом файле.</p>
        </form>
      </div>
      <div className="settings-danger-zone">
        <div><b>Очистить данные приложения</b><p>Удалить сохранённый токен, Client ID и сбросить настройки.</p></div>
        <button className="danger-button" type="button" onClick={() => setClearDialogOpen(true)}>Очистить данные</button>
      </div>
      {error && <div className="error-message" role="alert">{error}</div>}
      </div></div>
      {clearDialogOpen && <div className="clear-data-modal-layer" onMouseDown={(event) => { if (event.target === event.currentTarget && !clearBusy) setClearDialogOpen(false); }}>
        <section className="clear-data-modal panel" role="alertdialog" aria-modal="true" aria-labelledby="clear-data-title" aria-describedby="clear-data-description">
          <span className="eyebrow">СБРОС ПРИЛОЖЕНИЯ</span>
          <h2 id="clear-data-title">Очистить все данные?</h2>
          <p id="clear-data-description">Сохранённый токен будет удалён, а Client ID и настройки сбросятся к значениям по умолчанию. Приложение выйдет из аккаунта SoundCloud. Это действие нельзя отменить.</p>
          {error && <div className="error-message" role="alert">{error}</div>}
          <div className="clear-data-actions">
            <button className="outline-button" type="button" disabled={clearBusy} onClick={() => setClearDialogOpen(false)}>Отмена</button>
            <button className="danger-button" type="button" disabled={clearBusy} onClick={() => void confirmClearData()}>{clearBusy ? 'Очищаю…' : 'Да, очистить'}</button>
          </div>
        </section>
      </div>}
    </section>
  );
}
