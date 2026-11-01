import { useState, useEffect, useRef, useId } from 'react';
import { Plus, Sparkles, Minus, Users, Check, X } from 'lucide-react';


// --- 案件共有 ---

export const TextField = ({
  label,
  value,
  onCommit,
  placeholder,
  type = 'text',
  textarea = false,
  rows = 3,
  disabled = false,
  suggestions,
}: {
  label: string;
  value: string;
  onCommit: (val: string) => void;
  placeholder?: string;
  type?: string;
  textarea?: boolean;
  rows?: number;
  disabled?: boolean;
  suggestions?: string[];
}) => {
  const [local, setLocal] = useState(value);
  const [focused, setFocused] = useState(false);
  const composingRef = useRef(false);
  const datalistId = useId();
  const hasSuggestions = !textarea && !!suggestions && suggestions.length > 0;

  useEffect(() => {
    if (!focused) setLocal(value);
  }, [value, focused]);

  const commit = () => {
    setFocused(false);
    if (local !== value) onCommit(local);
  };

  const cls =
    'w-full min-w-0 max-w-full px-3 py-2 rounded-lg border border-border bg-white outline-none focus:border-accent text-text';

  return (
    <label className="flex flex-col gap-1 min-w-0 w-full max-w-full">
      <span className="text-sm sm:text-xs font-bold text-text2">{label}</span>
      {textarea ? (
        <textarea
          className={`${cls} resize-y leading-relaxed`}
          style={{ fontSize: '16px' }}
          rows={rows}
          value={local}
          disabled={disabled}
          placeholder={placeholder}
          onChange={e => {
            const val = e.target.value;
            setLocal(val);
            if (!composingRef.current) onCommit(val);
          }}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={e => {
            composingRef.current = false;
            onCommit(e.currentTarget.value);
          }}
          onFocus={() => setFocused(true)}
          onBlur={commit}
        />
      ) : (
        <>
          <input
            className={cls}
            style={{ fontSize: '16px' }}
            type={type}
            value={local}
            disabled={disabled}
            placeholder={placeholder}
            list={hasSuggestions ? datalistId : undefined}
            onChange={e => {
              const val = e.target.value;
              setLocal(val);
              if (!composingRef.current) onCommit(val);
            }}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={e => {
              composingRef.current = false;
              onCommit(e.currentTarget.value);
            }}
            onFocus={() => setFocused(true)}
            onBlur={commit}
            onKeyDown={e => {
              if (e.key === 'Enter' && !textarea && !composingRef.current && !e.nativeEvent.isComposing) e.currentTarget.blur();
            }}
          />
          {hasSuggestions && (
            <datalist id={datalistId}>
              {suggestions!.map(s => (
                <option key={s} value={s} />
              ))}
            </datalist>
          )}
        </>
      )}
    </label>
  );
};

export const HeadcountSelector = ({
  value,
  assignedCount,
  onChange,
  disabled = false,
}: {
  value: number;
  assignedCount: number;
  onChange: (val: number) => void;
  disabled?: boolean;
}) => {
  const PRESETS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  return (
    <div className="flex flex-col gap-1.5 p-3 rounded-xl border border-border bg-white shadow-2xs">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Users size={14} className="text-accent" />
          <span className="text-sm font-bold text-text">稼働人員 (選択式)</span>
          <span className="px-2 py-0.5 rounded-full bg-accent-l text-accent font-mono font-extrabold text-[11px]">
            {value}名
          </span>
        </div>
        {assignedCount > 0 && !disabled && (
          <button
            type="button"
            onClick={() => onChange(assignedCount)}
            className="flex items-center gap-1 px-2 py-1 rounded-md bg-accent-l text-accent hover:bg-accent hover:text-white transition-colors text-[10px] font-bold"
            title="アサインされているディレクター・担当者・メンバーの合計人数を反映します"
          >
            <Sparkles size={10} />
            アサイン合計({assignedCount}人)を反映
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap mt-1">
        {/* Preset pill buttons */}
        <div className="flex items-center gap-1 flex-wrap">
          {PRESETS.map(num => {
            const isSelected = value === num;
            return (
              <button
                key={num}
                type="button"
                disabled={disabled}
                onClick={() => onChange(num)}
                className={`min-w-[36px] h-9 px-2 rounded-lg text-[11px] font-bold border transition-all active:scale-95 flex items-center justify-center ${
                  isSelected
                    ? 'bg-accent border-accent text-white shadow-xs scale-105 z-1'
                    : 'bg-bg/60 border-border2 text-text2 hover:border-accent hover:text-accent hover:bg-white'
                }`}
              >
                {num}人
              </button>
            );
          })}
        </div>

        {/* Stepper controls */}
        <div className="flex items-center gap-1 bg-bg p-1 rounded-lg border border-border2">
          <button
            type="button"
            disabled={disabled || value <= 0}
            onClick={() => onChange(Math.max(0, value - 1))}
            className="w-8 h-8 rounded-md bg-white border border-border2 text-text2 font-bold hover:border-accent hover:text-accent disabled:opacity-30 flex items-center justify-center text-base active:scale-95 transition-all"
            title="1人減らす"
          >
            <Minus size={13} />
          </button>
          <div className="flex items-center px-1.5">
            <input
              type="number"
              min="0"
              max="999"
              disabled={disabled}
              value={value}
              onChange={e => onChange(Math.max(0, parseInt(e.target.value, 10) || 0))}
              className="w-9 text-center font-extrabold text-sm bg-transparent outline-none text-text"
              style={{ fontSize: '16px' }}
            />
            <span className="text-[10px] font-bold text-text3">人</span>
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(value + 1)}
            className="w-8 h-8 rounded-md bg-white border border-border2 text-text2 font-bold hover:border-accent hover:text-accent disabled:opacity-30 flex items-center justify-center text-base active:scale-95 transition-all"
            title="1人増やす"
          >
            <Plus size={13} />
          </button>
        </div>
      </div>
    </div>
  );
};

export const RoleChipSelect = ({
  label,
  roleBadge,
  roleDescription,
  options,
  selected,
  onToggle,
  themeColor = 'accent',
  emptyText,
}: {
  label: string;
  roleBadge: string;
  roleDescription?: string;
  options: string[];
  selected: string[];
  onToggle: (name: string) => void;
  themeColor?: 'purple' | 'emerald' | 'sky' | 'accent';
  emptyText?: string;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const unselectedOptions = options.filter(name => !selected.includes(name));

  const getContainerStyle = () => {
    if (themeColor === 'purple') return 'border-purple-200 bg-purple-50/20';
    if (themeColor === 'emerald') return 'border-emerald-200 bg-emerald-50/20';
    if (themeColor === 'sky') return 'border-sky-200 bg-sky-50/20';
    return 'border-border bg-bg/20';
  };

  const getBadgeStyle = () => {
    if (themeColor === 'purple') return 'bg-purple-100 text-purple-800 border-purple-300';
    if (themeColor === 'emerald') return 'bg-emerald-100 text-emerald-800 border-emerald-300';
    if (themeColor === 'sky') return 'bg-sky-100 text-sky-800 border-sky-300';
    return 'bg-accent-l text-accent border-accent/20';
  };

  const getTagStyle = () => {
    if (themeColor === 'purple') return 'bg-purple-600 text-white shadow-xs';
    if (themeColor === 'emerald') return 'bg-emerald-600 text-white shadow-xs';
    if (themeColor === 'sky') return 'bg-sky-600 text-white shadow-xs';
    return 'bg-accent text-white shadow-xs';
  };

  const getAddBtnStyle = () => {
    if (themeColor === 'purple') return 'text-purple-700 bg-white border-purple-200 hover:border-purple-500 hover:bg-purple-50';
    if (themeColor === 'emerald') return 'text-emerald-700 bg-white border-emerald-200 hover:border-emerald-500 hover:bg-emerald-50';
    if (themeColor === 'sky') return 'text-sky-700 bg-white border-sky-200 hover:border-sky-500 hover:bg-sky-50';
    return 'text-accent bg-white border-accent/25 hover:border-accent hover:bg-accent-l';
  };

  return (
    <div className={`flex flex-col gap-2.5 p-3.5 rounded-xl border ${getContainerStyle()} transition-all`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className={`px-2 py-0.5 rounded-md text-[10px] font-black border ${getBadgeStyle()}`}>
            {roleBadge}
          </span>
          <span className="text-sm font-bold text-text">{label}</span>
          {roleDescription && (
            <span className="text-[10px] text-text3 font-normal hidden sm:inline">
              ({roleDescription})
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-bold text-text2 bg-white/80 px-2 py-0.5 rounded-full border border-border2/60">
            {selected.length}名
          </span>
          <button
            type="button"
            onClick={() => setIsOpen(v => !v)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-bold transition-all active:scale-95 ${getAddBtnStyle()} ${isOpen ? 'ring-2 ring-accent/30' : ''}`}
          >
            <Plus size={12} className={isOpen ? 'rotate-45 transition-transform' : 'transition-transform'} />
            {isOpen ? '閉じる' : '追加'}
          </button>
        </div>
      </div>

      {/* アサイン済みメンバー一覧（スッキリとタグ表示） */}
      <div className="flex flex-wrap items-center gap-1.5 min-h-[32px]">
        {selected.length === 0 ? (
          <span className="text-xs text-text3 py-1 font-medium italic">未割り当て</span>
        ) : (
          selected.map(name => (
            <span
              key={name}
              className={`inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-lg text-xs font-bold ${getTagStyle()}`}
            >
              <span>{name.replace('　', '')}</span>
              <button
                type="button"
                onClick={() => onToggle(name)}
                title={`${name.replace('　', '')}の割り当てを解除`}
                className="w-4 h-4 rounded hover:bg-black/20 flex items-center justify-center transition-colors text-white/90 hover:text-white"
              >
                <X size={11} className="stroke-[3]" />
              </button>
            </span>
          ))
        )}
      </div>

      {/* 追加パレット（開いた時だけ未選択メンバーを表示） */}
      {isOpen && (
        <div className="mt-1 p-2.5 rounded-lg bg-white border border-border2 shadow-xs space-y-2">
          <div className="text-[10px] font-bold text-text3 flex items-center justify-between">
            <span>タップして{label}に追加:</span>
            <span>残り{unselectedOptions.length}名</span>
          </div>
          {unselectedOptions.length === 0 ? (
            <div className="text-xs text-text3 py-1 text-center">全員が選択済みです</div>
          ) : (
            <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
              {unselectedOptions.map(name => (
                <button
                  key={name}
                  type="button"
                  onClick={() => onToggle(name)}
                  className="px-2 py-1 rounded-md text-xs font-bold bg-bg hover:bg-accent hover:text-white border border-border2 transition-all flex items-center gap-1 active:scale-95"
                >
                  <Plus size={10} />
                  {name.replace('　', '')}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const ChipSelect = ({
  label,
  options,
  selected,
  onToggle,
  emptyText,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (name: string) => void;
  emptyText?: string;
}) => (
  <div className="flex flex-col gap-1">
    <span className="text-[10px] font-bold text-text2">{label}</span>
    {options.length === 0 ? (
      <span className="text-[10px] text-text3">{emptyText || '選択肢がありません'}</span>
    ) : (
      <div className="flex flex-wrap gap-1.5">
        {options.map(name => {
          const on = selected.includes(name);
          return (
            <button
              key={name}
              type="button"
              onClick={() => onToggle(name)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition-all ${
                on
                  ? 'bg-accent border-accent text-white'
                  : 'bg-bg border-border2 text-text2 hover:border-accent hover:text-accent'
              }`}
            >
              {name.replace('　', '')}
            </button>
          );
        })}
      </div>
    )}
  </div>
);
