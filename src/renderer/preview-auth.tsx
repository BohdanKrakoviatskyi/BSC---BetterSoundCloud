import React from 'react';
import { createRoot } from 'react-dom/client';
import { AuthScreen } from './ui/components/AuthScreen';
import './ui/styles.css';
import './ui/new-ui.css';

document.documentElement.style.setProperty('--accent', '#ff765d');

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthScreen error="" busy={false} clientId="" onLogin={() => {}} onSilentLogin={() => {}} />
  </React.StrictMode>,
);
