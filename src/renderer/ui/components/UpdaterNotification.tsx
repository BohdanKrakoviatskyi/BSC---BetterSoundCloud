import { useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { FaBell, FaDownload } from '../lib/icons';

export function UpdaterNotification() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [updating, setUpdating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState('');
  const [statusError, setStatusError] = useState(false);
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

  /**
   * Turns a failed updater operation into something worth reading.
   *
   * The plugin reports manifest and transport problems as English sentences, and those were being
   * shown verbatim: "Ошибка проверки: Error: Could not fetch a valid release JSON from the remote".
   * The full text still reaches the console through addLog; this only decides what a person sees.
   *
   * Returns null for anything unrecognised, so an unexpected failure is reported rather than
   * disguised as one of the known ones.
   */
  function describeUpdaterError(reason: unknown): string | null {
    const raw = reason instanceof Error ? reason.message : String(reason);
    const text = raw.toLowerCase();

    // The release has no signed latest.json, or it is not readable. This is the current state of
    // the project: v0.1.17 published without updater artifacts.
    if (text.includes('release json') || text.includes('parse json') || text.includes('invalid json') || text.includes('unexpected token')) {
      return 'Сервер релизов не отдал файл обновления. Обычно релиз собран без подписи — до тех пор обновляться придётся вручную.';
    }
    if (text.includes('signature') || text.includes('public key') || text.includes('verify')) {
      return 'Подпись обновления не прошла проверку, установка отменена.';
    }
    if (text.includes('enotfound') || text.includes('econnrefused') || text.includes('timed out') || text.includes('timeout') || text.includes('network') || text.includes('fetch failed')) {
      return 'Нет связи с сервером обновлений. Проверка повторится позже.';
    }
    if (text.includes('403') || text.includes('404') || text.includes('429') || text.includes('forbidden') || text.includes('not found')) {
      return 'Сервер обновлений сейчас недоступен. Проверка повторится позже.';
    }
    return null;
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

  /**
   * @param byUser true when the person pressed the check button, false for the check that runs on
   *   launch. Only a request the user made is allowed to raise an error in the panel.
   */
  async function checkForUpdate(active = true, byUser = false) {
    if (!isTauri() || checking) return;
    setChecking(true);
    setStatus('Проверяю обновления…');
    setStatusError(false);
    addLog(`Starting updater check()${byUser ? ' (requested by user)' : ' (automatic on launch)'}`);
    try {
      const available = await check();
      if (!active) return;
      setUpdate(available);
      setStatus(available ? `Доступна версия ${available.version}` : 'Установлена последняя версия');
      addLog(available ? `Update found: ${available.version}; date=${available.date ?? 'unknown'}; body=${available.body ?? '(empty)'}` : 'No update available');
    } catch (reason) {
      const detail = formatReason(reason);
      addLog(`Updater check failed: ${detail}`);
      if (!active) return;
      if (byUser) {
        setStatusError(true);
        setStatus(
          describeUpdaterError(reason)
          ?? `Не удалось проверить обновления: ${reason instanceof Error ? reason.message : String(reason)}`,
        );
      } else {
        // The launch check was nobody's request. A server that cannot be reached is not the user's
        // problem to solve here, so the panel stays neutral and the reason is left in the console.
        setStatus('Автопроверка обновлений не удалась');
      }
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
      setStatusError(true);
      setStatus(
        describeUpdaterError(reason)
        ?? `Не удалось установить обновление: ${reason instanceof Error ? reason.message : String(reason)}`,
      );
      setUpdating(false);
    }
  }

  if (!isTauri()) return null;

  return <div className="updater-actions" ref={rootRef}>
    <button className={`icon-button updater-bell${update ? ' has-update' : ''}`} type="button" aria-label="Уведомления об обновлениях" aria-expanded={open} aria-haspopup="dialog" title="Уведомления" onClick={() => setOpen((value) => !value)}>
      <FaBell aria-hidden="true" />
      {update && <i className="updater-badge" aria-label="Доступно обновление" />}
    </button>
    {open && <section className="updater-popover" role="dialog" aria-label="Обновление приложения">
      <div className="updater-popover-title">Обновления</div>
      <p className="updater-current-version">Текущая версия: <strong>{currentVersion}</strong></p>
      <p className={`updater-popover-status${statusError ? ' is-error' : ''}`} aria-live="polite">{status || 'Проверка ещё не выполнена'}</p>
      {update
        ? <button className="updater-button has-update" type="button" onClick={() => void installUpdate()} disabled={updating}>{updating ? 'Установка…' : 'Обновить'}</button>
        : <button className="updater-button updater-check-button" type="button" onClick={() => void checkForUpdate(true, true)} disabled={checking} aria-label={checking ? 'Проверка обновлений' : 'Проверить обновления'} title={checking ? 'Проверка обновлений…' : 'Проверить обновления'}>
            <FaDownload className={checking ? 'is-checking' : ''} aria-hidden="true" />
          </button>}
      {import.meta.env.DEV && <details className="updater-log-details" open>
        <summary>Журнал обновления ({logs.length})</summary>
        <pre className="updater-log" aria-live="polite">{logs.length ? logs.join('\n') : 'Ожидание событий…'}</pre>
      </details>}
    </section>}
  </div>;
}
