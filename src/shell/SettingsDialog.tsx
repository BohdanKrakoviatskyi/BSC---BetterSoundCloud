import { useEffect } from 'react';
import { savePreference } from '../app/preferences';
import { useAppStore, type MusicSource, type ThemeMode } from '../app/useAppStore';

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const theme = useAppStore((state) => state.theme);
  const source = useAppStore((state) => state.source);
  const setTheme = useAppStore((state) => state.setTheme);
  const setSource = useAppStore((state) => state.setSource);
  const showError = useAppStore((state) => state.showError);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open, onClose]);

  if (!open) return null;

  const changeTheme = (value: ThemeMode) => {
    setTheme(value);
    void savePreference('theme', value).catch((error: unknown) => showError(String(error)));
  };
  const changeSource = (value: MusicSource) => {
    setSource(value);
    void savePreference('source', value).catch((error: unknown) => showError(String(error)));
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="dialog-heading">
          <div><p className="eyebrow">YOUR EXPERIENCE</p><h2 id="settings-title">Settings</h2></div>
          <button className="icon-button" aria-label="Close settings" onClick={onClose}>x</button>
        </div>
        <label className="setting-row">
          <span><strong>Appearance</strong><small>Choose how Resonance looks</small></span>
          <select value={theme} onChange={(event) => changeTheme(event.target.value as ThemeMode)}>
            <option value="system">System</option><option value="dark">Dark</option><option value="light">Light</option>
          </select>
        </label>
        <label className="setting-row">
          <span><strong>Music source</strong><small>Choose your starting library</small></span>
          <select value={source} onChange={(event) => changeSource(event.target.value as MusicSource)}>
            <option value="local">Local library</option><option value="spotify">Spotify</option><option value="soundcloud">SoundCloud</option>
          </select>
        </label>
        <p className="settings-note">Provider sign-in and library controls will appear here as each source is connected.</p>
      </section>
    </div>
  );
}