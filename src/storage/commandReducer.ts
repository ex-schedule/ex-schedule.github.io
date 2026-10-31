export type Data = Record<string, any>;
export type StoredDocument = { collection: string; id: string; data: Data; version: number };

export type ReadPrecondition = {
  collection: string;
  id: string;
  version: number;
};

export type RequestPrecondition = {
  collection: string;
  id: string;
  member: string;
  dayIndex: number;
  requestId: string;
};

export type WriteOperation =
  | { collection: string; id: string; mode: 'set'; data: Data; merge?: boolean }
  | { collection: string; id: string; mode: 'update'; fields: { path: string[]; value: any }[] };

export type CommandOperation = {
  protocolVersion?: number;
  opId: string;
  timestamp: string;
  reads: ReadPrecondition[];
  expectedRequest?: RequestPrecondition;
  writes: WriteOperation[];
  snapshot?: StoredDocument[];
};

export type OperationOutcome = {
  status: 'committed' | 'aborted' | 'invalid' | 'duplicate_ignored';
  reason?: string;
};

const badKeys = new Set(['__proto__', 'prototype', 'constructor']);

export function checkPath(collection: string, id: string): void {
  if (
    !(collection === 'months' && /^\d{4}-(?:[1-9]|1[0-2])$/.test(id)) &&
    !(collection === 'settings' && id === 'global') &&
    !(collection === 'test' && id === 'connection')
  ) {
    throw new Error('invalid-argument: 保存先が不正です。');
  }
}

export function checkJSON(value: any, depth = 0): void {
  if (depth > 45) throw new Error('invalid-argument: データが複雑すぎます。');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    value.forEach(x => checkJSON(x, depth + 1));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (badKeys.has(key)) throw new Error('invalid-argument: 使用できない項目名です。');
      checkJSON(child, depth + 1);
    }
    return;
  }
  throw new Error('invalid-argument: 保存できない値です。');
}

function resolveTimestamps(value: any, now: string): any {
  if (Array.isArray(value)) return value.map(x => resolveTimestamps(x, now));
  if (value && typeof value === 'object') {
    if (value.__serverTimestamp === true && Object.keys(value).length === 1) return now;
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveTimestamps(v, now)]));
  }
  return value;
}

function mergeMaps(oldValue: any, patch: any): any {
  const result = structuredClone(oldValue || {});
  for (const [key, value] of Object.entries(patch)) {
    if (
      value && typeof value === 'object' && !Array.isArray(value) &&
      result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])
    ) {
      result[key] = mergeMaps(result[key], value);
    } else {
      result[key] = structuredClone(value);
    }
  }
  return result;
}

function setField(data: Data, segments: string[], value: any): void {
  if (
    !Array.isArray(segments) || !segments.length || segments.length > 16 ||
    segments.some(x => typeof x !== 'string' || !x || x.length > 512 || badKeys.has(x))
  ) {
    throw new Error('invalid-argument: 項目の指定が不正です。');
  }
  let cursor: any = data;
  for (const key of segments.slice(0, -1)) {
    if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[segments[segments.length - 1]] = structuredClone(value);
}

export function replayCommandLog(
  operations: CommandOperation[] = [],
  seedDocuments: StoredDocument[] = []
): {
  documents: Map<string, StoredDocument>;
  outcomes: Map<string, OperationOutcome>;
} {
  const documents = new Map<string, StoredDocument>();
  for (const doc of seedDocuments) {
    checkPath(doc.collection, doc.id);
    checkJSON(doc.data);
    documents.set(`${doc.collection}/${doc.id}`, {
      collection: doc.collection,
      id: doc.id,
      data: structuredClone(doc.data),
      version: Number.isInteger(doc.version) && doc.version > 0 ? doc.version : 1,
    });
  }

  const seenOpIds = new Set<string>();
  const outcomes = new Map<string, OperationOutcome>();

  for (const op of operations) {
    if (!op || typeof op.opId !== 'string' || !op.opId) continue;

    if (seenOpIds.has(op.opId)) {
      if (!outcomes.has(op.opId)) {
        outcomes.set(op.opId, { status: 'duplicate_ignored' });
      }
      continue;
    }
    seenOpIds.add(op.opId);

    const reads = Array.isArray(op.reads) ? op.reads : [];
    const writes = Array.isArray(op.writes) ? op.writes : [];

    let preconditionFailed = false;
    let failureReason = '';

    for (const read of reads) {
      try {
        checkPath(read.collection, read.id);
      } catch (e: any) {
        preconditionFailed = true;
        failureReason = e?.message || 'invalid-path';
        break;
      }
      const currentVersion = documents.get(`${read.collection}/${read.id}`)?.version || 0;
      if (!Number.isInteger(read.version) || read.version !== currentVersion) {
        preconditionFailed = true;
        failureReason = `version_mismatch:${read.collection}/${read.id} expected=${read.version} actual=${currentVersion}`;
        break;
      }
    }

    if (!preconditionFailed && op.expectedRequest) {
      const { collection, id, member, dayIndex, requestId } = op.expectedRequest;
      const targetDoc = documents.get(`${collection}/${id}`);
      const slot = targetDoc?.data?.schedule?.[member]?.[dayIndex];
      const isPending = slot && (slot.requestStatus === 'pending' || slot.type === 'pending');
      if (!isPending || slot.requestId !== requestId) {
        preconditionFailed = true;
        failureReason = `request_precondition_failed:expected=${requestId} actual=${slot?.requestId || 'none'}`;
      }
    }

    if (preconditionFailed) {
      outcomes.set(op.opId, { status: 'aborted', reason: failureReason });
      continue;
    }

    if (Array.isArray(op.snapshot) && op.snapshot.length > 0 && writes.length === 0) {
      try {
        const nextDocs = new Map<string, StoredDocument>();
        for (const doc of op.snapshot) {
          checkPath(doc.collection, doc.id);
          checkJSON(doc.data);
          nextDocs.set(`${doc.collection}/${doc.id}`, {
            collection: doc.collection,
            id: doc.id,
            data: structuredClone(doc.data),
            version: Number.isInteger(doc.version) && doc.version > 0 ? doc.version : 1,
          });
        }
        for (const existingKey of documents.keys()) {
          if (!nextDocs.has(existingKey)) {
            throw new Error(`incomplete_snapshot:${existingKey}`);
          }
        }
        documents.clear();
        for (const [k, v] of nextDocs.entries()) documents.set(k, v);
        outcomes.set(op.opId, { status: 'committed' });
      } catch (err: any) {
        outcomes.set(op.opId, { status: 'aborted', reason: err?.message || 'invalid-snapshot' });
      }
      continue;
    }

    const staged = new Map<string, StoredDocument>();
    const now = typeof op.timestamp === 'string' ? op.timestamp : new Date(0).toISOString();
    let writeError: string | null = null;

    for (const write of writes) {
      try {
        checkPath(write.collection, write.id);
        if (write.collection === 'test') throw new Error('permission-denied');
        const key = `${write.collection}/${write.id}`;
        const old = staged.get(key) || documents.get(key) || null;
        let nextData: Data;
        if (write.mode === 'set') {
          checkJSON(write.data);
          if (!write.data || typeof write.data !== 'object' || Array.isArray(write.data)) {
            throw new Error('invalid-argument');
          }
          const patch = resolveTimestamps(write.data, now);
          nextData = write.merge ? mergeMaps(old?.data, patch) : patch;
        } else if (write.mode === 'update') {
          if (!old) throw new Error('not-found');
          nextData = structuredClone(old.data);
          for (const field of write.fields || []) {
            checkJSON(field.value);
            setField(nextData, field.path, resolveTimestamps(field.value, now));
          }
        } else {
          throw new Error('invalid-mode');
        }
        staged.set(key, {
          collection: write.collection,
          id: write.id,
          data: nextData,
          version: (documents.get(key)?.version || 0) + 1,
        });
      } catch (err: any) {
        writeError = err?.message || 'write-error';
        break;
      }
    }

    if (writeError) {
      outcomes.set(op.opId, { status: 'invalid', reason: writeError });
      continue;
    }

    for (const [key, docValue] of staged.entries()) {
      documents.set(key, docValue);
    }
    outcomes.set(op.opId, { status: 'committed' });
  }

  return { documents, outcomes };
}
