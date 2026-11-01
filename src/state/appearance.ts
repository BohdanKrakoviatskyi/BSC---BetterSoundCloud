import { createStore, persist } from '../lib/util';
import type { Variant } from '../lib/color';
import type { MotionMode } from '../lib/motion';

export type GlassMode = 'liquid' | 'frosted' | 'off';
export type BgMode = 'dynamic' | 'color' | 'image';

export interface Appearance {
  theme: 'dark' | 'light' | 'system';
  glass: GlassMode;
  blur: number; // 0..100
  opacity: number; // tint density 0..100
  refraction: number; // 0..100
  bgMode: BgMode;
  bgStyle: 'palette' | 'artwork';
  bgColor: string;
  bgImage: string | null;
  bgDim: number;
  bgBlur: number;
  accentMode: 'dynamic' | 'custom';
  accentColor: string;
  variant: Variant;
  motion: MotionMode;
  lang: 'ru' | 'en';
}

export const DEFAULTS: Appearance = {
  theme: 'dark',
  glass: 'liquid',
  blur: 45,
  opacity: 34,
  refraction: 45,
  bgMode: 'dynamic',
  bgStyle: 'palette',
  bgColor: '#25305e',
  bgImage: null,
  bgDim: 30,
  bgBlur: 0,
  accentMode: 'dynamic',
  accentColor: '#8c7cff',
  variant: 'vibrant',
  motion: 'expressive',
  lang: (navigator.language || 'ru').toLowerCase().startsWith('ru') ? 'ru' : 'en',
};

export const appearance = createStore<Appearance>({ ...DEFAULTS });
persist('lyra.app.v1', appearance, ({ bgImage: _omit, ...rest }) => rest);

const IMG_KEY = 'lyra.bgimg.v1';
try {
  const img = localStorage.getItem(IMG_KEY);
  if (img) appearance.set({ bgImage: img });
} catch {
  /* ignore */
}

/** Returns false if the image couldn't be persisted (it still applies for this session). */
export function setBgImage(data: string | null): boolean {
  let ok = true;
  try {
    if (data) localStorage.setItem(IMG_KEY, data);
    else localStorage.removeItem(IMG_KEY);
  } catch {
    ok = false;
  }
  appearance.set({ bgImage: data, bgMode: data ? 'image' : appearance.get().bgMode === 'image' ? 'dynamic' : appearance.get().bgMode });
  return ok;
}

/** Downscales a user photo to keep storage + memory light. */
export async function processImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const k = Math.min(1, 1920 / Math.max(img.naturalWidth, img.naturalHeight));
    const cv = document.createElement('canvas');
    cv.width = Math.round(img.naturalWidth * k);
    cv.height = Math.round(img.naturalHeight * k);
    cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/jpeg', 0.84);
  } finally {
    URL.revokeObjectURL(url);
  }
}
