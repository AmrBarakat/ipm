import { useState } from 'react';
import { ChevronRight, ChevronDown, Flag, AlertTriangle } from 'lucide-react';
import { ROW_H, HEADER_H } from './ganttUtils';

/**
 * Frozen-left task/WBS tree column (virtualized).
 * Props:
 *  rows         – flat row list from buildRows()
 *  leftWidth    – px
 *  scrollTop    – px (drives virtualization)
 *  viewportH    – px
 *  expanded, onToggleExpand
 *  onReorder(dragId, targetId, position)  – 'child'|'before'|'after'
 *  exporting   – when true, render ALL rows (no virtualization) for image export
 *  criticalIds, delayedIds
 */
export default function GanttTree({
  rows, leftWidth, scrollTop, viewportH,
  expanded, onToggleExpand,
  onReorder, exporting, criticalIds, delayedIds,
  onResizeStart,
}) {
  const [dragId, setDragId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null); // { id, position }

  const totalH = rows.length * ROW_H;
  const start = exporting ? 0 : Math.max(0, Math.floor(scrollTop / ROW_H) - 4);
  const end = exporting ? rows.length : Math.min(rows.length, Math.ceil((scrollTop + viewportH) / ROW_H) + 4);
  const visible = rows.slice(start, end);

  function handleDragStart(e, row) {
    if (row.kind !== 'wbs') return;
    setDragId(row.id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', row.id);
  }
  function handleDragOver(e, row) {
    if (!dragId || row.id === dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    let position;
    if (row.kind === 'milestone') { position = y < rect.height / 2 ? 'before' : 'after'; }
    else { position = y < rect.height * 0.3 ? 'before' : y > rect.height * 0.7 ? 'after' : 'child'; }
    setDropTarget({ id: row.id, position });
  }
  function handleDrop(e, row) {
    e.preventDefault();
    if (dragId && row.id !== dragId && dropTarget) {
      onReorder(dragId, row.id, dropTarget.position);
    }
    setDragId(null); setDropTarget(null);
  }

  return (
    <div className="sticky left-0 z-20 bg-white border-r border-slate-200 relative shrink-0" style={{ width: leftWidth, flex: `0 0 ${leftWidth}` }}>
      {/* Header cell */}
      <div className="sticky top-0 z-30 bg-slate-50 border-b border-slate-200 flex items-center px-3 text-[11px] font-bold text-slate-500 uppercase tracking-wide"
        style={{ height: HEADER_H }}>
        Task / WBS
      </div>
      {/* Resize divider handle */}
      <div onMouseDown={onResizeStart} className="absolute top-0 bottom-0 z-40 cursor-col-resize group" style={{ right: -3, width: 6 }}>
        <div className="w-1 h-full bg-slate-200 group-hover:bg-amber-400 mx-auto" />
      </div>
      {/* Rows */}
      <div style={{ height: totalH, position: 'relative' }}>
        <div style={{ height: start * ROW_H }} />
        {visible.map(row => {
          const isWbs = row.kind === 'wbs';
          const isDrop = dropTarget && dropTarget.id === row.id;
          const dropClass = isDrop ? (dropTarget.position === 'before' ? 'border-t-2 border-amber-400' : dropTarget.position === 'after' ? 'border-b-2 border-amber-400' : 'bg-amber-50') : '';
          const isCritical = isWbs && criticalIds.has(row.id);
          const isDelayed = isWbs && delayedIds.has(row.id);
          return (
            <div key={row.id}
              draggable={isWbs}
              onDragStart={e => handleDragStart(e, row)}
              onDragOver={e => handleDragOver(e, row)}
              onDragLeave={() => setDropTarget(null)}
              onDrop={e => handleDrop(e, row)}
              onDragEnd={() => { setDragId(null); setDropTarget(null); }}
              className={`flex items-stretch border-b border-slate-100 ${dropClass} ${dragId === row.id ? 'opacity-40' : ''}`}
              style={{ height: ROW_H, paddingLeft: row.depth * 16 }}
            >
              <div className={`flex items-center gap-1 w-full px-2 text-xs ${isWbs ? 'cursor-grab active:cursor-grabbing' : ''}`}>
                {isWbs ? (
                  <>
                    {row.hasChildren ? (
                      <button onClick={() => onToggleExpand(row.id)} className="p-0.5 hover:bg-slate-100 rounded shrink-0">
                        {expanded[row.id] ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />}
                      </button>
                    ) : <span className="w-[18px] shrink-0" />}
                    {isDelayed && <AlertTriangle className="w-3 h-3 text-red-500 shrink-0" />}
                    {isCritical && !isDelayed && <span className="text-rose-500 shrink-0 font-bold leading-none">●</span>}
                    <span className="font-mono text-slate-400 shrink-0">{row.data.wbs_code}</span>
                    <span className={`truncate ${isCritical ? 'text-rose-800 font-medium' : 'text-slate-700'}`}>{row.data.name}</span>
                  </>
                ) : (
                  <>
                    <Flag className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    <span className="truncate text-slate-700 font-medium">{row.data.title}</span>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}