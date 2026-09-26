import { useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type Update } from '@tauri-apps/plugin-updater';

export function UpdaterNotification() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isTauri()) return;

    let active = true;
    void check()
      .then((available) => {
        if (active && available) setUpdate(available);
      })
      .catch((reason: unknown) => {
        console.error('Не удалось проверить обновления:', reason);
      });

    return () => {
      active = false;
    };
  }, []);

  async function installUpdate() {
    if (!update || updating) return;
    setUpdating(true);
    setError('');
    try {
      await update.downloadAndInstall();
      await relaunch();
    } catch (reason) {
      console.error('Не удалось установить обновление:', reason);
      setError('Не удалось установить обновление. Попробуйте ещё раз.');
      setUpdating(false);
    }
  }

  if (!update) return null;

  return (
    <aside
      role="status"
      style={{
        position: 'fixed',
        right: 20,
        bottom: 20,
        zIndex: 1000,
        width: 'min(360px, calc(100vw - 40px))',
        padding: 18,
        border: '1px solid rgba(255,255,255,.14)',
        borderRadius: 14,
        background: '#171a22',
        color: '#fff',
        boxShadow: '0 12px 40px rgba(0,0,0,.35)',
      }}
    >
      <div style={{ marginBottom: 12, fontWeight: 600 }}>Доступно обновление {update.version}</div>
      {error && <div style={{ marginBottom: 12, color: '#ff9a8a', fontSize: 13 }}>{error}</div>}
      <button
        type="button"
        onClick={() => void installUpdate()}
        disabled={updating}
        style={{
          padding: '9px 14px',
          border: 0,
          borderRadius: 8,
          background: '#ff765d',
          color: '#171a22',
          font: 'inherit',
          fontWeight: 600,
          cursor: updating ? 'wait' : 'pointer',
          opacity: updating ? 0.7 : 1,
        }}
      >
        {updating ? 'Установка…' : 'Обновить и перезапустить'}
      </button>
    </aside>
  );
}
