import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initializeSession } from './storage';


initializeSession().then(() => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)).catch(() => { document.getElementById('root')!.textContent = 'このリンクでは開けません。共有リンクを確認してください。'; });
