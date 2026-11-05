import { isTauri } from '@tauri-apps/api/core';
import { register, unregister } from '@tauri-apps/plugin-global-shortcut';
import { currentTrack, next, prev, seekBy, toggle, toggleMute } from './player';
import { toggleLike } from './library';
import { go, setImmersive, ui } from './ui';
import {
  DEFAULT_SHORTCUTS,
  SHORTCUTS,
  normalizeShortcut,
  shortcuts,
  type ShortcutId,
} from './shortcuts';

let globalRegistered: string | null = null;
let runtimeStarted = false;
let registrationQueue = Promise.resolve();

export function dispatchShortcut(id: ShortcutId) {
  switch (id) {
    case 'playPause':
      toggle();
      break;
    case 'seekBack':
      seekBy(-5);
      break;
    case 'seekForward':
      seekBy(5);
      break;
    case 'previous':
      prev();
      break;
    case 'next':
      next();
      break;
    case 'like': {
      const track = currentTrack();
      if (track) toggleLike(track.id);
      break;
    }
    case 'lyrics':
      if (currentTrack()) setImmersive(!ui.get().immersive);
      break;
    case 'search':
      setImmersive(false);
      go({ name: 'search', q: '' });
      break;
    case 'mute':
      toggleMute();
      break;
  }
}

function registerGlobal(binding: string): Promise<void> {
  return register(toNativeShortcut(binding), (event) => {
    if (event.state === 'Pressed' && shortcuts.get().recording === null) dispatchShortcut('mute');
  });
}

export function initializeShortcutRuntime() {
  if (runtimeStarted) return;
  runtimeStarted = true;
  if (!isTauri()) return;

  const binding = shortcuts.get().bindings.mute;
  registrationQueue = registrationQueue.catch(() => undefined).then(async () => {
    try {
      await registerGlobal(binding);
      globalRegistered = binding;
      shortcuts.set({ error: null });
    } catch (error) {
      shortcuts.set({ error: errorMessage(error) });
    }
  });
}

export function updateShortcut(id: ShortcutId, binding: string): Promise<boolean> {
  const nextBinding = normalizeShortcut(binding);
  const bindings = shortcuts.get().bindings;
  const duplicate = SHORTCUTS.find(
    (shortcut) => shortcut.id !== id && normalizeShortcut(bindings[shortcut.id]) === nextBinding,
  );
  if (duplicate) {
    shortcuts.set({ error: 'duplicate' });
    return Promise.resolve(false);
  }

  if (id !== 'mute' || !isTauri()) {
    shortcuts.set({ bindings: { ...bindings, [id]: nextBinding }, error: null });
    return Promise.resolve(true);
  }

  registrationQueue = registrationQueue.catch(() => undefined).then(async () => {
    if (globalRegistered === nextBinding) {
      shortcuts.set({ bindings: { ...shortcuts.get().bindings, mute: nextBinding }, error: null });
      return;
    }

    const previous = globalRegistered;
    try {
      await registerGlobal(nextBinding);
      if (previous) {
        try {
          await unregister(toNativeShortcut(previous));
        } catch (error) {
          await unregister(toNativeShortcut(nextBinding)).catch(() => undefined);
          throw error;
        }
      }
      globalRegistered = nextBinding;
      shortcuts.set({ bindings: { ...shortcuts.get().bindings, mute: nextBinding }, error: null });
    } catch (error) {
      shortcuts.set({ error: errorMessage(error) });
      throw error;
    }
  });

  return registrationQueue.then(() => true, () => false);
}

export function restoreDefaultShortcut(id: ShortcutId): Promise<boolean> {
  return updateShortcut(id, DEFAULT_SHORTCUTS[id]);
}

export function handleWindowShortcut(event: KeyboardEvent) {
  if (shortcuts.get().recording) return;
  const target = event.target;
  if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]')) return;

  const normalizedEvent = eventShortcut(event);
  if (!normalizedEvent) return;
  const action = SHORTCUTS.find(
    ({ id, scope }) => scope === 'window' && normalizeShortcut(shortcuts.get().bindings[id]) === normalizedEvent,
  );
  if (!action) return;

  if (action.id === 'playPause' && target instanceof HTMLElement && target.closest('button, [role=slider]')) return;
  event.preventDefault();
  dispatchShortcut(action.id);
}

function eventShortcut(event: KeyboardEvent): string | null {
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return null;
  const key = event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  const modifiers: string[] = [];
  if (event.ctrlKey) modifiers.push('Ctrl');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey && event.key !== '/') modifiers.push('Shift');
  if (event.metaKey) modifiers.push('Meta');
  return normalizeShortcut([...modifiers, key].join('+'));
}

function toNativeShortcut(binding: string): string {
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  return normalizeShortcut(binding).split('+').map((part) => {
    if (part === 'Ctrl') return 'Control';
    if (part === 'Meta') return isMac ? 'CommandOrControl' : 'Super';
    return part;
  }).join('+');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
