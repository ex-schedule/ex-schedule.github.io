import { useState, useEffect, useRef } from 'react';
import { Save, ChevronLeft, Upload, Trash2, Users } from 'lucide-react';
import type { ProjectItem } from '../types';
import { projectTitle } from '../utils/venue';
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
    // dirty時はbase/draftを維持し、latestRemoteの更新だけで競合バナー・再読込ボタンに反映する
  }, [project]);

  const patchDraft = (changes: Partial<ProjectItem>) => {
    setDraft(prev => ({ ...prev, ...changes }));
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
    const payload = { ...draft, updatedAt: new Date().toISOString() };
    try {
      const saved = await onSave(payload, base);
      if (!isMountedRef.current || prevIdRef.current !== project.id) return;
      setBase(saved);
      setDraft(saved);
      setLatestRemote(saved);
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

  return (
    <div className="project-surface min-w-0 w-full max-w-full bg-white rounded-xl shadow-sm p-4 sm:p-5 border border-border space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap min-w-0">
          <button
            onClick={handleBack}
            disabled={saving}
            className="flex items-center gap-1 px-3 py-1.5 min-h-[38px] sm:min-h-0 rounded-lg border border-border2 text-sm sm:text-xs font-bold text-text2 hover:border-accent hover:text-accent transition-colors bg-white active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
            data-no-print
          >
            <ChevronLeft size={13} />
            一覧へ戻る
          </button>
          <div className="min-w-0 max-w-full">
            <div className="project-text-wrap text-[17px] sm:text-base font-extrabold text-text">{projectTitle(draft)}</div>
            <div className="text-sm sm:text-xs text-text2 font-bold flex items-center gap-2 mt-1 flex-wrap">
              <span className="project-text-wrap max-w-full">{draft.client || 'クライアント未入力'}</span>
              <span>•</span>
              <span>{draft.timeStart}〜{draft.timeEnd}</span>
              <span>•</span>
              <span className="text-accent font-extrabold">稼働人員 {draft.headcount ?? 0}名</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap" data-no-print>
          {canEdit && (
            <div data-edit-only>
              <button
                type="button"
                disabled={(!isDirty && !mergePending) || saving}
                onClick={handleSave}
                className="mr-2 inline-flex items-center gap-1 px-3 py-1.5 min-h-[38px] sm:min-h-0 rounded-lg bg-accent text-white text-sm sm:text-xs font-bold hover:bg-accent-d active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 transition-all"
              >
                <Save size={12} />
                {saving ? '保存中…' : '保存して共有'}
              </button>
              {confirmDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-red-600">削除しますか？</span>
                  <button
                    onClick={handleDelete}
                    disabled={saving}
                    className="px-3 py-1.5 min-h-[36px] sm:min-h-0 rounded-lg bg-red-500 text-white text-[10px] font-bold hover:bg-red-600 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    削除する
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    disabled={saving}
                    className="px-3 py-1.5 min-h-[36px] sm:min-h-0 rounded-lg border border-border2 text-[10px] font-bold text-text2 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    やめる
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  disabled={saving}
                  className="flex items-center gap-1 px-3 py-1.5 min-h-[38px] sm:min-h-0 rounded-lg border border-red-200 bg-red-50 text-[10px] font-bold text-red-600 hover:bg-red-100 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Trash2 size={12} />
                  案件を削除
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {mergePending && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-800" data-no-print>
          同名の登録済み案件を表示上で統合しています。{canEdit ? '「保存して共有」で1件として保存できます。' : '保存データはまだ変更していません。'}
        </div>
      )}

      {hasConflict && (
        <div
          className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 text-[11px] font-bold flex-wrap"
          data-no-print
        >
          <span>他の人が更新しました。入力内容は保持しています。</span>
          <button
            type="button"
            onClick={handleLoadLatest}
            className="px-2.5 py-1 rounded-md border border-amber-400 bg-white text-amber-700 hover:bg-amber-100 text-[10px] font-bold active:scale-95"
          >
            最新の内容を読み込む
          </button>
        </div>
      )}

      {saveError && (
        <div className="px-3 py-2 rounded-lg border border-red-300 bg-red-50 text-red-700 text-[11px] font-bold" data-no-print>
          {saveError}
        </div>
      )}

      {/* Basic Info Fields */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <TextField
          label="稼働場所（案件名になります）"
          value={draft.venue}
          disabled={!canEdit || saving}
          placeholder="例: イオンモール〇〇 1F センターコート"
          onCommit={val => patchDraft({ venue: val })}
        />
        <TextField label="稼働日" type="date" value={draft.date} disabled={!canEdit || saving} onCommit={val => patchDraft({ date: val, occurrenceDates: undefined })} />
        <TextField
          label="終了日"
          type="date"
          value={draft.dateEnd || ''}
          disabled={!canEdit || saving}
          onCommit={val => patchDraft({ dateEnd: val || '', occurrenceDates: undefined })}
        />
        <div className="grid grid-cols-2 gap-2 min-w-0 max-w-full">
          <TextField label="開始時刻" type="time" value={draft.timeStart} disabled={!canEdit || saving} onCommit={val => patchDraft({ timeStart: val })} />
          <TextField label="終了時刻" type="time" value={draft.timeEnd} disabled={!canEdit || saving} onCommit={val => patchDraft({ timeEnd: val })} />
        </div>
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
      </div>

      {/* Headcount Selection UI */}
      <HeadcountSelector
        value={draft.headcount ?? 1}
        assignedCount={assignedStaffTotal}
        disabled={!canEdit || saving}
        onChange={val => patchDraft({ headcount: val })}
      />

      {/* Descriptions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TextField
          label="実施内容"
          textarea
          rows={3}
          value={draft.content}
          disabled={!canEdit || saving}
          placeholder="実施する内容・進行・持ち物など"
          onCommit={val => patchDraft({ content: val })}
        />
        <TextField
          label="コメント"
          textarea
          rows={3}
          value={draft.comment}
          disabled={!canEdit || saving}
          placeholder="連絡事項・注意点など"
          onCommit={val => patchDraft({ comment: val })}
        />
      </div>

      {/* Roles Assignment (Director / Lead / Member) */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <Users size={14} className="text-accent" />
            <span className="text-xs font-extrabold text-text">スタッフ・役割の割り当て</span>
            <span className="text-[10px] text-text3">
              （ディレクター / 担当者 / メンバー）
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
              className="flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] sm:min-h-0 rounded-lg border border-border2 text-[10px] font-bold text-text2 hover:border-accent hover:text-accent transition-colors bg-white shadow-2xs active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              title="この日・この場所のイベントに入っているメンバーを全体表示から取り込みます"
            >
              <Upload size={11} />
              全体表示から取り込む（{syncCount}名）
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* Director */}
          <RoleChipSelect
            label="ディレクター"
            roleBadge="ディレクター"
            roleDescription="現場統括・ディレクション"
            themeColor="purple"
            options={directorOptions}
            selected={draft.directors || []}
            onToggle={name => canEdit && !saving && patchDraft({ directors: toggleIn(draft.directors || [], name) })}
            emptyText="メンバー一覧がありません"
          />

          {/* Lead */}
          <RoleChipSelect
            label="担当者"
            roleBadge="担当者"
            roleDescription="責任者・リーダー"
            themeColor="emerald"
            options={leadOptions}
            selected={draft.leads || []}
            onToggle={name => canEdit && !saving && patchDraft({ leads: toggleIn(draft.leads, name) })}
            emptyText="担当者候補がいません"
          />

          {/* Member */}
          <RoleChipSelect
            label="メンバー"
            roleBadge="メンバー"
            roleDescription="稼働スタッフ"
            themeColor="sky"
            options={memberOptions}
            selected={draft.members || []}
            onToggle={name => canEdit && !saving && patchDraft({ members: toggleIn(draft.members, name) })}
            emptyText="メンバー候補がいません"
          />
        </div>
      </div>

    </div>
  );
};
