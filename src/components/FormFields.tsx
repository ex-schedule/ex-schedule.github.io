import { useState, useEffect, useRef, useId } from 'react';
import { Plus, Sparkles, Minus, Users, Check } from 'lucide-react';


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
  const getStyle = (on: boolean) => {
    if (themeColor === 'purple') {
      return on
        ? 'bg-purple-600 border-purple-600 text-white shadow-xs scale-102'
        : 'bg-white border-purple-200 text-purple-900 hover:border-purple-500 hover:bg-purple-50/50';
    }
    if (themeColor === 'emerald') {
      return on
        ? 'bg-emerald-600 border-emerald-600 text-white shadow-xs scale-102'
        : 'bg-white border-emerald-200 text-emerald-900 hover:border-emerald-500 hover:bg-emerald-50/50';
    }
    if (themeColor === 'sky') {
      return on
        ? 'bg-sky-600 border-sky-600 text-white shadow-xs scale-102'
        : 'bg-white border-sky-200 text-sky-900 hover:border-sky-500 hover:bg-sky-50/50';
    }
    return on
      ? 'bg-accent border-accent text-white shadow-xs scale-102'
      : 'bg-white border-border2 text-text2 hover:border-accent hover:text-accent';
  };

  const getContainerStyle = () => {
    if (themeColor === 'purple') return 'border-purple-200 bg-purple-50/30';
    if (themeColor === 'emerald') return 'border-emerald-200 bg-emerald-50/30';
    if (themeColor === 'sky') return 'border-sky-200 bg-sky-50/30';
    return 'border-border bg-bg/20';
  };

  const getBadgeStyle = () => {
    if (themeColor === 'purple') return 'bg-purple-100 text-purple-800 border-purple-300';
    if (themeColor === 'emerald') return 'bg-emerald-100 text-emerald-800 border-emerald-300';
    if (themeColor === 'sky') return 'bg-sky-100 text-sky-800 border-sky-300';
    return 'bg-accent-l text-accent border-accent/20';
  };

  return (
    <div className={`flex flex-col gap-2 p-3.5 rounded-xl border ${getContainerStyle()}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className={`px-2 py-0.5 rounded-md text-[10px] font-black border ${getBadgeStyle()}`}>
            {roleBadge}
          </span>
          <span className="text-sm font-bold text-text">{label}</span>
          {roleDescription && (
            <span className="text-[9.5px] text-text3 font-normal hidden sm:inline">
              ({roleDescription})
            </span>
          )}
        </div>
        <span className="text-[10px] font-bold text-text2 bg-white/80 px-2 py-0.5 rounded-full border border-border2/60">
          {selected.length > 0 ? `${selected.length}名 選択中` : '0名'}
        </span>
      </div>

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
                className={`px-2.5 py-1.5 min-h-[44px] sm:min-h-0 rounded-lg text-sm sm:text-xs font-bold border transition-all active:scale-95 flex items-center gap-1 ${getStyle(
                  on
                )}`}
              >
                {on && <Check size={11} className="stroke-[3]" />}
                {name.replace('　', '')}
              </button>
            );
          })}
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
