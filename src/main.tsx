import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initializeSession } from './storage';

const root = document.getElementById('root')!;
// 予定の履歴を読み込むまで数十秒かかることがあるため、待っている間も画面に表示する
root.innerHTML =
  '<p style="padding:24px;font-family:sans-serif;color:#555">予定を読み込んでいます…<br>回線によっては1分ほどかかります。</p>';

initializeSession().then(() => createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)).catch(() => {
  root.innerHTML =
    '<p style="padding:24px;font-family:sans-serif;color:#555">予定を読み込めませんでした。電波のよい場所で、もう一度お試しください。</p>' +
    '<p style="padding:0 24px"><button onclick="location.reload()" style="padding:10px 20px;font-size:16px">もう一度読み込む</button></p>';
});
