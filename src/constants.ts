// Modified for portable distribution: generic team configuration; original source notices retained.
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import team from '../config/team.json';

export const INITIAL_SCHEDULE_DATA: Record<string, string[]> = Object.fromEntries(
  team.members.map(name => [name, Array(30).fill('')])
);
export const TRAINING_LABELS: Record<string, string> = team.trainingLabels;
export const TRAINING_LOCATIONS: Record<string, string> = team.trainingLocations;
export const MEMBERS: string[] = team.members;


export const getDaysInMonth = (year: number, month: number) => {
  return new Date(year, month + 1, 0).getDate();
};

export const getStartOffset = (year: number, month: number) => {
  // Mon=0, Tue=1, Wed=2, Thu=3, Fri=4, Sat=5, Sun=6
  const day = new Date(year, month, 1).getDay();
  return (day + 6) % 7;
};

export interface EventClientConfig {
  id: string; // e.g. 'event_sb', 'event_docomo', 'event_au', 'event_rakuten', 'event_uq', 'event_ym', 'event_other'
  name: string; // 表示名: 'ソフトバンク', 'ドコモ', 'au', '楽天モバイル', 'UQ mobile', 'ワイモバイル', 'その他イベント'
  shortName: string; // 短縮名: 'SB', 'docomo', 'au', '楽天', 'UQ', 'YM', '他イベ'
  color: string; // 背景色 (例: #18181b)
  textColor?: string; // テキスト色 (基本は #ffffff)
  color1?: string; // 下位互換用
  color2?: string; // 下位互換用
}

/**
 * クライアント設定の初期値（初期状態はクライアント未登録・「現状なし」）
 */
export const DEFAULT_EVENT_CLIENTS: EventClientConfig[] = [];

export type BaseStatusType =
  | 'normal'
  | 'request'
  | 'pending'
  | 'training'
  | 'dispatch'
  | 'office'
  | 'event'
  | 'absence'
  | 'other'
  | 'rest';

export type StatusType =
  | BaseStatusType
  | string;

export const BASE_STATUS_TYPES: BaseStatusType[] = [
  'normal',
  'request',
  'pending',
  'training',
  'dispatch',
  'office',
  'event',
  'absence',
  'other',
  'rest',
];

export const TYPE_LABEL: Record<string, string> = {
  normal: '公休(〇)',
  request: '希望休(◎)',
  pending: '希望休申請',
  training: '研修',
  dispatch: '外出',
  office: '本社出勤',
  event: 'イベント',
  absence: '欠勤',
  other: 'その他',
  rest: '未定',
};

export const TYPE_SHORT_LABEL: Record<string, string> = {
  normal: '公休',
  request: '希望休',
  pending: '申請',
  training: '研修',
  dispatch: '外出',
  office: '本社',
  event: 'イベ',
  absence: '欠勤',
  other: 'その他',
  rest: '未定',
};

export const TYPE_CLASS: Record<string, string> = {
  normal: 'bg-gray-100 text-gray-600',
  request: 'bg-pink-100 text-pink-700',
  pending: 'bg-amber-100 text-amber-800 ring-1 ring-amber-300',
  training: 'bg-purple-100 text-purple-700',
  dispatch: 'bg-orange-100 text-orange-700',
  office: 'bg-emerald-100 text-emerald-700',
  event: 'bg-orange-100 text-orange-700',
  absence: 'bg-zinc-700 text-white',
  other: 'bg-blue-100 text-blue-700',
  rest: 'bg-slate-50 text-slate-400',
};

/**
 * クライアント別イベントの背景色スタイルを取得（カスタム登録時のみ適用）
 */
export const getStatusStyle = (
  type: string,
  eventClients: EventClientConfig[] = []
): Record<string, string | number> => {
  const client = eventClients.find(c => c.id === type);
  if (client) {
    const bg = client.color || client.color1 || '#f97316';
    return {
      backgroundColor: bg,
      color: client.textColor || '#ffffff',
    };
  }
  return {};
};

// 下位互換エイリアス
export const getStatusCompositeStyle = getStatusStyle;

/**
 * 表示用ラベルを取得（動的クライアント対応）
 */
export const getStatusLabel = (
  type: string,
  eventClients: EventClientConfig[] = []
): string => {
  const client = eventClients.find(c => c.id === type);
  if (client) {
    return `イベ(${client.name})`;
  }
  return TYPE_LABEL[type] || type;
};

/**
 * 短縮表示用ラベルを取得（動的クライアント対応）
 */
export const getStatusShortLabel = (
  type: string,
  eventClients: EventClientConfig[] = []
): string => {
  const client = eventClients.find(c => c.id === type);
  if (client) {
    return client.shortName || client.name;
  }
  return TYPE_SHORT_LABEL[type] || TYPE_LABEL[type] || type;
};

/**
 * 稼働（出勤）判定（全イベントクライアントを稼働としてカウント）
 */
export const isWorkType = (type: string): boolean => {
  if (!type || type === 'normal' || type === 'request' || type === 'pending' || type === 'absence' || type === 'rest') {
    return false;
  }
  return true;
};

export interface GoalRow {
  content: string;
  person: string;
  deadline: string;
  stars: number;
  note: string;
}

/** 案件共有の担当者候補 */
export const LEAD_MEMBERS: string[] = team.leadMembers;

/** レイアウト（会場配置図）で使える配置物 */
export const LAYOUT_CATALOG: Record<string, { label: string; emoji: string; color: string; wPct: number; hPct: number }> = {
  round_table: { label: '丸机',         emoji: '○', color: '#6366f1', wPct: 8,  hPct: 9  },
  long_table:  { label: '長机',         emoji: '▬', color: '#7c3aed', wPct: 16, hPct: 5  },
  reception:   { label: '受付',         emoji: '◈', color: '#db2777', wPct: 14, hPct: 8  },
  booth:       { label: 'ブース',       emoji: '▣', color: '#0f766e', wPct: 16, hPct: 10 },
  display:     { label: '展示台',       emoji: '◫', color: '#0369a1', wPct: 13, hPct: 8  },
  experience:  { label: '体験スペース', emoji: '◰', color: '#0891b2', wPct: 16, hPct: 11 },
  seating:     { label: '着座スペース', emoji: '▤', color: '#16a34a', wPct: 16, hPct: 10 },
  stock:       { label: '在庫置き場',   emoji: '□', color: '#b45309', wPct: 12, hPct: 9  },
  pillar:      { label: '柱',           emoji: '■', color: '#475569', wPct: 4,  hPct: 6  },
  entrance:    { label: '入口',         emoji: '▷', color: '#059669', wPct: 8,  hPct: 5  },
  partition:   { label: '仕切り',       emoji: '━', color: '#64748b', wPct: 22, hPct: 2  },
};

/** 「イベント」ステータスでも案件として扱わない予定（搬入・前泊・後泊・待機など） */
export const NON_EVENT_KEYWORDS = [
  '商談', '内定式', '搬入', '搬出', '運転', '移動', '準備', '撤収', '設営', '積込', '積み込み', '荷降ろし', '待機', '要員',
  '前泊', '後泊', '中泊', '宿泊', 'ホテル', '移動日', '出張移動',
  '休み', '公休', '有給', '有休', '振替', '振休', '代休', '特休',
  '健康診断', '健診', '受診', 'PCR', 'ワクチン',
  '長南',
];
