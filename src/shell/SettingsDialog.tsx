import { useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { commands, type ProviderAuthEvent } from '../app/commands';
import { readSpotifyClientId, savePreference, saveSpotifyClientId } from '../app/preferences';
import { useAppStore, type MusicSource, type ThemeMode } from '../app/useAppStore';

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const theme = useAppStore((state) => state.theme);
  const source = useAppStore((state) => state.source);
  const setTheme = useAppStore((state) => state.setTheme);
  const setSource = useAppStore((state) => state.setSource);
  const showError = useAppStore((state) => state.showError);
  const [spotifyClientId, setSpotifyClientId] = useState('');
  const [spotifyConnected, setSpotifyConnected] = useState(false);
  const [spotifyBusy, setSpotifyBusy] = useState(false);
  const [spotifyMessage, setSpotifyMessage] = useState('');

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    void readSpotifyClientId().then((clientId) => { if (active) setSpotifyClientId(clientId); });
    if (!isTauri()) return () => { active = false; };
    void commands.spotifySessionStatus().then((connected) => { if (active) setSpotifyConnected(connected); });
    void listen<ProviderAuthEvent>('provider-auth-status', ({ payload }) => {
      if (payload.provider !== 'spotify') return;
      setSpotifyBusy(false);
      setSpotifyConnected(payload.connected);
      setSpotifyMessage(payload.message);
    }).then((stop) => { unlisten = stop; });
    return () => { active = false; unlisten?.(); };
  }, [open]);

  if (!open) return null;

  const changeTheme = (value: ThemeMode) => {
    setTheme(value);
    void savePreference('theme', value).catch((error: unknown) => showError(String(error)));
  };
  const changeSource = (value: MusicSource) => {
    setSource(value);
    void savePreference('source', value).catch((error: unknown) => showError(String(error)));
  };

  const connectSpotify = async () => {
    const clientId = spotifyClientId.trim();
    if (!clientId) {
      setSpotifyMessage('Enter your Spotify developer app Client ID first.');
      return;
    }
    setSpotifyBusy(true);
    setSpotifyMessage('Opening Spotify sign-in…');
    try {
      await saveSpotifyClientId(clientId);
      await commands.spotifyBeginLibraryLogin(clientId);
    } catch (error) {
      setSpotifyBusy(false);
      setSpotifyMessage(String(error));
      showError(String(error));
    }
  };

  const disconnectSpotify = async () => {
    try {
      await commands.spotifyLogout();
      setSpotifyConnected(false);
      setSpotifyMessage('Spotify library disconnected.');
    } catch (error) {
      showError(String(error));
    }
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
        {source === 'spotify' && <section className="provider-settings" aria-label="Spotify library connection">
          <div><p className="eyebrow">SPOTIFY LIBRARY</p><h3>{spotifyConnected ? 'Connected' : 'Connect your account'}</h3></div>
          <label className="provider-client-id"><span>Developer app Client ID</span><input value={spotifyClientId} onChange={(event) => setSpotifyClientId(event.target.value)} autoComplete="off" spellCheck={false} /></label>
          <p className="settings-note">Create a Spotify developer app and add <code>http://127.0.0.1:8898/login</code> to its redirect URLs.</p>
          <div className="provider-actions"><button className="primary-button" onClick={() => void connectSpotify()} disabled={spotifyBusy || !isTauri()}>{spotifyBusy ? 'Waiting for Spotify…' : 'Connect Spotify'}</button>
            {spotifyConnected && <button className="text-button" onClick={() => void disconnectSpotify()}>Disconnect</button>}</div>
          {spotifyMessage && <p role="status" className="provider-status">{spotifyMessage}</p>}
        </section>}
        {source === 'soundcloud' && <p className="settings-note">SoundCloud connection will be available after its native account and stream flow is integrated.</p>}
      </section>
    </div>
  );
}
