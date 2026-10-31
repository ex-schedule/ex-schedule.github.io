import { Users } from 'lucide-react';

// --- Utilities ---
// --- Components ---

export const MemberTabs = ({ 
  members, 
  current, 
  onSelect,
  requestBadges,
  canEdit,
  onManageMembers,
}: { 
  members: string[];
  current: string;
  onSelect: (n: string) => void;
  requestBadges?: Record<string, number>;
  canEdit?: boolean;
  onManageMembers?: () => void;
}) => (
  <div className="bg-white rounded-xl shadow-sm mb-4 overflow-hidden border border-border">
    <div className="flex items-center justify-between gap-2 p-2 border-b border-border">
      <div className="flex overflow-x-auto gap-1.5 hide-scrollbar flex-1">
        {members.map(name => {
          const badgeCount = requestBadges?.[name] || 0;
          return (
            <button
              key={name}
              onClick={() => onSelect(name)}
              className={`px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-all duration-200 border flex items-center gap-1.5 ${
                name === current 
                  ? 'bg-accent border-accent text-white font-semibold' 
                  : 'bg-bg border-border2 text-text2 hover:border-accent-m hover:text-accent hover:bg-accent-l'
              }`}
            >
              <span>{name.replace('　', '')}</span>
              {badgeCount > 0 && (
                <span className={`px-1.5 py-0.2 rounded-full text-[9px] font-bold ${
                  name === current ? 'bg-white text-accent' : 'bg-amber-500 text-white'
                }`}>
                  {badgeCount}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {canEdit && onManageMembers && (
        <button
          type="button"
          data-edit-only
          onClick={onManageMembers}
          className="px-3 py-1.5 rounded-lg text-xs font-bold border border-accent/30 bg-accent/5 text-accent hover:bg-accent hover:text-white transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
          title="メンバーの追加・名前変更・削除"
        >
          <Users size={13} />
          <span>メンバー管理</span>
        </button>
      )}
    </div>
  </div>
);
