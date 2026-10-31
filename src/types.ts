import type { GoalRow, StatusType } from './constants';
import type { OperationType } from './App';

export interface ScheduleItem {
  type: StatusType;
  detail: string;
  /** 全体表示から指定できる、その日のイベント用クライアント上書き。 */
  client?: string;
  /** 画面表示用の申請者情報。認証IDではない。 */
  requestedBy?: string;
  requestedAt?: string;
  requestId?: string;
}

export interface MonthData {
  schedule: Record<string, ScheduleItem[]>;
  memos: Record<string, Record<number, string>>;
  dones: Record<string, Record<number, boolean>>;
  goals: Record<string, GoalRow[]>;
  nextPlan: Record<string, string>;
  teamGoal: string;
  overallMemo?: string;
  trainingLabels?: Record<string, string>;
  trainingLocations?: Record<string, string>;
  memberStations?: Record<string, string>;
  dailyLocations?: Record<number, string>;
  dailyTimes?: Record<number, string>;
  history?: HistoryEntry[];
  projects?: ProjectItem[];
  /** Previously saved clients, retained for suggestions across months. */
  clientNames?: string[];
}

/** レイアウト（会場配置図）の配置物 */
export interface LayoutItem {
  id: string;
  type: string;
  label: string;
  x: number; // 中心のX座標 0-100%
  y: number; // 中心のY座標 0-100%
  rotation: number;
  color: string;
  wPct: number;
  hPct: number;
  emoji: string;
}

/** 案件共有の1件 */
export interface ProjectItem {
  id: string;
  date: string;
  dateEnd?: string;
  /** 実施日。離れた日付を統合した案件では範囲内の全日とは限らない。 */
  occurrenceDates?: string[];
  timeStart: string;
  timeEnd: string;
  client: string;
  carrier: string;
  venue: string;
  content: string;
  headcount: number;
  directors?: string[];
  leads: string[];
  members: string[];
  comment: string;
  layout: LayoutItem[];
  updatedAt?: string;
}

export interface StorageErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
}

export interface PendingRequestItem {
  year: number;
  month: number; // 0-indexed
  monthKey: string; // e.g. "2026-9"
  member: string;
  dayIdx: number;
  day: number;
  detail: string;
  currentType: StatusType;
  requestedBy: string;
  requestedAt: string;
  requestId: string;
}

export interface HistoryEntry {
  at: string;
  by: string;
  member: string;
  day: number;
  field: 'type' | 'detail' | 'client';
  from: string;
  to: string;
}

/** 全体表示のイベントから作った案件候補 */
export interface ProjectCandidate {
  key: string;
  date: string;
  dateEnd: string;
  dates: string[];
  venue: string;
  detectedClient?: string;
  detectedCarrier?: string;
  members: string[];
  timeStart: string;
  timeEnd: string;
}

export interface MemberSummary {
  name: string;
  counts: Record<StatusType, number>;
  details: { label: string; count: number }[];
  work: number;
  off: number;
}
