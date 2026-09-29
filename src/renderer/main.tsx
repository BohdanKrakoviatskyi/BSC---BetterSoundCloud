import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { desktop } from './lib/desktop';
import './ui/styles.css';
import './ui/new-ui.css';

// SoundCloud artwork links expire and 404. One delegated listener keeps a dead image from
// painting the browser's broken-image glyph over every card, avatar and cover in the app.
document.addEventListener('error', (event) => {
  const target = event.target;
  if (target instanceof HTMLImageElement) target.classList.add('is-broken');
}, true);

window.desktop = desktop as typeof window.desktop;

createRoot(document.getElementById('root')!).render(<App />);
