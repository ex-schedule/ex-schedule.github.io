import type { CommandOperation, StoredDocument, OperationOutcome } from './commandReducer';
import { replayCommandLog } from './commandReducer';
import type { ChannelCredentials } from './cryptoCodec';
import { createCryptoCodec, bytesToHex } from './cryptoCodec';

export type TransportState = {
  documents: Map<string, StoredDocument>;
  outcomes: Map<string, OperationOutcome>;
  operations: CommandOperation[];
};

export type NetfluxTransportOptions = {
  credentials: ChannelCredentials;
  seedDocuments?: StoredDocument[];
  onInvalidate?: () => void;
  webSocketFactory?: (url: string) => WebSocket;
};

const CACHE_KEY_PREFIX = 'ex_schedule_e2ee_ops_v1_';

const CACHE_DB_NAME = 'ex_schedule_cache';
const CACHE_STORE = 'ops';

// 履歴は数MBになり localStorage の上限(iPhoneでは約5MB)を超えるため、IndexedDB に保存する
function openCacheDb(): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(CACHE_DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(CACHE_STORE)) req.result.createObjectStore(CACHE_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

let cacheDbPromise: Promise<IDBDatabase | null> | null = null;
function getCacheDb(): Promise<IDBDatabase | null> {
  if (!cacheDbPromise) cacheDbPromise = openCacheDb();
  return cacheDbPromise;
}

async function loadCachedOps(channelId: string): Promise<CommandOperation[]> {
  const db = await getCacheDb();
  if (db) {
    const fromDb = await new Promise<unknown>(resolve => {
      try {
        const req = db.transaction(CACHE_STORE, 'readonly').objectStore(CACHE_STORE).get(channelId);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    if (Array.isArray(fromDb) && fromDb.length > 0) return fromDb as CommandOperation[];
  }
  // 以前の版が localStorage に残した一時保存を読む
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(CACHE_KEY_PREFIX + channelId);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveCachedOps(channelId: string, ops: CommandOperation[]): Promise<void> {
  const db = await getCacheDb();
  if (db) {
    const saved = await new Promise<boolean>(resolve => {
      try {
        const tx = db.transaction(CACHE_STORE, 'readwrite');
        tx.objectStore(CACHE_STORE).put(ops, channelId);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
    if (saved) {
      // IndexedDB に入ったら、上限を圧迫する localStorage 側は消して空ける
      try { localStorage.removeItem(CACHE_KEY_PREFIX + channelId); } catch {}
      return;
    }
  }
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(CACHE_KEY_PREFIX + channelId, JSON.stringify(ops));
  } catch {}
}

export async function createNetfluxTransport(options: NetfluxTransportOptions) {
  const { credentials, seedDocuments = [], onInvalidate } = options;
  const codec = await createCryptoCodec(credentials);
  const wsFactory = options.webSocketFactory || ((url: string) => new WebSocket(url));

  let operations: CommandOperation[] = await loadCachedOps(credentials.channelId);
  let state = replayCommandLog(operations, seedDocuments);

  let ws: WebSocket | null = null;
  let seq = 1;
  let myId: string | null = null;
  let hkId: string | null = null;
  let closed = false;
  let hasEverConnected = false;
  let readyPromise: Promise<void> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let backgroundRetryTimer: ReturnType<typeof setTimeout> | undefined;

  let historyBuffer: string[] = [];
  let historyResolvers: Array<(ops: CommandOperation[]) => void> = [];
  const ackResolvers = new Map<number, () => void>();

  function recomputeState(nextOps: CommandOperation[]) {
    operations = nextOps;
    state = replayCommandLog(operations, seedDocuments);
    // 履歴の受信中は何度も呼ばれるため、まとめて1回保存する
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void saveCachedOps(credentials.channelId, operations);
    }, 500);
    (saveTimer as any)?.unref?.();
    onInvalidate?.();
  }

  async function decodeEnvelopes(envelopes: string[]): Promise<CommandOperation[]> {
    const decoded: CommandOperation[] = [];
    for (const env of envelopes) {
      const op = await codec.verifyAndDecrypt(env);
      if (op && typeof op.opId === 'string') {
        decoded.push(op);
      }
    }
    return decoded;
  }

  function requestFullHistoryInternal(): Promise<CommandOperation[]> {
    return new Promise((resolve, reject) => {
      if (!ws || ws.readyState !== WebSocket.OPEN || !hkId) {
        reject(new Error('unavailable'));
        return;
      }
      const needsStart = historyResolvers.length === 0;
      historyResolvers.push(resolve);
      if (needsStart) {
        historyBuffer = [];
        ws.send(
          JSON.stringify([
            seq++,
            'MSG',
            hkId,
            JSON.stringify(['GET_FULL_HISTORY', credentials.channelId]),
          ])
        );
      }
    });
  }

  function connect(): Promise<void> {
    if (readyPromise) return readyPromise;
    readyPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      const socket = wsFactory(credentials.wsUrl);
      ws = socket;
      myId = null;
      hkId = null;

      const connectTimeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          readyPromise = null;
          try { socket.close(); } catch {}
          reject(new Error('保存サーバーへの接続がタイムアウトしました。'));
        }
      }, 60000);
      (connectTimeout as any)?.unref?.();

      socket.addEventListener('error', () => {
        if (!settled) {
          settled = true;
          clearTimeout(connectTimeout);
          readyPromise = null;
          reject(new Error('保存サーバーに接続できません。'));
        }
      });

      socket.addEventListener('close', () => {
        clearTimeout(connectTimeout);
        readyPromise = null;
        ws = null;
        hkId = null;
        if (!closed && hasEverConnected) {
          clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(() => {
            void connect().catch(() => {});
          }, 1500);
          (reconnectTimer as any)?.unref?.();
        }
      });

      socket.addEventListener('message', async (ev) => {
        const text = typeof ev.data === 'string' ? ev.data : '';
        let parsed: any;
        try {
          parsed = JSON.parse(text);
        } catch {
          return;
        }
        if (!Array.isArray(parsed)) return;

        if (parsed[1] === 'ACK' && typeof parsed[0] === 'number') {
          const resolveAck = ackResolvers.get(parsed[0]);
          if (resolveAck) {
            ackResolvers.delete(parsed[0]);
            resolveAck();
          }
          return;
        }

        if (parsed[2] === 'IDENT') {
          myId = parsed[3];
          socket.send(JSON.stringify([seq++, 'JOIN', credentials.channelId]));
        } else if (parsed[2] === 'JOIN' && parsed[3] === credentials.channelId) {
          const memberId = parsed[1];
          if (memberId !== myId && !hkId) {
            hkId = memberId;
            const txid = bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(4)));
            // Register validateKey metadata on new channel (ignored by server if already exists)
            socket.send(
              JSON.stringify([
                seq++,
                'MSG',
                hkId,
                JSON.stringify([
                  'GET_HISTORY',
                  credentials.channelId,
                  {
                    validateKey: credentials.validateKeyBase64,
                    metadata: { validateKey: credentials.validateKeyBase64 },
                    txid,
                  },
                ]),
              ])
            );

            try {
              const ops = await requestFullHistoryInternal();
              hasEverConnected = true;
              recomputeState(ops);
              if (!settled) {
                settled = true;
                clearTimeout(connectTimeout);
                resolve();
              }
            } catch (e) {
              if (!settled) {
                settled = true;
                clearTimeout(connectTimeout);
                readyPromise = null;
                reject(e);
              }
            }
          }
        } else if (
          parsed[2] === 'MSG' &&
          parsed[3] === credentials.channelId &&
          typeof parsed[4] === 'string'
        ) {
          const op = await codec.verifyAndDecrypt(parsed[4]);
          if (op && typeof op.opId === 'string') {
            if (!operations.some(existing => existing.opId === op.opId)) {
              recomputeState([...operations, op]);
            }
          }
        } else if (
          parsed[2] === 'MSG' &&
          parsed[1] === hkId &&
          typeof parsed[4] === 'string'
        ) {
          try {
            const inner = JSON.parse(parsed[4]);
            if (Array.isArray(inner) && inner[0] === 'FULL_HISTORY' && Array.isArray(inner[1])) {
              if (typeof inner[1][4] === 'string') {
                historyBuffer.push(inner[1][4]);
              }
            } else if (Array.isArray(inner) && inner[0] === 'FULL_HISTORY_END') {
              const rawList = historyBuffer.slice();
              const resolvers = historyResolvers.splice(0, historyResolvers.length);
              historyBuffer = [];
              const ops = await decodeEnvelopes(rawList);
              for (const r of resolvers) r(ops);
            }
          } catch {}
        }
      });
    });
    return readyPromise;
  }

  async function ensureReady(): Promise<void> {
    if (ws && ws.readyState === WebSocket.OPEN && hkId) return;
    await connect();
  }

  function connectInBackground(): void {
    if (closed || backgroundRetryTimer) return;
    connect().catch(() => {
      if (closed) return;
      backgroundRetryTimer = setTimeout(() => {
        backgroundRetryTimer = undefined;
        connectInBackground();
      }, 5000);
      (backgroundRetryTimer as any)?.unref?.();
    });
  }

  // 読み取り用: 一時保存があれば待たずにそれを返し、最新の履歴は裏で取りに行く。
  // 書き込み(commitOperation)は従来どおり ensureReady で接続完了を待つ。
  async function ensureReadyOrCached(): Promise<void> {
    if (ws && ws.readyState === WebSocket.OPEN && hkId) return;
    if (operations.length > 0) {
      connectInBackground();
      return;
    }
    await connect();
  }

  async function syncHistory(): Promise<TransportState> {
    await ensureReady();
    const ops = await requestFullHistoryInternal();
    recomputeState(ops);
    return { documents: state.documents, outcomes: state.outcomes, operations };
  }

  async function commitOperation(op: CommandOperation): Promise<void> {
    if (credentials.readOnly) {
      const err: any = new Error('閲覧用リンクでは編集できません。');
      err.code = 'permission-denied';
      throw err;
    }
    await ensureReady();
    const signed = await codec.encryptAndSign(op);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      const err: any = new Error('保存サーバーに接続できません。');
      err.code = 'unavailable';
      throw err;
    }
    const sendSeq = seq++;
    const ackPromise = new Promise<boolean>(resolve => {
      const timer = setTimeout(() => {
        ackResolvers.delete(sendSeq);
        resolve(false);
      }, 2500);
      (timer as any)?.unref?.();
      ackResolvers.set(sendSeq, () => {
        clearTimeout(timer);
        resolve(true);
      });
    });

    ws.send(JSON.stringify([sendSeq, 'MSG', credentials.channelId, signed]));

    const acked = await ackPromise;
    if (acked) {
      if (!operations.some(existing => existing.opId === op.opId)) {
        recomputeState([...operations, op]);
      }
      const fastOutcome = state.outcomes.get(op.opId);
      if (fastOutcome?.status === 'committed' || fastOutcome?.status === 'duplicate_ignored') {
        if (operations.length >= 100 && !op.snapshot) {
          void maybeSendCheckpoint();
        }
        return;
      }
    }

    // Fallback or conflict verification against History Keeper
    for (let waitAttempt = 0; waitAttempt < 4; waitAttempt++) {
      await new Promise(r => setTimeout(r, 150 * (waitAttempt + 1)));
      const synced = await syncHistory();
      const outcome = synced.outcomes.get(op.opId);
      if (outcome) {
        if (outcome.status === 'committed' || outcome.status === 'duplicate_ignored') {
          return;
        }
        if (outcome.status === 'aborted') {
          const err: any = new Error('別の端末で更新されました。');
          err.code = 'aborted';
          throw err;
        }
        const err: any = new Error(outcome.reason || '保存できませんでした。');
        err.code = 'invalid-argument';
        throw err;
      }
    }
    const err: any = new Error('保存の確認がタイムアウトしました。');
    err.code = 'unavailable';
    throw err;
  }

  async function maybeSendCheckpoint(): Promise<void> {
    if (credentials.readOnly || !ws || ws.readyState !== WebSocket.OPEN) return;
    const docs = Array.from(state.documents.values()).map(d => structuredClone(d));
    if (docs.length === 0) return;
    const checkpointOp: CommandOperation = {
      protocolVersion: 1,
      opId: `ckpt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      reads: docs.map(d => ({ collection: d.collection, id: d.id, version: d.version })),
      writes: [],
      snapshot: docs,
    };
    try {
      const signed = await codec.encryptAndSign(checkpointOp);
      ws.send(JSON.stringify([seq++, 'MSG', credentials.channelId, signed]));
      recomputeState([...operations, checkpointOp]);
    } catch {}
  }

  function getDocument(collection: string, id: string): StoredDocument | null {
    const found = state.documents.get(`${collection}/${id}`);
    return found ? structuredClone(found) : null;
  }

  function listCollection(collection: string): StoredDocument[] {
    const docs: StoredDocument[] = [];
    for (const doc of state.documents.values()) {
      if (doc.collection === collection) docs.push(structuredClone(doc));
    }
    docs.sort((a, b) => a.id.localeCompare(b.id));
    return docs;
  }

  function close(): void {
    closed = true;
    clearTimeout(reconnectTimer);
    clearTimeout(backgroundRetryTimer);
    clearTimeout(saveTimer);
    void saveCachedOps(credentials.channelId, operations);
    try { ws?.close(); } catch {}
    ws = null;
  }

  return {
    credentials,
    ensureReady,
    ensureReadyOrCached,
    syncHistory,
    commitOperation,
    getDocument,
    listCollection,
    close,
  };
}
