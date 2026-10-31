import { useState, useMemo } from 'react';
import { ChevronRight, Search, Plus, Shield, Crown, Users } from 'lucide-react';
import type { ProjectItem, ProjectCandidate } from '../types';
import { clientColor, formatProjectDates, sameProjectName } from '../utils/venue';


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
  const clients = useMemo(
    () => Array.from(new Set(projects.map(project => project.client.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ja')),
    [projects]
  );

  const sorted = useMemo(() => {
    const q = query.trim();
    const isMine = (p: ProjectItem) =>
      !!myName &&
      ((p.directors || []).includes(myName) || p.leads.includes(myName) || p.members.includes(myName));
    return projects
      .filter(p => !onlyMine || isMine(p))
      .filter(p => !clientFilter || p.client === clientFilter)
      .filter(p => {
        if (!q) return true;
        const names = [...(p.directors || []), ...p.leads, ...p.members].map(n => n.replace('　', '')).join(' ');
        return `${p.venue}${p.client}${p.carrier}${p.content}${p.comment}${names}`.includes(q.replace('　', ''));
      })
      .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.venue.localeCompare(b.venue, 'ja'));
  }, [projects, query, clientFilter, onlyMine, myName]);

  return (
    <div className="project-surface min-w-0 w-full max-w-full bg-white rounded-xl shadow-sm p-4 sm:p-6 border border-border">
      <div className="flex flex-col gap-3 mb-5">
        <div className="flex items-center gap-2 text-base sm:text-lg font-bold text-text flex-wrap">
          <div className="w-1 h-5 bg-accent rounded-full" />
          案件一覧 ({year}年{month + 1}月)
          <span className="text-xs font-semibold text-text2">
            表示{sorted.length}件 / 全{projects.length}件
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap w-full" data-no-print>
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border2 bg-white min-w-0 w-full basis-full shrink-0 sm:w-auto sm:basis-auto sm:shrink sm:min-w-[220px] sm:flex-1">
            <Search size={13} className="text-text3" />
            <input
              data-view-control
              className="outline-none min-w-0 w-full bg-transparent"
              style={{ fontSize: '16px' }}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="名前・場所・クライアント検索"
            />
          </div>
          {clients.length > 0 && (
            <select
              data-view-control
              className="px-2.5 py-1.5 min-h-[38px] sm:min-h-0 rounded-lg border border-border2 text-sm font-bold text-text2 outline-none focus:border-accent bg-white w-[calc(50%-0.25rem)] sm:w-auto sm:max-w-[150px] min-w-0 shrink-0"
              style={{ fontSize: '16px' }}
              value={clientFilter}
              onChange={e => setClientFilter(e.target.value)}
              aria-label="クライアントで絞り込み"
            >
              <option value="">全クライアント</option>
              {clients.map(client => <option key={client} value={client}>{client}</option>)}
            </select>
          )}
          <select
            data-view-control
            className="px-2.5 py-1.5 min-h-[38px] sm:min-h-0 rounded-lg border border-border2 text-sm font-bold text-text2 outline-none focus:border-accent bg-white w-[calc(50%-0.25rem)] sm:w-auto min-w-0 shrink-0"
            style={{ fontSize: '16px' }}
            value={myName}
            onChange={e => onChangeMyName(e.target.value)}
            title="自分の名前を選ぶと、自分の案件だけに絞り込めます"
          >
            <option value="">自分の名前を選択</option>
            {members.map(name => (
              <option key={name} value={name}>
                {name.replace('　', '')}
              </option>
            ))}
          </select>
          <button
            onClick={() => setOnlyMine(v => !v)}
            disabled={!myName}
            className={`w-full sm:w-auto px-3 py-1.5 min-h-[38px] sm:min-h-0 rounded-lg text-xs font-bold border transition-colors disabled:opacity-40 active:scale-95 ${
              onlyMine ? 'bg-accent border-accent text-white' : 'bg-white border-border2 text-text2 hover:border-accent hover:text-accent'
            }`}
            title={myName ? `${myName.replace('　', '')}がアサインされた案件だけ表示` : '先に自分の名前を選んでください'}
          >
            自分の案件だけ
          </button>
          {canEdit && (
            <button
              data-edit-only
              onClick={onAdd}
              className="flex items-center gap-1.5 px-3 py-1.5 min-h-[38px] sm:min-h-0 rounded-lg bg-accent text-white text-xs font-bold hover:bg-accent-d transition-colors shadow-2xs active:scale-95"
            >
              <Plus size={13} />
              案件を追加
            </button>
          )}
        </div>
      </div>


      {candidates.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
          <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
            <div className="text-sm font-bold text-amber-800">
              登録・統合候補 {candidates.length}件
              <span className="ml-2 font-normal text-amber-700">
                全体表示の予定から見つかりました。内容を確認して登録できます。
              </span>
            </div>
            {canEdit && (
              <button
                onClick={onRegisterAll}
                className="px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-bold hover:bg-amber-600 transition-colors shadow-xs"
              >
                すべて登録・統合
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {candidates.map(c => (
              <div
                key={c.key}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-amber-200 shadow-xs text-xs flex-wrap"
              >
                <span className="font-mono font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-100">{formatProjectDates(c.date, c.dateEnd, c.dates)}</span>
                <span className="font-bold text-text">{c.venue}</span>
                {c.detectedClient && (
                  <span className="px-1.5 py-0.2 rounded bg-blue-50 text-blue-700 border border-blue-100 text-[11px] font-bold">
                    {c.detectedClient}
                  </span>
                )}
                {c.detectedCarrier && (
                  <span className="px-1.5 py-0.2 rounded bg-pink-50 text-pink-700 border border-pink-100 text-[11px] font-bold">
                    {c.detectedCarrier}
                  </span>
                )}
                <span className="text-text2 font-bold">{c.members.length}人</span>
                {canEdit && (
                  <button
                    onClick={() => onRegister(c)}
                    className="px-2 py-0.5 rounded-md bg-amber-500 text-white font-bold hover:bg-amber-600 transition-colors text-[11px]"
                  >
                    {projects.some(p => sameProjectName(p.venue, c.venue)) ? '統合' : '登録'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="text-sm text-text2 font-bold p-5 bg-bg/40 rounded-xl text-center">
          {projects.length === 0
            ? '今日以降の案件はありません。'
            : onlyMine
            ? `${myName.replace('　', '')}がアサインされた今日以降の案件はありません。`
            : '条件に一致する案件がありません。'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {sorted.map(p => {
            const projectColor = clientColor(p.client || '');
            return (
            <button
              key={p.id}
              onClick={() => onSelect(p.id)}
              className="text-left border border-border rounded-xl p-4 sm:p-5 bg-white hover:border-accent hover:bg-accent-l/10 transition-all flex flex-col gap-3 shadow-sm active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-accent min-w-0 w-full max-w-full"
              style={projectColor ? { borderTop: `4px solid ${projectColor.accent}` } : undefined}
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="project-text-wrap min-w-0 max-w-full px-3 py-1.5 rounded-lg bg-accent-l text-accent text-sm font-extrabold border border-accent/20 leading-snug">
                  {formatProjectDates(p.date, p.dateEnd, p.occurrenceDates)}
                </span>
                <span className="text-sm text-text2 font-bold">
                  {p.timeStart}〜{p.timeEnd}
                </span>
              </div>

              <div className="project-text-wrap text-[17px] sm:text-base font-extrabold text-text leading-snug">{p.venue || '（場所未入力）'}</div>
              <div className="flex items-start gap-2 text-sm min-w-0">
                <span className="shrink-0 pt-1 text-xs font-bold text-text2">クライアント</span>
                <span
                  className="project-text-wrap px-2 py-1 rounded font-bold min-w-0"
                  style={projectColor ? { backgroundColor: projectColor.soft, color: projectColor.text } : undefined}
                >{p.client || '未入力'}</span>
              </div>
              {p.carrier && (
                <div className="project-text-wrap text-sm text-text2"><span className="font-bold">キャリア</span> {p.carrier}</div>
              )}

              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-sm">
                <span className="font-extrabold text-text flex items-center gap-1">
                  <Users size={15} className="text-accent" />
                  稼働 {p.headcount ?? 0}人
                </span>
              </div>
              {((p.directors || []).length > 0 || p.leads.length > 0 || p.members.length > 0) && (
                <div className="space-y-1 text-sm text-text2">
                  {(p.directors || []).length > 0 && (
                    <div className="project-text-wrap flex items-start gap-2">
                      <Crown size={14} className="mt-0.5 shrink-0 text-purple-600" />
                      <span><span className="font-bold text-purple-700">ディレクター</span> {(p.directors || []).map(name => name.replace('　', '')).join('、')}</span>
                    </div>
                  )}
                  {p.leads.length > 0 && (
                    <div className="project-text-wrap flex items-start gap-2">
                      <Shield size={14} className="mt-0.5 shrink-0 text-emerald-600" />
                      <span><span className="font-bold text-emerald-700">担当者</span> {p.leads.map(name => name.replace('　', '')).join('、')}</span>
                    </div>
                  )}
                  {p.members.length > 0 && <div>メンバー {p.members.length}名</div>}
                </div>
              )}

              {p.content && <div className="project-text-wrap text-sm text-text2 line-clamp-2">{p.content}</div>}

              <div className="text-sm font-bold text-accent flex items-center gap-1 mt-auto pt-1">
                詳細を確認
                <ChevronRight size={16} />
              </div>
            </button>
          )})}
        </div>
      )}
    </div>
  );
};
