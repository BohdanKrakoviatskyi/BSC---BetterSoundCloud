import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { desktop } from './lib/desktop';
import './ui/styles.css';
import './ui/new-ui.css';

window.desktop = desktop as typeof window.desktop;

createRoot(document.getElementById('root')!).render(<App />);
