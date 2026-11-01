import { useState, type FormEvent } from 'react';
import { Users, Plus, Trash2, Edit2, Check, X, ArrowUp, ArrowDown, ShieldCheck } from 'lucide-react';

export const MemberManagementModal = ({
  open,
  members,
  leadMembers,
  canEdit,
  onClose,
  onAddMember,
  onRenameMember,
  onDeleteMember,
  onUpdateOrderOrRole,
}: {
  open: boolean;
  members: string[];
  leadMembers: string[];
  canEdit: boolean;
  onClose: () => void;
  onAddMember: (name: string, isLead: boolean) => Promise<void>;
  onRenameMember: (oldName: string, newName: string, isLead: boolean) => Promise<void>;
  onDeleteMember: (name: string) => Promise<void>;
  onUpdateOrderOrRole: (nextMembers: string[], nextLeads: string[]) => Promise<void>;
}) => {
  const [newName, setNewName] = useState('');
  const [newIsLead, setNewIsLead] = useState(false);
  const [editingTarget, setEditingTarget] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingIsLead, setEditingIsLead] = useState(false);
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalNotice, setModalNotice] = useState<string | null>(null);

  if (!open) return null;

  const flashNotice = (msg: string) => {
    setModalNotice(msg);
    setTimeout(() => setModalNotice(null), 2500);
  };

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (!canEdit || busy) return;
    setModalError(null);
    setBusy(true);
    try {
      await onAddMember(newName, newIsLead);
      setNewName('');
      setNewIsLead(false);
      flashNotice('メンバーを追加しました。');
    } catch (err) {
      setModalError(err instanceof Error ? err.message : '追加できませんでした。');
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (name: string) => {
    setModalError(null);
    setEditingTarget(name);
    setEditingName(name);
    setEditingIsLead(leadMembers.includes(name));
  };

  const handleSaveEdit = async (oldName: string) => {
    if (!canEdit || busy) return;
    setModalError(null);
    setBusy(true);
    try {
      await onRenameMember(oldName, editingName, editingIsLead);
      setEditingTarget(null);
      flashNotice('メンバー情報を更新しました。');
    } catch (err) {
      setModalError(err instanceof Error ? err.message : '更新できませんでした。');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (name: string) => {
    if (!canEdit || busy) return;
    if (!window.confirm(`「${name.replace('　', ' ')}」をメンバー一覧から削除しますか？（このメンバーの予定枠も整理されます）`)) {
      return;
    }
    setModalError(null);
    setBusy(true);
    try {
      await onDeleteMember(name);
      if (editingTarget === name) setEditingTarget(null);
      flashNotice(`「${name.replace('　', ' ')}」を削除しました。`);
    } catch (err) {
      setModalError(err instanceof Error ? err.message : '削除できませんでした。');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleLead = async (name: string) => {
    if (!canEdit || busy) return;
    setModalError(null);
    setBusy(true);
    try {
      const nextLeads = leadMembers.includes(name)
        ? leadMembers.filter(m => m !== name)
        : [...leadMembers, name];
      await onUpdateOrderOrRole(members, nextLeads);
    } catch (err) {
      setModalError(err instanceof Error ? err.message : '更新できませんでした。');
    } finally {
      setBusy(false);
    }
  };

  const handleMove = async (index: number, delta: -1 | 1) => {
    if (!canEdit || busy) return;
    const targetIdx = index + delta;
    if (targetIdx < 0 || targetIdx >= members.length) return;
    const nextMembers = [...members];
    const [moved] = nextMembers.splice(index, 1);
    nextMembers.splice(targetIdx, 0, moved);
    setModalError(null);
    setBusy(true);
    try {
      await onUpdateOrderOrRole(nextMembers, leadMembers);
    } catch (err) {
      setModalError(err instanceof Error ? err.message : '並び替えできませんでした。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] bg-black/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4"
      onClick={e => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="bg-white rounded-2xl shadow-2xl border border-border max-w-xl w-full max-h-[90dvh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 sm:px-6 py-4 border-b border-border flex items-center justify-between gap-3 bg-bg/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-accent text-white flex items-center justify-center">
              <Users size={18} />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-text">メンバー管理（追加・編集・削除）</h2>
              <p className="text-[11px] text-text2">変更すると全員のスケジュール画面に即時反映されます</p>
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="p-1.5 rounded-lg text-text2 hover:text-text hover:bg-white border border-transparent hover:border-border transition-colors"
            title="閉じる"
          >
            <X size={18} />
          </button>
        </div>

        {/* Add Form */}
        {canEdit && (
          <form onSubmit={handleAdd} className="p-4 sm:px-6 border-b border-border bg-accent-l/20 space-y-2.5">
            <div className="text-xs font-bold text-text flex items-center gap-1.5">
              <Plus size={14} className="text-accent" />
              新しいメンバーを追加
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <input
                type="text"
                value={newName}
                disabled={busy}
                onChange={e => setNewName(e.target.value)}
                placeholder="氏名を入力（例: 山田　太郎）"
                className="flex-1 px-3 py-2 rounded-lg border border-border2 bg-white text-sm font-bold text-text outline-none focus:border-accent"
                style={{ fontSize: '16px' }}
              />
              <label className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-white border border-border2 text-xs font-bold text-text2 cursor-pointer select-none shrink-0">
                <input
                  type="checkbox"
                  checked={newIsLead}
                  disabled={busy}
                  onChange={e => setNewIsLead(e.target.checked)}
                  className="accent-emerald-600"
                />
                イベントリーダー
              </label>
              <button
                type="submit"
                disabled={busy || !newName.trim()}
                className="px-4 py-2 rounded-lg bg-accent text-white text-xs font-bold hover:bg-accent-d disabled:opacity-40 transition-colors flex items-center justify-center gap-1 shrink-0"
              >
                <Plus size={14} />
                追加する
              </button>
            </div>
          </form>
        )}

        {/* Alerts */}
        {modalError && (
          <div className="mx-4 sm:mx-6 mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs font-bold">
            {modalError}
          </div>
        )}
        {modalNotice && (
          <div className="mx-4 sm:mx-6 mt-3 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold">
            ✓ {modalNotice}
          </div>
        )}

        {/* Member List */}
        <div className="p-4 sm:px-6 overflow-y-auto flex-1 space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-text2 mb-1">
            <span>登録メンバー一覧（{members.length}名）</span>
            <span className="text-[10px] text-text3">名前変更時は既存の予定・案件アサインも自動で引き継がれます</span>
          </div>

          {members.map((name, idx) => {
            const isEditing = editingTarget === name;
            const isLead = leadMembers.includes(name);
            return (
              <div
                key={name}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 rounded-xl border border-border bg-white hover:border-border2 transition-colors"
              >
                {isEditing ? (
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full">
                    <input
                      type="text"
                      value={editingName}
                      disabled={busy}
                      onChange={e => setEditingName(e.target.value)}
                      className="flex-1 px-2.5 py-1.5 rounded-lg border border-accent bg-white text-sm font-bold text-text outline-none"
                      style={{ fontSize: '16px' }}
                      autoFocus
                    />
                    <label className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-bg border border-border2 text-xs font-bold text-text2 cursor-pointer select-none shrink-0">
                      <input
                        type="checkbox"
                        checked={editingIsLead}
                        disabled={busy}
                        onChange={e => setEditingIsLead(e.target.checked)}
                        className="accent-emerald-600"
                      />
                      イベントリーダー
                    </label>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleSaveEdit(name)}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 flex items-center gap-1"
                      >
                        <Check size={13} />
                        保存
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setEditingTarget(null)}
                        className="px-2.5 py-1.5 rounded-lg border border-border2 text-xs font-bold text-text2 hover:bg-bg"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-6 text-center font-mono text-[11px] font-bold text-text3 shrink-0">
                        {idx + 1}
                      </span>
                      <span className="font-bold text-sm text-text truncate">{name}</span>
                      <button
                        type="button"
                        disabled={!canEdit || busy}
                        onClick={() => handleToggleLead(name)}
                        title="クリックでイベントリーダーを切り替え"
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold border transition-colors flex items-center gap-1 shrink-0 ${
                          isLead
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100 shadow-2xs'
                            : 'bg-bg text-text3 border-border hover:text-text2 hover:border-border2'
                        }`}
                      >
                        <ShieldCheck size={11} />
                        {isLead ? 'イベントリーダー' : '一般'}
                      </button>
                    </div>

                    {canEdit && (
                      <div className="flex items-center gap-1 shrink-0 self-end sm:self-auto">
                        <button
                          type="button"
                          disabled={busy || idx === 0}
                          onClick={() => handleMove(idx, -1)}
                          title="上へ移動"
                          className="p-1.5 rounded-lg border border-border text-text2 hover:text-accent hover:border-accent disabled:opacity-30"
                        >
                          <ArrowUp size={13} />
                        </button>
                        <button
                          type="button"
                          disabled={busy || idx === members.length - 1}
                          onClick={() => handleMove(idx, 1)}
                          title="下へ移動"
                          className="p-1.5 rounded-lg border border-border text-text2 hover:text-accent hover:border-accent disabled:opacity-30"
                        >
                          <ArrowDown size={13} />
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => startEdit(name)}
                          className="px-2.5 py-1.5 rounded-lg border border-border2 text-xs font-bold text-text2 hover:border-accent hover:text-accent flex items-center gap-1"
                        >
                          <Edit2 size={12} />
                          編集
                        </button>
                        <button
                          type="button"
                          disabled={busy || members.length <= 1}
                          onClick={() => handleDelete(name)}
                          className="px-2.5 py-1.5 rounded-lg border border-red-200 bg-red-50 text-xs font-bold text-red-600 hover:bg-red-100 disabled:opacity-30 flex items-center gap-1"
                        >
                          <Trash2 size={12} />
                          削除
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-6 py-3 border-t border-border bg-bg/40 flex items-center justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-accent text-white text-xs font-bold hover:bg-accent-d transition-colors"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};
