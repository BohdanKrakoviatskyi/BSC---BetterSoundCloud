import type { Settings } from '../types';

type Props = {
  settings: Settings;
  saved: boolean;
  error: string;
  onUpdate: (patch: Partial<Settings>) => void;
};

export function SettingsPanel({ settings, saved, error, onUpdate }: Props) {
  return (
    <section className="settings-panel">
      <div className="panel-heading">
        <div>
          <div className="card-kicker">ПЕРСОНАЛИЗАЦИЯ</div>
          <h2>Настройки приложения</h2>
        </div>
        <span className={`save-state ${saved ? 'is-saved' : ''}`}>{saved ? 'Сохранено на устройстве' : 'Сохраняю…'}</span>
      </div>
      <label className="setting-row color-setting">
        <span><strong>Цвет акцента</strong><small>Используется для активных элементов интерфейса</small></span>
        <input aria-label="Цвет акцента" type="color" value={settings.accent} onChange={(event) => onUpdate({ accent: event.target.value })} />
      </label>
      <label className="setting-row">
        <span><strong>Компактный интерфейс</strong><small>Уменьшить расстояния между элементами</small></span>
        <input className="switch" type="checkbox" checked={settings.compact} onChange={(event) => onUpdate({ compact: event.target.checked })} />
      </label>
      <label className="setting-row volume-setting">
        <span><strong>Начальная громкость</strong><small>Сохраняется локально как настройка приложения</small></span>
        <span className="volume-control"><input type="range" min="0" max="100" value={settings.volume} onChange={(event) => onUpdate({ volume: Number(event.target.value) })} /><output>{settings.volume}%</output></span>
      </label>
      {error && <div className="error-message" role="alert">{error}</div>}
    </section>
  );
}
