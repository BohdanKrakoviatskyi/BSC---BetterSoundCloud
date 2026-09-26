import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import type { Profile, Settings } from '../types';
import { ConfirmDialog } from './ConfirmDialog';
import { ErrorMessage } from './ErrorMessage';
import { createUserBackgroundPreset, deleteUserBackgroundPreset, loadUserBackgroundPresets, type UserBackgroundPreset } from '../lib/backgroundPresets';
import './SettingsPanel.css';

const MAX_BACKGROUND_DATA_URL_LENGTH = 700_000;
const MAX_BACKGROUND_FILE_SIZE = 25 * 1024 * 1024;
const BACKGROUND_PRESETS = [
  { name: 'Синий нуар', fileName: '025bef26455d0dd81b480740debab6aa.jpg' },
  { name: 'Ночной пейзаж', fileName: '24a15fa7c44039c32c08754e5f88b0ad.jpg' },
  { name: 'Lovers Rock', fileName: 'ddf5ad34da8ad9ac8cd399c48cd418f2.jpg' },
  { name: 'Дождливый город', fileName: 'kira.jpg' },
  { name: 'Blue hour', fileName: 'sigara.jpg' },
  { name: 'Красное яблоко', fileName: 'сау.jpg' },
] as const;

async function encodeBackgroundImage(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Выбери изображение в формате JPEG, PNG или WebP.');
  }
  if (file.size > MAX_BACKGROUND_FILE_SIZE) {
    throw new Error('Размер исходного изображения не должен превышать 25 МБ.');
  }

  const image = await createImageBitmap(file);
  try {
    let scale = Math.min(1, 1920 / image.width, 1080 / image.height);
    for (let attempt = 0; attempt < 9; attempt += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Не удалось обработать изображение.');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      if (dataUrl.length <= MAX_BACKGROUND_DATA_URL_LENGTH) return dataUrl;
      scale *= 0.78;
    }
  } finally {
    image.close();
  }

  throw new Error('Не удалось уменьшить изображение до допустимого размера.');
}

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
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  const [backgroundError, setBackgroundError] = useState('');
  const [userBackgroundPresets, setUserBackgroundPresets] = useState<UserBackgroundPreset[]>([]);
  const [backgroundPresetName, setBackgroundPresetName] = useState('');

  useEffect(() => {
    setClientId(settings.clientId);
  }, [settings.clientId]);

  useEffect(() => {
    let active = true;
    void loadUserBackgroundPresets()
      .then((presets) => { if (active) setUserBackgroundPresets(presets); })
      .catch((reason: unknown) => { if (active) setBackgroundError(reason instanceof Error ? reason.message : 'Не удалось загрузить сохранённые пресеты.'); });
    return () => { active = false; };
  }, []);

  async function submitToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token.trim()) return;
    const saved = await onSaveToken(token.trim());
    if (saved) {
      setToken('');
      setShowToken(false);
    }
  }

  async function selectBackground(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;

    setBackgroundBusy(true);
    setBackgroundError('');
    try {
      const backgroundImage = await encodeBackgroundImage(file);
      onUpdate({ backgroundImage });
    } catch (reason) {
      setBackgroundError(reason instanceof Error ? reason.message : 'Не удалось загрузить изображение.');
    } finally {
      setBackgroundBusy(false);
    }
  }

  async function selectBackgroundPreset(fileName: string) {
    setBackgroundBusy(true);
    setBackgroundError('');
    try {
      const presetUrl = `${import.meta.env.BASE_URL}${encodeURIComponent(fileName)}`;
      const response = await fetch(presetUrl);
      if (!response.ok) throw new Error('Не удалось загрузить выбранный пресет.');
      const file = new File([await response.blob()], fileName, { type: 'image/jpeg' });
      const backgroundImage = await encodeBackgroundImage(file);
      onUpdate({ backgroundImage });
    } catch (reason) {
      setBackgroundError(reason instanceof Error ? reason.message : 'Не удалось применить пресет.');
    } finally {
      setBackgroundBusy(false);
    }
  }

  async function saveBackgroundPreset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings.backgroundImage) return;

    setBackgroundBusy(true);
    setBackgroundError('');
    try {
      const preset = await createUserBackgroundPreset(backgroundPresetName, settings.backgroundImage);
      setUserBackgroundPresets((current) => [preset, ...current]);
      setBackgroundPresetName('');
    } catch (reason) {
      setBackgroundError(reason instanceof Error ? reason.message : 'Не удалось сохранить пресет.');
    } finally {
      setBackgroundBusy(false);
    }
  }

  async function removeBackgroundPreset(preset: UserBackgroundPreset) {
    setBackgroundBusy(true);
    setBackgroundError('');
    try {
      await deleteUserBackgroundPreset(preset.id);
      setUserBackgroundPresets((current) => current.filter(({ id }) => id !== preset.id));
    } catch (reason) {
      setBackgroundError(reason instanceof Error ? reason.message : 'Не удалось удалить пресет.');
    } finally {
      setBackgroundBusy(false);
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
        <section className="settings-card settings-appearance" aria-labelledby="personalization-title">
          <div className="settings-card-heading">
            <span className="settings-card-icon" aria-hidden="true">✦</span>
            <div>
              <span className="eyebrow">ТВОЙ СТИЛЬ</span>
              <h2 id="personalization-title">Интерфейс</h2>
              <p>Цвет и плотность элементов.</p>
            </div>
            <button className="settings-reset-button" type="button" disabled={backgroundBusy} onClick={() => { setBackgroundError(''); onUpdate({ accent: '#ff765d', compact: false, backgroundImage: '', backgroundBlur: 0 }); }}>
              Сбросить оформление
            </button>
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

        <section className="settings-card settings-background" aria-labelledby="background-title">
          <div className="settings-card-heading">
            <span className="settings-card-icon" aria-hidden="true">▧</span>
            <div>
              <span className="eyebrow">АТМОСФЕРА</span>
              <h2 id="background-title">Фон приложения</h2>
              <p>Выбери изображение и настрой его отображение.</p>
            </div>
          </div>
          <div className="settings-options settings-background-options">
            <div className="setting-row background-image-setting">
              <span><b>Фоновое изображение</b><small>Появится во всём приложении, кроме боковой панели</small></span>
              <label className="background-upload-button">
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void selectBackground(event)} disabled={backgroundBusy} />
                <span>{backgroundBusy ? 'Обрабатываю…' : settings.backgroundImage ? 'Заменить' : 'Выбрать фото'}</span>
              </label>
            </div>
            <div className="background-presets">
              <div className="background-presets-heading"><b>Готовые фоны</b><small>Нажми на фото, чтобы применить</small></div>
              <div className="background-preset-grid">
                {BACKGROUND_PRESETS.map((preset) => (
                  <button className="background-preset" type="button" key={preset.fileName} disabled={backgroundBusy} aria-label={`Установить фон: ${preset.name}`} onClick={() => void selectBackgroundPreset(preset.fileName)}>
                    <img src={`${import.meta.env.BASE_URL}${encodeURIComponent(preset.fileName)}`} alt="" loading="lazy" />
                    <span>{preset.name}</span>
                  </button>
                ))}
              </div>
            </div>
            {userBackgroundPresets.length > 0 && <div className="background-user-presets">
              <div className="background-presets-heading"><b>Мои пресеты</b><small>{userBackgroundPresets.length}</small></div>
              <div className="background-preset-grid">
                {userBackgroundPresets.map((preset) => (
                  <div className="background-preset-card" key={preset.id}>
                    <button className="background-preset" type="button" disabled={backgroundBusy} aria-label={`Применить пресет: ${preset.name}`} onClick={() => onUpdate({ backgroundImage: preset.image })}>
                      <img src={preset.image} alt="" loading="lazy" />
                      <span>{preset.name}</span>
                    </button>
                    <button className="background-preset-delete" type="button" disabled={backgroundBusy} aria-label={`Удалить пресет: ${preset.name}`} title="Удалить пресет" onClick={() => void removeBackgroundPreset(preset)}>×</button>
                  </div>
                ))}
              </div>
            </div>}
            {backgroundError && <p className="background-image-error" role="alert">{backgroundError}</p>}
            {settings.backgroundImage && <>
              <div className="background-preview-row">
                <div className="background-preview" aria-label="Предпросмотр текущего фона">
                  <span style={{ backgroundImage: `url("${settings.backgroundImage}")`, filter: `blur(${settings.backgroundBlur}px)` }} />
                </div>
                <button className="text-action background-remove-button" type="button" onClick={() => { setBackgroundError(''); onUpdate({ backgroundImage: '', backgroundBlur: 0 }); }}>Убрать фон</button>
              </div>
              <form className="background-save-preset" onSubmit={(event) => void saveBackgroundPreset(event)}>
                <input aria-label="Название нового пресета" value={backgroundPresetName} onChange={(event) => setBackgroundPresetName(event.currentTarget.value)} maxLength={32} placeholder="Название пресета" disabled={backgroundBusy} required />
                <button type="submit" disabled={backgroundBusy || !backgroundPresetName.trim()}>{backgroundBusy ? 'Сохраняю…' : 'Сохранить пресет'}</button>
              </form>
            </>}
            <label className="setting-row background-blur-setting">
              <span><b>Размытие фона</b><small>Применяется только к загруженному изображению</small></span>
              <span className="background-blur-control"><input aria-label="Размытие фонового изображения" type="range" min="0" max="24" step="1" value={settings.backgroundBlur} disabled={!settings.backgroundImage} onChange={(event) => onUpdate({ backgroundBlur: Number(event.currentTarget.value) })} /><output>{settings.backgroundBlur}px</output></span>
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
              {tokenError && <ErrorMessage message={tokenError} />}
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
      {error && !clearDialogOpen && <ErrorMessage message={error} className="settings-page-error" />}
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
        {error && <ErrorMessage message={error} />}
      </ConfirmDialog>}
    </section>
  );
}
