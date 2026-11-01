import { useState, useEffect, useRef } from 'react';
import { Save, ChevronLeft, Upload, Trash2, Users, Calendar, Clock, MapPin, Building2, FileText, CheckCircle2 } from 'lucide-react';
import type { ProjectItem } from '../types';
import { projectTitle, clientColor } from '../utils/venue';
import { TextField, HeadcountSelector, RoleChipSelect } from './FormFields';

export const ProjectDetailView = ({
  project,
  directorOptions,
  leadOptions,
  memberOptions,
  clientSuggestions,
  year,
  month,
  canEdit,
  onBack,
  onSave,
  onDelete,
  onSyncMembers,
  syncCount,
  mergePending = false,
}: {
  project: ProjectItem;
  directorOptions: string[];
  leadOptions: string[];
  memberOptions: string[];
  clientSuggestions: string[];
  year: number;
  month: number;
  canEdit: boolean;
  onBack: () => void;
  onSave: (saved: ProjectItem, baseline: ProjectItem) => Promise<ProjectItem>;
  onDelete: (baseline: ProjectItem) => Promise<void>;
  onSyncMembers: () => Partial<ProjectItem> | null;
  syncCount: number | null;
  mergePending?: boolean;
}) => {
  const [draft, setDraft] = useState(project);
  const [base, setBase] = useState(project);
  const [latestRemote, setLatestRemote] = useState(project);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [project.id]);

  const prevIdRef = useRef(project.id);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const baseRef = useRef(base);
  baseRef.current = base;
  const busyRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setLatestRemote(project);

    const idChanged = prevIdRef.current !== project.id;
    prevIdRef.current = project.id;

    if (idChanged) {
      setBase(project);
      setDraft(project);
      setConfirmDelete(false);
      setSaving(false);
      setSaveError(null);
      setSaveSuccess(false);
      busyRef.current = false;
      return;
    }

    const remoteChanged = JSON.stringify(project) !== JSON.stringify(baseRef.current);
    if (!remoteChanged) return;

    const currentlyDirty = JSON.stringify(draftRef.current) !== JSON.stringify(baseRef.current);
    if (!currentlyDirty) {
      setBase(project);
      setDraft(project);
    }
  }, [project]);

  const patchDraft = (changes: Partial<ProjectItem>) => {
    setDraft(prev => ({ ...prev, ...changes }));
    setSaveSuccess(false);
  };
  const isDirty = JSON.stringify(draft) !== JSON.stringify(base);
  const hasConflict = isDirty && JSON.stringify(latestRemote) !== JSON.stringify(base);

  const handleLoadLatest = () => {
    if (!window.confirm('入力内容を破棄して最新の内容を読み込みますか？')) return;
    setBase(latestRemote);
    setDraft(latestRemote);
    setSaveError(null);
  };

  const handleSave = async () => {
    if (!canEdit || busyRef.current) return;
    busyRef.current = true;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    const payload = { ...draft, updatedAt: new Date().toISOString() };
    try {
      const saved = await onSave(payload, base);
      if (!isMountedRef.current || prevIdRef.current !== project.id) return;
      setBase(saved);
      setDraft(saved);
      setLatestRemote(saved);
      setSaveSuccess(true);
      setTimeout(() => {
        if (isMountedRef.current) setSaveSuccess(false);
      }, 3000);
    } catch (e) {
      if (!isMountedRef.current || prevIdRef.current !== project.id) return;
      setSaveError(e instanceof Error ? e.message : '保存に失敗しました。もう一度お試しください。');
    } finally {
      if (isMountedRef.current && prevIdRef.current === project.id) setSaving(false);
      busyRef.current = false;
    }
  };

  const handleDelete = async () => {
    if (!canEdit || busyRef.current) return;
    busyRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      await onDelete(base);
    } catch (e) {
      if (!isMountedRef.current || prevIdRef.current !== project.id) return;
      setSaveError(e instanceof Error ? e.message : '削除に失敗しました。もう一度お試しください。');
      setSaving(false);
      setConfirmDelete(false);
      busyRef.current = false;
      return;
    }
    if (isMountedRef.current) setSaving(false);
    busyRef.current = false;
  };

  const handleBack = () => {
    if (busyRef.current) return;
    if (isDirty) {
      if (!window.confirm('保存されていない変更があります。破棄して一覧へ戻りますか？')) return;
    }
    onBack();
  };

  const toggleIn = (list: string[], name: string) =>
    list.includes(name) ? list.filter(n => n !== name) : [...list, name];

  const assignedStaffTotal = (draft.directors?.length || 0) + draft.leads.length + draft.members.length;
  const pColor = clientColor(draft.client || '');

  // 担当者オプションは全メンバーを対象とする（制限しない）
  const allStaffOptions = memberOptions && memberOptions.length > 0 ? memberOptions : optionsFromStaff(draft);

  function optionsFromStaff(item: ProjectItem): string[] {
    const set = new Set<string>();
    (item.directors || []).forEach(n => set.add(n));
    item.leads.forEach(n => set.add(n));
    item.members.forEach(n => set.add(n));
    return Array.from(set);
  }

  return (
    <div className="project-surface min-w-0 w-full max-w-full space-y-4">
      {/* 1. Top Action Bar */}
      <div className="flex items-center justify-between gap-3 bg-white p-3.5 sm:p-4 rounded-xl border border-border shadow-2xs flex-wrap">
        <button
          onClick={handleBack}
          disabled={saving}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border2 text-xs font-bold text-text2 hover:border-accent hover:text-accent transition-colors bg-white active:scale-95 disabled:opacity-40"
          data-no-print
        >
          <ChevronLeft size={14} />
          一覧へ戻る
        </button>

        <div className="flex items-center gap-2 flex-wrap" data-no-print>
          {saveSuccess && (
            <span className="text-xs font-bold text-emerald-600 flex items-center gap-1 px-2 py-1 bg-emerald-50 rounded-lg border border-emerald-200 animate-fadeIn">
              <CheckCircle2 size={13} />
              保存しました
            </span>
          )}
          {canEdit && (
            <div data-edit-only className="flex items-center gap-2">
              <button
                type="button"
                disabled={(!isDirty && !mergePending) || saving}
                onClick={handleSave}
                className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-xs active:scale-95 ${
                  isDirty || mergePending
                    ? 'bg-accent text-white hover:bg-accent-d ring-2 ring-accent/30'
                    : 'bg-bg text-text3 border border-border2 cursor-not-allowed opacity-50'
                }`}
              >
                <Save size={13} />
                {saving ? '保存中…' : '変更を保存'}
              </button>

              {confirmDelete ? (
                <div className="flex items-center gap-1.5 bg-red-50 p-1 rounded-lg border border-red-200">
                  <span className="text-[10px] font-bold text-red-600 px-1">削除？</span>
                  <button
                    onClick={handleDelete}
                    disabled={saving}
                    className="px-2.5 py-1 rounded-md bg-red-600 text-white text-[10px] font-bold hover:bg-red-700 active:scale-95"
                  >
                    削除
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    disabled={saving}
                    className="px-2 py-1 rounded-md bg-white border border-border2 text-[10px] font-bold text-text2 hover:bg-bg"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  disabled={saving}
                  className="flex items-center gap-1 px-2.5 py-2 rounded-lg border border-red-200 bg-red-50 text-[11px] font-bold text-red-600 hover:bg-red-100 transition-colors"
                  title="この案件を削除"
                >
                  <Trash2 size={13} />
                  削除
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Notifications */}
      {mergePending && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs font-bold text-amber-800" data-no-print>
          同名の登録済み案件を表示上で統合しています。{canEdit ? '「変更を保存」で1件として保存できます。' : ''}
        </div>
      )}

      {hasConflict && (
        <div
          className="flex items-center justify-between gap-2 px-4 py-2.5 rounded-xl border border-amber-300 bg-amber-50 text-amber-800 text-xs font-bold flex-wrap"
          data-no-print
        >
          <span>他の人が更新しました。入力内容は保持しています。</span>
          <button
            type="button"
            onClick={handleLoadLatest}
            className="px-2.5 py-1 rounded-md border border-amber-400 bg-white text-amber-700 hover:bg-amber-100 text-[10px] font-bold"
          >
            最新を読み込む
          </button>
        </div>
      )}

      {saveError && (
        <div className="px-4 py-2.5 rounded-xl border border-red-300 bg-red-50 text-red-700 text-xs font-bold" data-no-print>
          {saveError}
        </div>
      )}

      {/* 2. Project Header Summary Banner */}
      <div
        className="bg-white rounded-xl shadow-sm p-4 sm:p-5 border border-border relative overflow-hidden"
        style={pColor ? { borderTop: `4px solid ${pColor.accent}` } : undefined}
      >
        <div className="flex flex-col gap-2.5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <h1 className="text-lg sm:text-xl font-extrabold text-text tracking-tight flex items-center gap-2">
              <MapPin size={20} className="text-accent shrink-0" />
              <span>{draft.venue || '（稼働場所未入力）'}</span>
            </h1>
          </div>

          <div className="flex items-center gap-2 flex-wrap text-xs font-bold">
            {draft.client ? (
              <span
                className="px-2.5 py-1 rounded-md font-bold flex items-center gap-1"
                style={pColor ? { backgroundColor: pColor.soft, color: pColor.text } : { backgroundColor: '#f1f5f9', color: '#475569' }}
              >
                <Building2 size={13} />
                {draft.client}
              </span>
            ) : (
              <span className="px-2 py-1 rounded-md bg-slate-100 text-slate-500 text-[11px]">
                クライアント未指定
              </span>
            )}

            {draft.carrier && (
              <span className="px-2 py-1 rounded-md bg-pink-50 text-pink-700 border border-pink-200 text-[11px] font-bold">
                {draft.carrier}
              </span>
            )}

            <span className="px-2.5 py-1 rounded-md bg-bg text-text2 border border-border2 flex items-center gap-1">
              <Calendar size={13} className="text-text3" />
              {draft.date}{draft.dateEnd && draft.dateEnd !== draft.date ? ` 〜 ${draft.dateEnd}` : ''}
            </span>

            <span className="px-2.5 py-1 rounded-md bg-bg text-text2 border border-border2 flex items-center gap-1">
              <Clock size={13} className="text-text3" />
              {draft.timeStart} 〜 {draft.timeEnd}
            </span>

            <span className="px-2.5 py-1 rounded-md bg-accent-l text-accent border border-accent/20 flex items-center gap-1 font-extrabold">
              <Users size={13} />
              稼働人員 {draft.headcount ?? 1}名（アサイン {assignedStaffTotal}名）
            </span>
          </div>
        </div>
      </div>

      {/* 3. Section: Staff Roles Assignment (Highest Priority for Field Workers) */}
      <div className="bg-white rounded-xl shadow-sm p-4 sm:p-5 border border-border space-y-4">
        <div className="flex items-center justify-between gap-2 border-b border-border pb-3 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="w-1 h-4 bg-accent rounded-full" />
            <span className="text-sm font-extrabold text-text flex items-center gap-1.5">
              <Users size={16} className="text-accent" />
              稼働スタッフの割り当て
            </span>
            <span className="text-xs text-text3 font-medium">
              （合計 {assignedStaffTotal} 名）
            </span>
          </div>
          {canEdit && syncCount !== null && (
            <button
              data-edit-only
              disabled={saving}
              onClick={() => {
                const changes = onSyncMembers();
                if (changes) patchDraft(changes);
              }}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-accent/30 text-xs font-bold text-accent hover:bg-accent hover:text-white transition-all bg-accent-l/30 active:scale-95 disabled:opacity-40"
              title="この日・この場所のイベントに入っているメンバーを全体表示から取り込みます"
            >
              <Upload size={12} />
              全体表示から取り込む（{syncCount}名）
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5">
          {/* Director */}
          <RoleChipSelect
            label="ディレクター"
            roleBadge="ディレクター"
            roleDescription="現場統括"
            themeColor="purple"
            options={directorOptions && directorOptions.length > 0 ? directorOptions : allStaffOptions}
            selected={draft.directors || []}
            onToggle={name => canEdit && !saving && patchDraft({ directors: toggleIn(draft.directors || [], name) })}
            emptyText="メンバーがいません"
          />

          {/* Event Leader */}
          <RoleChipSelect
            label="イベントリーダー"
            roleBadge="イベントリーダー"
            roleDescription="現場リーダー・責任者"
            themeColor="emerald"
            options={leadOptions && leadOptions.length > 0 ? leadOptions : allStaffOptions}
            selected={draft.leads || []}
            onToggle={name => canEdit && !saving && patchDraft({ leads: toggleIn(draft.leads, name) })}
            emptyText="イベントリーダーが登録されていません"
          />

          {/* Member */}
          <RoleChipSelect
            label="メンバー"
            roleBadge="メンバー"
            roleDescription="稼働スタッフ"
            themeColor="sky"
            options={allStaffOptions}
            selected={draft.members || []}
            onToggle={name => canEdit && !saving && patchDraft({ members: toggleIn(draft.members, name) })}
            emptyText="メンバーがいません"
          />
        </div>
      </div>

      {/* 4. Section: Project Information & Timing */}
      <div className="bg-white rounded-xl shadow-sm p-4 sm:p-5 border border-border space-y-4">
        <div className="flex items-center gap-2 border-b border-border pb-3">
          <div className="w-1 h-4 bg-accent rounded-full" />
          <span className="text-sm font-extrabold text-text flex items-center gap-1.5">
            <Building2 size={16} className="text-accent" />
            案件の基本情報
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <TextField
            label="稼働場所（案件名になります）"
            value={draft.venue}
            disabled={!canEdit || saving}
            placeholder="例: イオンモール〇〇 1F センターコート"
            onCommit={val => patchDraft({ venue: val })}
          />
          <TextField
            label="クライアント"
            value={draft.client}
            disabled={!canEdit || saving}
            placeholder="例: 株式会社〇〇"
            suggestions={clientSuggestions}
            onCommit={val => patchDraft({ client: val })}
          />
          <TextField
            label="キャリア"
            value={draft.carrier || ''}
            disabled={!canEdit || saving}
            placeholder="例: docomo / au / SB / 楽天"
            onCommit={val => patchDraft({ carrier: val })}
          />
          <TextField
            label="稼働日（開始日）"
            type="date"
            value={draft.date}
            disabled={!canEdit || saving}
            onCommit={val => patchDraft({ date: val, occurrenceDates: undefined })}
          />
          <TextField
            label="終了日（複数日の場合）"
            type="date"
            value={draft.dateEnd || ''}
            disabled={!canEdit || saving}
            onCommit={val => patchDraft({ dateEnd: val || '', occurrenceDates: undefined })}
          />
          <div className="grid grid-cols-2 gap-2 min-w-0 max-w-full">
            <TextField
              label="開始時刻"
              type="time"
              value={draft.timeStart}
              disabled={!canEdit || saving}
              onCommit={val => patchDraft({ timeStart: val })}
            />
            <TextField
              label="終了時刻"
              type="time"
              value={draft.timeEnd}
              disabled={!canEdit || saving}
              onCommit={val => patchDraft({ timeEnd: val })}
            />
          </div>
        </div>

        <HeadcountSelector
          value={draft.headcount ?? 1}
          assignedCount={assignedStaffTotal}
          disabled={!canEdit || saving}
          onChange={val => patchDraft({ headcount: val })}
        />
      </div>

      {/* 5. Section: Content & Notes */}
      <div className="bg-white rounded-xl shadow-sm p-4 sm:p-5 border border-border space-y-4">
        <div className="flex items-center gap-2 border-b border-border pb-3">
          <div className="w-1 h-4 bg-accent rounded-full" />
          <span className="text-sm font-extrabold text-text flex items-center gap-1.5">
            <FileText size={16} className="text-accent" />
            実施内容・連絡事項
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <TextField
            label="実施内容・進行・持ち物"
            textarea
            rows={4}
            value={draft.content}
            disabled={!canEdit || saving}
            placeholder="実施する内容・進行スケジュール・必要な持ち物など"
            onCommit={val => patchDraft({ content: val })}
          />
          <TextField
            label="コメント・連絡事項・注意点"
            textarea
            rows={4}
            value={draft.comment}
            disabled={!canEdit || saving}
            placeholder="現場スタッフへの注意事項・共有事項など"
            onCommit={val => patchDraft({ comment: val })}
          />
        </div>
      </div>
    </div>
  );
};
