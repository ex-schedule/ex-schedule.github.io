import { MEMBERS, StatusType, getDaysInMonth } from '../constants';
import type { ScheduleItem, MonthData, PendingRequestItem } from '../types';


// --- 希望休申請 ---

export const isPendingRequestItem = (item: { type?: string; detail?: string } | null | undefined): boolean => {
  if (!item) return false;
  if (item.type === 'pending' || item.type === '申請') return true;
  // Legacy records may only contain a label; explicit resolved types take precedence.
  return !item.type && !!item.detail?.includes('希望休申請');
};

export const extractAllPendingRequests = (
  allMonthsData: Record<string, MonthData>,
  memberList: string[] = MEMBERS
): PendingRequestItem[] => {
  const pending: PendingRequestItem[] = [];

  Object.entries(allMonthsData || {}).forEach(([mKey, monthData]) => {
    if (!monthData || !monthData.schedule) return;
    const parts = mKey.split('-');
    if (parts.length !== 2) return;
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    if (isNaN(y) || isNaN(m)) return;

    const days = getDaysInMonth(y, m);
    const schedule = monthData.schedule;
    const allMembers = Array.from(new Set([...memberList, ...Object.keys(schedule)]));

    allMembers.forEach(name => {
      const rawSched = schedule[name];
      if (!rawSched) return;

      const items: (Partial<ScheduleItem> | undefined)[] = Array.isArray(rawSched)
        ? rawSched
        : Array.from({ length: days }).map((_, i) => (rawSched as any)?.[i]);

      items.slice(0, days).forEach((item, i) => {
        if (!item) return;
        const isPending = isPendingRequestItem(item);

        if (isPending) {
          pending.push({
            year: y,
            month: m,
            monthKey: mKey,
            member: name,
            dayIdx: i,
            day: i + 1,
            detail: item.detail || '',
            currentType: (item.type as StatusType) || 'pending',
            requestedBy: item.requestedBy?.trim() || '申請者未設定',
            requestedAt: item.requestedAt || '',
            requestId: item.requestId || `${mKey}-${name}-${i}-${item.requestedAt || ''}`,
          });
        }
      });
    });
  });

  return pending.sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    if (a.month !== b.month) return a.month - b.month;
    if (a.dayIdx !== b.dayIdx) return a.dayIdx - b.dayIdx;
    return a.member.localeCompare(b.member, 'ja');
  });
};

export const extractPendingRequests = (
  schedule: Record<string, { type: StatusType; detail: string }[]> | undefined,
  daysInMonth: number,
  memberList: string[] = MEMBERS
): { member: string; dayIdx: number; detail: string; currentType: StatusType }[] => {
  if (!schedule) return [];
  const pending: { member: string; dayIdx: number; detail: string; currentType: StatusType }[] = [];
  const allMembers = Array.from(new Set([...memberList, ...Object.keys(schedule)]));

  allMembers.forEach(name => {
    const rawSched = schedule[name];
    if (!rawSched) return;

    const items: ({ type?: StatusType; detail?: string } | undefined)[] = Array.isArray(rawSched)
      ? rawSched
      : Array.from({ length: daysInMonth }).map((_, i) => (rawSched as any)?.[i]);

    items.slice(0, daysInMonth).forEach((item, i) => {
      if (!item) return;
      const isPending = isPendingRequestItem(item);

      if (isPending) {
        pending.push({
          member: name,
          dayIdx: i,
          detail: item.detail || '',
          currentType: (item.type as StatusType) || 'pending',
        });
      }
    });
  });

  return pending.sort((a, b) => a.dayIdx - b.dayIdx || a.member.localeCompare(b.member, 'ja'));
};
