import { useRef, useEffect, useCallback, useState } from 'react';
import { ROW_H, HEADER_H, daysBetween, addDays, toISO, clamp, buildHeader, buildWeekends } from './ganttUtils';

const MILESTONE_COLORS = {
  pending: '#94a3b8', in_progress: '#3b82f6', completed: '#10b981', overdue: '#ef4444',
};

/**
 * Right-hand timeline canvas (virtualized rows, bars, dependency arrows, today line, weekends).
 * Props:
 *  rows, timelineStart, totalDays, dayWidth, scrollTop, viewportH, exporting
 *  showDeps, showCritical, criticalIds, float (Map), cpmFinish
 *  onMoveItem(id, newStart, newEnd)  – drag to reschedule (with cascade)
 *  onResizeItem(id, newStart, newEnd)
 *  onOpenEditor(row)
 */
export default function GanttTimeline({
  rows, timelineStart, totalDays, dayWidth, scrollTop, viewportH, exporting,
  showDeps, showCritical, criticalIds, float, wbsById,
  onMoveItem, onResizeItem, onOpenEditor,
}) {
  const timelineW = totalDays * dayWidth;
  const totalH = rows.length * ROW_H;

  const { minor, major } = buildHeader(timelineStart, totalDays, scaleKeyFromWidth(dayWidth));
  const weekends = buildWeekends(timelineStart, totalDays, scaleKeyFromWidth(dayWidth));

  const start = exporting ? 0 : Math.max(0, Math.floor(scrollTop / ROW_H) - 4);
  const end = exporting ? rows.length : Math.min(rows.length, Math.ceil((scrollTop + viewportH) / ROW_H) + 4);
  const visible = rows.slice(start, end);

  // x position for a date
  const xFor = (date) => daysBetween(timelineStart, date) * dayWidth;
  const todayX = xFor(new Date());

  // ── Drag bar (move / resize) ──────────────────────────────────────────────
  const dragRef = useRef(null);
  const [hoverBar, setHoverBar] = useState(null);

  const onBarMouseDown = useCallback((e, row, mode) => {
    if (mode === 'dblclick') return;
    e.preventDefault(); e.stopPropagation();
    const item = row.data;
    dragRef.current = {
      id: item.id, mode,
      startX: e.clientX,
      origStart: item.planned_start, origEnd: item.planned_end,
      rowId: row.id,
    };
    document.body.style.cursor = mode === 'move' ? 'grabbing' : 'ew-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    function move(e) {
      const drag = dragRef.current;
      if (!drag) return;
      const deltaPx = e.clientX - drag.startX;
      const deltaDays = Math.round(deltaPx / dayWidth);
      let newStart = drag.origStart, newEnd = drag.origEnd;
      if (drag.mode === 'move') {
        newStart = toISO(addDays(drag.origStart, deltaDays));
        newEnd = toISO(addDays(drag.origEnd, deltaDays));
      } else if (drag.mode === 'resize-left') {
        const cand = toISO(addDays(drag.origStart, deltaDays));
        if (cand < drag.origEnd) newStart = cand;
      } else if (drag.mode === 'resize-right') {
        const cand = toISO(addDays(drag.origEnd, deltaDays));
        if (cand > drag.origStart) newEnd = cand;
      }
      onMoveItem(drag.id, newStart, newEnd, drag.mode === 'move');
    }
    function up() {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      document.body.style.cursor = ''; document.body.style.userSelect = '';
      onResizeItem(drag.id); // finalize / persist
    }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [dayWidth, onMoveItem, onResizeItem]);

  // Dependency arrows (all rows — absolute coords; not affected by virtualization)
  const arrows = [];
  if (showDeps) {
    const rowIndex = {};
    rows.forEach((r, i) => { rowIndex[r.id] = i; });
    for (const row of rows) {
      if (row.kind !== 'wbs') continue;
      const preds = row.data.predecessor_ids || [];
      for (const predId of preds) {
        const pred = wbsById[predId];
        if (!pred) continue;
        const predEnd = pred.actual_end || pred.planned_end;
        const itemStart = row.data.actual_start || row.data.planned_start;
        if (!predEnd || !itemStart) continue;
        const fromIdx = rowIndex[predId], toIdx = rowIndex[row.id];
        if (fromIdx == null || toIdx == null) continue;
        const isCritical = showCritical && criticalIds.has(predId) && criticalIds.has(row.id);
        arrows.push({
          fromX: xFor(predEnd), toX: xFor(itemStart),
          fromY: fromIdx * ROW_H + ROW_H / 2,
          toY: toIdx * ROW_H + ROW_H / 2,
          isCritical,
          conflict: itemStart <= predEnd,
        });
      }
    }
  }

  return (
    <div className="relative" style={{ width: timelineW, minWidth: timelineW }}>
      {/* Header (sticky top) */}
      <div className="sticky top-0 z-20 bg-white" style={{ height: HEADER_H }}>
        {/* major tier */}
        <div className="relative border-b border-slate-200 bg-slate-50" style={{ height: HEADER_H / 2 }}>
          {major.map((m, i) => (
            <div key={i} className="absolute top-0 h-full flex items-center pl-1.5 text-[11px] font-semibold text-slate-500 border-l border-slate-300 truncate"
              style={{ left: m.day * dayWidth, width: Math.max(20, m.wDays * dayWidth) }}>
              {m.label}
            </div>
          ))}
        </div>
        {/* minor tier */}
        <div className="relative border-b border-slate-200 bg-slate-50" style={{ height: HEADER_H / 2 }}>
          {minor.map((m, i) => (
            <div key={i} className="absolute top-0 h-full flex items-center pl-1 text-[10px] text-slate-400 border-l border-slate-100 truncate"
              style={{ left: m.day * dayWidth, width: Math.max(14, m.wDays * dayWidth) }}>
              {m.label}
            </div>
          ))}
        </div>
      </div>

      {/* Background overlay: weekends, gridlines, today — full height */}
      <div className="absolute pointer-events-none" style={{ top: HEADER_H, left: 0, width: timelineW, height: totalH, zIndex: 0 }}>
        {/* minor gridlines */}
        {minor.map((m, i) => (
          <div key={i} className="absolute top-0 bottom-0 border-l border-slate-100" style={{ left: m.day * dayWidth }} />
        ))}
        {/* weekends */}
        {weekends.map((w, i) => (
          <div key={i} className="absolute top-0 bottom-0 bg-slate-100/60" style={{ left: w.day * dayWidth, width: dayWidth }} />
        ))}
        {/* today */}
        {todayX >= 0 && todayX <= timelineW && (
          <div className="absolute top-0 bottom-0 border-l-2 border-red-400" style={{ left: todayX }} />
        )}
      </div>

      {/* Dependency arrows SVG */}
      {showDeps && arrows.length > 0 && (
        <svg className="absolute pointer-events-none" style={{ top: HEADER_H, left: 0, width: timelineW, height: totalH, zIndex: 6 }}
          overflow="visible">
          <defs>
            <marker id="gantt-arr" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="#94a3b8" /></marker>
            <marker id="gantt-arr-crit" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="#f43f5e" /></marker>
          </defs>
          {arrows.map((a, i) => {
            const color = a.isCritical ? '#f43f5e' : a.conflict ? '#ef4444' : '#94a3b8';
            const midX = a.fromX + (a.toX - a.fromX) / 2;
            const d = `M ${a.fromX} ${a.fromY} C ${midX} ${a.fromY}, ${midX} ${a.toY}, ${a.toX} ${a.toY}`;
            return <path key={i} d={d} fill="none" stroke={color} strokeWidth={a.isCritical ? 2 : 1.4}
              strokeDasharray={a.isCritical ? 'none' : '4 3'} markerEnd={`url(#${a.isCritical ? 'gantt-arr-crit' : 'gantt-arr'})`} opacity={0.85} />;
          })}
        </svg>
      )}

      {/* Virtualized rows */}
      <div style={{ height: totalH, position: 'relative' }}>
        <div style={{ height: start * ROW_H }} />
        {visible.map(row => {
          if (row.kind === 'milestone') {
            const mx = xFor(row.data.planned_date);
            if (mx < -20 || mx > timelineW + 20) return <div key={row.id} style={{ height: ROW_H }} />;
            const color = MILESTONE_COLORS[row.data.status] || '#f59e0b';
            return (
              <div key={row.id} className="relative" style={{ height: ROW_H }}>
                <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-10 cursor-pointer"
                  style={{ left: mx }}
                  onDoubleClick={() => onOpenEditor(row)}>
                  <div className="w-4 h-4 rotate-45 border-2 border-white shadow" style={{ backgroundColor: color }} />
                </div>
              </div>
            );
          }
          const item = row.data;
          const barX = xFor(item.planned_start);
          const barW = Math.max(6, daysBetween(item.planned_start, item.planned_end) * dayWidth);
          const isCritical = showCritical && criticalIds.has(item.id);
          const slackDays = float.get(item.id) || 0;
          const slackX = barX + barW;
          const slackW = slackDays * dayWidth;
          const actualX = item.actual_start ? xFor(item.actual_start) : null;
          const actualW = item.actual_start ? Math.max(4, daysBetween(item.actual_start, item.actual_end || new Date().toISOString().slice(0, 10)) * dayWidth) : null;
          const baseColor = isCritical ? '#f43f5e' : '#a855f7';
          return (
            <div key={row.id} className="relative" style={{ height: ROW_H }}>
              {/* slack */}
              {slackW > 1 && !isCritical && (
                <div className="absolute rounded-sm border border-dashed border-amber-300 bg-amber-100/50 z-[2]"
                  style={{ left: slackX, width: slackW, top: 12, height: 14 }} title={`Slack: ${slackDays}d`} />
              )}
              {/* actual bar */}
              {actualX != null && (
                <div className="absolute rounded bg-emerald-500 z-[3]" style={{ left: actualX, width: actualW, top: 26, height: 6 }}
                  title={`Actual ${item.actual_start} → ${item.actual_end || '…'}`} />
              )}
              {/* planned bar */}
              <div
                className={`absolute rounded z-10 select-none ${isCritical ? 'shadow-sm shadow-rose-300' : ''}`}
                style={{ left: barX, width: barW, top: 8, height: 18, backgroundColor: baseColor, opacity: hoverBar === row.id ? 1 : 0.92 }}
                onMouseDown={e => onBarMouseDown(e, row, 'move')}
                onMouseEnter={() => setHoverBar(row.id)}
                onMouseLeave={() => setHoverBar(null)}
                onDoubleClick={() => onOpenEditor(row)}
                title={`${item.wbs_code} ${item.name} · ${item.planned_start} → ${item.planned_end} · ${item.progress || 0}%`}
              >
                {/* progress fill */}
                {item.progress > 0 && (
                  <div className="absolute left-0 top-0 h-full bg-black/25 rounded" style={{ width: `${clamp(item.progress, 0, 100)}%` }} />
                )}
                <span className="absolute inset-0 flex items-center px-1.5 text-[10px] text-white font-medium truncate drop-shadow pointer-events-none">
                  {barW > 40 ? item.name : ''}
                </span>
                {/* resize handles */}
                <div onMouseDown={e => onBarMouseDown(e, row, 'resize-left')} className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize z-20 hover:bg-white/40 rounded-l" />
                <div onMouseDown={e => onBarMouseDown(e, row, 'resize-right')} className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize z-20 hover:bg-white/40 rounded-r" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function scaleKeyFromWidth(dayWidth) {
  if (dayWidth >= 30) return 'day';
  if (dayWidth >= 12) return 'week';
  if (dayWidth >= 5) return 'month';
  if (dayWidth >= 2.5) return 'quarter';
  return 'year';
}