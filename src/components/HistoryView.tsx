import type { HistoryEntry } from '../types';


// --- 変更履歴 ---

export const HistoryView = ({
  history,
  onClear,
}: {
  history: HistoryEntry[];
  onClear: () => void;
}) => {
  return (
    <div className="bg-white rounded-xl shadow-sm p-5 border border-border">
      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <div className="flex items-center gap-2 text-sm font-bold text-text">
          <div className="w-1 h-4 bg-accent rounded-full" />
          変更履歴
          <span className="text-[10px] font-bold text-text3">直近{history.length}件</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap" data-edit-only>
          <button
            onClick={onClear}
            className="px-3 py-1 rounded-lg text-[10px] font-bold bg-red-50 border border-red-200 text-red-600 hover:bg-red-100"
          >
            履歴を消去
          </button>
        </div>
      </div>

      {history.length === 0 ? (
        <div className="text-[11px] text-text2 font-bold">まだ変更履歴はありません。</div>
      ) : (
        <div className="divide-y divide-border">
          {history.map((h, i) => (
            <div key={`${h.at}-${i}`} className="py-2 flex items-center gap-3 text-[11px] flex-wrap">
              <span className="font-mono text-text3 min-w-[130px]">
                {new Date(h.at).toLocaleString('ja-JP', {
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
              <span className="font-bold text-text min-w-[90px]">{h.member.replace('　', '')}</span>
              <span className="font-mono font-bold text-accent min-w-[40px]">{h.day}日</span>
              <span className="text-text2">{h.field === 'type' ? 'ステータス' : h.field === 'client' ? 'クライアント' : '詳細'}</span>
              <span className="text-text3 line-through">{h.from || '（空）'}</span>
              <span className="text-text2">→</span>
              <span className="font-bold text-text">{h.to || '（空）'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
