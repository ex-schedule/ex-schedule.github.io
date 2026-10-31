import { useState, useEffect, useMemo } from 'react';
import { StatusType, TYPE_LABEL, TYPE_CLASS, DEFAULT_EVENT_CLIENTS, getStatusStyle, getStatusShortLabel, isWorkType } from '../constants';
import type { EventClientConfig } from '../constants';
import { getDow } from '../utils/venue';
import { getHoliday } from '../utils/holidays';
import { SUMMARY_TYPES } from './SummaryView';

// --- 日別ビュー ---

export const DailyView = ({
  members,
  schedule,
  year,
  month,
  daysInMonth,
  dailyLocations,
  dailyTimes,
  eventClients = DEFAULT_EVENT_CLIENTS,
}: {
  members: string[];
  schedule: Record<string, { type: StatusType; detail: string }[]>;
  year: number;
  month: number;
  daysInMonth: number;
  dailyLocations: Record<number, string>;
  dailyTimes: Record<number, string>;
  eventClients?: EventClientConfig[];
}) => {
  const [day, setDay] = useState(() => {
    const today = new Date();
    return today.getFullYear() === year && today.getMonth() === month ? today.getDate() : 1;
  });

  useEffect(() => {
    setDay(d => Math.min(Math.max(d, 1), daysInMonth));
  }, [daysInMonth]);

  const entries = useMemo(
    () =>
      members.map(name => ({
        name,
        item: schedule[name]?.[day - 1] || { type: 'rest' as StatusType, detail: '' },
      })),
    [members, schedule, day]
  );

  const groups = useMemo(
    () => {
      // Gather present types
      const presentTypes = Array.from(new Set(entries.map(e => e.item.type)));
      // Sort in preferred order: SUMMARY_TYPES order first, then custom event types, then rest
      return presentTypes
        .map(type => ({
          type,
          list: entries.filter(e => e.item.type === type),
        }))
        .filter(g => g.list.length > 0);
    },
    [entries]
  );

  const workCount = entries.filter(e => isWorkType(e.item.type)).length;
  const offCount = entries.filter(e => e.item.type === 'normal' || e.item.type === 'request').length;
  const dow = getDow(year, month, day);
  const dowLabel = ['月', '火', '水', '木', '金', '土', '日'][dow];
  const holiday = getHoliday(year, month, day);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm p-5 border border-border">
        <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
          <div className="flex items-center gap-2 text-sm font-bold text-text">
            <div className="w-1 h-4 bg-accent rounded-full" />
            日別ビュー ({year}年{month + 1}月{day}日 {dowLabel})
            {holiday && <span className="ml-1 text-red-600">・{holiday}</span>}
          </div>
          <div className="flex items-center gap-2" data-no-print>
            <button
              onClick={() => setDay(d => Math.max(1, d - 1))}
              className="px-4 py-2 rounded-lg border border-border2 text-xs font-bold text-text2 hover:border-accent hover:text-accent"
            >
              前日
            </button>
            <button
              onClick={() => setDay(d => Math.min(daysInMonth, d + 1))}
              className="px-4 py-2 rounded-lg border border-border2 text-xs font-bold text-text2 hover:border-accent hover:text-accent"
            >
              翌日
            </button>
          </div>
        </div>

        <div className="flex gap-1 overflow-x-auto snap-x pb-2 mb-4 hide-scrollbar" data-no-print>
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const d = i + 1;
            const wd = getDow(year, month, d);
            const hol = getHoliday(year, month, d);
            return (
              <button
                key={d}
                onClick={() => setDay(d)}
                title={hol || undefined}
                className={`min-w-[44px] min-h-[44px] px-1 py-1 rounded-lg text-[11px] font-bold border transition-all snap-start ${
                  d === day
                    ? 'bg-accent border-accent text-white'
                    : wd === 6 || hol
                    ? 'bg-red-50 border-border text-red-500 hover:border-accent'
                    : wd === 5
                    ? 'bg-blue-50 border-border text-blue-500 hover:border-accent'
                    : 'bg-bg border-border text-text2 hover:border-accent'
                }`}
              >
                {d}
                <div className="text-[8px] font-normal opacity-80">{['月', '火', '水', '木', '金', '土', '日'][wd]}</div>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-2 mb-4 text-[10px] font-bold">
          <span className="px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-100">
            稼働 {workCount}人
          </span>
          <span className="px-2 py-1 rounded-lg bg-gray-100 text-text2 border border-border">
            休み {offCount}人
          </span>
          {dailyLocations?.[day] && (
            <span className="px-2 py-1 rounded-lg bg-orange-50 text-orange-700 border border-orange-100">
              場所: {dailyLocations[day]}
            </span>
          )}
          {dailyTimes?.[day] && (
            <span className="px-2 py-1 rounded-lg bg-blue-50 text-blue-700 border border-blue-100">
              時間: {dailyTimes[day]}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {groups.map(g => (
            <div key={g.type} className="border border-border rounded-xl p-3 bg-bg/50">
              <div className="flex items-center justify-between mb-2">
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${TYPE_CLASS[g.type] || 'bg-slate-100 text-slate-700'}`}
                  style={g.type.startsWith('event') ? getStatusStyle(g.type, eventClients) : undefined}
                >
                  {getStatusShortLabel(g.type, eventClients)}
                </span>
                <span className="text-[10px] font-bold text-text3">{g.list.length}人</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {g.list.map(e => (
                  <span
                    key={e.name}
                    className="px-2 py-1 rounded-lg bg-white border border-border2 text-[10px] text-text"
                  >
                    <span className="font-bold">{e.name.replace('　', '')}</span>
                    {e.item.detail && <span className="ml-1 text-text2">/ {e.item.detail}</span>}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
