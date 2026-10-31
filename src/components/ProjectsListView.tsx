import { useState, useMemo } from 'react';
import {
  ChevronRight,
  Search,
  Plus,
  Shield,
  Crown,
  Users,
  LayoutGrid,
  ClipboardList,
  BarChart3,
  AlertCircle,
  Calendar,
  Clock,
  X,
} from 'lucide-react';
import type { ProjectItem, ProjectCandidate } from '../types';
import { clientColor, formatProjectDates, projectDates, sameProjectName } from '../utils/venue';

type ViewMode = 'board' | 'table' | 'members';
type StatusFilter = 'all' | 'attention' | 'multi';

const DOW_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

function addDowToSegment(seg: string): string {
  // seg is like "11/1" or "11/7〜11/8"
  return seg;
}

function getDateSegments(p: ProjectItem, year: number): { segments: string[]; totalDays: number } {
  const allDates = projectDates(p);
  const rawFormatted = formatProjectDates(p.date, p.dateEnd, p.occurrenceDates);
  if (!rawFormatted) return { segments: ['日程未定'], totalDays: 0 };

  const formatSingle = (md: string) => {
    const m = /^(\d{1,2})\/(\d{1,2})$/.exec(md.trim());
    if (!m) return md;
    const mo = Number(m[1]);
    const d = Number(m[2]);
    const dow = DOW_NAMES[new Date(year, mo - 1, d).getDay()];
    return `${mo}/${d}(${dow})`;
  };

  const parts = rawFormatted.split('・').map(part => {
    if (part.includes('〜')) {
      const [s, e] = part.split('〜');
      return `${formatSingle(s)}〜${formatSingle(e)}`;
    }
    return formatSingle(part);
  });

  return {
    segments: parts.map(addDowToSegment),
    totalDays: allDates.length,
  };
}

function getAssignedTotal(p: ProjectItem): number {
  const uniqueStaff = new Set([
    ...(p.directors || []),
    ...(p.leads || []),
    ...(p.members || []),
  ]);
  return uniqueStaff.size;
}

export const ProjectsListView = ({
  projects,
  candidates,
  members,
  year,
  month,
  canEdit,
  myName,
  onChangeMyName,
  onSelect,
  onAdd,
  onRegister,
  onRegisterAll,
}: {
  projects: ProjectItem[];
  candidates: ProjectCandidate[];
  members: string[];
  year: number;
  month: number;
  canEdit: boolean;
  myName: string;
  onChangeMyName: (name: string) => void;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRegister: (candidate: ProjectCandidate) => void;
  onRegisterAll: () => void;
}) => {
  const [query, setQuery] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [onlyMine, setOnlyMine] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('board');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [showCandidates, setShowCandidates] = useState(false);

  const isNeedsAttention = (p: ProjectItem) => {
    const assigned = getAssignedTotal(p);
    const required = Math.max(1, p.headcount ?? 1);
    return assigned < required || !p.client?.trim();
  };

  const isMultiSession = (p: ProjectItem) => {
    const raw = formatProjectDates(p.date, p.dateEnd, p.occurrenceDates);
    return raw.includes('・') || projectDates(p).length >= 2;
  };

  // --- Dashboard KPI Stats ---
  const stats = useMemo(() => {
    let totalDaysCount = 0;
    let multiSessionCount = 0;
    let totalRequired = 0;
    let totalAssigned = 0;
    let understaffedCount = 0;
    let missingClientCount = 0;
    let attentionCount = 0;
    const clientCounts = new Map<string, number>();

    for (const p of projects) {
      const days = projectDates(p).length || 1;
      totalDaysCount += days;
      if (isMultiSession(p)) multiSessionCount++;

      const assigned = getAssignedTotal(p);
      const req = Math.max(1, p.headcount ?? 1);
      totalRequired += req;
      totalAssigned += assigned;

      const isUnder = assigned < req;
      const isNoClient = !p.client?.trim();
      if (isUnder) understaffedCount++;
      if (isNoClient) missingClientCount++;
      if (isUnder || isNoClient) attentionCount++;

      const clientKey = p.client?.trim() || '__UNSET__';
      clientCounts.set(clientKey, (clientCounts.get(clientKey) || 0) + 1);
    }

    const clientBreakdown = Array.from(clientCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => {
        if (a.name === '__UNSET__') return 1;
        if (b.name === '__UNSET__') return -1;
        return b.count - a.count || a.name.localeCompare(b.name, 'ja');
      });

    const fillRate = totalRequired > 0 ? Math.min(100, Math.round((totalAssigned / totalRequired) * 100)) : 100;

    return {
      total: projects.length,
      totalDaysCount,
      multiSessionCount,
      totalRequired,
      totalAssigned,
      fillRate,
      understaffedCount,
      missingClientCount,
      attentionCount,
      clientBreakdown,
    };
  }, [projects]);

  const clients = useMemo(
    () =>
      Array.from(new Set(projects.map(project => project.client.trim()).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b, 'ja')
      ),
    [projects]
  );

  const sorted = useMemo(() => {
    const q = query.trim().replace('　', '');
    const isMine = (p: ProjectItem) =>
      !!myName &&
      ((p.directors || []).includes(myName) || p.leads.includes(myName) || p.members.includes(myName));

    return projects
      .filter(p => !onlyMine || isMine(p))
      .filter(p => {
        if (statusFilter === 'attention') return isNeedsAttention(p);
        if (statusFilter === 'multi') return isMultiSession(p);
        return true;
      })
      .filter(p => {
        if (!clientFilter) return true;
        if (clientFilter === '__UNSET__') return !p.client?.trim();
        return p.client.trim() === clientFilter;
      })
      .filter(p => {
        if (!q) return true;
        const names = [...(p.directors || []), ...p.leads, ...p.members]
          .map(n => n.replace('　', ''))
          .join(' ');
        return `${p.venue}${p.client}${p.carrier}${p.content}${p.comment}${names}`
          .replace(/　/g, '')
          .toLowerCase()
          .includes(q.toLowerCase());
      })
      .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.venue.localeCompare(b.venue, 'ja'));
  }, [projects, query, clientFilter, onlyMine, myName, statusFilter]);

  // Member workload stats for Members view
  const memberWorkloads = useMemo(() => {
    return members.map(member => {
      const directorProjects: ProjectItem[] = [];
      const leadProjects: ProjectItem[] = [];
      const staffProjects: ProjectItem[] = [];
      for (const p of projects) {
        if ((p.directors || []).includes(member)) directorProjects.push(p);
        else if (p.leads.includes(member)) leadProjects.push(p);
        else if (p.members.includes(member)) staffProjects.push(p);
      }
      const allAssigned = [...directorProjects, ...leadProjects, ...staffProjects].sort((a, b) =>
        (a.date || '9999').localeCompare(b.date || '9999')
      );
      return {
        member,
        directorCount: directorProjects.length,
        leadCount: leadProjects.length,
        staffCount: staffProjects.length,
        total: allAssigned.length,
        projects: allAssigned,
      };
    });
  }, [members, projects]);

  const hasActiveFilter = statusFilter !== 'all' || !!clientFilter || onlyMine || !!query.trim();

  const resetFilters = () => {
    setStatusFilter('all');
    setClientFilter('');
    setOnlyMine(false);
    setQuery('');
  };

  return (
    <div className="project-surface space-y-5 min-w-0 w-full max-w-full">
      {/* Top Executive Dashboard Panel */}
      <div className="rounded-2xl bg-white shadow-sm border border-slate-200/90 overflow-hidden">
        {/* Top Dark/Accent Banner Header */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-blue-950 px-5 py-4 text-white flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-400/30 flex items-center justify-center text-blue-300 shrink-0">
              <LayoutGrid size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-base sm:text-lg font-black tracking-tight">
                  案件共有ダッシュボード
                </h2>
                <span className="px-2.5 py-0.5 rounded-full bg-white/10 text-blue-200 text-xs font-bold border border-white/15">
                  {year}年{month + 1}月
                </span>
                <span className="px-2.5 py-0.5 rounded-full bg-blue-500/30 text-white text-xs font-extrabold">
                  表示 {sorted.length} / 全 {projects.length} 会場
                </span>
              </div>
              <p className="text-[11px] text-slate-300 mt-0.5">
                同じ会場名の案件を自動集約し、日程・クライアント・スタッフ配置を一画面で俯瞰できます
              </p>
            </div>
          </div>

          {/* View Switcher & Add Action */}
          <div className="flex items-center gap-2.5 flex-wrap" data-no-print>
            <div className="inline-flex rounded-xl bg-slate-950/60 border border-white/10 p-1">
              <button
                type="button"
                onClick={() => setViewMode('board')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  viewMode === 'board'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <LayoutGrid size={13} />
                カードボード
              </button>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  viewMode === 'table'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <ClipboardList size={13} />
                マトリクス表
              </button>
              <button
                type="button"
                onClick={() => setViewMode('members')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  viewMode === 'members'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <BarChart3 size={13} />
                メンバー稼働
              </button>
            </div>

            {canEdit && (
              <button
                data-edit-only
                onClick={onAdd}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-500 hover:bg-blue-400 text-white text-xs font-extrabold transition-all shadow-sm active:scale-95"
              >
                <Plus size={15} />
                新規案件を追加
              </button>
            )}
          </div>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          {/* 4 Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
            {/* KPI 1: Total Venues & Total Event Days */}
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`text-left rounded-xl p-4 border transition-all ${
                statusFilter === 'all' && !clientFilter
                  ? 'border-blue-500 bg-blue-50/40 ring-2 ring-blue-500/15'
                  : 'border-slate-200 bg-slate-50/60 hover:bg-white hover:border-blue-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500">集約済み案件（会場数）</span>
                <span className="w-7 h-7 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center">
                  <Calendar size={15} />
                </span>
              </div>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-3xl font-black text-slate-900 tracking-tight">{stats.total}</span>
                <span className="text-xs font-bold text-slate-500">会場</span>
                <span className="ml-auto text-xs font-extrabold text-blue-700 bg-blue-100/80 px-2 py-0.5 rounded-full">
                  延べ {stats.totalDaysCount} 日間
                </span>
              </div>
            </button>

            {/* KPI 2: Staffing Fill Rate */}
            <button
              type="button"
              onClick={() => setStatusFilter(statusFilter === 'attention' ? 'all' : 'attention')}
              className={`text-left rounded-xl p-4 border transition-all ${
                statusFilter === 'attention'
                  ? 'border-amber-500 bg-amber-50/50 ring-2 ring-amber-500/15'
                  : 'border-slate-200 bg-slate-50/60 hover:bg-white hover:border-amber-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500">スタッフ充足率・要確認</span>
                <span
                  className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                    stats.understaffedCount > 0
                      ? 'bg-amber-100 text-amber-600'
                      : 'bg-emerald-100 text-emerald-600'
                  }`}
                >
                  <Users size={15} />
                </span>
              </div>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-3xl font-black text-slate-900 tracking-tight">{stats.fillRate}%</span>
                <span className="text-xs font-bold text-slate-500">
                  ({stats.totalAssigned}/{stats.totalRequired}名)
                </span>
                {stats.attentionCount > 0 && (
                  <span className="ml-auto px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-extrabold">
                    要確認 {stats.attentionCount}件
                  </span>
                )}
              </div>
              <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden mt-2.5">
                <div
                  className={`h-full rounded-full transition-all ${
                    stats.fillRate >= 100 ? 'bg-emerald-500' : 'bg-amber-500'
                  }`}
                  style={{ width: `${Math.min(100, stats.fillRate)}%` }}
                />
              </div>
            </button>

            {/* KPI 3: Multi-day / Multi-session Venues */}
            <button
              type="button"
              onClick={() => setStatusFilter(statusFilter === 'multi' ? 'all' : 'multi')}
              className={`text-left rounded-xl p-4 border transition-all ${
                statusFilter === 'multi'
                  ? 'border-indigo-500 bg-indigo-50/50 ring-2 ring-indigo-500/15'
                  : 'border-slate-200 bg-slate-50/60 hover:bg-white hover:border-indigo-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500">複数日・複数週集約カード</span>
                <span className="w-7 h-7 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center">
                  <Clock size={15} />
                </span>
              </div>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-3xl font-black text-slate-900 tracking-tight">
                  {stats.multiSessionCount}
                </span>
                <span className="text-xs font-bold text-slate-500">会場</span>
                <span className="ml-auto text-[11px] font-bold text-indigo-700 bg-indigo-100/80 px-2 py-0.5 rounded-full">
                  同名会場を自動統合
                </span>
              </div>
            </button>

            {/* KPI 4: Client Distribution Bar & Quick Filter */}
            <div className="rounded-xl p-4 border border-slate-200 bg-slate-50/60 flex flex-col justify-between">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-slate-500">クライアント比率（タップで絞込）</span>
                {clientFilter && (
                  <button
                    type="button"
                    onClick={() => setClientFilter('')}
                    className="text-[11px] text-blue-600 hover:underline font-extrabold"
                  >
                    解除
                  </button>
                )}
              </div>

              {/* Stacked Color Bar */}
              {stats.total > 0 && (
                <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden flex mb-2">
                  {stats.clientBreakdown.map(item => {
                    const isUnset = item.name === '__UNSET__';
                    const cColor = !isUnset ? clientColor(item.name) : null;
                    const pct = Math.max(4, (item.count / stats.total) * 100);
                    return (
                      <div
                        key={item.name}
                        style={{
                          width: `${pct}%`,
                          backgroundColor: cColor ? cColor.accent : '#94a3b8',
                        }}
                        title={`${isUnset ? '未入力' : item.name}: ${item.count}件`}
                      />
                    );
                  })}
                </div>
              )}

              <div className="flex flex-wrap gap-1 max-h-[52px] overflow-y-auto">
                {stats.clientBreakdown.map(item => {
                  const isUnset = item.name === '__UNSET__';
                  const label = isUnset ? '未入力' : item.name;
                  const active = clientFilter === item.name;
                  const cColor = !isUnset ? clientColor(item.name) : null;
                  return (
                    <button
                      key={item.name}
                      type="button"
                      onClick={() => setClientFilter(active ? '' : item.name)}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold border transition-all ${
                        active
                          ? 'bg-slate-900 text-white border-slate-900 shadow-2xs'
                          : isUnset
                          ? 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                          : 'bg-white hover:opacity-85'
                      }`}
                      style={
                        !active && cColor
                          ? { backgroundColor: cColor.soft, color: cColor.text, borderColor: `${cColor.accent}40` }
                          : undefined
                      }
                    >
                      <span className="truncate max-w-[90px]">{label}</span>
                      <span className="font-black">{item.count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Collapsible Candidate Notification Bar */}
          {candidates.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50/60 px-4 py-2.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 text-xs font-bold text-amber-900">
                  <AlertCircle size={15} className="text-amber-600 shrink-0" />
                  <span>
                    全体表示から未登録・統合候補が <strong>{candidates.length}件</strong> 検出されています
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowCandidates(v => !v)}
                    className="px-3 py-1 rounded-lg bg-white border border-amber-300 text-amber-800 text-xs font-bold hover:bg-amber-100 transition-colors"
                  >
                    {showCandidates ? '候補を隠す ▲' : `候補を表示 (${candidates.length}件) ▼`}
                  </button>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={onRegisterAll}
                      className="px-3 py-1 rounded-lg bg-amber-500 text-white text-xs font-extrabold hover:bg-amber-600 transition-colors shadow-2xs"
                    >
                      すべて一括登録・統合
                    </button>
                  )}
                </div>
              </div>

              {showCandidates && (
                <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-amber-200/80">
                  {candidates.map(c => (
                    <div
                      key={c.key}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-amber-200 shadow-2xs text-xs flex-wrap"
                    >
                      <span className="font-mono font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-100">
                        {formatProjectDates(c.date, c.dateEnd, c.dates)}
                      </span>
                      <span className="font-bold text-slate-800">{c.venue}</span>
                      {c.detectedClient && (
                        <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100 text-[10px] font-bold">
                          {c.detectedClient}
                        </span>
                      )}
                      <span className="text-slate-500 font-bold">{c.members.length}人</span>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => onRegister(c)}
                          className="px-2 py-0.5 rounded-md bg-amber-500 text-white font-bold hover:bg-amber-600 transition-colors text-[11px]"
                        >
                          {projects.some(p => sameProjectName(p.venue, c.venue)) ? '統合' : '登録'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Search & Filter Control Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-1" data-no-print>
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border whitespace-nowrap transition-all ${
                  statusFilter === 'all'
                    ? 'bg-slate-900 text-white border-slate-900 shadow-2xs'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                }`}
              >
                すべて ({stats.total})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('attention')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border whitespace-nowrap transition-all ${
                  statusFilter === 'attention'
                    ? 'bg-amber-500 text-white border-amber-500 shadow-2xs'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-amber-400 hover:text-amber-700'
                }`}
              >
                要確認・人員不足 ({stats.attentionCount})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('multi')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border whitespace-nowrap transition-all ${
                  statusFilter === 'multi'
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-400 hover:text-indigo-700'
                }`}
              >
                複数日程・統合済み ({stats.multiSessionCount})
              </button>
            </div>

            <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50/70 focus-within:bg-white focus-within:border-blue-500 min-w-0 flex-1 sm:w-60 transition-colors">
                <Search size={14} className="text-slate-400 shrink-0" />
                <input
                  data-view-control
                  className="outline-none min-w-0 w-full bg-transparent text-xs font-semibold text-slate-800"
                  style={{ fontSize: '14px' }}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="会場名・メンバー・クライアント検索"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    className="text-slate-400 hover:text-slate-700"
                    aria-label="検索クリア"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>

              {clients.length > 0 && (
                <select
                  data-view-control
                  className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 outline-none focus:border-blue-500 bg-white max-w-[150px]"
                  value={clientFilter}
                  onChange={e => setClientFilter(e.target.value)}
                  aria-label="クライアントで絞り込み"
                >
                  <option value="">全クライアント</option>
                  {clients.map(client => (
                    <option key={client} value={client}>
                      {client}
                    </option>
                  ))}
                  {stats.missingClientCount > 0 && <option value="__UNSET__">クライアント未設定</option>}
                </select>
              )}

              <select
                data-view-control
                className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 outline-none focus:border-blue-500 bg-white"
                value={myName}
                onChange={e => onChangeMyName(e.target.value)}
                title="自分の名前を選ぶとカード上でハイライトされます"
              >
                <option value="">自分の名前を選択</option>
                {members.map(name => (
                  <option key={name} value={name}>
                    {name.replace('　', '')}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => setOnlyMine(v => !v)}
                disabled={!myName}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold border whitespace-nowrap transition-all disabled:opacity-40 ${
                  onlyMine
                    ? 'bg-blue-600 border-blue-600 text-white shadow-2xs'
                    : 'bg-white border-slate-200 text-slate-700 hover:border-blue-500 hover:text-blue-600'
                }`}
              >
                自分の案件のみ
              </button>

              {hasActiveFilter && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="px-2.5 py-1.5 rounded-xl text-xs font-bold text-red-600 hover:bg-red-50 border border-red-200 whitespace-nowrap"
                >
                  リセット
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {viewMode === 'members' ? (
        /* Member Workload Dashboard View */
        <div className="bg-white rounded-2xl shadow-sm p-5 border border-slate-200">
          <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
            <div>
              <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                <Users size={18} className="text-blue-600" />
                メンバー別アサイン状況 ({year}年{month + 1}月)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                各メンバーの担当現場数と会場一覧です。会場バッジをクリックすると案件詳細が開きます。
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
            {memberWorkloads.map(w => {
              const isMe = myName === w.member;
              return (
                <div
                  key={w.member}
                  className={`rounded-xl border p-4 transition-all ${
                    isMe
                      ? 'border-blue-500 bg-blue-50/30 ring-2 ring-blue-500/15'
                      : 'border-slate-200 bg-slate-50/40 hover:bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        onChangeMyName(w.member);
                        setOnlyMine(true);
                        setViewMode('board');
                      }}
                      className="text-sm font-black text-slate-900 hover:text-blue-600 flex items-center gap-2"
                    >
                      <span className="w-7 h-7 rounded-full bg-slate-800 text-white text-xs flex items-center justify-center font-bold">
                        {w.member.slice(0, 1)}
                      </span>
                      <span>{w.member.replace('　', '')}</span>
                    </button>
                    <div className="flex items-center gap-1 text-[11px] font-bold">
                      {w.directorCount > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">
                          D {w.directorCount}
                        </span>
                      )}
                      {w.leadCount > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                          担当 {w.leadCount}
                        </span>
                      )}
                      {w.staffCount > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-sky-100 text-sky-700">
                          M {w.staffCount}
                        </span>
                      )}
                      <span className="px-2 py-0.5 rounded-full bg-slate-900 text-white font-extrabold">
                        {w.total}会場
                      </span>
                    </div>
                  </div>

                  {w.projects.length === 0 ? (
                    <div className="text-xs text-slate-400 py-1">アサイン案件なし</div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {w.projects.map(p => {
                        const isLead = p.leads.includes(w.member);
                        const isDir = (p.directors || []).includes(w.member);
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => onSelect(p.id)}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all hover:border-blue-500 ${
                              isDir
                                ? 'bg-purple-50 border-purple-200 text-purple-900'
                                : isLead
                                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                                : 'bg-white border-slate-200 text-slate-800'
                            }`}
                          >
                            <span className="text-slate-500 font-mono text-[10px]">
                              {formatProjectDates(p.date, p.dateEnd, p.occurrenceDates)}
                            </span>
                            <span className="truncate max-w-[140px]">{p.venue}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : sorted.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm p-10 border border-slate-200 text-center">
          <div className="text-sm text-slate-500 font-bold">
            {projects.length === 0
              ? '今日以降の案件はありません。'
              : onlyMine
              ? `${myName.replace('　', '')}がアサインされた案件はありません。`
              : '条件に一致する案件がありません。'}
          </div>
          {hasActiveFilter && (
            <button
              type="button"
              onClick={resetFilters}
              className="mt-3 px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 transition-colors"
            >
              フィルタを解除する
            </button>
          )}
        </div>
      ) : viewMode === 'table' ? (
        /* Matrix Table View Mode */
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse min-w-[880px]">
              <thead>
                <tr className="bg-slate-900 text-white font-bold text-left">
                  <th className="py-3 px-4 w-[180px]">開催日程</th>
                  <th className="py-3 px-4 min-w-[160px]">会場名</th>
                  <th className="py-3 px-3.5 w-[140px]">クライアント</th>
                  <th className="py-3 px-3 w-[105px]">時間</th>
                  <th className="py-3 px-3 w-[95px] text-center">充足状況</th>
                  <th className="py-3 px-3.5 min-w-[160px]">ディレクター・担当者</th>
                  <th className="py-3 px-3.5 min-w-[230px]">稼働メンバー</th>
                  <th className="py-3 px-3.5 min-w-[140px]">内容・備考</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {sorted.map(p => {
                  const projectColor = clientColor(p.client || '');
                  const assigned = getAssignedTotal(p);
                  const required = p.headcount ?? 1;
                  const isShort = assigned < required;
                  const { segments, totalDays } = getDateSegments(p, year);

                  return (
                    <tr
                      key={p.id}
                      onClick={() => onSelect(p.id)}
                      className="cursor-pointer transition-colors hover:bg-blue-50/50 bg-white"
                    >
                      <td className="py-3 px-4 align-top">
                        <div className="flex flex-wrap gap-1">
                          {segments.map((seg, i) => (
                            <span
                              key={i}
                              className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-extrabold text-[11px] whitespace-nowrap"
                            >
                              {seg}
                            </span>
                          ))}
                        </div>
                        {totalDays > 1 && (
                          <div className="text-[10px] font-bold text-slate-400 mt-1">計{totalDays}日間</div>
                        )}
                      </td>
                      <td className="py-3 px-4 align-top font-black text-slate-900 text-sm">
                        {p.venue || '（場所未入力）'}
                      </td>
                      <td className="py-3 px-3.5 align-top">
                        <div className="flex flex-col items-start gap-1">
                          {p.client ? (
                            <span
                              className="px-2.5 py-0.5 rounded-md font-extrabold text-[11px]"
                              style={
                                projectColor
                                  ? { backgroundColor: projectColor.soft, color: projectColor.text }
                                  : undefined
                              }
                            >
                              {p.client}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-bold">
                              未入力
                            </span>
                          )}
                          {p.carrier && <span className="text-[11px] text-slate-500 font-bold">{p.carrier}</span>}
                        </div>
                      </td>
                      <td className="py-3 px-3 align-top font-bold text-slate-600 whitespace-nowrap">
                        {p.timeStart}〜{p.timeEnd}
                      </td>
                      <td className="py-3 px-3 align-top text-center">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold ${
                            isShort
                              ? 'bg-amber-50 text-amber-800 border border-amber-300'
                              : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          }`}
                        >
                          {assigned}/{required}名
                        </span>
                      </td>
                      <td className="py-3 px-3.5 align-top">
                        <div className="flex flex-wrap gap-1">
                          {(p.directors || []).map(name => (
                            <span
                              key={`d-${name}`}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold ${
                                myName === name
                                  ? 'bg-purple-600 text-white'
                                  : 'bg-purple-50 text-purple-800 border border-purple-200'
                              }`}
                            >
                              <Crown size={11} />
                              {name.replace('　', '')}
                            </span>
                          ))}
                          {p.leads.map(name => (
                            <span
                              key={`l-${name}`}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold ${
                                myName === name
                                  ? 'bg-emerald-600 text-white'
                                  : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                              }`}
                            >
                              <Shield size={11} />
                              {name.replace('　', '')}
                            </span>
                          ))}
                          {(p.directors || []).length === 0 && p.leads.length === 0 && (
                            <span className="text-slate-300 text-[11px]">-</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-3.5 align-top">
                        <div className="flex flex-wrap gap-1">
                          {p.members.map(name => (
                            <span
                              key={`m-${name}`}
                              className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                                myName === name
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-slate-100 text-slate-700 border border-slate-200'
                              }`}
                            >
                              {name.replace('　', '')}
                            </span>
                          ))}
                          {p.members.length === 0 && <span className="text-slate-300 text-[11px]">-</span>}
                        </div>
                      </td>
                      <td className="py-3 px-3.5 align-top text-slate-500">
                        <div className="line-clamp-2 text-[11px]">
                          {[p.content, p.comment].filter(Boolean).join(' / ') || '-'}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Modern Dashboard Card Grid (Default) */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {sorted.map(p => {
            const projectColor = clientColor(p.client || '');
            const assigned = getAssignedTotal(p);
            const required = p.headcount ?? 1;
            const shortage = Math.max(0, required - assigned);
            const { segments, totalDays } = getDateSegments(p, year);
            const isMine =
              !!myName &&
              ((p.directors || []).includes(myName) ||
                p.leads.includes(myName) ||
                p.members.includes(myName));

            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelect(p.id)}
                className={`group text-left rounded-2xl bg-white border transition-all flex flex-col overflow-hidden shadow-xs hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.99] min-w-0 w-full ${
                  isMine ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-slate-200/90 hover:border-blue-400'
                }`}
              >
                {/* Top Colored Accent Strip */}
                <div
                  className="h-1.5 w-full"
                  style={{
                    backgroundColor: projectColor ? projectColor.accent : '#94a3b8',
                  }}
                />

                <div className="p-4 sm:p-5 flex-1 flex flex-col gap-3.5">
                  {/* Row 1: Client Pill + Carrier + Staffing Status Badge */}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {p.client ? (
                        <span
                          className="px-2.5 py-0.5 rounded-md text-xs font-extrabold tracking-tight"
                          style={
                            projectColor
                              ? { backgroundColor: projectColor.soft, color: projectColor.text }
                              : undefined
                          }
                        >
                          {p.client}
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 rounded-md bg-slate-100 text-slate-500 text-[11px] font-bold">
                          クライアント未設定
                        </span>
                      )}
                      {p.carrier && (
                        <span className="px-2 py-0.5 rounded-md bg-pink-50 text-pink-700 border border-pink-200 text-[11px] font-bold">
                          {p.carrier}
                        </span>
                      )}
                    </div>

                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold border ${
                        shortage > 0
                          ? 'bg-amber-50 text-amber-800 border-amber-300'
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      }`}
                    >
                      <Users size={12} />
                      {shortage > 0 ? `不足 ${assigned}/${required}名` : `稼働 ${assigned}/${required}名`}
                    </span>
                  </div>

                  {/* Row 2: Venue Title & Time */}
                  <div>
                    <div className="text-lg font-black text-slate-900 leading-snug tracking-tight group-hover:text-blue-600 transition-colors break-words">
                      {p.venue || '（場所未入力）'}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs font-bold text-slate-500">
                      <span className="inline-flex items-center gap-1">
                        <Clock size={12} className="text-slate-400" />
                        {p.timeStart}〜{p.timeEnd}
                      </span>
                      {totalDays > 1 && (
                        <>
                          <span>•</span>
                          <span className="text-blue-600 font-extrabold">計{totalDays}日間</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Row 3: Date Segments (Clean Individual Date Badges for Aggregated Venues) */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {segments.map((seg, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-50/90 text-blue-700 border border-blue-200/80 text-xs font-extrabold"
                      >
                        <Calendar size={12} className="text-blue-500 shrink-0" />
                        {seg}
                      </span>
                    ))}
                  </div>

                  {/* Row 4: Structured Staff Assignment Box */}
                  <div className="rounded-xl bg-slate-50/90 border border-slate-200/80 p-3 space-y-2 mt-auto">
                    {/* Directors & Leads */}
                    {((p.directors || []).length > 0 || p.leads.length > 0) && (
                      <div className="flex flex-wrap items-center gap-1.5 pb-1.5 border-b border-slate-200/70">
                        {(p.directors || []).map(name => (
                          <span
                            key={`dir-${name}`}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-extrabold ${
                              myName === name
                                ? 'bg-purple-600 text-white shadow-2xs'
                                : 'bg-purple-100/90 text-purple-900 border border-purple-200'
                            }`}
                          >
                            <Crown size={11} className={myName === name ? 'text-white' : 'text-purple-600'} />
                            {name.replace('　', '')}
                          </span>
                        ))}
                        {p.leads.map(name => (
                          <span
                            key={`lead-${name}`}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-extrabold ${
                              myName === name
                                ? 'bg-emerald-600 text-white shadow-2xs'
                                : 'bg-emerald-100/90 text-emerald-900 border border-emerald-200'
                            }`}
                          >
                            <Shield size={11} className={myName === name ? 'text-white' : 'text-emerald-600'} />
                            {name.replace('　', '')}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Members */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      {p.members.map(name => (
                        <span
                          key={`mem-${name}`}
                          className={`px-2 py-0.5 rounded-md text-[11px] font-bold ${
                            myName === name
                              ? 'bg-blue-600 text-white shadow-2xs'
                              : 'bg-white text-slate-700 border border-slate-200/90 shadow-2xs'
                          }`}
                        >
                          {name.replace('　', '')}
                        </span>
                      ))}
                      {assigned === 0 && (
                        <span className="text-[11px] text-amber-700 font-bold">スタッフ未設定</span>
                      )}
                      {shortage > 0 && (
                        <span className="px-2 py-0.5 rounded-md border border-dashed border-amber-400 bg-amber-50/70 text-amber-800 text-[10px] font-extrabold">
                          ＋あと{shortage}名枠
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Optional Content / Comment Preview */}
                  {(p.content || p.comment) && (
                    <div className="text-xs text-slate-500 line-clamp-1">
                      {p.comment ? `💬 ${p.comment}` : p.content}
                    </div>
                  )}

                  {/* Footer Link */}
                  <div className="flex items-center justify-between text-xs font-extrabold text-blue-600 pt-1 border-t border-slate-100">
                    <span>詳細・メンバー編集を開く</span>
                    <ChevronRight size={15} className="group-hover:translate-x-0.5 transition-transform" />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
