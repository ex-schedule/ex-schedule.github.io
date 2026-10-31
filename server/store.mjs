import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class StoreError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
const badKeys = new Set(['__proto__', 'prototype', 'constructor']);
export function checkPath(collection, id) {
  if (!(collection === 'months' && /^\d{4}-(?:[1-9]|1[0-2])$/.test(id)) &&
      !(collection === 'settings' && id === 'global') &&
      !(collection === 'test' && id === 'connection'))
    throw new StoreError('invalid-argument', '保存先が不正です。');
}
function checkJSON(value, depth = 0) {
  if (depth > 45) throw new StoreError('invalid-argument', 'データが複雑すぎます。');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) { value.forEach(x => checkJSON(x, depth + 1)); return; }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (badKeys.has(key)) throw new StoreError('invalid-argument', '使用できない項目名です。');
      checkJSON(child, depth + 1);
    }
    return;
  }
  throw new StoreError('invalid-argument', '保存できない値です。');
}
function timestamps(value, now) {
  if (Array.isArray(value)) return value.map(x => timestamps(x, now));
  if (value && typeof value === 'object') {
    if (value.__serverTimestamp === true && Object.keys(value).length === 1) return now;
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, timestamps(v, now)]));
  }
  return value;
}
function mergeMaps(oldValue, patch) {
  const result = structuredClone(oldValue || {});
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value) &&
        result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])) {
      result[key] = mergeMaps(result[key], value);
    } else result[key] = structuredClone(value);
  }
  return result;
}
function setField(data, segments, value) {
  if (!Array.isArray(segments) || !segments.length || segments.length > 16 ||
      segments.some(x => typeof x !== 'string' || !x || x.length > 512 || badKeys.has(x)))
    throw new StoreError('invalid-argument', '項目の指定が不正です。');
  let cursor = data;
  for (const key of segments.slice(0, -1)) {
    if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[segments.at(-1)] = structuredClone(value);
}
export class DocumentStore {
  constructor(filename) {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    this.db.exec('CREATE TABLE IF NOT EXISTS documents (collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, version INTEGER NOT NULL, PRIMARY KEY(collection,id))');
  }
  get(collection, id) {
    checkPath(collection, id);
    const row = this.db.prepare('SELECT data,version FROM documents WHERE collection=? AND id=?').get(collection, id);
    return row ? { collection, id, data: JSON.parse(row.data), version: row.version } : null;
  }
  list(collection) {
    if (!['months', 'settings', 'test'].includes(collection)) throw new StoreError('invalid-argument', '一覧の指定が不正です。');
    return this.db.prepare('SELECT id,data,version FROM documents WHERE collection=? ORDER BY id').all(collection)
      .map(row => ({ collection, id: row.id, data: JSON.parse(row.data), version: row.version }));
  }
  commit(reads = [], writes = []) {
    if (!Array.isArray(reads) || !Array.isArray(writes) || reads.length > 64 || writes.length > 64)
      throw new StoreError('invalid-argument', '更新件数が不正です。');
    const touched = new Map();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const read of reads) {
        checkPath(read.collection, read.id);
        if (!Number.isInteger(read.version) || read.version < 0) throw new StoreError('invalid-argument', '版の指定が不正です。');
        if ((this.get(read.collection, read.id)?.version || 0) !== read.version)
          throw new StoreError('aborted', '別の端末で更新されました。', 409);
      }
      const now = new Date().toISOString();
      for (const write of writes) {
        checkPath(write.collection, write.id);
        if (write.collection === 'test') throw new StoreError('permission-denied', '接続確認は更新できません。', 403);
        const old = this.get(write.collection, write.id);
        let data;
        if (write.mode === 'set') {
          checkJSON(write.data);
          if (!write.data || typeof write.data !== 'object' || Array.isArray(write.data))
            throw new StoreError('invalid-argument', '保存データが不正です。');
          const patch = timestamps(write.data, now);
          data = write.merge ? mergeMaps(old?.data, patch) : patch;
        } else if (write.mode === 'update') {
          if (!old) throw new StoreError('not-found', '対象データがありません。', 404);
          if (!Array.isArray(write.fields) || write.fields.length > 256) throw new StoreError('invalid-argument', '更新項目が不正です。');
          data = structuredClone(old.data);
          for (const field of write.fields) {
            checkJSON(field.value);
            setField(data, field.path, timestamps(field.value, now));
          }
        } else throw new StoreError('invalid-argument', '更新方法が不正です。');
        const json = JSON.stringify(data);
        if (Buffer.byteLength(json) > 2 * 1024 * 1024) throw new StoreError('resource-exhausted', '月の保存容量が上限を超えました。', 413);
        this.db.prepare('INSERT INTO documents(collection,id,data,version) VALUES(?,?,?,?) ON CONFLICT(collection,id) DO UPDATE SET data=excluded.data,version=excluded.version')
          .run(write.collection, write.id, json, (old?.version || 0) + 1);
        touched.set(write.collection + '/' + write.id, { collection: write.collection, id: write.id });
      }
      this.db.exec('COMMIT');
      return [...touched.values()];
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  exportData() {
    return { format: 'ex-schedule-v1', exportedAt: new Date().toISOString(),
      documents: this.db.prepare('SELECT collection,id,data,version FROM documents ORDER BY collection,id').all()
        .map(row => ({ ...row, data: JSON.parse(row.data) })) };
  }
  restore(payload, replace = false) {
    if (payload?.format !== 'ex-schedule-v1' || !Array.isArray(payload.documents) || payload.documents.length > 2400)
      throw new StoreError('invalid-argument', 'バックアップ形式が不正です。');
    const identities = new Set();
    for (const item of payload.documents) {
      checkPath(item.collection, item.id); checkJSON(item.data);
      if (!item.data || typeof item.data !== 'object' || Array.isArray(item.data)) throw new StoreError('invalid-argument', '保存データが不正です。');
      if (Buffer.byteLength(JSON.stringify(item.data)) > 2 * 1024 * 1024) throw new StoreError('invalid-argument', '保存データが大きすぎます。');
      const key = item.collection + '/' + item.id;
      if (identities.has(key)) throw new StoreError('invalid-argument', '同じ保存先が重複しています。');
      identities.add(key);
    }
    if (!replace && this.db.prepare('SELECT count(*) AS n FROM documents').get().n)
      throw new StoreError('failed-precondition', '既存データがあります。明示的な置換指定が必要です。', 409);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (replace) this.db.exec('DELETE FROM documents');
      for (const item of payload.documents) this.db.prepare('INSERT INTO documents(collection,id,data,version) VALUES(?,?,?,?)')
        .run(item.collection, item.id, JSON.stringify(item.data), Number.isInteger(item.version) && item.version > 0 ? item.version : 1);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close() { this.db.close(); }
}
