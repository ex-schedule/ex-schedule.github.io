import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createServerlessLinks } from '../scripts/links.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(join(tmpdir(), 'ex-cryptpad-test-'));
let api, codec, reducer, memberStore;

// In-memory Netflux + History Keeper mock WebSocket hub matching CryptPad protocol
class MockNetfluxHub {
  constructor() {
    this.channels = new Map(); // channelId -> { validateKey, history: string[], peers: Set<MockSocket> }
    this.nextId = 1;
    this.requests = []; // GET_HISTORY の記録
    this.sockets = new Set();
    this.pongs = [];
  }

  dropAll() {
    for (const socket of [...this.sockets]) socket.close();
  }

  createWebSocketClass() {
    const hub = this;
    return class MockWebSocket {
      static OPEN = 1;
      constructor(url) {
        this.url = url;
        this.readyState = 1;
        this.id = `peer-${hub.nextId++}`;
        this.hkId = 'history-keeper-mock';
        this.listeners = { open: [], message: [], close: [], error: [] };
        hub.sockets.add(this);
        queueMicrotask(() => {
          this._emit('open', {});
          this._emit('message', { data: JSON.stringify([0, '', 'IDENT', this.id]) });
        });
      }

      addEventListener(type, fn) {
        this.listeners[type]?.push(fn);
      }

      _emit(type, ev) {
        for (const fn of this.listeners[type] || []) fn(ev);
      }

      send(raw) {
        const msg = JSON.parse(raw);
        const [seq, cmd, target, arg] = msg;
        if (msg[2] === 'PONG') {
          hub.pongs.push(msg);
          return;
        }
        if (cmd === 'JOIN') {
          const chId = target;
          if (!hub.channels.has(chId)) {
            hub.channels.set(chId, { validateKey: null, history: [], peers: new Set() });
          }
          const ch = hub.channels.get(chId);
          ch.peers.add(this);
          queueMicrotask(() => {
            this._emit('message', { data: JSON.stringify([seq, 'JACK', chId]) });
            this._emit('message', { data: JSON.stringify([0, this.hkId, 'JOIN', chId]) });
            this._emit('message', { data: JSON.stringify([0, this.id, 'JOIN', chId]) });
          });
        } else if (cmd === 'MSG' && target === this.hkId) {
          const req = JSON.parse(arg);
          const reqType = req[0];
          const chId = req[1];
          if (!hub.channels.has(chId)) {
            hub.channels.set(chId, { validateKey: null, history: [], peers: new Set() });
          }
          const ch = hub.channels.get(chId);
          if (reqType === 'GET_HISTORY') {
            const config = req[2] || {};
            if (config.metadata?.validateKey && !ch.validateKey) {
              ch.validateKey = config.metadata.validateKey;
            }
            queueMicrotask(() => {
              const direct = payload => this._emit('message', {
                data: JSON.stringify([0, this.hkId, 'MSG', this.id, JSON.stringify(payload)]),
              });
              direct({ validateKey: ch.validateKey, channel: chId });
              let start = 0;
              if (config.lastKnownHash) {
                start = ch.history.findIndex(entry => entry.slice(0, 64) === config.lastKnownHash);
                if (start < 0) {
                  hub.requests.push({ peer: this.id, lastKnownHash: config.lastKnownHash, served: -1 });
                  direct({ error: 'EUNKNOWN', channel: chId, txid: config.txid });
                  return;
                }
              } else {
                // 実サーバーと同じく、チェックポイントが2つ以上あれば最後から2つ目以降だけを返す
                const checkpoints = ch.history.map((entry, i) => (entry.startsWith('cp|') ? i : -1)).filter(i => i >= 0);
                if (checkpoints.length >= 2) start = checkpoints.at(-2);
              }
              const served = ch.history.slice(start);
              hub.requests.push({ peer: this.id, lastKnownHash: config.lastKnownHash || null, served: served.length, total: ch.history.length });
              for (const entry of served) direct([config.txid, 'someone', 'MSG', chId, entry]);
              direct({ state: 1, channel: chId, txid: config.txid });
            });
          } else if (reqType === 'GET_FULL_HISTORY') {
            queueMicrotask(() => {
              for (const entry of ch.history) {
                this._emit('message', {
                  data: JSON.stringify([
                    0,
                    this.hkId,
                    'MSG',
                    this.id,
                    JSON.stringify(['FULL_HISTORY', [0, this.id, 'MSG', chId, entry]]),
                  ]),
                });
              }
              this._emit('message', {
                data: JSON.stringify([
                  0,
                  this.hkId,
                  'MSG',
                  this.id,
                  JSON.stringify(['FULL_HISTORY_END', chId]),
                ]),
              });
            });
          }
        } else if (cmd === 'MSG') {
          const chId = target;
          const ch = hub.channels.get(chId);
          if (!ch) return;
          ch.history.push(arg);
          queueMicrotask(() => {
            this._emit('message', { data: JSON.stringify([seq, 'ACK']) });
            for (const peer of ch.peers) {
              if (peer !== this && peer.readyState === 1) {
                peer._emit('message', { data: JSON.stringify([0, this.id, 'MSG', chId, arg]) });
              }
            }
          });
        }
      }

      close() {
        if (this.readyState === 3) return;
        this.readyState = 3;
        hub.sockets.delete(this);
        for (const ch of hub.channels.values()) {
          ch.peers.delete(this);
        }
        this._emit('close', {});
      }
    };
  }
}

before(async () => {
  const storageFile = join(temporary, 'storage.mjs');
  const codecFile = join(temporary, 'codec.mjs');
  const reducerFile = join(temporary, 'reducer.mjs');
  const memberStoreFile = join(temporary, 'memberStore.mjs');
  await build({ entryPoints: [join(root, 'src/storage.ts')], outfile: storageFile, bundle: true, platform: 'node', format: 'esm' });
  await build({ entryPoints: [join(root, 'src/storage/cryptoCodec.ts')], outfile: codecFile, bundle: true, platform: 'node', format: 'esm' });
  await build({ entryPoints: [join(root, 'src/storage/commandReducer.ts')], outfile: reducerFile, bundle: true, platform: 'node', format: 'esm' });
  await build({ entryPoints: [join(root, 'src/utils/memberStore.ts')], outfile: memberStoreFile, bundle: true, platform: 'node', format: 'esm' });
  api = await import(pathToFileURL(storageFile).href);
  codec = await import(pathToFileURL(codecFile).href);
  reducer = await import(pathToFileURL(reducerFile).href);
  memberStore = await import(pathToFileURL(memberStoreFile).href);
});

after(async () => {
  await rm(temporary, { recursive: true, force: true });
});

test('createServerlessLinks generates valid edit and view-only CryptPad E2EE share links', async () => {
  const links = await createServerlessLinks('https://arweave.net/');
  assert.match(links.edit, /^https:\/\/arweave\.net\/#ch=[0-9a-f]{32}&k=[A-Za-z0-9_-]+&s=[A-Za-z0-9_-]+$/);
  assert.match(links.view, /^https:\/\/arweave\.net\/\?readonly=1#ch=[0-9a-f]{32}&k=[A-Za-z0-9_-]+&v=[A-Za-z0-9_-]+$/);

  const editCreds = await codec.parseShareHash(new URL(links.edit).hash);
  const viewCreds = await codec.parseShareHash(new URL(links.view).hash);
  assert.equal(editCreds.readOnly, false);
  assert.equal(viewCreds.readOnly, true);
  assert.equal(editCreds.channelId, viewCreds.channelId);
  assert.equal(editCreds.validateKeyBase64, viewCreds.validateKeyBase64);
});

test('two E2EE CryptPad clients sync in real time, enforce CAS/requestId preconditions, and block viewer writes', async () => {
  const hub = new MockNetfluxHub();
  const prevWS = globalThis.WebSocket;
  globalThis.WebSocket = hub.createWebSocketClass();

  try {
    const editCredsA = await codec.generateNewChannelCredentials('wss://mock.cryptpad/cryptpad_websocket');
    const editHash = codec.formatShareHash(editCredsA, 'edit');
    const viewHash = codec.formatShareHash(editCredsA, 'view');

    const editCredsB = await codec.parseShareHash(editHash);
    const viewCredsC = await codec.parseShareHash(viewHash);

    const clientA = await api.createCryptPadDocumentClient(editCredsA);
    const clientB = await api.createCryptPadDocumentClient(editCredsB);
    const viewerC = await api.createCryptPadDocumentClient(viewCredsC);

    try {
      // 1. Viewer C subscribes via onSnapshot
      let viewerObserved = null;
      const unsubC = api.onSnapshot(api.doc(viewerC, 'months', '2026-10'), snap => {
        if (snap.exists()) viewerObserved = snap.data();
      });

      // 2. Client A writes initial pending request req-A
      await api.setDoc(api.doc(clientA, 'months', '2026-10'), {
        schedule: {
          'メンバー1': [{ type: 'pending', detail: '希望休A', requestId: 'req-A', requestedAt: '2026-10-01T00:00:00Z' }],
        },
        history: [],
      });

      // Wait for Client B & Viewer C to receive encrypted + signed operation
      const end = Date.now() + 2000;
      while (!viewerObserved && Date.now() < end) {
        await new Promise(r => setTimeout(r, 20));
      }
      assert.equal(viewerObserved?.schedule?.['メンバー1']?.[0]?.requestId, 'req-A');

      // 3. Viewer C cannot write
      await assert.rejects(
        api.setDoc(api.doc(viewerC, 'months', '2026-10'), { overallMemo: 'hacked' }),
        /閲覧|編集権限/
      );

      // 4. Client B replaces req-A with req-B via transaction
      await api.runTransaction(clientB, async tx => {
        const refB = api.doc(clientB, 'months', '2026-10');
        const snap = await tx.get(refB);
        assert.equal(snap.exists(), true);
        tx.update(
          refB,
          new api.FieldPath('schedule', 'メンバー1'),
          [{ type: 'pending', detail: '希望休B', requestId: 'req-B', requestedAt: '2026-10-02T00:00:00Z' }]
        );
      });

      // 5. Fresh Client D connects from zero cache and restores latest state from History Keeper
      const clientD = await api.createCryptPadDocumentClient(editCredsB);
      try {
        const snapD = await api.getDocFromServer(api.doc(clientD, 'months', '2026-10'));
        assert.equal(snapD.exists(), true);
        assert.equal(snapD.data().schedule['メンバー1'][0].requestId, 'req-B');
      } finally {
        clientD.close();
      }

      unsubC();
    } finally {
      clientA.close();
      clientB.close();
      viewerC.close();
    }
  } finally {
    globalThis.WebSocket = prevWS;
  }
});

test('replayCommandLog enforces expectedRequest precondition even when version matches, and supports checkpoint snapshots', () => {
  const ops = [
    {
      opId: 'op-1',
      timestamp: '2026-10-01T00:00:00Z',
      reads: [],
      writes: [
        {
          collection: 'months',
          id: '2026-10',
          mode: 'set',
          data: {
            schedule: {
              'メンバー1': [{ type: 'pending', detail: '申請B', requestId: 'req-B' }],
            },
          },
        },
      ],
    },
    {
      opId: 'op-2-mismatch-reqId-with-matching-version',
      timestamp: '2026-10-01T00:01:00Z',
      reads: [{ collection: 'months', id: '2026-10', version: 1 }],
      expectedRequest: {
        collection: 'months',
        id: '2026-10',
        member: 'メンバー1',
        dayIndex: 0,
        requestId: 'req-A',
      },
      writes: [
        {
          collection: 'months',
          id: '2026-10',
          mode: 'update',
          fields: [{ path: ['schedule', 'メンバー1', '0', 'type'], value: 'request' }],
        },
      ],
    },
    {
      opId: 'ckpt-1',
      timestamp: '2026-10-01T00:02:00Z',
      reads: [{ collection: 'months', id: '2026-10', version: 1 }],
      writes: [],
      snapshot: [
        {
          collection: 'months',
          id: '2026-10',
          version: 5,
          data: {
            schedule: {
              'メンバー1': [{ type: 'request', detail: '確定◎', requestId: 'req-B' }],
            },
          },
        },
      ],
    },
  ];

  const { documents, outcomes } = reducer.replayCommandLog(ops);
  assert.equal(outcomes.get('op-1').status, 'committed');
  assert.equal(outcomes.get('op-2-mismatch-reqId-with-matching-version').status, 'aborted');
  assert.match(outcomes.get('op-2-mismatch-reqId-with-matching-version').reason, /request_precondition_failed/);
  assert.equal(outcomes.get('ckpt-1').status, 'committed');
  assert.equal(documents.get('months/2026-10').version, 5);
  assert.equal(documents.get('months/2026-10').data.schedule['メンバー1'][0].type, 'request');
});

test('memberStore adds, renames (migrating schedules/projects/stations), reorders, and deletes members atomically', async () => {
  const hub = new MockNetfluxHub();
  const prevWS = globalThis.WebSocket;
  globalThis.WebSocket = hub.createWebSocketClass();

  try {
    const creds = await codec.generateNewChannelCredentials('wss://mock.cryptpad/cryptpad_websocket');
    const client = await api.createCryptPadDocumentClient(creds);
    try {
      let members = ['メンバー1', 'メンバー2'];
      let leadMembers = ['メンバー1'];

      // Seed initial settings and month schedule/project data
      await api.setDoc(api.doc(client, 'settings', 'global'), {
        members,
        leadMembers,
        memberStations: { 'メンバー1': '海浜幕張', 'メンバー2': '横浜' },
      });
      await api.setDoc(api.doc(client, 'months', '2026-10'), {
        schedule: {
          'メンバー1': [{ type: 'event', detail: '幕張メッセ', requestedBy: 'メンバー1' }],
          'メンバー2': [{ type: 'rest', detail: '', requestedBy: 'メンバー1' }],
        },
        history: [{ at: '2026-10-01T00:00:00Z', by: '', member: 'メンバー1', day: 1, field: 'type', from: 'rest', to: 'event' }],
        projects: [
          {
            id: 'p1',
            date: '2026-10-01',
            venue: '幕張メッセ',
            directors: [],
            leads: ['メンバー1'],
            members: ['メンバー2'],
          },
        ],
      });

      // 1. Add a new member (even if caller passes a stale currentMembers missing 'メンバー2', tx preserves 'メンバー2')
      const added = await memberStore.addTeamMember('新メンバー3', true, ['メンバー1'], leadMembers, client);
      members = added.members;
      leadMembers = added.leadMembers;
      assert.deepEqual(members, ['メンバー1', 'メンバー2', '新メンバー3']);
      assert.deepEqual(leadMembers, ['メンバー1', '新メンバー3']);

      // 2. Rename 'メンバー1' -> '佐藤　太郎' and verify migration across all schedule rows
      const renamed = await memberStore.renameTeamMember(
        'メンバー1',
        '佐藤　太郎',
        true,
        members,
        leadMembers,
        ['2026-10'],
        client
      );
      members = renamed.members;
      leadMembers = renamed.leadMembers;
      assert.deepEqual(members, ['佐藤　太郎', 'メンバー2', '新メンバー3']);

      // Full-width / half-width space duplicate must be rejected
      await assert.rejects(
        memberStore.addTeamMember('佐藤 太郎', false, members, leadMembers, client),
        /既に登録されています/
      );

      const settingsAfterRename = (await api.getDocFromServer(api.doc(client, 'settings', 'global'))).data();
      assert.equal(settingsAfterRename.memberStations['佐藤　太郎'], '海浜幕張');
      assert.equal('メンバー1' in settingsAfterRename.memberStations, false);

      const monthAfterRename = (await api.getDocFromServer(api.doc(client, 'months', '2026-10'))).data();
      assert.equal(monthAfterRename.schedule['佐藤　太郎'][0].detail, '幕張メッセ');
      assert.equal(monthAfterRename.schedule['佐藤　太郎'][0].requestedBy, '佐藤　太郎');
      assert.equal(monthAfterRename.schedule['メンバー2'][0].requestedBy, '佐藤　太郎');
      assert.equal('メンバー1' in monthAfterRename.schedule, false);
      assert.equal(monthAfterRename.history[0].member, '佐藤　太郎');
      assert.deepEqual(monthAfterRename.projects[0].leads, ['佐藤　太郎']);

      // 3. Delete 'メンバー2' and verify cleanup
      const deleted = await memberStore.deleteTeamMember(
        'メンバー2',
        members,
        leadMembers,
        ['2026-10'],
        client
      );
      members = deleted.members;
      leadMembers = deleted.leadMembers;
      assert.deepEqual(members, ['佐藤　太郎', '新メンバー3']);

      const monthAfterDelete = (await api.getDocFromServer(api.doc(client, 'months', '2026-10'))).data();
      assert.equal('メンバー2' in monthAfterDelete.schedule, false);
      assert.deepEqual(monthAfterDelete.projects[0].members, []);
    } finally {
      client.close();
    }
  } finally {
    globalThis.WebSocket = prevWS;
  }
});

async function waitFor(check, timeoutMs = 4000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  return false;
}

test('checkpoints let a new device load a short window, reconnects fetch only the difference, and PING is answered', async () => {
  const hub = new MockNetfluxHub();
  const prevWS = globalThis.WebSocket;
  globalThis.WebSocket = hub.createWebSocketClass();
  const clients = [];
  try {
    const creds = await codec.generateNewChannelCredentials('wss://mock.cryptpad/cryptpad_websocket');
    const hash = codec.formatShareHash(creds, 'edit');
    const open = async () => {
      const client = await api.createCryptPadDocumentClient(await codec.parseShareHash(hash), { checkpointInterval: 4, checkpointDelayMs: 0 });
      clients.push(client);
      return client;
    };
    const month = client => api.doc(client, 'months', '2026-11');
    const read = async client => (await api.getDocFromServer(month(client))).data();
    const increment = client => api.runTransaction(client, async tx => {
      const snap = await tx.get(month(client));
      tx.update(month(client), 'counter', snap.data().counter + 1);
    });

    const a = await open();
    await api.setDoc(month(a), { schedule: { A: [{ type: 'rest', detail: '' }] }, counter: 0 });
    for (let i = 1; i <= 11; i++) await increment(a);
    const channel = hub.channels.get(creds.channelId);
    // 書く間隔は応答の前後関係で少し変わるため、範囲を絞るのに必要な2つ以上を確認する
    assert.ok(await waitFor(() => channel.history.filter(entry => entry.startsWith('cp|')).length >= 2), 'checkpoints are written');
    const totalBefore = channel.history.length;

    // 新しい端末: 最後から2つ目のチェックポイント以降だけを受け取り、同じ内容になる
    const b = await open();
    const bRequest = hub.requests.at(-1);
    assert.equal(bRequest.lastKnownHash, null);
    assert.ok(bRequest.served < totalBefore, `served ${bRequest.served} of ${totalBefore}`);
    assert.equal((await read(b)).counter, 11);
    assert.equal((await api.getDocFromServer(month(b))).version, (await api.getDocFromServer(month(a))).version);

    // 途中から読んだ端末でも、版の一致を条件にした保存と相互の即時反映が働く
    await increment(b);
    assert.ok(await waitFor(async () => (await read(a)).counter === 12), 'A sees B');

    // 切断 → 再接続では、手元の最後の位置からの差分だけを読む
    hub.dropAll();
    assert.ok(await waitFor(() => hub.requests.filter(r => r.lastKnownHash).length >= 2, 6000), 'both reconnect incrementally');
    const delta = hub.requests.filter(r => r.lastKnownHash).at(-1);
    assert.ok(delta.served <= 2, `delta served ${delta.served}`);
    await increment(a);
    assert.ok(await waitFor(async () => (await read(b)).counter === 13), 'B sees A after reconnect');

    // サーバーからの PING に PONG を返す(返さないと実サーバーは約75秒で切断する)
    for (const socket of hub.sockets) socket._emit('message', { data: JSON.stringify([0, '', 'PING', 12345]) });
    assert.ok(await waitFor(() => hub.pongs.some(msg => msg[3] === 12345)), 'PONG is sent');

    // 3台目も短い範囲から同じ結果になる
    const c = await open();
    assert.equal((await read(c)).counter, 13);
  } finally {
    for (const client of clients) client.close?.();
    globalThis.WebSocket = prevWS;
  }
});

test('a device still loads when no checkpoint in the served window can be used, by reading the full history', async () => {
  const hub = new MockNetfluxHub();
  const prevWS = globalThis.WebSocket;
  globalThis.WebSocket = hub.createWebSocketClass();
  const clients = [];
  try {
    const creds = await codec.generateNewChannelCredentials('wss://mock.cryptpad/cryptpad_websocket');
    const hash = codec.formatShareHash(creds, 'edit');
    const a = await api.createCryptPadDocumentClient(await codec.parseShareHash(hash), { checkpointInterval: 1000 });
    clients.push(a);
    const ref = api.doc(a, 'months', '2026-11');
    await api.setDoc(ref, { counter: 1 });
    await api.setDoc(ref, { counter: 2 }, { merge: true });
    // 基準の操作が範囲の外にあるチェックポイントを2つ、手で差し込む
    const channel = hub.channels.get(creds.channelId);
    const cryptoCodec = await codec.createCryptoCodec(await codec.parseShareHash(hash));
    for (const id of ['x1', 'x2']) {
      const env = await cryptoCodec.encryptAndSign({
        opId: 'cp-' + id, timestamp: new Date().toISOString(), reads: [], writes: [],
        checkpoint: { basis: 'not-in-window', docs: [{ collection: 'months', id: '2026-11', data: { counter: 999 }, version: 9 }] },
      });
      channel.history.push(`cp|${id}|${env}`);
    }
    const b = await api.createCryptPadDocumentClient(await codec.parseShareHash(hash), { checkpointInterval: 1000 });
    clients.push(b);
    const snap = await api.getDocFromServer(api.doc(b, 'months', '2026-11'));
    assert.equal(snap.data().counter, 2);
    assert.equal(snap.version, 2);
  } finally {
    for (const client of clients) client.close?.();
    globalThis.WebSocket = prevWS;
  }
});
