import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { installBack } from './back.js';
import './styles.css';
import './app.css';
import { installLigatures } from './ligatures.js';
import { installTouchMenu } from './touchMenu.js';
import { syncUrl } from './url.js';

installBack();
syncUrl();
installLigatures();
installTouchMenu();

const root = document.getElementById('root');
if (!root) throw new Error('#root fehlt');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
