import { createStore } from '../lib/util';
import type { Key } from '../lib/i18n';

export type ShortcutId = 'playPause' | 'seekBack' | 'seekForward' | 'previous' | 'next' | 'like' | 'lyrics' | 'search' | 'mute';
export type ShortcutScope = 'window' | 'global';

export interface ShortcutDefinition {
  id: ShortcutId;
  label: Key;
  scope: ShortcutScope;
  defaultBinding: string;
}

export const SHORTCUTS: ShortcutDefinition[] = [
  { id: 'playPause', label: 'kbPlay', scope: 'window', defaultBinding: 'Space' },
  { id: 'seekBack', label: 'kbSeekBack', scope: 'window', defaultBinding: 'ArrowLeft' },
  { id: 'seekForward', label: 'kbSeekForward', scope: 'window', defaultBinding: 'ArrowRight' },
  { id: 'previous', label: 'kbPrevious', scope: 'window', defaultBinding: 'Shift+ArrowLeft' },
  { id: 'next', label: 'kbNext', scope: 'window', defaultBinding: 'Shift+ArrowRight' },
  { id: 'like', label: 'kbLike', scope: 'window', defaultBinding: 'L' },
  { id: 'lyrics', label: 'kbLyrics', scope: 'window', defaultBinding: 'F' },
  { id: 'search', label: 'kbSearch', scope: 'window', defaultBinding: '/' },
  { id: 'mute', label: 'kbMute', scope: 'global', defaultBinding: 'Shift+M' },
];

export type ShortcutBindings = Record<ShortcutId, string>;

export const DEFAULT_SHORTCUTS = Object.fromEntries(
  SHORTCUTS.map(({ id, defaultBinding }) => [id, defaultBinding]),
) as ShortcutBindings;

interface ShortcutState {
  bindings: ShortcutBindings;
  recording: ShortcutId | null;
  error: string | null;
}

const STORAGE_KEY = 'resonance.shortcuts.v1';

function loadBindings(): ShortcutBindings {
  const bindings = { ...DEFAULT_SHORTCUTS };
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (stored && typeof stored === 'object') {
      for (const { id } of SHORTCUTS) {
        const value = (stored as Record<string, unknown>)[id];
        if (typeof value === 'string' && isValidShortcut(value)) bindings[id] = value;
      }
    }
  } catch {
    // Ignore unavailable or malformed local storage and use defaults.
  }
  return bindings;
}

export const shortcuts = createStore<ShortcutState>({
  bindings: loadBindings(),
  recording: null,
  error: null,
});

let lastSavedBindings = shortcuts.get().bindings;
shortcuts.subscribe(() => {
  const { bindings } = shortcuts.get();
  if (bindings === lastSavedBindings) return;
  lastSavedBindings = bindings;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
  } catch {
    if (shortcuts.get().error !== 'storage') shortcuts.set({ error: 'storage' });
  }
});

export function isValidShortcut(value: string): boolean {
  const parts = normalizeShortcut(value).split('+');
  if (parts.length < 1 || parts.some((part) => !part.trim())) return false;
  const modifiers = new Set(['Ctrl', 'Alt', 'Shift', 'Meta']);
  const key = parts[parts.length - 1];
  const usedModifiers = parts.slice(0, -1);
  return !modifiers.has(key)
    && usedModifiers.every((part) => modifiers.has(part))
    && new Set(usedModifiers).size === usedModifiers.length;
}

export function shortcutForEvent(event: KeyboardEvent): string | null {
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return null;
  const key = event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  const modifiers: string[] = [];
  if (event.ctrlKey) modifiers.push('Ctrl');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey && event.key !== '/') modifiers.push('Shift');
  if (event.metaKey) modifiers.push('Meta');
  return [...modifiers, key].join('+');
}

export function normalizeShortcut(value: string): string {
  return value
    .split('+')
    .map((part) => part.trim())
    .map((part) => {
      const modifier = part.toLowerCase();
      if (modifier === 'control' || modifier === 'ctrl') return 'Ctrl';
      if (modifier === 'alt' || modifier === 'option') return 'Alt';
      if (modifier === 'shift') return 'Shift';
      if (modifier === 'meta' || modifier === 'command' || modifier === 'cmd') return 'Meta';
      if (part.length !== 1) return part;
      const key = part.toUpperCase();
      return key === 'Д' ? 'L' : key === 'А' ? 'F' : key;
    })
    .join('+');
}

export function displayShortcut(value: string): string[] {
  return normalizeShortcut(value).split('+').map((part) => {
    if (part === 'Meta') return /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Meta';
    if (part === 'Ctrl') return /Mac|iPhone|iPad/.test(navigator.platform) ? '⌃' : 'Ctrl';
    if (part === 'Alt') return /Mac|iPhone|iPad/.test(navigator.platform) ? '⌥' : 'Alt';
    if (part === 'Shift') return /Mac|iPhone|iPad/.test(navigator.platform) ? '⇧' : 'Shift';
    if (part === 'ArrowLeft') return '←';
    if (part === 'ArrowRight') return '→';
    if (part === 'ArrowUp') return '↑';
    if (part === 'ArrowDown') return '↓';
    return part;
  });
}
