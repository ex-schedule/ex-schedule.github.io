import { doc, runTransaction, serverTimestamp, FieldPath } from '../storage';
import { db } from '../storage';
import { TYPE_LABEL, getDaysInMonth, type StatusType } from '../constants';
import type { HistoryEntry, MonthData, ScheduleItem } from '../types';
import { cleanFirestorePayload, getType } from './venue';
import { RECENT_HISTORY_LIMIT, historyEntryKey, mergedHistory } from './history';

const CONFLICT_MESSAGE = '予定が他の人に更新されました。最新の内容を確認して再度入力してください。';
const REQUEST_CONFLICT_MESSAGE = '申請内容が更新されました。最新の状態を確認して再度お試しください。';

/** 全体表示・スケジュールの type / detail を1件だけ更新する（他日・他メンバー・metadataは保持） */
export async function saveScheduleField(
  monthKey: string,
  member: string,
  dayIdx: number,
  field: 'type' | 'detail',
  value: string,
  expected: ScheduleItem,
  fallback: ScheduleItem[]
): Promise<void> {
  const [year, monthNumber] = monthKey.split('-').map(Number);
  const daysInMonth = getDaysInMonth(year, monthNumber - 1);
  if (!/^\d{4}-(?:[1-9]|1[0-2])$/.test(monthKey) || year < 1900 ||
      !Number.isInteger(dayIdx) || dayIdx < 0 || dayIdx >= daysInMonth ||
      (field === 'type' && !Object.hasOwn(TYPE_LABEL, value))) {
    throw new Error('日付とステータスを確認してください。');
  }
  const ref = doc(db, 'months', monthKey);
  await runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    const data = (snap.exists() ? snap.data() : {}) as Partial<MonthData>;
    const raw = data.schedule?.[member];
    const source = raw && typeof raw === 'object' && Object.keys(raw).length ? raw : fallback;
    const schedule: ScheduleItem[] = Array.from({ length: daysInMonth }, (_, i) => {
      const item = source[i];
      if (item && typeof item === 'object') {
        if ('type' in item) return { ...item, detail: item.detail || '' };
        const legacy = item as { detail?: string; status?: string };
        const detail = legacy.detail || legacy.status || '';
        return { ...legacy, type: getType(detail), detail: String(detail) };
      }
      return { type: getType(item), detail: String(item || '') };
    });
    const current = schedule[dayIdx] || { type: 'rest' as StatusType, detail: '' };

    const currentValue = field === 'type' ? current.type : (current.detail || '');
    if (currentValue === value) return; // 同一値はno-op

    const expectedValue = field === 'type' ? expected.type : (expected.detail || '');
    if (currentValue !== expectedValue) throw new Error(CONFLICT_MESSAGE);

    if (field === 'type') {
      const currentReqId = current.requestId || '';
      const expectedReqId = expected.requestId || '';
      if (currentReqId !== expectedReqId || (current.requestedAt || '') !== (expected.requestedAt || '')) {
        throw new Error(REQUEST_CONFLICT_MESSAGE);
      }
    }

    let nextItem: ScheduleItem;
    let from: string;
    let to: string;
    if (field === 'type') {
      const nextType = value as StatusType;
      nextItem = { ...current, type: nextType };
      if (nextType === 'pending') {
        nextItem.requestedBy = member;
        nextItem.requestedAt = new Date().toISOString();
        nextItem.requestId = globalThis.crypto?.randomUUID?.() || `${monthKey}-${member}-${dayIdx}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      } else {
        delete nextItem.requestedBy;
        delete nextItem.requestedAt;
        delete nextItem.requestId;
      }
      from = TYPE_LABEL[current.type] || current.type;
      to = TYPE_LABEL[nextType] || nextType;
    } else {
      nextItem = { ...current, detail: value };
      from = current.detail || '';
      to = value;
    }
    schedule[dayIdx] = nextItem;

    const entry: HistoryEntry = {
      at: new Date().toISOString(),
      by: '',
      member,
      day: dayIdx + 1,
      field,
      from,
      to,
    };
    const entryKey = historyEntryKey();
    const stored = Array.isArray(raw) ? raw[dayIdx] : undefined;
    const canPatchCell = snap.exists() && Array.isArray(raw) && raw.length === daysInMonth &&
      !!stored && typeof stored === 'object' && 'type' in stored;

    if (canPatchCell) {
      // 変えた1日分と履歴1件だけを送る(その人の1か月分と履歴300件を毎回送り直さない)
      const fields: unknown[] = [new FieldPath('schedule', member, String(dayIdx)), cleanFirestorePayload(nextItem)];
      if (Object.keys(data.recentHistory || {}).length >= RECENT_HISTORY_LIMIT) {
        // 追記分が溜まったら、従来の履歴配列へまとめて移す
        fields.push('history', cleanFirestorePayload(mergedHistory({ ...data, recentHistory: { ...data.recentHistory, [entryKey]: entry } })));
        fields.push('recentHistory', {});
      } else {
        fields.push(new FieldPath('recentHistory', entryKey), entry);
      }
      fields.push('updatedAt', serverTimestamp());
      tx.update(ref, ...fields);
      return;
    }

    // 月のデータがまだ無い・旧形式の並びの時は、その人の1か月分を正しい形で書く
    tx.set(ref, cleanFirestorePayload({
      schedule: { [member]: schedule },
      recentHistory: { [entryKey]: entry },
      updatedAt: serverTimestamp(),
    }), { merge: true });
  });
}

/** settings/months配下のmap型フィールドの1キーだけを部分更新する */
export async function saveScheduleMapField(
  collectionName: 'months' | 'settings',
  documentKey: string,
  field: 'memberStations' | 'dailyLocations' | 'dailyTimes',
  key: string,
  value: string,
  expected: string,
  fallback: string
): Promise<void> {
  const ref = doc(db, collectionName, documentKey);
  await runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    const data = (snap.exists() ? snap.data() : {}) as Record<string, any>;
    const map = data[field];
    const current = map && typeof map === 'object' && key in map ? String(map[key] ?? '') : fallback;
    if (current === value) return; // 同一値はno-op
    if (current !== expected) throw new Error(CONFLICT_MESSAGE);

    tx.set(ref, cleanFirestorePayload({
      [field]: { [key]: value },
      updatedAt: serverTimestamp(),
    }), { merge: true });
  });
}
