import React, { useState, useMemo } from 'react';
import { ChevronRight, Search } from 'lucide-react';
import { StatusType, TYPE_LABEL, TYPE_CLASS, isWorkType } from '../constants';
import type { MemberSummary } from '../types';

// --- Summary (集計) ---

// 表示順: 稼働系を先に、休み系を後ろに
export const SUMMARY_TYPES: StatusType[] = [
  'office', 'event', 'training', 'dispatch', 'other', 'absence', 'normal', 'request', 'pending', 'rest'
];

// 稼働（出勤）としてカウントする種別
export const WORK_TYPES: StatusType[] = ['office', 'event', 'training', 'dispatch', 'other'];

export const SummaryView = ({
  members,
  schedule,
  daysInMonth,
  year,
  month,
}: {
  members: string[];
  schedule: Record<string, { type: StatusType; detail: string }[]>;
  daysInMonth: number;
  year: number;
  month: number;
}) => {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const visibleMembers = useMemo(
    () => members.filter(name => name.replace('　', '').includes(query.trim())),
    [members, query]
  );

  const summaries: MemberSummary[] = useMemo(() => {
    return visibleMembers.map(name => {
      const days = (schedule[name] || []).slice(0, daysInMonth);
      const counts = {} as Record<StatusType, number>;
      (Object.keys(TYPE_LABEL) as StatusType[]).forEach(t => { counts[t] = 0; });

      const detailMap: Record<string, number> = {};
      days.forEach(item => {
        const type = (item?.type || 'rest') as StatusType;
        // Group all event_* subtypes into event for the summary count
        if (type.startsWith('event')) {
          counts.event = (counts.event || 0) + 1;
        }
        counts[type] = (counts[type] || 0) + 1;
        const label = (item?.detail || '').trim();
        if (label && label !== '〇' && label !== '◎') {
          detailMap[label] = (detailMap[label] || 0) + 1;
        }
      });

      const details = Object.entries(detailMap)
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ja'));

      const work = days.reduce((sum, item) => sum + (isWorkType(item?.type || '') ? 1 : 0), 0);
      const off = (counts.normal || 0) + (counts.request || 0);

      return { name, counts, details, work, off };
    });
  }, [visibleMembers, schedule, daysInMonth]);


  const cellNum = (n: number) => (
    <span className={n === 0 ? 'text-text3/40' : 'font-bold text-text'}>{n === 0 ? '-' : n}</span>
  );

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm p-5 border border-border">
        <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
          <div className="flex items-center gap-2 text-sm font-bold text-text">
            <div className="w-1 h-4 bg-accent rounded-full" />
            ステータス集計 ({year}年{month + 1}月 / 全{daysInMonth}日)
          </div>
          <div className="flex items-center gap-2 flex-wrap" data-no-print>
            <div className="flex items-center gap-1 px-2 py-1 rounded-lg border border-border2">
              <Search size={12} className="text-text3" />
              <input
                className="outline-none text-[11px] w-28 bg-transparent"
                style={{ fontSize: '16px', width: '120px' }}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="メンバー検索"
              />
            </div>
          </div>
        </div>

        <p className="text-[10px] text-text3 mb-3">
          メンバー名をクリックすると、その人の予定内容（詳細テキスト）ごとの内訳を表示します。
          稼働日数 = {WORK_TYPES.map(t => (TYPE_LABEL[t] || t).split('(')[0]).join(' + ')}。
        </p>

        <div className="overflow-x-auto lg:overflow-x-visible -mx-5 px-5 lg:mx-0 lg:px-0 border-b border-border">
          <table className="w-full text-[10px] border-separate border-spacing-0 min-w-[720px] lg:min-w-0">
            <thead className="relative z-30">
              <tr className="bg-accent-l text-accent">
                <th className="p-2 border border-border font-bold sticky left-0 sm:top-[120px] bg-accent-l z-50 min-w-[84px] sm:min-w-[110px] text-left">
                  メンバー
                </th>
                <th className="p-2 border border-border font-bold sm:sticky sm:top-[120px] bg-accent-l z-30 min-w-[56px]">
                  稼働日数
                </th>
                <th className="p-2 border border-border font-bold sm:sticky sm:top-[120px] bg-accent-l z-30 min-w-[56px]">
                  休日数
                </th>
                {SUMMARY_TYPES.map(t => (
                  <th key={t} className="p-2 border border-border font-bold sm:sticky sm:top-[120px] bg-accent-l z-30 min-w-[62px]">
                    <span className={`px-1.5 py-0.5 rounded-full whitespace-nowrap ${TYPE_CLASS[t] || 'bg-slate-100 text-slate-700'}`}>
                      {(TYPE_LABEL[t] || t).split('(')[0]}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summaries.map(s => (
                <React.Fragment key={s.name}>
                  <tr className="hover:bg-accent-l/20 transition-colors">
                    <td className="p-0 border border-border sticky left-0 bg-white z-20">
                      <button
                        onClick={() => setExpanded(expanded === s.name ? null : s.name)}
                        className="w-full flex items-center gap-1 px-2 py-2 text-left font-bold text-text hover:text-accent transition-colors"
                      >
                        <ChevronRight
                          size={12}
                          className={`transition-transform ${expanded === s.name ? 'rotate-90' : ''}`}
                        />
                        {s.name.replace('　', '')}
                      </button>
                    </td>
                    <td className="p-2 border border-border text-center bg-emerald-50/40">
                      <span className="font-bold text-emerald-700">{s.work}</span>
                    </td>
                    <td className="p-2 border border-border text-center bg-gray-50">
                      <span className="font-bold text-text2">{s.off}</span>
                    </td>
                    {SUMMARY_TYPES.map(t => (
                      <td key={t} className="p-2 border border-border text-center">
                        {cellNum(s.counts[t])}
                      </td>
                    ))}
                  </tr>
                  {expanded === s.name && (
                    <tr>
                      <td
                        colSpan={SUMMARY_TYPES.length + 3}
                        className="p-3 border border-border bg-bg"
                      >
                        {s.details.length === 0 ? (
                          <span className="text-[10px] text-text3">詳細の入力がありません。</span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {s.details.map(d => (
                              <span
                                key={d.label}
                                className="px-2 py-1 rounded-full bg-white border border-border2 text-[10px] text-text2"
                              >
                                {d.label}
                                <span className="ml-1 font-bold text-accent">{d.count}日</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
