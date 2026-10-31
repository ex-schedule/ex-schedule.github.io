import { NON_EVENT_KEYWORDS } from '../constants';
import type { StatusType, EventClientConfig } from '../constants';
import type { ProjectCandidate, ProjectItem } from '../types';

/** Recursively remove undefined values from Firestore payloads */
export const cleanFirestorePayload = <T,>(data: T): T => {
  if (data === undefined) {
    return null as any;
  }
  if (data === null) {
    return null as any;
  }
  if (Array.isArray(data)) {
    return data
      .filter(item => item !== undefined)
      .map(item => cleanFirestorePayload(item)) as any;
  }
  if (typeof data === 'object') {
    if (
      data instanceof Date ||
      typeof (data as any).isEqual === 'function' ||
      '_methodName' in (data as any)
    ) {
      return data;
    }
    const clean: Record<string, any> = {};
    for (const [k, v] of Object.entries(data as Record<string, any>)) {
      if (v !== undefined) {
        clean[k] = cleanFirestorePayload(v);
      }
    }
    return clean as any;
  }
  return data;
};

export const getDow = (year: number, month: number, day: number) => {
  const d = new Date(year, month, day).getDay();
  return (d + 6) % 7; // Mon=0 ... Sun=6
};

export const getType = (s: string | { type: StatusType; detail: string }): StatusType => {
  if (typeof s === 'object' && s !== null) return s.type;
  if (!s || typeof s !== 'string') return 'rest';
  if (s.startsWith('研修')) return 'training';
  if (s.includes('イベント')) return 'event';
  if (s === '〇') return 'normal';
  if (s === '◎') return 'request';
  if (s.includes('申請')) return 'pending';
  if (s === '未定') return 'rest';
  if (s.includes('海浜幕張') || s.includes('鳥浜') || s.includes('外販')) return 'dispatch';
  if (s.includes('本社')) return 'office';
  if (s.includes('欠勤')) return 'absence';
  return 'other';
};

export const genId = () => Math.random().toString(36).slice(2, 9);

/** ローカル時間の今日を YYYY-MM-DD で返す */
export const todayString = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** 搬入・前泊・後泊・待機・休暇などイベント本体ではない文言を判定 */
export const isNonEventVenue = (text: string): boolean => {
  if (!text) return true;
  const s = text.trim();
  if (!s) return true;
  // 長南が含まれる場合は案件として検出しない
  if (s.includes('長南')) return true;
  // 完全一致または主要キーワード
  if (NON_EVENT_KEYWORDS.some(k => s === k || s.startsWith(k) || s.endsWith(k) || s.includes(k))) return true;
  // 括弧で囲まれた前泊・後泊・待機など
  if (/\((前泊|後泊|中泊|宿泊|待機|移動|運転|要員)\)/i.test(s) || /（(前泊|後泊|中泊|宿泊|待機|移動|運転|要員)）/i.test(s)) {
    // もし全体が宿泊・待機系なら除外
    const cleaned = s.replace(/[\(（].*?[\)）]/g, '').trim();
    if (!cleaned || NON_EVENT_KEYWORDS.some(k => cleaned === k || cleaned.includes(k))) return true;
  }
  // 「前泊」「後泊」が含まれる場合（例: 海浜幕張(前泊)、京都前泊）はイベント候補から除外
  if (/前泊|後泊|中泊|宿泊|移動日/i.test(s)) return true;
  return false;
};

/**
 * 会場名を比較用に正規化する。
 * 「でんき横浜本店」と「横浜本店」を同一と判定できるように、
 * 企業種別（でんき/電気/デンキ/カメラ）や会社名接頭辞を正規化。
 */
export const normalizeVenueKey = (s: string): string => {
  if (!s) return '';
  let norm = s.normalize('NFKC').replace(/[\s　・/／〜～~→➡⇒]+/g, '').trim().toLowerCase();
  norm = norm
    .replace(/^(株式会社|\(株\)|（株）|合同会社|\(合\)|（合）|有限会社|\(有\)|（有）)/g, '')
    .replace(/(株式会社|\(株\)|（株）|合同会社|\(合\)|（合）|有限会社|\(有\)|（有）)$/g, '')
    .replace(/^(でんき|デンキ|電気|電器)/g, '')
    .replace(/^(ヤマダデンキ|ヤマダ電機|ヤマダ|ビックカメラ|コジマ×ビックカメラ|コジマ|ヨドバシカメラ|ヨドバシ|エディオン|ケーズデンキ|ケーズ|ジョーシン|上新電機|ノジマ|イオンモール|イオン|アピタ|イトーヨーカドー)/g, '')
    .replace(/^(アレアレア|アレレア)/g, 'アレアレア')
    .replace(/(京都太秦|太秦)$/g, '太秦');
  return norm;
};

/** 会場名が同一または同じ拠点を指しているか判定 */
export const isSameVenue = (a: string, b: string): boolean => {
  if (!a || !b) return false;
  const rawA = a.replace(/[\s　]+/g, '').trim();
  const rawB = b.replace(/[\s　]+/g, '').trim();
  if (rawA === rawB) return true;

  const keyA = normalizeVenueKey(a);
  const keyB = normalizeVenueKey(b);
  if (keyA && keyB && keyA === keyB) return true;

  // 「でんき」や「電気」を除去した文字列で比較
  const stripElecA = rawA.replace(/でんき|デンキ|電気|電器/g, '');
  const stripElecB = rawB.replace(/でんき|デンキ|電気|電器/g, '');
  if (stripElecA && stripElecB && (stripElecA === stripElecB || stripElecA === rawB || rawA === stripElecB)) {
    return true;
  }

  // どちらかが3文字以上で末尾または一部に含まれる場合（例: 「横浜本店」と「でんき横浜本店」）
  if (stripElecA.length >= 3 && stripElecB.length >= 3) {
    if (stripElecA.includes(stripElecB) || stripElecB.includes(stripElecA)) {
      return true;
    }
  }

  return false;
};

/** 会場名の比較用に全角・半角の空白をすべて除去する */
export const normalizeVenue = (s: string) => s.replace(/[\s　]+/g, '').trim();

/** 案件名の完全一致（空白・全半角の表記ゆれだけ吸収） */
export const sameProjectName = (a: string, b: string) => {
  const key = (name: string) => normalizeVenue(name.normalize('NFKC')).toLocaleLowerCase();
  return !!a && !!b && key(a) === key(b);
};

/**
 * 会場名や詳細テキストから、取引先クライアント名、キャリア、正式な会場名を自動判定
 */
export const detectProjectMetadata = (rawVenue: string, extraNotes: string = '') => {
  const combined = `${rawVenue} ${extraNotes}`;
  
  // 1. クライアント・施設名の自動判定
  let client = '';
  if (/でんき|電気|デンキ|ヤマダ/i.test(combined)) {
    client = 'ヤマダデンキ';
  } else if (/コジマ/i.test(combined)) {
    client = 'コジマ×ビックカメラ';
  } else if (/ビックカメラ/i.test(combined)) {
    client = 'ビックカメラ';
  } else if (/ヨドバシ/i.test(combined)) {
    client = 'ヨドバシカメラ';
  } else if (/エディオン|EDION/i.test(combined)) {
    client = 'エディオン';
  } else if (/ケーズ/i.test(combined)) {
    client = 'ケーズデンキ';
  } else if (/ジョーシン|Joshin|上新/i.test(combined)) {
    client = '上新電機 (Joshin)';
  } else if (/ノジマ|nojima/i.test(combined)) {
    client = 'ノジマ';
  } else if (/アピタ|ピアゴ|ユニー|太秦/i.test(combined)) {
    client = 'ユニー (アピタ)';
  } else if (/アレアレア|アレレア|立川/i.test(combined)) {
    client = 'アレアレア立川';
  } else if (/イオンモール|イオン/i.test(combined)) {
    client = 'イオンリテール / イオンモール';
  } else if (/イトーヨーカドー|ヨーカドー/i.test(combined)) {
    client = 'イトーヨーカ堂';
  } else if (/ららぽーと|三井/i.test(combined)) {
    client = '三井不動産商業マネジメント';
  } else if (/海浜幕張/i.test(combined)) {
    client = 'イオン海浜幕張';
  } else if (/鳥浜/i.test(combined)) {
    client = '三井アウトレットパーク 横浜ベイサイド';
  }

  // 2. キャリアの自動判定
  let carrier = '';
  if (/docomo|ドコモ/i.test(combined)) {
    carrier = 'docomo';
  } else if (/au|KDDI/i.test(combined)) {
    carrier = 'au';
  } else if (/UQ/i.test(combined)) {
    carrier = 'UQ mobile';
  } else if (/SoftBank|ソフトバンク|SB/i.test(combined)) {
    carrier = 'SoftBank';
  } else if (/YM|ワイモバイル|Y!mobile/i.test(combined)) {
    carrier = 'Y!mobile';
  } else if (/楽天|Rakuten/i.test(combined)) {
    carrier = '楽天モバイル';
  }

  // 3. 正式な会場名の整理
  let cleanVenue = rawVenue.trim();
  if (/^アレレア立川$/i.test(cleanVenue) || /^アレレア$/i.test(cleanVenue)) cleanVenue = 'アレアレア立川';
  if (/^太秦$/i.test(cleanVenue)) cleanVenue = 'アピタ京都太秦';

  // 4. 標準内容
  const content = '携帯キャリア販促・ブース運営';

  return { client, carrier, cleanVenue, content };
};

const CLIENT_COLOR_PRESETS = [
  { accent: '#2563eb', soft: '#dbeafe', text: '#1d4ed8' },
  { accent: '#7c3aed', soft: '#ede9fe', text: '#6d28d9' },
  { accent: '#db2777', soft: '#fce7f3', text: '#be185d' },
  { accent: '#0f766e', soft: '#ccfbf1', text: '#0f766e' },
  { accent: '#c2410c', soft: '#ffedd5', text: '#c2410c' },
  { accent: '#4f46e5', soft: '#e0e7ff', text: '#4338ca' },
];

export const clientColor = (client: string, eventClients?: EventClientConfig[]) => {
  const normalized = client.normalize('NFKC').trim();
  if (!normalized) return null;

  if (eventClients && eventClients.length > 0) {
    const matched = eventClients.find(c => {
      const cName = c.name.normalize('NFKC').trim();
      const cShort = (c.shortName || '').normalize('NFKC').trim();
      return (
        cName === normalized ||
        (cShort && cShort === normalized) ||
        (cName.length >= 2 && normalized.includes(cName)) ||
        (normalized.length >= 2 && cName.includes(normalized))
      );
    });
    if (matched) {
      const hex = matched.color || matched.color1 || '#18181b';
      return {
        accent: hex,
        soft: `${hex}20`,
        text: hex,
      };
    }
  }

  let hash = 0;
  for (const char of normalized) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return CLIENT_COLOR_PRESETS[hash % CLIENT_COLOR_PRESETS.length];
};

export const clientShortName = (client: string) =>
  client
    .replace(/^(株式会社|合同会社|有限会社)/, '')
    .replace(/\s*\(.+?\)/g, '')
    .trim()
    .slice(0, 8) || '未設定';

export const projectCoversDate = (project: ProjectItem, date: string) => {
  if (project.occurrenceDates?.length) return project.occurrenceDates.includes(date);
  const start = project.date || '';
  const end = project.dateEnd || project.date || '';
  return !!start && !!end && start <= date && date <= end;
};

export const eventClientFor = (projects: ProjectItem[], date: string, detail: string) => {
  const matchedProject = projects.find(project =>
    projectCoversDate(project, date) && isSameVenue(project.venue, detail)
  );
  return matchedProject?.client || detectProjectMetadata(detail).client || '';
};

/**
 * 「アレレア立川〜太秦」「立川〜太秦」「アレアレア立川 / アピタ京都太秦」などの複数会場表現を
 * それぞれ独立した会場名に分割・整形する
 */
export const splitVenuesFromText = (raw: string): string[] => {
  if (!raw) return [];
  const text = raw.trim();
  if (isNonEventVenue(text)) return [];

  // 時刻範囲 (例: 10:00〜19:00) や 日付範囲 (例: 8/1〜8/3) ではない区切り記号で分割
  // 区切り記号: 〜, ～, ~, →, ➡, ⇒, /, ／, ・
  const parts = text.split(/(?<!\d{1,2})[〜～~→➡⇒/／・](?!\d{1,2})/);
  const result: string[] = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed || isNonEventVenue(trimmed)) continue;
    
    // 表記ゆれの補正
    let v = trimmed;
    if (v === 'アレレア立川' || v === 'アレレア') v = 'アレアレア立川';
    if (v === '立川') v = 'アレアレア立川';
    if (v === '太秦') v = 'アピタ京都太秦';

    if (!result.includes(v)) {
      result.push(v);
    }
  }

  return result.length > 0 ? result : [text];
};

/** YYYY-MM-DD を日単位で比較できる数値に変換する */
export const projectDateOrdinal = (date: string): number | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
};

/** 旧案件の日付範囲も実施日として展開する。 */
export const projectDates = (project: ProjectItem): string[] => {
  if (project.occurrenceDates?.length) return [...new Set(project.occurrenceDates)].sort();
  const start = projectDateOrdinal(project.date);
  const end = projectDateOrdinal(project.dateEnd || project.date);
  if (start === null || end === null || end < start || end - start > 366) return [project.date].filter(Boolean);
  return Array.from({ length: end - start + 1 }, (_, i) => new Date((start + i) * 86400000).toISOString().slice(0, 10));
};

export const projectRangesOverlap = (aStart: string, aEnd: string, bStart: string, bEnd: string) => {
  const values = [aStart, aEnd, bStart, bEnd].map(projectDateOrdinal);
  if (values.some(value => value === null)) return false;
  const [as, ae, bs, be] = values as number[];
  return as <= be && bs <= ae;
};

export const projectRangesOverlapOrAdjacent = (aStart: string, aEnd: string, bStart: string, bEnd: string) => {
  const values = [aStart, aEnd, bStart, bEnd].map(projectDateOrdinal);
  if (values.some(value => value === null)) return false;
  const [as, ae, bs, be] = values as number[];
  return as <= be + 1 && bs <= ae + 1;
};

export const uniqueInOrder = (values: string[]) => [...new Set(values)];

/** 「10:00-19:00」「10:00〜19:00」などから開始・終了を取り出す */
export const parseTimeRange = (raw: string | undefined): { start: string; end: string } => {
  const fallback = { start: '10:00', end: '18:00' };
  if (!raw) return fallback;
  const times = raw.match(/\d{1,2}[:：]\d{2}/g);
  if (!times || times.length === 0) return fallback;
  const norm = (t: string) => {
    const [h, m] = t.replace('：', ':').split(':');
    return `${h.padStart(2, '0')}:${m}`;
  };
  return { start: norm(times[0]), end: norm(times[1] || times[0]) };
};

export const formatProjectDateRange = (dateStart: string, dateEnd?: string) => {
  if (!dateStart) return '';
  if (!dateEnd || dateStart === dateEnd) {
    const parts = dateStart.split('-');
    return parts.length === 3 ? `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}` : dateStart;
  }
  const sParts = dateStart.split('-');
  const eParts = dateEnd.split('-');
  const sStr = sParts.length === 3 ? `${parseInt(sParts[1], 10)}/${parseInt(sParts[2], 10)}` : dateStart;
  const eStr = eParts.length === 3 ? `${parseInt(eParts[1], 10)}/${parseInt(eParts[2], 10)}` : dateEnd;
  return `${sStr}〜${eStr}`;
};

/** 離れた実施日は範囲でつながず、実際の日付だけを表示する。 */
export const formatProjectDates = (dateStart: string, dateEnd?: string, dates?: string[]) => {
  if (!dates?.length) return formatProjectDateRange(dateStart, dateEnd);
  const sorted = [...new Set(dates)].sort();
  const groups: [string, string][] = [];
  for (const date of sorted) {
    const last = groups.at(-1);
    if (last && projectDateOrdinal(date) === (projectDateOrdinal(last[1]) ?? -2) + 1) last[1] = date;
    else groups.push([date, date]);
  }
  return groups.map(([start, end]) => formatProjectDateRange(start, end)).join('・');
};

export const projectTitle = (p: ProjectItem) => {
  const venue = p.venue || '（場所未入力）';
  const range = formatProjectDates(p.date, p.dateEnd, p.occurrenceDates);
  return range ? `${range} ${venue}` : venue;
};

export const buildProjectCandidates = (
  membersList: string[],
  schedule: Record<string, { type: StatusType; detail: string }[]>,
  year: number,
  month: number,
  daysInMonth: number,
  dailyTimes: Record<number, string> = {}
): ProjectCandidate[] => {
  interface RawEntry {
    dayIdx: number;
    date: string;
    venue: string;
    member: string;
    time: string;
  }
  const entries: RawEntry[] = [];

  for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
    const dayNum = dayIdx + 1;
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    const dayTime = dailyTimes[dayNum] || '';

    membersList.forEach(m => {
      const cell = schedule[m]?.[dayIdx];
      if (!cell || !cell.detail) return;
      if (cell.type !== 'event' && cell.type !== 'dispatch' && cell.type !== 'training') return;

      const rawText = cell.detail.trim();
      if (!rawText || isNonEventVenue(rawText)) return;

      const venues = splitVenuesFromText(rawText);
      venues.forEach(v => {
        if (!v || isNonEventVenue(v)) return;
        entries.push({
          dayIdx,
          date: dateStr,
          venue: v,
          member: m,
          time: dayTime || rawText,
        });
      });
    });
  }

  if (entries.length === 0) return [];

  const byVenueGroup: {
    venue: string;
    dates: string[];
    members: string[];
    timeText: string;
  }[] = [];

  entries.forEach(entry => {
    const existing = byVenueGroup.find(g => sameProjectName(g.venue, entry.venue));

    if (existing) {
      if (!existing.dates.includes(entry.date)) existing.dates.push(entry.date);
      if (!existing.members.includes(entry.member)) existing.members.push(entry.member);
      if (entry.venue.length > existing.venue.length) existing.venue = entry.venue;
      if (!existing.timeText && entry.time) existing.timeText = entry.time;
    } else {
      byVenueGroup.push({
        venue: entry.venue,
        dates: [entry.date],
        members: [entry.member],
        timeText: entry.time,
      });
    }
  });

  const today = todayString();
  return byVenueGroup
    .map((g, idx) => {
      const sortedDates = [...g.dates].sort();
      const dateStart = sortedDates[0];
      const dateEnd = sortedDates[sortedDates.length - 1];
      const meta = detectProjectMetadata(g.venue, g.timeText);
      const parsedTime = parseTimeRange(g.timeText);

      return {
        key: `candidate-${idx}-${dateStart}-${g.venue}`,
        date: dateStart,
        dateEnd: dateEnd,
        dates: sortedDates,
        venue: meta.cleanVenue || g.venue,
        detectedClient: meta.client,
        detectedCarrier: meta.carrier,
        members: g.members,
        timeStart: parsedTime.start,
        timeEnd: parsedTime.end,
      };
    })
    .filter(c => (c.dateEnd || c.date) >= today);
};
