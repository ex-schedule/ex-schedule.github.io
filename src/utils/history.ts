import type { HistoryEntry, MonthData } from '../types';

export const MAX_HISTORY = 300;
/** 1件ずつ追記した履歴がこの件数に達したら、まとめて history 配列へ移す */
export const RECENT_HISTORY_LIMIT = 100;

/**
 * 変更履歴の全体を新しい順で返す。
 * history: 従来の配列(新しい順)。recentHistory: 予定の編集ごとに1件ずつ追記する分。
 * 1回の編集で履歴300件を丸ごと送り直さないために分けている。
 */
export function mergedHistory(data: Partial<MonthData> | undefined | null): HistoryEntry[] {
  const base = Array.isArray(data?.history) ? data!.history! : [];
  const recent = Object.values(data?.recentHistory || {}).filter(
    (entry): entry is HistoryEntry => !!entry && typeof entry === 'object'
  );
  if (recent.length === 0) return base.slice(0, MAX_HISTORY);
  recent.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  return [...recent, ...base].slice(0, MAX_HISTORY);
}

export function historyEntryKey(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
