import { useState, useMemo } from 'react';
import { CheckCircle2, Info } from 'lucide-react';
import { MEMBERS, StatusType, getDaysInMonth } from '../constants';
import type { MonthData, PendingRequestItem } from '../types';
import { getDow } from '../utils/venue';
import { getHoliday } from '../utils/holidays';


export const RequestsView = ({
  allPendingRequests,
  allData,
  members,
  currentYear,
  currentMonth,
  canEdit,
  onApprove,
  onReject,
  onSetNormal,
}: {
  allPendingRequests: PendingRequestItem[];
  allData: Record<string, MonthData>;
  members?: string[];
  currentYear: number;
  currentMonth: number;
  canEdit: boolean;
  onApprove: (req: PendingRequestItem) => void;
  onReject: (req: PendingRequestItem) => void;
  onSetNormal?: (req: PendingRequestItem) => void;
  onNavigateMonth?: (year: number, month: number) => void;
}) => {
  const activeMembers = members || MEMBERS;
  const [viewTab, setViewTab] = useState<'pending' | 'approved'>('pending');
  const [monthFilter, setMonthFilter] = useState<'all' | 'current' | 'next'>('all');

  const nextYear = currentMonth === 11 ? currentYear + 1 : currentYear;
  const nextMonth = currentMonth === 11 ? 0 : currentMonth + 1;

  // 当月（現在選択中の月）の未処理申請
  const currentMonthPendingList = useMemo(() => {
    return allPendingRequests.filter(r => r.year === currentYear && r.month === currentMonth);
  }, [allPendingRequests, currentYear, currentMonth]);

  // 翌月の未処理申請（9月等）
  const nextMonthPendingList = useMemo(() => {
    return allPendingRequests.filter(r => r.year === nextYear && r.month === nextMonth);
  }, [allPendingRequests, nextYear, nextMonth]);

  // 表示対象の未処理申請一覧
  const displayedPendingList = useMemo(() => {
    if (monthFilter === 'current') return currentMonthPendingList;
    if (monthFilter === 'next') return nextMonthPendingList;
    return allPendingRequests;
  }, [monthFilter, currentMonthPendingList, nextMonthPendingList, allPendingRequests]);

  // 確定済みの希望休一覧（全期間から収集）
  const allApprovedList = useMemo(() => {
    const out: { year: number; month: number; member: string; dayIdx: number; day: number; detail: string }[] = [];
    Object.entries(allData || {}).forEach(([mKey, rawData]) => {
      const mData = rawData as MonthData | undefined;
      if (!mData?.schedule) return;
      const parts = mKey.split('-');
      if (parts.length !== 2) return;
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10) - 1;
      if (isNaN(y) || isNaN(m)) return;

      const days = getDaysInMonth(y, m);
      const allMembers = Array.from(new Set([...activeMembers, ...Object.keys(mData.schedule)]));

      allMembers.forEach(name => {
        const rawSched = mData.schedule[name];
        if (!rawSched) return;
        const items: ({ type?: StatusType; detail?: string } | undefined)[] = Array.isArray(rawSched)
          ? rawSched
          : Array.from({ length: days }).map((_, i) => (rawSched as any)?.[i]);

        items.slice(0, days).forEach((item, i) => {
          if (item?.type === 'request') {
            out.push({
              year: y,
              month: m,
              member: name,
              dayIdx: i,
              day: i + 1,
              detail: item.detail || '',
            });
          }
        });
      });
    });

    return out.sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      if (a.month !== b.month) return a.month - b.month;
      if (a.dayIdx !== b.dayIdx) return a.dayIdx - b.dayIdx;
      return a.member.localeCompare(b.member, 'ja');
    });
  }, [allData]);

  const displayedApprovedList = useMemo(() => {
    if (monthFilter === 'current') {
      return allApprovedList.filter(item => item.year === currentYear && item.month === currentMonth);
    }
    if (monthFilter === 'next') {
      return allApprovedList.filter(item => item.year === nextYear && item.month === nextMonth);
    }
    return allApprovedList.filter(item => 
      (item.year === currentYear && item.month === currentMonth) || 
      (item.year === nextYear && item.month === nextMonth)
    );
  }, [allApprovedList, monthFilter, currentYear, currentMonth, nextYear, nextMonth]);

  const handleApproveAll = async () => {
    if (displayedPendingList.length === 0) return;
    const filterLabel = 
      monthFilter === 'current' 
        ? `${currentMonth + 1}月分` 
        : monthFilter === 'next' 
        ? `${nextMonth + 1}月分(翌月)` 
        : '表示中のすべて';
    if (!window.confirm(`${filterLabel}の未処理申請 ${displayedPendingList.length}件をすべて「希望休(◎)」として承認しますか？`)) return;
    for (const req of displayedPendingList) {
      await onApprove(req);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6 border border-border">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-2 text-base font-bold text-text flex-wrap">
            <div className="w-1.5 h-4 bg-accent rounded-full" />
            <span>{currentYear}年{currentMonth + 1}月 希望休申請管理</span>
            {nextMonthPendingList.length > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-blue-600 text-white text-xs font-bold shadow-xs">
                翌月({nextMonth + 1}月)の申請 {nextMonthPendingList.length}件
              </span>
            )}
            {currentMonthPendingList.length > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-bold ring-1 ring-amber-300">
                当月({currentMonth + 1}月) {currentMonthPendingList.length}件
              </span>
            )}
          </div>
          <p className="text-xs text-text3 mt-1">
            当月（{currentMonth + 1}月）および翌月（{nextMonth + 1}月）に提出された希望休申請の確認・承認がここで行えます。
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {viewTab === 'pending' && displayedPendingList.length > 0 && canEdit && (
            <button
              onClick={handleApproveAll}
              data-edit-only
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm transition-colors flex items-center gap-1.5"
            >
              <CheckCircle2 size={14} />
              {monthFilter === 'next' ? '翌月分を一括承認' : monthFilter === 'current' ? '当月分を一括承認' : '一括承認'} ({displayedPendingList.length}件)
            </button>
          )}
        </div>
      </div>

      {/* タブ切り替え & 月フィルター */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewTab('pending')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
              viewTab === 'pending'
                ? 'bg-accent text-white shadow-sm'
                : 'bg-bg text-text2 hover:text-text hover:bg-gray-200/60'
            }`}
          >
            <span>未処理の申請</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
              viewTab === 'pending' ? 'bg-white/20 text-white' : 'bg-gray-200 text-text2'
            }`}>
              {allPendingRequests.length}
            </span>
          </button>

          <button
            onClick={() => setViewTab('approved')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
              viewTab === 'approved'
                ? 'bg-accent text-white shadow-sm'
                : 'bg-bg text-text2 hover:text-text hover:bg-gray-200/60'
            }`}
          >
            <span>確定済みの希望休 (◎)</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
              viewTab === 'approved' ? 'bg-white/20 text-white' : 'bg-gray-200 text-text2'
            }`}>
              {displayedApprovedList.length}
            </span>
          </button>
        </div>

        {/* 月切り替えフィルター */}
        <div className="flex items-center gap-1.5 bg-bg p-1 rounded-lg border border-border text-xs font-medium">
          <button
            onClick={() => setMonthFilter('all')}
            className={`px-2.5 py-1 rounded-md transition-all font-bold ${
              monthFilter === 'all'
                ? 'bg-white text-accent shadow-2xs'
                : 'text-text2 hover:text-text'
            }`}
          >
            すべて ({allPendingRequests.length})
          </button>
          <button
            onClick={() => setMonthFilter('current')}
            className={`px-2.5 py-1 rounded-md transition-all font-bold ${
              monthFilter === 'current'
                ? 'bg-white text-accent shadow-2xs'
                : 'text-text2 hover:text-text'
            }`}
          >
            当月 {currentMonth + 1}月分 ({currentMonthPendingList.length})
          </button>
          <button
            onClick={() => setMonthFilter('next')}
            className={`px-2.5 py-1 rounded-md transition-all font-bold ${
              monthFilter === 'next'
                ? 'bg-blue-600 text-white shadow-2xs'
                : 'text-blue-700 hover:bg-blue-50'
            }`}
          >
            翌月 {nextMonth + 1}月分 ({nextMonthPendingList.length})
          </button>
        </div>
      </div>

      {viewTab === 'pending' ? (
        displayedPendingList.length === 0 ? (
          <div className="text-center py-12 px-4 border border-dashed border-border rounded-xl bg-bg/30">
            <CheckCircle2 size={36} className="mx-auto text-emerald-500 mb-2 opacity-80" />
            <p className="text-sm font-bold text-text mb-1">
              {monthFilter === 'next'
                ? `翌月（${nextMonth + 1}月）の未処理の希望休申請はありません`
                : monthFilter === 'current'
                ? `当月（${currentMonth + 1}月）の未処理の希望休申請はありません`
                : '未処理の希望休申請はありません'}
            </p>
            <p className="text-xs text-text3">
              メンバーがスケジュール画面で「希望休申請」を選択すると、ここに自動で届きます。
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {displayedPendingList.map(req => {
              const dow = getDow(req.year, req.month, req.day);
              const dowLabel = ['月', '火', '水', '木', '金', '土', '日'][dow];
              const holiday = getHoliday(req.year, req.month, req.day);
              const isSat = dow === 5;
              const isSun = dow === 6 || !!holiday;
              const isNextMonth = req.year !== currentYear || req.month !== currentMonth;

              return (
                <div
                  key={`${req.monthKey}-${req.member}-${req.day}`}
                  className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 border rounded-xl p-3 sm:px-4 transition-all ${
                    isNextMonth
                      ? 'border-blue-300/80 bg-blue-50/50 hover:bg-blue-50/80'
                      : 'border-amber-200/80 bg-amber-50/40 hover:bg-amber-50/70'
                  }`}
                >
                  <div className="flex items-center gap-2.5 flex-wrap">
                    {isNextMonth ? (
                      <span className="px-2 py-0.5 rounded bg-blue-600 text-white font-bold text-[11px] shrink-0">
                        {req.year !== currentYear ? `${req.year}年` : ''}{req.month + 1}月分 (翌月)
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 font-bold text-[11px] shrink-0">
                        {req.month + 1}月分 (当月)
                      </span>
                    )}

                    <span className={`font-mono font-bold text-xs px-2.5 py-1 rounded-lg border ${
                      isSun
                        ? 'bg-red-50 text-red-600 border-red-200'
                        : isSat
                        ? 'bg-blue-50 text-blue-600 border-blue-200'
                        : 'bg-white text-accent border-accent/20'
                    }`}>
                      {req.month + 1}/{req.day} ({dowLabel}){holiday ? ` ${holiday}` : ''}
                    </span>
                    <span className="font-bold text-sm text-text">
                      {req.member.replace('　', '')}
                    </span>
                    {req.detail && (
                      <span className="px-2 py-0.5 rounded bg-white border border-border text-xs text-text2 font-medium">
                        {req.detail}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0 flex-wrap" data-edit-only>
                    {canEdit && (
                      <>
                        <button
                          onClick={() => onApprove(req)}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 shadow-2xs transition-colors flex items-center gap-1"
                        >
                          <CheckCircle2 size={13} />
                          承認 (◎希望休)
                        </button>
                        {onSetNormal && (
                          <button
                            onClick={() => onSetNormal(req)}
                            className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-gray-50 border border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors"
                          >
                            公休 (〇)
                          </button>
                        )}
                        <button
                          onClick={() => onReject(req)}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 transition-colors"
                        >
                          却下 (未定)
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        displayedApprovedList.length === 0 ? (
          <div className="text-center py-12 px-4 border border-dashed border-border rounded-xl bg-bg/30">
            <Info size={36} className="mx-auto text-text3 mb-2 opacity-50" />
            <p className="text-sm font-bold text-text mb-1">
              確定済みの希望休はありません
            </p>
            <p className="text-xs text-text3">
              申請を承認すると、確定した希望休(◎)としてここに一覧表示されます。
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
            {displayedApprovedList.map(item => {
              const dow = getDow(item.year, item.month, item.day);
              const dowLabel = ['月', '火', '水', '木', '金', '土', '日'][dow];
              const holiday = getHoliday(item.year, item.month, item.day);
              const isNextMonth = item.year !== currentYear || item.month !== currentMonth;
              return (
                <div
                  key={`${item.year}-${item.month}-${item.member}-${item.day}`}
                  className={`flex items-center justify-between p-2.5 rounded-lg border text-xs gap-2 ${
                    isNextMonth
                      ? 'border-blue-200 bg-blue-50/60'
                      : 'border-pink-100 bg-pink-50/40'
                  }`}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    {isNextMonth && (
                      <span className="px-1.5 py-0.2 rounded bg-blue-600 text-white text-[9px] font-bold">
                        {item.month + 1}月
                      </span>
                    )}
                    <span className={`font-mono font-bold ${holiday ? 'text-red-600' : 'text-pink-700'}`} title={holiday || undefined}>
                      {item.month + 1}/{item.day}({dowLabel}){holiday ? '祝' : ''}
                    </span>
                    <span className="font-bold text-text">
                      {item.member.replace('　', '')}
                    </span>
                    {item.detail && (
                      <span className="text-text2 text-[10px] truncate max-w-[90px]">{item.detail}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}
    </div>
  );
};
