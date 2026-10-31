import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { build } from 'esbuild';
import ts from 'typescript';
import { startServer } from '../server/index.mjs';
import { DocumentStore } from '../server/store.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(join(tmpdir(), 'ex-portable-test-'));
let running, base, api, domain;
before(async () => {
  running = await startServer({ dataDir: join(temporary, 'main'), port: 0, seed: false });
  base = 'http://127.0.0.1:' + running.port;
  const storageFile = join(temporary, 'storage.mjs'), domainFile = join(temporary, 'domain.mjs');
  await build({ entryPoints: [join(root, 'src/storage.ts')], outfile: storageFile, bundle: true, platform: 'node', format: 'esm' });
  api = await import(pathToFileURL(storageFile).href);
  await build({ entryPoints: [join(root, 'tests/domain-entry.ts')], outfile: domainFile, bundle: true, platform: 'node', format: 'esm',
    plugins: [{ name: 'target-test-server', setup(builder) {
      builder.onLoad({ filter: /[\\/]storage\.ts$/ }, async args => ({ loader: 'ts',
        contents: (await readFile(args.path, 'utf8')).replace("export const db = createDocumentClient('');",
          'export const db = createDocumentClient(' + JSON.stringify(base) + ');')
      }));
    } }] });
  domain = await import(pathToFileURL(domainFile).href);
});
after(async () => { await running?.close(); await rm(temporary, { recursive: true, force: true }); });
const ref = (client, id) => api.doc(client, 'months', id);
const rest = () => ({ type: 'rest', detail: '' });
async function value(client, id) { return (await api.getDocFromServer(ref(client, id))).data(); }
async function waitFor(predicate, timeout = 3500) {
  const end = Date.now() + timeout;
  while (!predicate()) { if (Date.now() > end) throw new Error('Timed out waiting for shared state'); await new Promise(r => setTimeout(r, 25)); }
}
async function appActions(client, readOnly = false) {
  const src = await readFile(join(root, 'src/App.tsx'), 'utf8');
  const requests = await readFile(join(root, 'src/utils/requests.ts'), 'utf8');
  const start = src.indexOf('  type PendingProcessType');
  const extract = requests.slice(requests.indexOf('export const isPendingRequestItem ='), requests.indexOf('export const extractPendingRequests =')).replaceAll('export const', 'const');
  const handlers = src.slice(start, src.indexOf('  const handleApproveRequest =', start));
  assert.ok(start > 0 && handlers.length > 0);
  const program = ts.transpile(extract + handlers +
    ';globalThis.actions={extractAllPendingRequests,handleApprovePendingItem,handleSetNormalPendingItem,handleRejectPendingItem};', { target: ts.ScriptTarget.ES2022 });
  const errors = [], successes = [];
  const context = { MEMBERS: [], db: client, isReadOnly: readOnly, useRef: x => ({ current: x }),
    getDaysInMonth: (y, m) => new Date(y, m + 1, 0).getDate(),
    doc: api.doc, FieldPath: api.FieldPath, runTransaction: api.runTransaction, serverTimestamp: api.serverTimestamp,
    cleanFirestorePayload: domain.cleanFirestorePayload,
    setSaveError: x => errors.push(x), triggerSaveOk: x => successes.push(x),
    console: { error() {} }, setAllData() { throw new Error('Unexpected optimistic update'); } };
  vm.createContext(context); vm.runInContext(program, context);
  return { ...context.actions, errors, successes };
}

test('no account or Google token is required by the local application', async () => {
  const session = await (await fetch(base + '/api/session')).json();
  assert.deepEqual(session, { role: 'edit', readOnly: false });
  assert.equal((await fetch(base + '/healthz')).status, 200);
  assert.equal((await fetch(base + '/api/collections/months')).status, 200);
});

test('the existing schedule saver persists pending request metadata and leaves other data intact', async () => {
  const client = api.createDocumentClient(base), items = Array.from({ length: 31 }, rest);
  await api.setDoc(ref(client, '2026-10'), { schedule: { A: items, B: [rest()] }, history: [], overallMemo: 'keep' });
  await domain.saveScheduleField('2026-10', 'A', 0, 'type', 'pending', items[0], items);
  const saved = await value(client, '2026-10');
  assert.equal(saved.schedule.A[0].type, 'pending');
  assert.equal(saved.schedule.A[0].requestedBy, 'A');
  assert.ok(saved.schedule.A[0].requestId);
  assert.equal(saved.schedule.B[0].type, 'rest');
  assert.equal(saved.overallMemo, 'keep');
  assert.equal(saved.history.length, 1);
  assert.ok(Number.isFinite(Date.parse(saved.updatedAt)));
});

test('a stale edit fails without overwriting another user update', async () => {
  const client = api.createDocumentClient(base);
  const before = await value(client, '2026-10');
  await assert.rejects(domain.saveScheduleField('2026-10', 'A', 0, 'type', 'event', rest(), before.schedule.A), /更新|申請/);
  assert.deepEqual(await value(client, '2026-10'), before);
});

test('two independent clients retry optimistic transactions without losing an update', async () => {
  const a = api.createDocumentClient(base), b = api.createDocumentClient(base);
  await api.setDoc(ref(a, '2026-1'), { count: 0, marker: 'keep' });
  let reads = 0, release;
  const barrier = new Promise(resolve => { release = resolve; });
  const increment = client => {
    let first = true;
    return api.runTransaction(client, async tx => {
      const r = ref(client, '2026-1'), snap = await tx.get(r);
      if (first) { first = false; if (++reads === 2) release(); await barrier; }
      tx.set(r, { count: snap.data().count + 1 }, { merge: true });
    });
  };
  await Promise.all([increment(a), increment(b)]);
  assert.deepEqual(await value(a, '2026-1'), { count: 2, marker: 'keep' });
});

test('a second connected client receives committed changes through the event stream', async () => {
  const writer = api.createDocumentClient(base), reader = api.createDocumentClient(base);
  let observed = '';
  const stop = api.onSnapshot(api.collection(reader, 'months'), snapshot => {
    snapshot.forEach(document => { if (document.id === '2026-2') observed = document.data().memo; });
  });
  try {
    await api.setDoc(ref(writer, '2026-2'), { memo: 'shared-live' });
    await waitFor(() => observed === 'shared-live');
  } finally { stop(); }
});

test('the actual unchanged App approval handler updates a literal member name and history through HTTP', async () => {
  const client = api.createDocumentClient(base);
  const pending = { type: 'pending', detail: '希望休申請', requestedAt: '2026-10-01T00:00:00Z', requestId: 'request-a' };
  await api.setDoc(ref(client, '2026-3'), { schedule: { 'A.B': [pending], C: [{ type: 'event', detail: 'keep' }] }, history: [], overallMemo: 'keep' });
  const actions = await appActions(client);
  const request = actions.extractAllPendingRequests({ '2026-3': await value(client, '2026-3') })[0];
  await actions.handleApprovePendingItem(request);
  const saved = await value(client, '2026-3');
  assert.equal(actions.errors.filter(Boolean).length, 0);
  assert.equal(saved.schedule['A.B'][0].type, 'request');
  assert.equal(saved.schedule.A, undefined);
  assert.deepEqual(saved.schedule.C, [{ type: 'event', detail: 'keep' }]);
  assert.equal(saved.overallMemo, 'keep');
  assert.equal(saved.history[0].to, 'request');
  await actions.handleRejectPendingItem(request);
  assert.deepEqual(await value(client, '2026-3'), saved);
  assert.ok(actions.errors.some(Boolean));
});

test('the original App normal and rejection actions retain their behavior with the new store', async () => {
  const client = api.createDocumentClient(base), actions = await appActions(client);
  for (const [id, action, expected] of [['2026-4', 'handleSetNormalPendingItem', 'normal'], ['2026-5', 'handleRejectPendingItem', 'rest']]) {
    await api.setDoc(ref(client, id), { schedule: { A: [{ type: 'pending', detail: '', requestId: id, requestedAt: '2026-01-01T00:00:00Z' }] }, history: [] });
    const request = actions.extractAllPendingRequests({ [id]: await value(client, id) })[0];
    await actions[action](request);
    assert.equal((await value(client, id)).schedule.A[0].type, expected);
  }
});

test('client registration and project edits use the original business logic', async () => {
  const client = api.createDocumentClient(base);
  const item = { type: 'event', detail: '試作会場' };
  await api.setDoc(ref(client, '2026-6'), { schedule: { A: [item], B: [rest()] }, projects: [], history: [], dailyTimes: { 1: '10:00-18:00' } });
  await domain.saveScheduleClient('2026-6', 'A', 0, 'テスト顧客', item);
  const saved = await value(client, '2026-6');
  assert.equal(saved.schedule.A[0].client, 'テスト顧客');
  assert.equal(saved.projects.length, 1);
  assert.equal(saved.projects[0].client, 'テスト顧客');
  assert.equal(saved.projects[0].timeStart, '10:00');
  const desired = [{ ...saved.projects[0], comment: '共有コメント' }];
  await domain.saveProjectChanges('2026-6', desired, saved.projects);
  const updated = await value(client, '2026-6');
  assert.equal(updated.projects[0].comment, '共有コメント');
  assert.equal(updated.schedule.B[0].type, 'rest');
});

test('nested fields and settings merge without replacing unrelated values', async () => {
  const client = api.createDocumentClient(base);
  const r = api.doc(client, 'settings', 'global');
  await api.setDoc(r, { memberStations: { A: '駅A', B: '駅B' }, dailyTimes: { 1: 'old' } });
  await domain.saveScheduleMapField('settings', 'global', 'memberStations', 'A', '新駅', '駅A', '');
  await api.updateDoc(r, { 'dailyTimes.1': '10:00-18:00' });
  const data = (await api.getDocFromServer(r)).data();
  assert.deepEqual(data.memberStations, { A: '新駅', B: '駅B' });
  assert.equal(data.dailyTimes['1'], '10:00-18:00');
});

test('an invalid transaction rolls back all writes and rejects prototype pollution', async () => {
  const client = api.createDocumentClient(base);
  const before = await value(client, '2026-1');
  const response = await fetch(base + '/api/commit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reads: [], writes: [
    { collection: 'months', id: '2026-1', mode: 'set', data: { count: 999 } },
    { collection: 'other', id: 'bad', mode: 'set', data: {} }
  ] }) });
  assert.equal(response.status, 400);
  assert.deepEqual(await value(client, '2026-1'), before);
  const unsafe = await fetch(base + '/api/commit', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: '{"reads":[],"writes":[{"collection":"months","id":"2026-1","mode":"set","data":{"__proto__":{"polluted":true}}}]}' });
  assert.equal(unsafe.status, 400);
  assert.equal({}.polluted, undefined);
});

test('shared links require no user account and the viewer cannot write or export', async () => {
  const keys = { edit: 'e'.repeat(43), view: 'v'.repeat(43) };
  const locked = await startServer({ dataDir: join(temporary, 'links'), port: 0, seed: false, accessMode: 'link', accessKeys: keys });
  const url = 'http://127.0.0.1:' + locked.port;
  async function login(key) {
    const response = await fetch(url + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
    return { response, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  try {
    assert.equal((await fetch(url + '/api/collections/months')).status, 401);
    assert.equal((await fetch(url + '/assets/private.js')).status, 401);
    assert.match(await (await fetch(url + '/')).text(), /共有リンク/);
    assert.equal((await login('wrong')).response.status, 401);
    const viewer = await login(keys.view), editor = await login(keys.edit);
    assert.equal((await viewer.response.json()).readOnly, true);
    assert.match(viewer.response.headers.get('set-cookie'), /HttpOnly/i);
    assert.match(viewer.response.headers.get('set-cookie'), /SameSite=Strict/i);
    assert.equal((await fetch(url + '/api/collections/months', { headers: { cookie: viewer.cookie } })).status, 200);
    assert.equal((await fetch(url + '/api/commit?readonly=0', { method: 'POST', headers: { cookie: viewer.cookie, 'Content-Type': 'application/json' }, body: '{"reads":[],"writes":[]}' })).status, 403);
    assert.equal((await fetch(url + '/api/backup', { headers: { cookie: viewer.cookie } })).status, 403);
    assert.equal((await fetch(url + '/api/backup', { headers: { cookie: editor.cookie } })).status, 200);
    assert.equal((await fetch(url + '/api/commit', { method: 'POST', headers: { cookie: editor.cookie, origin: 'https://other.example', 'Content-Type': 'application/json' }, body: '{"reads":[],"writes":[]}' })).status, 403);
  } finally { await locked.close(); }
});

test('SQLite survives server restart and JSON backup restores all document contents', async () => {
  const directory = join(temporary, 'restart');
  let instance = await startServer({ dataDir: directory, port: 0, seed: false });
  let url = 'http://127.0.0.1:' + instance.port;
  let client = api.createDocumentClient(url);
  await api.setDoc(ref(client, '2026-7'), { schedule: { A: [rest()] }, history: [{ from: 'a', to: 'b' }], projects: [{ id: 'demo' }] });
  const backup = await (await fetch(url + '/api/backup')).json();
  await instance.close();
  instance = await startServer({ dataDir: directory, port: 0 });
  try {
    client = api.createDocumentClient('http://127.0.0.1:' + instance.port);
    assert.deepEqual((await value(client, '2026-7')), backup.documents[0].data);
    const restored = new DocumentStore(join(temporary, 'restored', 'schedule.sqlite'));
    try {
      restored.restore(backup);
      assert.deepEqual(restored.exportData().documents, backup.documents);
      assert.throws(() => restored.restore(backup), /既存データ/);
      const bad = { format: 'ex-schedule-v1', documents: [{ collection: 'bad', id: 'x', data: {} }] };
      assert.throws(() => restored.restore(bad, true));
      assert.deepEqual(restored.exportData().documents, backup.documents);
    } finally { restored.close(); }
  } finally { await instance.close(); }
});

test('the event stream reconnects and refreshes after a server restart', async () => {
  const directory = join(temporary, 'stream-restart');
  let instance = await startServer({ dataDir: directory, port: 0, seed: false });
  const port = instance.port, client = api.createDocumentClient('http://127.0.0.1:' + port);
  let count = -1;
  const stop = api.onSnapshot(ref(client, '2026-8'), snapshot => { count = snapshot.data()?.count ?? 0; });
  try {
    await api.setDoc(ref(client, '2026-8'), { count: 1 });
    await waitFor(() => count === 1);
    await instance.close();
    instance = await startServer({ dataDir: directory, port, seed: false });
    await api.setDoc(ref(client, '2026-8'), { count: 2 });
    await waitFor(() => count === 2, 5000);
  } finally { stop(); await instance.close(); }
});

test('the frontend build has no Firebase SDK, account identifier, or external font URL', async () => {
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
  assert.ok(!Object.keys(lock.packages).some(x => /firebase|@google\/genai/.test(x)));
  const storage = await readFile(join(root, 'src/storage.ts'), 'utf8');
  assert.doesNotMatch(storage, /firebaseapp\.com|firestore\.googleapis\.com|oauth2/);
  const styles = await readFile(join(root, 'public/fonts/fonts.css'), 'utf8');
  assert.doesNotMatch(styles, /https?:\/\//);
  const constants = await readFile(join(root, 'src/constants.ts'), 'utf8');
  assert.doesNotMatch(constants, /加藤/);
});
