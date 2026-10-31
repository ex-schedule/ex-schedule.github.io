import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, RotateCcw, Check, Settings2 } from 'lucide-react';
import { EventClientConfig, DEFAULT_EVENT_CLIENTS, getStatusStyle } from './constants';

interface EventClientSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  eventClients: EventClientConfig[];
  onSave: (newClients: EventClientConfig[]) => void;
}

const PRESET_COLORS = [
  { label: 'スレート/黒', color: '#18181b' },
  { label: '赤 (ドコモ)', color: '#dc2626' },
  { label: '橙 (au)', color: '#ea580c' },
  { label: '桃 (楽天)', color: '#db2777' },
  { label: '青 (UQ)', color: '#2563eb' },
  { label: 'ローズ (YM)', color: '#e11d48' },
  { label: '紫 (その他)', color: '#4f46e5' },
  { label: '緑', color: '#059669' },
  { label: '黄/茶', color: '#d97706' },
  { label: 'シアン', color: '#0891b2' },
];

export const EventClientSettingsModal: React.FC<EventClientSettingsModalProps> = ({
  isOpen,
  onClose,
  eventClients,
  onSave,
}) => {
  const [localClients, setLocalClients] = useState<EventClientConfig[]>(eventClients);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setLocalClients(eventClients || []);
      setSaveSuccess(false);
    }
  }, [isOpen, eventClients]);

  if (!isOpen) return null;

  const handleUpdate = (idx: number, patch: Partial<EventClientConfig>) => {
    setLocalClients(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  };

  const handleAdd = () => {
    const newId = `event_custom_${Date.now()}`;
    const nextItem: EventClientConfig = {
      id: newId,
      name: `イベント${localClients.length + 1}`,
      shortName: `E${localClients.length + 1}`,
      color: '#f97316',
      textColor: '#ffffff',
    };
    setLocalClients(prev => [...prev, nextItem]);
  };

  const handleDelete = (idx: number) => {
    const target = localClients[idx];
    if (window.confirm(`「${target.name}」を削除してもよろしいですか？`)) {
      setLocalClients(prev => prev.filter((_, i) => i !== idx));
    }
  };

  const handleReset = () => {
    if (window.confirm('クライアント設定を初期（現状なし）に戻しますか？')) {
      setLocalClients([]);
    }
  };

  const handleSave = () => {
    const cleaned = localClients.map((c, i) => ({
      ...c,
      name: c.name.trim() || `イベント${i + 1}`,
      shortName: c.shortName.trim() || c.name.trim().slice(0, 3) || `E${i + 1}`,
      color: c.color || c.color1 || '#18181b',
      textColor: '#ffffff',
    }));
    onSave(cleaned);
    setSaveSuccess(true);
    setTimeout(() => {
      onClose();
    }, 300);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl border border-border w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-accent text-white flex items-center justify-center shadow-xs">
              <Settings2 size={18} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-800">
                ステータス設定（イベント・クライアント）
              </h2>
              <p className="text-[11px] text-slate-500">
                クライアント名や表示色をカスタマイズできます。
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-200/70 text-slate-400 hover:text-slate-700 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Client List */}
        <div className="p-4 overflow-y-auto space-y-2.5 flex-1">
          {localClients.length === 0 ? (
            <div className="py-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200 p-4">
              <p className="text-xs font-bold text-slate-700 mb-1">
                現在、個別クライアント設定はありません（初期状態）
              </p>
              <p className="text-[11px] text-slate-500">
                標準の「イベント」（オレンジ色）ステータスが使用されます。会社名・クライアントごとに色や名称を分けたい場合は、下の「＋ クライアント追加」から追加できます。
              </p>
            </div>
          ) : (
            localClients.map((client, idx) => {
            const style = getStatusStyle(client.id, localClients);
            const currentColor = client.color || client.color1 || '#18181b';

            return (
              <div
                key={client.id || idx}
                className="p-3 rounded-xl border border-slate-200 bg-white hover:border-slate-300 shadow-2xs flex items-center justify-between gap-3"
              >
                {/* Preview badge */}
                <div
                  className="px-2.5 py-1 rounded-full text-xs font-bold text-center shrink-0 min-w-[70px]"
                  style={style}
                >
                  {client.shortName || client.name || '未設定'}
                </div>

                {/* Name & Short Name */}
                <div className="grid grid-cols-2 gap-2 flex-1 min-w-0">
                  <div>
                    <label className="block text-[9px] font-bold text-slate-500 mb-0.5">
                      クライアント名
                    </label>
                    <input
                      type="text"
                      className="w-full px-2 py-1 text-xs font-medium rounded-lg border border-slate-200 focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none"
                      value={client.name}
                      onChange={e => handleUpdate(idx, { name: e.target.value })}
                      placeholder="例: ソフトバンク"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold text-slate-500 mb-0.5">
                      略称
                    </label>
                    <input
                      type="text"
                      className="w-full px-2 py-1 text-xs font-medium rounded-lg border border-slate-200 focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none"
                      value={client.shortName}
                      onChange={e => handleUpdate(idx, { shortName: e.target.value })}
                      placeholder="例: SB"
                    />
                  </div>
                </div>

                {/* Color & Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  <div className="flex flex-col items-center">
                    <label className="text-[9px] font-bold text-slate-500 mb-0.5">色</label>
                    <input
                      type="color"
                      className="w-7 h-7 p-0 rounded-md border border-slate-300 cursor-pointer overflow-hidden"
                      value={currentColor}
                      onChange={e => handleUpdate(idx, { color: e.target.value })}
                      title="カラーを変更"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => handleDelete(idx)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors mt-2.5"
                    title="削除"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          }))}

          {/* Quick presets helper */}
          <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 text-xs flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10px] text-slate-500 font-medium">プリセットパレット:</span>
            <div className="flex flex-wrap gap-1">
              {PRESET_COLORS.map(p => (
                <button
                  key={p.color}
                  type="button"
                  title={p.label}
                  onClick={() => {
                    // Update the last or first client or just provide visual reference
                  }}
                  className="w-4 h-4 rounded-full border border-black/10 shadow-2xs cursor-default"
                  style={{ backgroundColor: p.color }}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={handleReset}
              className="text-[10px] text-slate-500 hover:text-slate-800 flex items-center gap-1 font-medium transition-colors"
            >
              <RotateCcw size={10} />
              初期値に戻す
            </button>
          </div>

          {/* Add New Client Button */}
          <button
            type="button"
            onClick={handleAdd}
            className="w-full py-2 px-3 rounded-xl border border-dashed border-slate-300 hover:border-accent text-slate-600 hover:text-accent font-bold text-xs flex items-center justify-center gap-1.5 bg-slate-50/50 hover:bg-accent-l/10 transition-all"
          >
            <Plus size={14} />
            クライアントを追加
          </button>
        </div>

        {/* Footer */}
        <div className="p-3.5 border-t border-border bg-slate-50 flex items-center justify-between">
          <div className="text-[11px] text-slate-500 font-medium">
            全 {localClients.length} 件
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 font-bold text-xs transition-all"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={handleSave}
              className={`px-4 py-1.5 rounded-lg text-white font-bold text-xs shadow-xs flex items-center gap-1.5 transition-all ${
                saveSuccess ? 'bg-emerald-600' : 'bg-accent hover:bg-accent/90'
              }`}
            >
              {saveSuccess ? (
                <>
                  <Check size={14} /> 保存完了
                </>
              ) : (
                '保存する'
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
