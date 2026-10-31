import React, { useState, useEffect, useRef } from 'react';
import { Trash2, RotateCw, Copy, ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from 'lucide-react';
import { LAYOUT_CATALOG } from '../constants';
import type { LayoutItem } from '../types';
import { genId } from '../utils/venue';


// --- レイアウト（会場配置図） ---

export const LayoutEditor = ({
  items,
  onChange,
  canEdit,
}: {
  items: LayoutItem[];
  onChange: (items: LayoutItem[]) => void;
  canEdit: boolean;
}) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<LayoutItem[]>(items);
  const dragRef = useRef<{ id: string; offX: number; offY: number } | null>(null);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const update = (next: LayoutItem[]) => {
    itemsRef.current = next;
    onChange(next);
  };

  const addItem = (type: string) => {
    if (!canEdit) return;
    const def = LAYOUT_CATALOG[type];
    if (!def) return;
    const sameType = itemsRef.current.filter(i => i.type === type).length;
    const newItem: LayoutItem = {
      id: genId(),
      type,
      label: sameType > 0 ? `${def.label}${sameType + 1}` : def.label,
      x: 25 + Math.round(Math.random() * 45),
      y: 25 + Math.round(Math.random() * 45),
      rotation: 0,
      color: def.color,
      wPct: def.wPct,
      hPct: def.hPct,
      emoji: def.emoji,
    };
    update([...itemsRef.current, newItem]);
    setSelectedId(newItem.id);
  };

  const patchItem = (id: string, patch: Partial<LayoutItem>) => {
    update(itemsRef.current.map(i => (i.id === id ? { ...i, ...patch } : i)));
  };

  const nudgeItem = (id: string, dxPct: number, dyPct: number) => {
    const src = itemsRef.current.find(i => i.id === id);
    if (!src) return;
    const nx = Math.max(2, Math.min(98, +(src.x + dxPct).toFixed(1)));
    const ny = Math.max(2, Math.min(98, +(src.y + dyPct).toFixed(1)));
    patchItem(id, { x: nx, y: ny });
  };

  const removeItem = (id: string) => {
    update(itemsRef.current.filter(i => i.id !== id));
    setSelectedId(null);
  };

  const duplicateItem = (id: string) => {
    const src = itemsRef.current.find(i => i.id === id);
    if (!src) return;
    const copy = { ...src, id: genId(), x: Math.min(94, src.x + 5), y: Math.min(94, src.y + 5) };
    update([...itemsRef.current, copy]);
    setSelectedId(copy.id);
  };

  const resizeItem = (id: string, factor: number) => {
    const src = itemsRef.current.find(i => i.id === id);
    if (!src) return;
    patchItem(id, {
      wPct: Math.max(3, Math.min(80, +(src.wPct * factor).toFixed(2))),
      hPct: Math.max(3, Math.min(80, +(src.hPct * factor).toFixed(2))),
    });
  };

  const clearAll = () => {
    update([]);
    setSelectedId(null);
    setConfirmClear(false);
  };

  const startDrag = (e: React.MouseEvent | React.TouchEvent, id: string) => {
    if (!canEdit) return;
    e.preventDefault();
    e.stopPropagation();
    setSelectedId(id);
    const item = itemsRef.current.find(i => i.id === id);
    if (!item || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const cy = 'touches' in e ? e.touches[0].clientY : e.clientY;
    dragRef.current = {
      id,
      offX: cx - rect.left - (item.x / 100) * rect.width,
      offY: cy - rect.top - (item.y / 100) * rect.height,
    };
  };

  useEffect(() => {
    const onMove = (e: MouseEvent | TouchEvent) => {
      const d = dragRef.current;
      if (!d || !canvasRef.current) return;
      e.preventDefault();
      const rect = canvasRef.current.getBoundingClientRect();
      const cx = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
      const cy = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY;
      const x = Math.max(2, Math.min(98, ((cx - rect.left - d.offX) / rect.width) * 100));
      const y = Math.max(2, Math.min(98, ((cy - rect.top - d.offY) / rect.height) * 100));
      const next = itemsRef.current.map(i => (i.id === d.id ? { ...i, x: +x.toFixed(1), y: +y.toFixed(1) } : i));
      itemsRef.current = next;
      onChange(next);
    };
    const onEnd = () => {
      dragRef.current = null;
    };
    window.addEventListener('mousemove', onMove, { passive: false });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('touchend', onEnd);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchend', onEnd);
    };
  }, [onChange]);

  const selected = items.find(i => i.id === selectedId) || null;

  return (
    <div className="flex flex-col gap-2.5">
      {canEdit && (
        <div className="flex flex-col gap-2 bg-slate-50/80 p-3 rounded-xl border border-border" data-edit-only>
          {/* Header & Clear */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[11px] font-bold text-text flex items-center gap-1.5">
              <span>画面にパーツを追加:</span>
            </span>

            {items.length > 0 && (
              <div>
                {confirmClear ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold text-red-600">全消去？</span>
                    <button
                      type="button"
                      onClick={clearAll}
                      className="px-2 py-0.5 rounded bg-red-500 text-white text-[10px] font-bold"
                    >
                      はい
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmClear(false)}
                      className="px-2 py-0.5 rounded border border-border2 text-[10px] font-bold text-text2"
                    >
                      いいえ
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmClear(true)}
                    className="text-[10px] font-bold text-text3 hover:text-red-500 px-2 py-0.5"
                  >
                    配置をクリア
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Palette Items */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            {Object.entries(LAYOUT_CATALOG).map(([type, def]) => (
              <button
                key={type}
                type="button"
                onClick={() => addItem(type)}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-lg border text-[11px] font-bold transition-all hover:bg-white shadow-2xs active:scale-95"
                style={{ borderColor: def.color + '66', background: def.color + '15', color: def.color }}
                title={`${def.label}を追加`}
              >
                <span className="text-xs">{def.emoji}</span>
                {def.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Canvas */}
      <div
        ref={canvasRef}
        className="relative rounded-xl overflow-hidden border-2 border-slate-300 w-full shadow-inner"
        style={{
          aspectRatio: '16/9',
          minHeight: '320px',
          backgroundImage: 'radial-gradient(circle, #94a3b8 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          backgroundColor: '#f8fafc',
          userSelect: 'none',
          touchAction: 'none',
        }}
        onClick={() => setSelectedId(null)}
      >
        <div className="absolute rounded-lg border-2 border-dashed pointer-events-none" style={{ inset: '2%', borderColor: '#cbd5e1' }} />

        {/* Badge showing item count */}
        <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-white/90 border border-border2/80 text-[9.5px] font-bold text-text2 pointer-events-none shadow-2xs">
          配置数: {items.length}件 {canEdit && '（タップで選択・ドラッグ移動）'}
        </div>

        {items.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-[11px] text-text3 font-bold gap-2 p-4 text-center">
            <div>{canEdit ? '上のパーツボタンをタップして自由に配置図を作成できます' : 'レイアウトは未作成です'}</div>
          </div>
        )}

        {items.map(item => {
          const isSel = item.id === selectedId;
          const isCircle = item.type === 'round_table';
          const isSmall = item.type === 'pillar';
          return (
            <div
              key={item.id}
              onMouseDown={e => startDrag(e, item.id)}
              onTouchStart={e => startDrag(e, item.id)}
              onClick={e => {
                e.stopPropagation();
                setSelectedId(item.id);
              }}
              style={{
                position: 'absolute',
                left: `${item.x}%`,
                top: `${item.y}%`,
                width: `${item.wPct}%`,
                height: `${item.hPct}%`,
                transform: `translate(-50%, -50%) rotate(${item.rotation}deg)`,
                backgroundColor: item.color,
                borderRadius: isCircle ? '50%' : isSmall ? '4px' : '8px',
                border: isSel ? '2.5px solid #2563eb' : '1.5px solid rgba(255,255,255,0.4)',
                boxShadow: isSel ? '0 0 0 4px rgba(37,99,235,0.4), 0 4px 10px rgba(0,0,0,0.25)' : '0 2px 5px rgba(0,0,0,0.18)',
                cursor: canEdit ? 'grab' : 'default',
                touchAction: 'none',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '1px',
                zIndex: isSel ? 30 : 5,
              }}
            >
              {!isSmall && <span style={{ fontSize: '13px', lineHeight: 1, pointerEvents: 'none' }}>{item.emoji}</span>}
              <span
                style={{
                  fontSize: '9.5px',
                  fontWeight: 900,
                  color: 'white',
                  textShadow: '0 1px 3px rgba(0,0,0,0.7)',
                  lineHeight: 1.1,
                  pointerEvents: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                {item.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Selected Item Controller - Mobile Optimized UI */}
      {canEdit && selected && (
        <div className="flex flex-col gap-2 p-3 rounded-xl bg-blue-50/70 border border-blue-200 shadow-xs" data-edit-only>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-blue-600" />
              <span className="text-[11px] font-bold text-blue-950">選択中: {selected.label}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => duplicateItem(selected.id)}
                className="flex items-center gap-1 px-2.5 py-1 min-h-[34px] sm:min-h-0 rounded-lg bg-white border border-border2 text-[10px] font-bold text-text2 hover:border-accent hover:text-accent shadow-2xs active:scale-95"
              >
                <Copy size={11} />
                複製
              </button>
              <button
                type="button"
                onClick={() => removeItem(selected.id)}
                className="flex items-center gap-1 px-2.5 py-1 min-h-[34px] sm:min-h-0 rounded-lg border border-red-200 bg-red-50 text-[10px] font-bold text-red-600 hover:bg-red-100 shadow-2xs active:scale-95"
              >
                <Trash2 size={11} />
                削除
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Rename Input */}
            <div className="flex items-center gap-1 bg-white px-2 py-1 rounded-lg border border-border2">
              <span className="text-[10px] font-bold text-text3">名前:</span>
              <input
                className="outline-none text-[11px] font-bold text-text bg-transparent"
                style={{ fontSize: '16px', width: '110px' }}
                value={selected.label}
                onChange={e => patchItem(selected.id, { label: e.target.value })}
                placeholder="パーツ名"
              />
            </div>

            {/* Rotation & Size */}
            <button
              type="button"
              onClick={() => patchItem(selected.id, { rotation: (selected.rotation + 45) % 360 })}
              className="flex items-center gap-1 px-2.5 py-1.5 min-h-[36px] sm:min-h-0 rounded-lg bg-white border border-border2 text-[10px] font-bold text-text2 hover:border-accent hover:text-accent active:scale-95"
            >
              <RotateCw size={11} />
              回転 ({selected.rotation}°)
            </button>
            <div className="flex items-center gap-1 bg-white p-0.5 rounded-lg border border-border2">
              <button
                type="button"
                onClick={() => resizeItem(selected.id, 0.88)}
                className="px-2 py-1 min-h-[34px] sm:min-h-0 rounded text-[10px] font-bold text-text2 hover:bg-bg active:scale-95"
                title="縮小"
              >
                縮小 -
              </button>
              <button
                type="button"
                onClick={() => resizeItem(selected.id, 1.14)}
                className="px-2 py-1 min-h-[34px] sm:min-h-0 rounded text-[10px] font-bold text-text2 hover:bg-bg active:scale-95"
                title="拡大"
              >
                拡大 +
              </button>
            </div>

            {/* Mobile D-Pad Position Micro-Adjustment */}
            <div className="flex items-center gap-1 bg-white p-1 rounded-lg border border-border2 ml-auto">
              <span className="text-[9.5px] font-bold text-text3 px-1">微調整:</span>
              <button
                type="button"
                onClick={() => nudgeItem(selected.id, -3, 0)}
                className="w-7 h-7 rounded bg-bg hover:bg-slate-200 text-text font-bold flex items-center justify-center active:scale-90"
                title="左に移動"
              >
                <ArrowLeft size={12} />
              </button>
              <button
                type="button"
                onClick={() => nudgeItem(selected.id, 0, -3)}
                className="w-7 h-7 rounded bg-bg hover:bg-slate-200 text-text font-bold flex items-center justify-center active:scale-90"
                title="上に移動"
              >
                <ArrowUp size={12} />
              </button>
              <button
                type="button"
                onClick={() => nudgeItem(selected.id, 0, 3)}
                className="w-7 h-7 rounded bg-bg hover:bg-slate-200 text-text font-bold flex items-center justify-center active:scale-90"
                title="下に移動"
              >
                <ArrowDown size={12} />
              </button>
              <button
                type="button"
                onClick={() => nudgeItem(selected.id, 3, 0)}
                className="w-7 h-7 rounded bg-bg hover:bg-slate-200 text-text font-bold flex items-center justify-center active:scale-90"
                title="右に移動"
              >
                <ArrowRight size={12} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
