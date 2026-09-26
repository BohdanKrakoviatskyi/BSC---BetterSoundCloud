import { useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type Update } from '@tauri-apps/plugin-updater';

export function UpdaterNotification() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [updating, setUpdating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState('');
  const [currentVersion, setCurrentVersion] = useState('…');
  const [logs, setLogs] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isTauri()) return;

    let active = true;
    addLog('Updater panel mounted; checking current app version');
    void getVersion().then((version) => {
      if (!active) return;
      setCurrentVersion(version);
      addLog(`Current app version: ${version}`);
    }).catch((reason: unknown) => {
      if (active) addLog(`Failed to read current version: ${formatReason(reason)}`);
    });
    void checkForUpdate(active);

    return () => {
      active = false;
    };
  }, []);

  function addLog(message: string) {
    const line = `${new Date().toLocaleTimeString()}  ${message}`;
    console.info(`[updater] ${line}`);
    if (import.meta.env.DEV) setLogs((current) => [...current.slice(-99), line]);
  }

  function formatReason(reason: unknown): string {
    if (reason instanceof Error) return `${reason.name}: ${reason.message}${reason.stack ? `\n${reason.stack}` : ''}`;
    return String(reason);
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  async function checkForUpdate(active = true) {
    if (!isTauri() || checking) return;
    setChecking(true);
    setStatus('Проверяю обновления…');
    addLog('Starting updater check()');
    try {
      const available = await check();
      if (!active) return;
      setUpdate(available);
      setStatus(available ? `Доступна версия ${available.version}` : 'Установлена последняя версия');
      addLog(available ? `Update found: ${available.version}; date=${available.date ?? 'unknown'}; body=${available.body ?? '(empty)'}` : 'No update available');
    } catch (reason) {
      const detail = formatReason(reason);
      addLog(`Updater check failed: ${detail}`);
      if (active) setStatus(`Ошибка проверки: ${reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason)}`);
    } finally {
      if (active) setChecking(false);
    }
  }

  async function installUpdate() {
    if (!update || updating) return;
    setUpdating(true);
    setStatus('Скачиваю и устанавливаю обновление…');
    addLog(`Starting download/install: ${currentVersion} -> ${update.version}`);
    try {
      let contentLength = 0;
      let downloaded = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          contentLength = event.data.contentLength ?? 0;
          addLog(`Download started; contentLength=${contentLength || 'unknown'}`);
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          addLog(`Download progress: ${downloaded}${contentLength ? `/${contentLength} bytes (${Math.round(downloaded / contentLength * 100)}%)` : ' bytes'}`);
        } else {
          addLog('Download finished; installing update');
        }
      });
      setCurrentVersion(update.version);
      setStatus(`Версия ${update.version} установлена; перезапускаю…`);
      addLog(`Update ${update.version} installed; restarting app`);
      await relaunch();
    } catch (reason) {
      const detail = formatReason(reason);
      addLog(`Updater installation failed: ${detail}`);
      setStatus(`Ошибка установки: ${reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason)}`);
      setUpdating(false);
    }
  }

  if (!isTauri()) return null;

  return <div className="updater-actions" ref={rootRef}>
    <button className={`icon-button updater-bell${update ? ' has-update' : ''}`} type="button" aria-label="Уведомления об обновлениях" aria-expanded={open} aria-haspopup="dialog" title="Уведомления" onClick={() => setOpen((value) => !value)}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>
      {update && <i className="updater-badge" aria-label="Доступно обновление" />}
    </button>
    {open && <section className="updater-popover" role="dialog" aria-label="Обновление приложения">
      <div className="updater-popover-title">Обновления</div>
      <p className="updater-current-version">Текущая версия: <strong>{currentVersion}</strong></p>
      <p className={`updater-popover-status${status.startsWith('Ошибка') ? ' is-error' : ''}`} aria-live="polite">{status || 'Проверка ещё не выполнена'}</p>
      {update
        ? <button className="updater-button has-update" type="button" onClick={() => void installUpdate()} disabled={updating}>{updating ? 'Установка…' : 'Обновить'}</button>
        : <button className="updater-button updater-check-button" type="button" onClick={() => void checkForUpdate()} disabled={checking} aria-label={checking ? 'Проверка обновлений' : 'Проверить обновления'} title={checking ? 'Проверка обновлений…' : 'Проверить обновления'}>
            <svg className={checking ? 'is-checking' : ''} viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" /></svg>
          </button>}
      {import.meta.env.DEV && <details className="updater-log-details" open>
        <summary>Журнал обновления ({logs.length})</summary>
        <pre className="updater-log" aria-live="polite">{logs.length ? logs.join('\n') : 'Ожидание событий…'}</pre>
      </details>}
    </section>}
  </div>;
}
