import { StrictMode } from 'react';

import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { initFx } from './lib/motion';
import { initPlayer } from './state/player';
import { initializeShortcutRuntime } from './state/shortcut-runtime';
import { initTheme } from './state/theme';

// Refraction via SVG backdrop filters is reliable in Chromium/Firefox only.
const ua = navigator.userAgent;
document.documentElement.dataset.distort = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(ua) ? 'off' : 'on';

initPlayer();
initializeShortcutRuntime();
initTheme();
initFx();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
