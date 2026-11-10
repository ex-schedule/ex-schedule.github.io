// Unified storage layer supporting both serverless CryptPad E2EE persistent channels
// and local HTTP/SQLite test backend with identical Firestore-like transaction semantics.

import type {
  Data,
  StoredDocument,
  ReadPrecondition,
  WriteOperation,
  CommandOperation,
} from './storage/commandReducer';
import type { ChannelCredentials } from './storage/cryptoCodec';
import {
  generateNewChannelCredentials,
  parseShareHash,
  formatShareHash,
} from './storage/cryptoCodec';
import { createNetfluxTransport } from './storage/netfluxTransport';
import type { ConnectionStatus } from './storage/netfluxTransport';

export type { ConnectionStatus };

// 保存サーバーとの接続状態(画面の表示用)。ローカルサーバー利用時は常に online。
let connectionStatus: ConnectionStatus = 'online';
const statusListeners = new Set<(status: ConnectionStatus) => void>();
function publishStatus(next: ConnectionStatus) {
  connectionStatus = next;
  for (const listener of statusListeners) listener(next);
}
export function getConnectionStatus(): ConnectionStatus {
  return connectionStatus;
}
export function subscribeConnectionStatus(listener: (status: ConnectionStatus) => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

export type { ChannelCredentials };
export { generateNewChannelCredentials, parseShareHash, formatShareHash };

export type DocumentReference = {
  kind: 'document';
  db: DocumentClient;
  collection: string;
  id: string;
};

export type CollectionReference = {
  kind: 'collection';
  db: DocumentClient;
  collection: string;
};

export class StorageError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export class FieldPath {
  segments: string[];
  constructor(...segments: string[]) {
    this.segments = segments;
  }
}

export class DocumentSnapshot {
  id: string;
  version: number;
  constructor(private record: StoredDocument | null, ref: DocumentReference) {
    this.id = ref.id;
    this.version = record?.version || 0;
  }
  exists(): boolean {
    return this.record !== null;
  }
  data(): any {
    return this.record ? structuredClone(this.record.data) : undefined;
  }
}

export class CollectionSnapshot {
  docs: DocumentSnapshot[];
  constructor(records: StoredDocument[], ref: CollectionReference) {
    this.docs = records.map(
      record =>
        new DocumentSnapshot(record, {
          kind: 'document',
          db: ref.db,
          collection: ref.collection,
          id: record.id,
        })
    );
  }
  forEach(callback: (document: DocumentSnapshot) => void): void {
    this.docs.forEach(callback);
  }
}

type Listener = { ref: DocumentReference | CollectionReference; refresh: () => void };

export type DocumentClient = {
  request: (path: string, init?: RequestInit) => Promise<any>;
  subscribe: (listener: Listener) => () => void;
  close?: () => void;
};

const ACTIVE_HASH_STORAGE_KEY = 'ex_schedule_active_share_hash_v1';
const DEFAULT_SHARED_EDIT_HASH =
  '#ch=6bfb4e7051e0512db416ed77272a214f&k=H1v6HzcScIhTBLBG_5_KFxGdplm4JWZt3Nty2igD2yk&s=PtBhgQTxv1rxsN-7axzELS78bDtz79--kxnRH9POy-4';
const DEFAULT_SHARED_VIEW_HASH =
  '#ch=6bfb4e7051e0512db416ed77272a214f&k=H1v6HzcScIhTBLBG_5_KFxGdplm4JWZt3Nty2igD2yk&v=s9xob80sBjLmqVdWGDyV4uT-0itxIzOkZke9jr5lYpI';
let activeCredentials: ChannelCredentials | null = null;

export function getActiveShareLinks(baseUrl?: string): { editUrl: string; viewUrl: string } | null {
  if (!activeCredentials) return null;
  const base =
    baseUrl ||
    (typeof window !== 'undefined'
      ? window.location.origin + window.location.pathname
      : 'https://arweave.net/');
  return {
    editUrl: activeCredentials.editSeedBase64Url
      ? base + formatShareHash(activeCredentials, 'edit')
      : '',
    viewUrl: base + formatShareHash(activeCredentials, 'view'),
  };
}

export async function createCryptPadDocumentClient(
  credentials: ChannelCredentials,
  options: {
    seedDocuments?: StoredDocument[];
    webSocketFactory?: (url: string) => WebSocket;
    checkpointInterval?: number;
    checkpointDelayMs?: number;
    onStatus?: (status: ConnectionStatus) => void;
  } = {}
): Promise<DocumentClient> {
  const listeners = new Set<Listener>();
  const transport = await createNetfluxTransport({
    credentials,
    seedDocuments: options.seedDocuments,
    webSocketFactory: options.webSocketFactory,
    checkpointInterval: options.checkpointInterval,
    checkpointDelayMs: options.checkpointDelayMs,
    onStatus: options.onStatus,
    onInvalidate() {
      for (const listener of listeners) listener.refresh();
    },
  });

  await transport.ensureReadyOrCached();

  async function request(path: string, init: RequestInit = {}): Promise<any> {
    if (path === '/api/session') {
      return {
        role: credentials.readOnly ? 'view' : 'edit',
        readOnly: credentials.readOnly,
      };
    }

    const docMatch = path.match(/^\/api\/documents\/([^/]+)\/([^/?]+)(\?fresh=1)?$/);
    if (docMatch) {
      const col = decodeURIComponent(docMatch[1]);
      const id = decodeURIComponent(docMatch[2]);
      if (docMatch[3]) {
        // 書き込み前の読み取り: 一時保存の古い内容を元に保存しないよう、最新になるのを待つ
        try {
          await transport.ensureReadyForWrite();
        } catch (err: any) {
          throw new StorageError('unavailable', err?.message || '保存サーバーに接続できません。');
        }
      } else {
        await transport.ensureReadyOrCached();
      }
      return { document: transport.getDocument(col, id) };
    }

    const colMatch = path.match(/^\/api\/collections\/([^/]+)$/);
    if (colMatch) {
      const col = decodeURIComponent(colMatch[1]);
      await transport.ensureReadyOrCached();
      return { documents: transport.listCollection(col) };
    }

    if (path === '/api/commit' && init.method === 'POST') {
      const body = init.body ? JSON.parse(String(init.body)) : {};
      const reads: ReadPrecondition[] = Array.isArray(body.reads) ? body.reads : [];
      const writes: WriteOperation[] = Array.isArray(body.writes) ? body.writes : [];
      const op: CommandOperation = {
        protocolVersion: 1,
        opId:
          globalThis.crypto?.randomUUID?.() ||
          `op-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        timestamp: new Date().toISOString(),
        reads,
        writes,
      };
      try {
        await transport.commitOperation(op);
        return { ok: true };
      } catch (err: any) {
        throw new StorageError(err?.code || 'unavailable', err?.message || '保存できませんでした。');
      }
    }

    throw new StorageError('not-found', 'APIが見つかりません。');
  }

  function subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return {
    request,
    subscribe,
    close() {
      transport.close();
    },
  };
}

let activeCryptPadClient: DocumentClient | null = null;

export function createDocumentClient(baseURL = '', fetcher: typeof fetch = fetch): DocumentClient {
  const listeners = new Set<Listener>();
  let controller: AbortController | null = null;
  let reconnect: ReturnType<typeof setTimeout> | undefined;

  async function request(path: string, init: RequestInit = {}) {
    if (!baseURL && activeCryptPadClient) {
      return activeCryptPadClient.request(path, init);
    }
    let response: Response;
    try {
      response = await fetcher(baseURL + path, {
        credentials: 'same-origin',
        ...init,
        headers: {
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers,
        },
      });
    } catch {
      throw new StorageError('unavailable', '保存サーバーに接続できません。');
    }
    const body = await response.json();
    if (!response.ok) {
      throw new StorageError(body.code || 'unavailable', body.error || '保存できませんでした。');
    }
    return body;
  }

  function invalidated(event: { refresh?: boolean; changes?: { collection: string; id: string }[] }) {
    for (const listener of listeners) {
      if (
        event.refresh ||
        event.changes?.some(
          change =>
            change.collection === listener.ref.collection &&
            (listener.ref.kind === 'collection' || change.id === listener.ref.id)
        )
      ) {
        listener.refresh();
      }
    }
  }

  async function connect() {
    if ((!baseURL && activeCryptPadClient) || !listeners.size || controller) return;
    controller = new AbortController();
    const current = controller;
    try {
      const response = await fetcher(baseURL + '/api/events', {
        credentials: 'same-origin',
        signal: current.signal,
      });
      if (!response.ok || !response.body) throw new Error('events unavailable');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (!current.signal.aborted) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const line = frame.split('\n').find(l => l.startsWith('data: '));
          if (line) invalidated(JSON.parse(line.slice(6)));
        }
      }
    } catch {
      /* Each listener's HTTP refresh reports errors; a new stream refreshes all data. */
    } finally {
      if (controller === current) controller = null;
      if (listeners.size && (baseURL || !activeCryptPadClient)) {
        reconnect = setTimeout(() => {
          void connect();
        }, 1000);
      }
    }
  }

  function subscribe(listener: Listener) {
    if (!baseURL && activeCryptPadClient) {
      return activeCryptPadClient.subscribe(listener);
    }
    listeners.add(listener);
    void connect();
    return () => {
      listeners.delete(listener);
      if (!listeners.size) {
        clearTimeout(reconnect);
        controller?.abort();
        controller = null;
      }
    };
  }

  return {
    request,
    subscribe,
    close() {
      if (!baseURL && activeCryptPadClient) {
        activeCryptPadClient.close?.();
      }
    },
  };
}

export const db = createDocumentClient('');

export function doc(store: DocumentClient, collection: string, id: string): DocumentReference {
  return { kind: 'document', db: store, collection, id };
}

export function collection(store: DocumentClient, name: string): CollectionReference {
  return { kind: 'collection', db: store, collection: name };
}

export function serverTimestamp() {
  return { __serverTimestamp: true };
}

export async function getDocFromServer(ref: DocumentReference, options: { fresh?: boolean } = {}) {
  const result = await ref.db.request(
    '/api/documents/' + encodeURIComponent(ref.collection) + '/' + encodeURIComponent(ref.id) +
      (options.fresh ? '?fresh=1' : '')
  );
  return new DocumentSnapshot(result.document, ref);
}

export async function setDoc(ref: DocumentReference, data: Data, options: { merge?: boolean } = {}) {
  await ref.db.request('/api/commit', {
    method: 'POST',
    body: JSON.stringify({
      reads: [],
      writes: [{ collection: ref.collection, id: ref.id, mode: 'set', data, merge: !!options.merge }],
    }),
  });
}

function updateFields(args: any[]) {
  const fields: { path: string[]; value: any }[] = [];
  if (args.length === 1 && !(args[0] instanceof FieldPath)) {
    for (const [key, value] of Object.entries(args[0])) {
      fields.push({ path: key.split('.'), value });
    }
  } else {
    if (args.length % 2) throw new StorageError('invalid-argument', '更新項目が不正です。');
    for (let i = 0; i < args.length; i += 2) {
      fields.push({
        path: args[i] instanceof FieldPath ? args[i].segments : String(args[i]).split('.'),
        value: args[i + 1],
      });
    }
  }
  return fields;
}

export async function updateDoc(ref: DocumentReference, ...args: any[]) {
  await ref.db.request('/api/commit', {
    method: 'POST',
    body: JSON.stringify({
      reads: [],
      writes: [{ collection: ref.collection, id: ref.id, mode: 'update', fields: updateFields(args) }],
    }),
  });
}

export async function runTransaction<T>(
  store: DocumentClient,
  callback: (transaction: {
    get: (ref: DocumentReference) => Promise<DocumentSnapshot>;
    set: (ref: DocumentReference, data: Data, options?: { merge?: boolean }) => void;
    update: (ref: DocumentReference, ...args: any[]) => void;
  }) => Promise<T>
): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const reads = new Map<string, { collection: string; id: string; version: number }>();
    const writes: any[] = [];
    const snapshots = new Map<string, DocumentSnapshot>();
    const result = await callback({
      async get(ref) {
        const identity = ref.collection + '/' + ref.id;
        if (snapshots.has(identity)) return snapshots.get(identity)!;
        const snapshot = await getDocFromServer(ref, { fresh: true });
        snapshots.set(identity, snapshot);
        reads.set(identity, { collection: ref.collection, id: ref.id, version: snapshot.version });
        return snapshot;
      },
      set(ref, data, options = {}) {
        writes.push({
          collection: ref.collection,
          id: ref.id,
          mode: 'set',
          data,
          merge: !!options.merge,
        });
      },
      update(ref, ...args) {
        writes.push({
          collection: ref.collection,
          id: ref.id,
          mode: 'update',
          fields: updateFields(args),
        });
      },
    });
    if (!writes.length) return result;
    try {
      await store.request('/api/commit', {
        method: 'POST',
        body: JSON.stringify({ reads: [...reads.values()], writes }),
      });
      return result;
    } catch (error) {
      if (!(error instanceof StorageError) || error.code !== 'aborted' || attempt === 4) throw error;
      await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
  throw new StorageError('aborted', '別の端末で更新されました。');
}

export function onSnapshot(
  ref: DocumentReference,
  next: (snapshot: DocumentSnapshot) => void,
  error?: (error: any) => void
): () => void;
export function onSnapshot(
  ref: CollectionReference,
  next: (snapshot: CollectionSnapshot) => void,
  error?: (error: any) => void
): () => void;
export function onSnapshot(
  ref: DocumentReference | CollectionReference,
  next: (snapshot: any) => void,
  error?: (error: any) => void
) {
  let active = true;
  let fetching = false;
  let again = false;
  async function refresh() {
    if (!active) return;
    if (fetching) {
      again = true;
      return;
    }
    fetching = true;
    try {
      let snapshot;
      if (ref.kind === 'document') snapshot = await getDocFromServer(ref);
      else {
        const result = await ref.db.request('/api/collections/' + encodeURIComponent(ref.collection));
        snapshot = new CollectionSnapshot(result.documents, ref);
      }
      if (active) next(snapshot);
    } catch (err) {
      if (active) error?.(err);
    } finally {
      fetching = false;
      if (again) {
        again = false;
        void refresh();
      }
    }
  }
  const unsubscribe = ref.db.subscribe({
    ref,
    refresh: () => {
      void refresh();
    },
  });
  void refresh();
  return () => {
    active = false;
    unsubscribe();
  };
}

export async function initializeSession() {
  const url = new URL(window.location.href);
  const hashParams = new URLSearchParams(url.hash.slice(1));

  // 1. Check if CryptPad E2EE share hash is in URL (hash or query) or saved in localStorage
  let creds =
    (await parseShareHash(url.hash)) || (await parseShareHash(url.search.slice(1)));
  if (!creds && !hashParams.get('key')) {
    try {
      const savedHash = localStorage.getItem(ACTIVE_HASH_STORAGE_KEY);
      if (savedHash) creds = await parseShareHash(savedHash);
    } catch {}
  }

  // 2. If explicit CryptPad credentials found, connect via serverless CryptPad E2EE channel
  if (creds) {
    activeCredentials = creds;
    const canonicalHash = formatShareHash(creds, creds.readOnly ? 'view' : 'edit');
    try {
      localStorage.setItem(ACTIVE_HASH_STORAGE_KEY, canonicalHash);
    } catch {}
    publishStatus('connecting');
    activeCryptPadClient = await createCryptPadDocumentClient(creds, { onStatus: publishStatus });
    if (creds.readOnly) url.searchParams.set('readonly', '1');
    else url.searchParams.delete('readonly');
    window.history.replaceState(null, '', url.pathname + url.search + canonicalHash);
    return;
  }

  // 3. Otherwise try local HTTP backend first (if running locally via `npm start`), fallback to the single shared team CryptPad channel
  const legacyKey = hashParams.get('key');
  try {
    activeCryptPadClient = null;
    let session;
    if (legacyKey) {
      session = await db.request('/api/session', {
        method: 'POST',
        body: JSON.stringify({ key: legacyKey }),
      });
      url.hash = '';
    } else {
      session = await db.request('/api/session');
    }
    if (session.readOnly) url.searchParams.set('readonly', '1');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    return;
  } catch {
    // No local Node server is present -> Serverless static mode!
    // Connect to the single shared team CryptPad E2EE channel so everyone (including PWA home-screen launches) shares 1 storage destination
    const wantReadOnly = url.searchParams.get('readonly') === '1';
    const defaultHash = wantReadOnly ? DEFAULT_SHARED_VIEW_HASH : DEFAULT_SHARED_EDIT_HASH;
    const fallbackCreds = (await parseShareHash(defaultHash)) || (await generateNewChannelCredentials());
    activeCredentials = fallbackCreds;
    const canonicalHash = formatShareHash(fallbackCreds, fallbackCreds.readOnly ? 'view' : 'edit');
    try {
      localStorage.setItem(ACTIVE_HASH_STORAGE_KEY, canonicalHash);
    } catch {}
    publishStatus('connecting');
    activeCryptPadClient = await createCryptPadDocumentClient(fallbackCreds, { onStatus: publishStatus });
    window.history.replaceState(null, '', url.pathname + url.search + canonicalHash);
  }
}
