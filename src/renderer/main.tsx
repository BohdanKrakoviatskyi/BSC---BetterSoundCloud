import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { desktop } from './platform/desktop';
import './styles/global.css';
import './styles/new-ui.css';

window.desktop = desktop as typeof window.desktop;

createRoot(document.getElementById('root')!).render(<App />);
