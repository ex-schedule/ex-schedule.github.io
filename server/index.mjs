import express from 'express';
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DocumentStore, StoreError } from './store.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function readKeys(dataDir) {
  const filename = join(dataDir, '.access-links.json');
  if (!existsSync(filename)) writeFileSync(filename, JSON.stringify({
    edit: randomBytes(32).toString('base64url'), view: randomBytes(32).toString('base64url')
  }), { flag: 'wx', mode: 0o600 });
  const keys = JSON.parse(readFileSync(filename, 'utf8'));
  if (!keys.edit || !keys.view || keys.edit === keys.view) throw new Error('共有リンク設定が不正です。');
  return keys;
}
function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
const gateHTML = '<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>共有スケジュール</title><body><p id="message">共有リンクを確認しています。</p><script src="/access.js"></script></body></html>';
const gateJS = "(async()=>{const p=new URLSearchParams(location.hash.slice(1));const key=p.get('key');const m=document.getElementById('message');if(!key){m.textContent='編集用または閲覧用の共有リンクから開いてください。';return;}try{const r=await fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key})});if(!r.ok)throw Error();const s=await r.json();const u=new URL(location.href);u.hash='';if(s.readOnly)u.searchParams.set('readonly','1');location.replace(u.href);}catch{m.textContent='この共有リンクでは開けません。リンクを確認してください。';}})();";

export function createApplication(options = {}) {
  const dataDir = resolve(options.dataDir || process.env.DATA_DIR || join(root, '.runtime'));
  const mode = options.accessMode || process.env.APP_ACCESS_MODE || 'local';
  if (!['local', 'link'].includes(mode)) throw new Error('APP_ACCESS_MODE must be local or link');
  mkdirSync(dataDir, { recursive: true });
  const isNewDatabase = !existsSync(join(dataDir, 'schedule.sqlite'));
  const store = new DocumentStore(join(dataDir, 'schedule.sqlite'));
  if (options.seed !== false && isNewDatabase) {
    const seed = join(root, 'server', 'seed.json');
    if (existsSync(seed)) store.restore(JSON.parse(readFileSync(seed, 'utf8')));
  }
  const keys = mode === 'link' ? (options.accessKeys || readKeys(dataDir)) : null;
  const streams = new Set();
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('X-Frame-Options', 'DENY');
    res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    if (mode === 'local') {
      const peer = req.socket.remoteAddress || '';
      const host = (req.hostname || '').replace(/^\[|\]$/g, '');
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer) || !['localhost', '127.0.0.1', '::1'].includes(host))
        return res.status(403).json({ code: 'permission-denied', error: 'ローカル試作用です。' });
    }
    if (req.path.startsWith('/api')) {
      res.set('Cache-Control', 'no-store');
      const origin = req.get('origin');
      const expectedOrigin = options.publicOrigin || process.env.PUBLIC_ORIGIN || (req.protocol + '://' + req.get('host'));
      if ((origin && origin !== expectedOrigin) || req.get('sec-fetch-site') === 'cross-site')
        return res.status(403).json({ code: 'permission-denied', error: '別のサイトからは操作できません。' });
    }
    next();
  });
  app.use(express.json({ limit: '4mb' }));
  function role(req) {
    if (mode === 'local') return 'edit';
    const cookie = (req.get('cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith('ex_access='));
    let value = '';
    try { value = cookie ? decodeURIComponent(cookie.slice('ex_access='.length)) : ''; } catch {}
    if (sameSecret(value, keys.edit)) return 'edit';
    if (sameSecret(value, keys.view)) return 'view';
    return null;
  }
  function requireRead(req, res, next) {
    const access = role(req);
    if (!access) return res.status(401).json({ code: 'unauthenticated', error: '共有リンクから開いてください。' });
    req.accessRole = access; next();
  }
  function requireEdit(req, res, next) {
    requireRead(req, res, () => {
      if (req.accessRole !== 'edit') return res.status(403).json({ code: 'permission-denied', error: '閲覧用リンクでは編集できません。' });
      next();
    });
  }
  function broadcast(changes) {
    if (!changes.length) return;
    const data = JSON.stringify({ changes });
    for (const response of streams) response.write('data: ' + data + '\n\n');
  }
  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  app.get('/access.js', (_req, res) => res.type('js').set('Cache-Control', 'no-store').send(gateJS));
  app.post('/api/session', (req, res) => {
    let access = mode === 'local' ? 'edit' : null;
    if (mode === 'link') {
      if (sameSecret(req.body?.key, keys.edit)) access = 'edit';
      if (sameSecret(req.body?.key, keys.view)) access = 'view';
      if (!access) throw new StoreError('unauthenticated', 'この共有リンクでは開けません。', 401);
      res.cookie('ex_access', req.body.key, { httpOnly: true, sameSite: 'strict', secure: req.secure,
        path: '/', maxAge: 30 * 24 * 60 * 60 * 1000 });
    }
    res.json({ role: access, readOnly: access === 'view' });
  });
  app.get('/api/session', requireRead, (req, res) => res.json({ role: req.accessRole, readOnly: req.accessRole === 'view' }));
  app.get('/api/documents/:collection/:id', requireRead, (req, res) => {
    const document = store.get(req.params.collection, req.params.id);
    res.json({ document });
  });
  app.get('/api/collections/:collection', requireRead, (req, res) => res.json({ documents: store.list(req.params.collection) }));
  app.post('/api/commit', requireEdit, (req, res) => {
    const changes = store.commit(req.body?.reads, req.body?.writes);
    broadcast(changes); res.json({ ok: true });
  });
  app.get('/api/events', requireRead, (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    streams.add(res);
    res.write('data: {"refresh":true}\n\n');
    const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 15000);
    heartbeat.unref();
    req.on('close', () => { clearInterval(heartbeat); streams.delete(res); });
  });
  app.get('/api/backup', requireEdit, (_req, res) => res.json(store.exportData()));
  app.use('/api', (_req, res) => res.status(404).json({ code: 'not-found', error: 'APIが見つかりません。' }));
  app.use((req, res, next) => {
    if (role(req)) return next();
    if (req.method === 'GET' && !extname(req.path)) return res.status(200).set('Cache-Control', 'no-store').type('html').send(gateHTML);
    return res.status(401).json({ code: 'unauthenticated', error: '共有リンクから開いてください。' });
  });
  app.use(express.static(join(root, 'dist'), { index: false, maxAge: '1h' }));
  app.get('*', (req, res, next) => {
    if (extname(req.path)) return res.status(404).send('Not Found');
    res.set('Cache-Control', 'no-store').sendFile(join(root, 'dist', 'index.html'), error => { if (error) next(error); });
  });
  app.use((error, _req, res, _next) => {
    if (res.headersSent) { res.end(); return; }
    const status = error instanceof StoreError ? error.status : (error.status === 413 ? 413 : 500);
    res.status(status).json({ code: error.code || 'unavailable', error: error instanceof StoreError ? error.message : '保存サーバーでエラーが発生しました。' });
  });
  return { app, store, accessMode: mode, dataDir, closeStreams() { for (const response of streams) response.end(); streams.clear(); } };
}
export async function startServer(options = {}) {
  const instance = createApplication(options);
  const port = options.port ?? Number(process.env.PORT || 3217);
  const host = options.host || process.env.HOST || '127.0.0.1';
  if (instance.accessMode === 'local' && !['127.0.0.1', '::1', 'localhost'].includes(host)) {
    instance.store.close(); throw new Error('local mode must bind to loopback');
  }
  const server = createServer(instance.app);
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); }); }
  catch (error) { instance.store.close(); throw error; }
  return { ...instance, server, port: server.address().port, async close() {
    instance.closeStreams();
    await new Promise(resolve => server.close(resolve)); instance.store.close();
  } };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(process.argv.slice(2).map(x => x.replace(/^--/, '').split('=')));
  const running = await startServer({ port: args.port === undefined ? undefined : Number(args.port),
    host: args.host, dataDir: args['data-dir'], accessMode: args.access,
    seed: args['no-seed'] ? false : undefined });
  console.log('Schedule Share ready: http://localhost:' + running.port + '/');
  if (running.accessMode === 'link') console.log('共有リンクの鍵はデータフォルダの .access-links.json に保存しました。');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await running.close(); process.exit(0); });
}
