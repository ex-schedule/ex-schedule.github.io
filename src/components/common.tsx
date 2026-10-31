import { useState, useEffect, useRef } from 'react';
import { TYPE_LABEL, TYPE_CLASS } from '../constants';
import type { StatusType } from '../constants';

/**
 * onChangeはvoid|boolean|Promise<void|boolean>を返せる。false/例外時は保存失敗として
 * ドラフト(localValue)を保持し、propの`value`が保存先と一致するまで上書きしない。
 */
export const LocalInput = ({ value, onChange, onBlur, className, size = 10, disabled, normalize, ...props }: any) => {
  const [localValue, setLocalValue] = useState(value);
  const [isFocused, setIsFocused] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const submittedRef = useRef<any>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    if (isFocused) return;
    // 保存中・保存失敗の値をpropがまだ追いついていない間は上書きしない（旧propへの巻き戻り防止）
    if (submittedRef.current !== null && value !== submittedRef.current) return;
    submittedRef.current = null;
    setLocalValue(value);
    setFailed(false);
  }, [value, isFocused]);

  const attemptSave = async (next: string) => {
    if (disabled || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    submittedRef.current = next;
    try {
      const result = onChange(next);
      const resolved = await result;
      const ok = resolved !== false;
      setFailed(!ok);
      // 保存失敗時は「propへの巻き戻り防止」ガードを解除する。以後に届く
      // 正規の更新（他ユーザーの編集など）を永久にブロックしないため。
      if (!ok) submittedRef.current = null;
    } catch {
      setFailed(true);
      submittedRef.current = null;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  // Use 16px to prevent iOS auto-zoom on focus
  const inputFontSize = 16;
  const scale = size / inputFontSize;

  return (
    <div className={`${className} relative flex items-center justify-center`}>
      <input
        {...props}
        disabled={disabled || saving}
        value={localValue}
        onChange={(e) => {
          setLocalValue(e.target.value);
          if (failed) setFailed(false);
        }}
        onFocus={() => setIsFocused(true)}
        onCompositionStart={() => setIsComposing(true)}
        onCompositionEnd={() => setIsComposing(false)}
        onBlur={() => {
          setIsFocused(false);
          const next = normalize ? normalize(localValue) : localValue;
          if (next !== localValue) setLocalValue(next);
          if (!disabled && next !== value) attemptSave(next);
          else if (!savingRef.current && next === value) {
            submittedRef.current = null;
            setFailed(false);
          }
          if (onBlur) onBlur();
        }}
        aria-invalid={failed || undefined}
        title={failed ? '未保存です。入力欄を選び直して離れると再試行します。' : props.title}
        className="absolute top-0 left-0 origin-top-left bg-transparent border-none outline-none text-center p-0 font-bold"
        style={{
          fontSize: `${inputFontSize}px`,
          transform: `scale(${scale})`,
          width: `${(1 / scale) * 100}%`,
          height: `${(1 / scale) * 100}%`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          lineHeight: 'normal',
          ...(failed ? { boxShadow: 'inset 0 0 0 1px #dc2626' } : {}),
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !isComposing && !e.nativeEvent.isComposing && e.keyCode !== 229) {
            e.currentTarget.blur();
          }
        }}
      />
      {/* Invisible placeholder to ensure the parent div has correct height/width */}
      <div
        className="invisible select-none pointer-events-none whitespace-pre py-0.5 px-1 font-bold"
        style={{ fontSize: `${size}px`, lineHeight: 'normal' }}
      >
        {localValue || ' '}
      </div>
    </div>
  );
};

export const LocalTextarea = ({ value, onChange, onBlur, className, rows = 1, ...props }: any) => {
  const [localValue, setLocalValue] = useState(value);
  const [isFocused, setIsFocused] = useState(false);
  
  useEffect(() => { 
    if (!isFocused) setLocalValue(value); 
  }, [value, isFocused]);

  return (
    <div className={`${className} relative`}>
      <textarea 
        {...props} 
        value={localValue} 
        rows={rows * 2} // Since we scale by 0.5
        onChange={(e) => setLocalValue(e.target.value)} 
        onFocus={() => setIsFocused(true)}
        onBlur={() => {
          setIsFocused(false);
          if (localValue !== value) onChange(localValue);
          if (onBlur) onBlur();
        }}
        className="absolute top-0 left-0 w-[200%] h-[200%] origin-top-left bg-transparent border-none outline-none p-2 font-bold resize-none"
        style={{ 
          fontSize: '22px', 
          transform: 'scale(0.5)',
          lineHeight: '1.2'
        }}
      />
      {/* Invisible placeholder to ensure the parent div has correct height based on content and rows */}
      <div 
        className="invisible select-none pointer-events-none whitespace-pre-wrap p-1 font-bold leading-tight"
        style={{ minHeight: `${rows * 1.2}em` }}
      >
        {localValue || ' '}
      </div>
    </div>
  );
};

export const Legend = () => (
  <div className="bg-white rounded-xl shadow-sm p-4 border border-border mb-4">
    <div className="flex items-center gap-2 text-xs font-bold text-text mb-3">
      <div className="w-1 h-4 bg-accent rounded-full" />
      凡例 (ステータス)
    </div>
    <div className="flex flex-wrap gap-2">
      {(Object.keys(TYPE_LABEL) as StatusType[]).map(type => (
        <div key={type} className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold ${TYPE_CLASS[type]}`}>
          {TYPE_LABEL[type]}
        </div>
      ))}
    </div>
  </div>
);

export const ToolbarButton = ({ icon: Icon, label, onClick }: { icon: any; label: string; onClick: () => void }) => (
  <button
    onClick={onClick}
    className="flex items-center gap-1.5 px-3 py-2.5 sm:py-1.5 min-h-[40px] sm:min-h-0 rounded-lg border border-border2 text-[11px] sm:text-[10px] font-bold text-text2 hover:border-accent hover:text-accent transition-colors"
  >
    <Icon size={12} />
    {label}
  </button>
);
