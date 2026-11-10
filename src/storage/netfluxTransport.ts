import type { CommandOperation, StoredDocument, OperationOutcome } from './commandReducer';
import { replayCommandLog } from './commandReducer';
import type { ChannelCredentials } from './cryptoCodec';
import { createCryptoCodec } from './cryptoCodec';

export type TransportState = {
  documents: Map<string, StoredDocument>;
  outcomes: Map<string, OperationOutcome>;
  operations: CommandOperation[];
};

export type ConnectionStatus = 'connecting' | 'online' | 'offline';

export type NetfluxTransportOptions = {
  credentials: ChannelCredentials;
  seedDocuments?: StoredDocument[];
  onInvalidate?: () => void;
  onStatus?: (status: ConnectionStatus) => void;
  webSocketFactory?: (url: string) => WebSocket;
  /** テスト用: チェックポイントを書く間隔(操作の件数) */
  checkpointInterval?: number;
  /** テスト用: チェックポイントを書くまでの待ち時間(ミリ秒)。未指定は 1.5〜5 秒 */
  checkpointDelayMs?: number;
};

const LEGACY_CACHE_KEY_PREFIX = 'ex_schedule_e2ee_ops_v1_';
const CACHE_DB_NAME = 'ex_schedule_cache';
const CACHE_STORE = 'ops';
const CACHE_V2_SUFFIX = '#v2';

/** サーバーが履歴の位置を見分けるのに使う、メッセージ先頭の文字数 */
const HASH_LENGTH = 64;
/** チェックポイント(その時点の全データの写し)の目印。保存サーバーはこの目印より前の履歴を新しい端末へ送らない */
const CHECKPOINT_PREFIX = /^cp\|(?:[A-Za-z0-9+/=_-]+\|)?/;
const DEFAULT_CHECKPOINT_INTERVAL = 50;
const CONNECT_TIMEOUT_MS = 60000;
const HISTORY_IDLE_TIMEOUT_MS = 45000;
const ACK_TIMEOUT_MS = 10000;
/** 保存の操作で、接続を待つ上限。これを超えたら「つながっていない」と早めに知らせる */
const WRITE_READY_TIMEOUT_MS = 10000;
/** サーバーは約25秒ごとに PING を送る。これより長く何も届かなければ切れたとみなす */
const SILENCE_LIMIT_MS = 75000;

type CacheRecord = {
  v: 2;
  seed: StoredDocument[];
  ops: CommandOperation[];
  tailHash: string | null;
  checkpointTotal: number;
};

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

function idbGet(db: IDBDatabase, key: string): Promise<unknown> {
  return new Promise(resolve => {
    try {
      const req = db.transaction(CACHE_STORE, 'readonly').objectStore(CACHE_STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function idbWrite(db: IDBDatabase, run: (store: IDBObjectStore) => void): Promise<boolean> {
  return new Promise(resolve => {
    try {
      const tx = db.transaction(CACHE_STORE, 'readwrite');
      run(tx.objectStore(CACHE_STORE));
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

async function loadCache(channelId: string): Promise<{ record: CacheRecord | null; legacyOps: CommandOperation[] }> {
  const db = await getCacheDb();
  if (db) {
    const current = (await idbGet(db, channelId + CACHE_V2_SUFFIX)) as CacheRecord | null;
    if (current && current.v === 2 && Array.isArray(current.ops) && Array.isArray(current.seed)) {
      return { record: current, legacyOps: [] };
    }
    // 以前の版の一時保存(最初からの全履歴)。画面をすぐ出すためだけに使う
    const legacy = await idbGet(db, channelId);
    if (Array.isArray(legacy) && legacy.length > 0) return { record: null, legacyOps: legacy as CommandOperation[] };
  }
  try {
    if (typeof localStorage === 'undefined') return { record: null, legacyOps: [] };
    const raw = localStorage.getItem(LEGACY_CACHE_KEY_PREFIX + channelId);
    const parsed = raw ? JSON.parse(raw) : null;
    return { record: null, legacyOps: Array.isArray(parsed) ? parsed : [] };
  } catch {
    return { record: null, legacyOps: [] };
  }
}

async function saveCache(channelId: string, record: CacheRecord): Promise<void> {
  const db = await getCacheDb();
  if (!db) return;
  const saved = await idbWrite(db, store => {
    store.put(record, channelId + CACHE_V2_SUFFIX);
    // 以前の版の一時保存は数十MBになるため、新しい形式で保存できたら消す
    store.delete(channelId);
  });
  if (saved) {
    try { localStorage.removeItem(LEGACY_CACHE_KEY_PREFIX + channelId); } catch {}
  }
}

const isCheckpointOp = (op: CommandOperation): boolean => !!op.checkpoint;

/** 一時保存と再生用: チェックポイントの中身(全データの写し)は外して目印だけ残す */
function stubOf(op: CommandOperation): CommandOperation {
  if (!op.checkpoint || !op.checkpoint.docs) return op;
  return { ...op, checkpoint: { basis: op.checkpoint.basis } };
}

function sameVersions(documents: Map<string, StoredDocument>, docs: StoredDocument[]): boolean {
  if (documents.size !== docs.length) return false;
  for (const doc of docs) {
    if (documents.get(`${doc.collection}/${doc.id}`)?.version !== doc.version) return false;
  }
  return true;
}

function codedError(code: string, message: string): Error {
  const err: any = new Error(message);
  err.code = code;
  return err;
}

type HistoryRequest = {
  txid: string;
  messages: string[];
  resolve: (messages: string[]) => void;
  reject: (error: Error) => void;
  idleTimer: ReturnType<typeof setTimeout> | undefined;
};

export async function createNetfluxTransport(options: NetfluxTransportOptions) {
  const { credentials, seedDocuments = [], onInvalidate, onStatus } = options;
  const checkpointInterval = options.checkpointInterval ?? DEFAULT_CHECKPOINT_INTERVAL;
  const codec = await createCryptoCodec(credentials);
  const wsFactory = options.webSocketFactory || ((url: string) => new WebSocket(url));

  // 現在の状態 = seed(基準にしたチェックポイントの写し) に operations を順に適用したもの
  let seed: StoredDocument[] = seedDocuments;
  let operations: CommandOperation[] = [];
  let knownOpIds = new Set<string>();
  /** operations の末尾までを受信済みと言える、サーバー上の最後のメッセージの目印 */
  let tailHash: string | null = null;
  let checkpointTotal = 0;
  /** 最新のチェックポイントが、新しい端末の読み込みに使える形で並んでいるか */
  let lastCheckpointUsable = true;

  const cached = await loadCache(credentials.channelId);
  if (cached.record) {
    seed = cached.record.seed;
    operations = cached.record.ops;
    tailHash = cached.record.tailHash;
    checkpointTotal = cached.record.checkpointTotal || 0;
  } else if (cached.legacyOps.length > 0) {
    operations = cached.legacyOps;
  }
  knownOpIds = new Set(operations.map(op => op.opId));
  let state = replayCommandLog(operations, seed);

  let ws: WebSocket | null = null;
  let seq = 1;
  let myId: string | null = null;
  let hkId: string | null = null;
  let synced = false;
  let closed = false;
  let status: ConnectionStatus = 'connecting';
  let readyPromise: Promise<void> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectDelay = 1500;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let checkpointTimer: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setInterval> | undefined;
  let lastFrameAt = Date.now();
  let historyRequest: HistoryRequest | null = null;
  let liveBuffer: string[] = [];
  const ackHandlers = new Map<number, () => void>();
  /** 受信フレームの直列処理。保存前はこれが空くのを待ち、受信済みの更新を取りこぼさない */
  let frameChain: Promise<void> = Promise.resolve();

  function setStatus(next: ConnectionStatus) {
    if (status === next) return;
    status = next;
    try { onStatus?.(next); } catch {}
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void saveCache(credentials.channelId, { v: 2, seed, ops: operations, tailHash, checkpointTotal });
    }, 500);
    (saveTimer as any)?.unref?.();
  }

  function recompute() {
    state = replayCommandLog(operations, seed);
    scheduleSave();
    onInvalidate?.();
  }

  function replaceLog(nextSeed: StoredDocument[], nextOps: CommandOperation[]) {
    seed = nextSeed;
    operations = nextOps;
  }

  /** チェックポイントに吸収されて手元の履歴から外れた操作の結果。保存の成否確認に使う */
  const retainedOutcomes = new Map<string, OperationOutcome>();
  function retainOutcomes(outcomes: Map<string, OperationOutcome>) {
    if (retainedOutcomes.size > 5000) retainedOutcomes.clear();
    for (const [id, outcome] of outcomes) retainedOutcomes.set(id, outcome);
  }

  /** チェックポイントを基準に置き換えて、手元の履歴を短く保つ。基準が手元に無い・内容が合わない時は何もしない */
  function rebaseOnto(checkpoint: CommandOperation): boolean {
    const docs = checkpoint.checkpoint?.docs;
    const basis = checkpoint.checkpoint?.basis;
    if (!docs || !basis) return false;
    const basisIndex = operations.findIndex(op => op.opId === basis);
    if (basisIndex < 0) return false;
    const atBasis = replayCommandLog(operations.slice(0, basisIndex + 1), seed);
    if (!sameVersions(atBasis.documents, docs)) return false;
    // 吸収される操作のIDと結果は残す(同じ操作が後から届いても二重に適用しない・保存結果を答えられる)
    retainOutcomes(atBasis.outcomes);
    replaceLog(docs, operations.slice(basisIndex + 1));
    return true;
  }

  /** サーバーの並び順どおりに1件を取り込む。追加したら true */
  function appendOperation(op: CommandOperation, message: string): boolean {
    tailHash = message.slice(0, HASH_LENGTH);
    if (knownOpIds.has(op.opId)) return false;
    knownOpIds.add(op.opId);
    operations.push(stubOf(op));
    if (op.checkpoint?.docs) {
      checkpointTotal++;
      lastCheckpointUsable = rebaseOnto(op);
    }
    return true;
  }

  async function decode(message: string): Promise<CommandOperation | null> {
    const op = await codec.verifyAndDecrypt(message.replace(CHECKPOINT_PREFIX, ''));
    return op && typeof op.opId === 'string' && op.opId ? op : null;
  }

  async function decodeAll(messages: string[]): Promise<{ op: CommandOperation; message: string }[]> {
    const decoded: { op: CommandOperation; message: string }[] = [];
    for (const message of messages) {
      const op = await decode(message);
      if (op) decoded.push({ op, message });
    }
    return decoded;
  }

  function sendToHistoryKeeper(socket: WebSocket, payload: unknown[]) {
    socket.send(JSON.stringify([seq++, 'MSG', hkId, JSON.stringify(payload)]));
  }

  function armHistoryTimer(socket: WebSocket) {
    if (!historyRequest) return;
    clearTimeout(historyRequest.idleTimer);
    historyRequest.idleTimer = setTimeout(() => dropSocket(socket), HISTORY_IDLE_TIMEOUT_MS);
    (historyRequest.idleTimer as any)?.unref?.();
  }

  function requestHistory(socket: WebSocket, kind: 'window' | 'full', lastKnownHash?: string | null): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const txid = Math.random().toString(16).slice(2, 10) || 'tx';
      historyRequest = { txid, messages: [], resolve, reject, idleTimer: undefined };
      armHistoryTimer(socket);
      if (kind === 'full') {
        sendToHistoryKeeper(socket, ['GET_FULL_HISTORY', credentials.channelId]);
      } else {
        const config: Record<string, unknown> = {
          txid,
          // 新しいチャンネルでは書き込みの署名検証キーを登録する(既存チャンネルでは無視される)
          validateKey: credentials.validateKeyBase64,
          metadata: { validateKey: credentials.validateKeyBase64 },
        };
        if (lastKnownHash) config.lastKnownHash = lastKnownHash;
        sendToHistoryKeeper(socket, ['GET_HISTORY', credentials.channelId, config]);
      }
    });
  }

  function finishHistory(error?: Error) {
    const request = historyRequest;
    if (!request) return;
    historyRequest = null;
    clearTimeout(request.idleTimer);
    if (error) request.reject(error);
    else request.resolve(request.messages);
  }

  /** 途中からの履歴(先頭がチェックポイント)から状態を組み立てる。組み立てられない時は null */
  function buildFromWindow(entries: { op: CommandOperation; message: string }[]): { seed: StoredDocument[]; ops: CommandOperation[] } | null {
    const position = new Map<string, number>();
    entries.forEach((entry, index) => { if (!position.has(entry.op.opId)) position.set(entry.op.opId, index); });
    for (let i = entries.length - 1; i >= 0; i--) {
      const checkpoint = entries[i].op.checkpoint;
      if (!checkpoint?.docs || !checkpoint.basis) continue;
      const basisIndex = position.get(checkpoint.basis);
      // 基準の操作がこの範囲に入っていれば、基準より後の操作を取りこぼさずに再現できる
      if (basisIndex === undefined || basisIndex >= i) continue;
      return { seed: checkpoint.docs, ops: entries.slice(basisIndex + 1).map(entry => stubOf(entry.op)) };
    }
    return null;
  }

  /** 待っている間に接続が入れ替わっていたら、古い接続の結果で状態を書き換えない */
  function assertCurrent(socket: WebSocket) {
    if (ws !== socket) throw codedError('unavailable', '保存サーバーとの接続が切れました。');
  }

  async function synchronize(socket: WebSocket): Promise<void> {
    if (tailHash) {
      try {
        const entries = await decodeAll(await requestHistory(socket, 'window', tailHash));
        assertCurrent(socket);
        for (const entry of entries) appendOperation(entry.op, entry.message);
        return;
      } catch (error: any) {
        if (error?.code !== 'EUNKNOWN' && error?.code !== 'EINVAL') throw error;
        // 手元の位置がサーバーに無い → 最初から読み直す
      }
    }
    const messages = await requestHistory(socket, 'window');
    const partial = messages.length > 0 && CHECKPOINT_PREFIX.test(messages[0]);
    let entries = await decodeAll(messages);
    assertCurrent(socket);
    const built = partial ? buildFromWindow(entries) : null;
    if (partial && !built) {
      assertCurrent(socket);
      entries = await decodeAll(await requestHistory(socket, 'full'));
      assertCurrent(socket);
    }
    if (built) {
      replaceLog(built.seed, built.ops);
      // 範囲内の操作はすべて受信済みとして覚える(基準より前の分も、後から重複して届くことがある)
      knownOpIds = new Set(entries.map(entry => entry.op.opId));
      checkpointTotal = Math.max(2, entries.filter(entry => entry.op.checkpoint).length);
      lastCheckpointUsable = true;
    } else {
      replaceLog(seedDocuments, []);
      knownOpIds = new Set();
      checkpointTotal = 0;
      lastCheckpointUsable = true;
      for (const entry of entries) appendOperation(entry.op, entry.message);
    }
    const last = entries.at(-1);
    tailHash = last ? last.message.slice(0, HASH_LENGTH) : null;
  }

  function dropSocket(socket: WebSocket | null) {
    if (!socket || ws !== socket) return;
    ws = null;
    hkId = null;
    myId = null;
    synced = false;
    readyPromise = null;
    liveBuffer = [];
    ackHandlers.clear();
    finishHistory(codedError('unavailable', '保存サーバーとの接続が切れました。'));
    try { socket.close(); } catch {}
    if (closed) return;
    setStatus('offline');
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      void connect().catch(() => {});
    }, reconnectDelay);
    (reconnectTimer as any)?.unref?.();
    reconnectDelay = Math.min(reconnectDelay * 2, 15000);
  }

  async function handleFrame(socket: WebSocket, text: string, onSynced: () => void, onFailed: (error: Error) => void) {
    if (ws !== socket) return;
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    if (!Array.isArray(parsed)) return;
    lastFrameAt = Date.now();

    if (parsed[1] === 'ACK' && typeof parsed[0] === 'number') {
      const handler = ackHandlers.get(parsed[0]);
      if (handler) {
        ackHandlers.delete(parsed[0]);
        handler();
      }
      return;
    }

    if (parsed[2] === 'PING') {
      // 応答しないとサーバーが約75秒で接続を切る
      parsed[2] = 'PONG';
      try { socket.send(JSON.stringify(parsed)); } catch {}
      return;
    }

    if (parsed[2] === 'IDENT') {
      myId = parsed[3];
      socket.send(JSON.stringify([seq++, 'JOIN', credentials.channelId]));
      return;
    }

    if (parsed[2] === 'JOIN' && parsed[3] === credentials.channelId) {
      if (parsed[1] === myId || hkId) return;
      hkId = parsed[1];
      // 履歴の本体はこの後のフレームで届くため、ここでは待たずに裏で進める
      void (async () => {
        try {
          await synchronize(socket);
          // 履歴の受信中に届いた新着を、順番を保って取り込む
          while (liveBuffer.length) {
            if (ws !== socket) return;
            const buffered = liveBuffer;
            liveBuffer = [];
            const decodedBuffer = await decodeAll(buffered);
            if (ws !== socket) return;
            for (const entry of decodedBuffer) appendOperation(entry.op, entry.message);
          }
          if (ws !== socket) return;
          synced = true;
          reconnectDelay = 1500;
          recompute();
          setStatus('online');
          onSynced();
          scheduleCheckpoint();
        } catch (error: any) {
          onFailed(error instanceof Error ? error : new Error('unavailable'));
          dropSocket(socket);
        }
      })();
      return;
    }

    if (parsed[2] === 'MSG' && parsed[3] === credentials.channelId && typeof parsed[4] === 'string') {
      if (!synced) {
        liveBuffer.push(parsed[4]);
        return;
      }
      const op = await decode(parsed[4]);
      if (op && ws === socket && appendOperation(op, parsed[4])) recompute();
      return;
    }

    if (parsed[2] === 'MSG' && parsed[1] === hkId && typeof parsed[4] === 'string' && historyRequest) {
      // 履歴の応答が届いている間だけ待ち時間を延ばす(PING だけが続く時は打ち切る)
      armHistoryTimer(socket);
      let inner: any;
      try {
        inner = JSON.parse(parsed[4]);
      } catch {
        return;
      }
      if (Array.isArray(inner)) {
        if (inner[0] === 'FULL_HISTORY' && Array.isArray(inner[1]) && typeof inner[1][4] === 'string') {
          historyRequest.messages.push(inner[1][4]);
        } else if (inner[0] === 'FULL_HISTORY_END') {
          finishHistory();
        } else if (inner[0] === historyRequest.txid && inner[2] === 'MSG' && typeof inner[4] === 'string') {
          historyRequest.messages.push(inner[4]);
        }
      } else if (inner && typeof inner === 'object' && inner.txid === historyRequest.txid) {
        if (inner.error) finishHistory(codedError(String(inner.error), '履歴を取得できませんでした。'));
        else if (inner.state === 1) finishHistory();
      }
    }
  }

  function connect(): Promise<void> {
    if (readyPromise) return readyPromise;
    if (closed) return Promise.reject(codedError('unavailable', '保存サーバーに接続できません。'));
    clearTimeout(reconnectTimer);
    setStatus('connecting');
    readyPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      const socket = wsFactory(credentials.wsUrl);
      ws = socket;
      myId = null;
      hkId = null;
      synced = false;
      lastFrameAt = Date.now();

      const connectTimeout = setTimeout(() => {
        // 履歴を受信し続けている間は待つ(止まった時は履歴側の待ち時間で切る)
        if (settled || historyRequest) return;
        fail(new Error('保存サーバーへの接続がタイムアウトしました。'));
        dropSocket(socket);
      }, CONNECT_TIMEOUT_MS);
      (connectTimeout as any)?.unref?.();

      const succeed = () => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimeout);
        resolve();
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimeout);
        reject(error);
      };

      socket.addEventListener('error', () => {
        fail(codedError('unavailable', '保存サーバーに接続できません。'));
        dropSocket(socket);
      });
      socket.addEventListener('close', () => {
        fail(codedError('unavailable', '保存サーバーに接続できません。'));
        dropSocket(socket);
      });

      // 受信した順番(=サーバーの並び順)を崩さないよう、1件ずつ直列に処理する
      socket.addEventListener('message', (ev: MessageEvent) => {
        const text = typeof ev.data === 'string' ? ev.data : '';
        frameChain = frameChain.then(() => handleFrame(socket, text, succeed, fail)).catch(() => {});
      });
    });
    readyPromise.catch(() => {});
    return readyPromise;
  }

  async function ensureReady(): Promise<void> {
    if (ws && synced) return;
    await connect();
  }

  /** 保存用: 接続を一定時間だけ待つ。つながらなければ、長く待たせずに失敗を返す(接続の試行は裏で続く) */
  async function ensureReadyForWrite(): Promise<void> {
    if (ws && synced) {
      await frameChain;
      if (ws && synced) return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        connect(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(codedError('unavailable', '保存サーバーにつながっていません。接続表示が「同期中」に戻ってから、もう一度お試しください。')),
            WRITE_READY_TIMEOUT_MS
          );
          (timer as any)?.unref?.();
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  // 読み取り用: 一時保存があれば待たずにそれを返し、最新の履歴は裏で取りに行く。
  // 書き込みと、書き込み前の読み取りは ensureReady で最新になるのを待つ。
  async function ensureReadyOrCached(): Promise<void> {
    if (ws && synced) return;
    if (operations.length > 0 || seed !== seedDocuments) {
      void connect().catch(() => {});
      return;
    }
    await connect();
  }

  function outcomeError(outcome: OperationOutcome): Error {
    if (outcome.status === 'aborted') return codedError('aborted', '別の端末で更新されました。');
    return codedError('invalid-argument', outcome.reason || '保存できませんでした。');
  }

  async function commitOperation(op: CommandOperation): Promise<void> {
    if (credentials.readOnly) throw codedError('permission-denied', '閲覧用リンクでは編集できません。');
    await ensureReadyForWrite();
    const signed = await codec.encryptAndSign(op);
    const socket = ws;
    if (!socket || !synced) throw codedError('unavailable', '保存サーバーに接続できません。');

    const sendSeq = seq++;
    const acked = await new Promise<boolean>(resolve => {
      const timer = setTimeout(() => {
        ackHandlers.delete(sendSeq);
        resolve(false);
      }, ACK_TIMEOUT_MS);
      (timer as any)?.unref?.();
      // 受信の直列処理の中で取り込むことで、他の人の操作との前後関係をサーバーと一致させる
      ackHandlers.set(sendSeq, () => {
        clearTimeout(timer);
        if (appendOperation(op, signed)) recompute();
        resolve(true);
      });
      try {
        socket.send(JSON.stringify([sendSeq, 'MSG', credentials.channelId, signed]));
      } catch {
        clearTimeout(timer);
        ackHandlers.delete(sendSeq);
        resolve(false);
      }
    });

    if (!acked) {
      // 届いたか分からない → つなぎ直して差分だけ読み、結果を確かめる
      dropSocket(socket);
      try {
        await ensureReadyForWrite();
      } catch {
        throw codedError('unavailable', '保存の確認ができませんでした。通信環境を確認して、もう一度お試しください。');
      }
    }

    const outcome = state.outcomes.get(op.opId) || retainedOutcomes.get(op.opId);
    if (!outcome) throw codedError('unavailable', '保存の確認ができませんでした。通信環境を確認して、もう一度お試しください。');
    if (outcome.status !== 'committed' && outcome.status !== 'duplicate_ignored') throw outcomeError(outcome);
    scheduleCheckpoint();
  }

  function shouldCheckpoint(): boolean {
    if (credentials.readOnly || closed || !ws || !synced || state.documents.size === 0) return false;
    if (!lastCheckpointUsable || checkpointTotal === 1) return true;
    let sinceCheckpoint = 0;
    for (let i = operations.length - 1; i >= 0 && !isCheckpointOp(operations[i]); i--) sinceCheckpoint++;
    return sinceCheckpoint >= checkpointInterval;
  }

  function scheduleCheckpoint() {
    if (checkpointTimer || !shouldCheckpoint()) return;
    // 複数の端末が同時に書かないよう、少し待ってから条件を確かめ直す
    const delay = options.checkpointDelayMs ?? 1500 + Math.random() * 3500;
    checkpointTimer = setTimeout(() => {
      checkpointTimer = undefined;
      void sendCheckpoint();
    }, delay);
    (checkpointTimer as any)?.unref?.();
  }

  async function sendCheckpoint(): Promise<void> {
    if (!shouldCheckpoint()) return;
    const socket = ws;
    const basis = operations.at(-1)?.opId;
    if (!socket || !basis) return;
    const random = Math.random().toString(36).slice(2, 10);
    const op: CommandOperation = {
      protocolVersion: 1,
      opId: `cp-${Date.now()}-${random}`,
      timestamp: new Date().toISOString(),
      reads: [],
      writes: [],
      checkpoint: { basis, docs: Array.from(state.documents.values()).map(doc => structuredClone(doc)) },
    };
    try {
      const message = `cp|${Date.now().toString(36)}${random}|${await codec.encryptAndSign(op)}`;
      if (ws !== socket || !synced) return;
      const sendSeq = seq++;
      ackHandlers.set(sendSeq, () => {
        if (appendOperation(op, message)) recompute();
        scheduleCheckpoint();
      });
      socket.send(JSON.stringify([sendSeq, 'MSG', credentials.channelId, message]));
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

  // 無通信が続いた接続(スマホが裏に回った後など)は、閉じた合図が来なくても切れたものとして扱う
  watchdog = setInterval(() => {
    if (ws && Date.now() - lastFrameAt > SILENCE_LIMIT_MS) dropSocket(ws);
  }, 15000);
  (watchdog as any)?.unref?.();

  const onVisible = () => {
    if (closed || typeof document === 'undefined' || document.visibilityState !== 'visible') return;
    if (ws && Date.now() - lastFrameAt > 40000) dropSocket(ws);
    else if (!ws) {
      reconnectDelay = 1500;
      void connect().catch(() => {});
    }
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
  if (typeof window !== 'undefined') window.addEventListener('online', onVisible);

  function close(): void {
    closed = true;
    clearTimeout(reconnectTimer);
    clearTimeout(saveTimer);
    clearTimeout(checkpointTimer);
    clearInterval(watchdog);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    if (typeof window !== 'undefined') window.removeEventListener('online', onVisible);
    void saveCache(credentials.channelId, { v: 2, seed, ops: operations, tailHash, checkpointTotal });
    const socket = ws;
    dropSocket(socket);
  }

  return {
    credentials,
    ensureReady,
    ensureReadyForWrite,
    ensureReadyOrCached,
    commitOperation,
    getDocument,
    listCollection,
    getStatus: () => status,
    getState: (): TransportState => ({ documents: state.documents, outcomes: state.outcomes, operations }),
    close,
  };
}
