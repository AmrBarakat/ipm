import { useState, useEffect, useRef, useMemo } from 'react';
// Gantt shows WBS + Milestones only. Tasks are managed independently as a Kanban board.
import { base44 } from '@/api/base44Client';
import { formatDate } from '@/lib/constants';

import { ChevronLeft, ChevronRight, Flag, ZoomIn, ZoomOut, Calendar, AlertTriangle, Layers } from 'lucide-react';
import PanelWrapper from '@/components/ui/PanelWrapper';

const MILESTONE_STATUS_COLORS = {
  pending:     'bg-slate-400',
  in_progress: 'bg-blue-500',
  completed:   'bg-emerald-500',
  overdue:     'bg-red-500',
};

const ZOOM_LEVELS = [
  { label: 'Week',    days: 7   },
  { label: 'Month',   days: 30  },
  { label: 'Quarter', days: 90  },
  { label: 'Year',    days: 365 },
];

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

export default function TabGantt({ projectId, project }) {
  const [milestones, setMilestones] = useState([]);
  const [wbsItems, setWbsItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [zoomIdx, setZoomIdx] = useState(1);
  const [viewStart, setViewStart] = useState(null);
  const [tooltip, setTooltip] = useState(null);
  const [showDeps, setShowDeps] = useState(true);
  const zoom = ZOOM_LEVELS[zoomIdx];
  const visibleDays = zoom.days;

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [m, w] = await Promise.all([
        base44.entities.Milestone.filter({ project_id: projectId }, 'planned_date', 100),
        base44.entities.WBSItem.filter({ project_id: projectId }, 'wbs_code', 500),
      ]);
      setMilestones(m);
      setWbsItems(w);
      setLoading(false);
    }
    load();
  }, [projectId]);

  // WBS dependency impact
  const wbsImpact = useMemo(() => {
    const byId = Object.fromEntries(wbsItems.map(i => [i.id, i]));
    const result = {};
    for (const item of wbsItems) {
      const preds = (item.predecessor_ids || []).map(pid => byId[pid]).filter(Boolean);
      if (!preds.length) { result[item.id] = { delayed: false }; continue; }
      const predEnds = preds.map(p => p.actual_end || p.planned_end).filter(Boolean);
      if (!predEnds.length) { result[item.id] = { delayed: false }; continue; }
      const latestEnd = predEnds.reduce((a, b) => (a > b ? a : b));
      const myStart = item.actual_start || item.planned_start;
      result[item.id] = { delayed: myStart && myStart <= latestEnd, earliestStart: latestEnd };
    }
    return result;
  }, [wbsItems]);

  const { minDate } = useMemo(() => {
    const dates = [];
    if (project?.start_date) dates.push(new Date(project.start_date));
    if (project?.target_completion_date) dates.push(new Date(project.target_completion_date));
    wbsItems.forEach(w => {
      if (w.planned_start) dates.push(new Date(w.planned_start));
      if (w.planned_end) dates.push(new Date(w.planned_end));
    });
    milestones.forEach(m => {
      if (m.planned_date) dates.push(new Date(m.planned_date));
    });
    if (dates.length === 0) {
      const now = new Date();
      return { minDate: addDays(now, -15) };
    }
    const min = new Date(Math.min(...dates.map(d => d.getTime())));
    return { minDate: addDays(min, -7) };
  }, [milestones, wbsItems, project]);

  useEffect(() => {
    if (!viewStart) {
      const start = project?.start_date ? new Date(project.start_date) : new Date();
      setViewStart(addDays(start, -3));
    }
  }, [minDate]);

  const viewEnd = viewStart ? addDays(viewStart, visibleDays) : null;

  function pan(n) { setViewStart(v => addDays(v, n)); }
  function jumpToToday() { setViewStart(addDays(new Date(), -Math.floor(visibleDays / 4))); }
  function jumpToStart() { setViewStart(addDays(minDate, -3)); }

  const headerUnits = useMemo(() => {
    if (!viewStart) return [];
    const units = [];
    if (visibleDays <= 14) {
      for (let i = 0; i < visibleDays; i++) units.push(addDays(viewStart, i));
    } else if (visibleDays <= 90) {
      let cur = new Date(viewStart);
      while (cur < viewEnd) { units.push(new Date(cur)); cur = addDays(cur, 7); }
    } else {
      let cur = new Date(viewStart);
      cur.setDate(1);
      while (cur < viewEnd) {
        units.push(new Date(cur));
        cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      }
    }
    return units;
  }, [viewStart, visibleDays]);

  function pct(date) {
    if (!viewStart || !date) return null;
    const d = new Date(date);
    return (daysBetween(viewStart, d) / visibleDays) * 100;
  }

  function getBarStyle(startDate, endDate) {
    if (!viewStart || !startDate) return null;
    const start = new Date(startDate);
    const end = endDate ? new Date(endDate) : addDays(start, 1);
    const left = clamp(daysBetween(viewStart, start), 0, visibleDays);
    const right = clamp(daysBetween(viewStart, end), 0, visibleDays);
    const width = right - left;
    if (width <= 0) return null;
    return { left: `${(left / visibleDays) * 100}%`, width: `${(width / visibleDays) * 100}%` };
  }

  function getMilestoneStyle(date) {
    if (!viewStart || !date) return null;
    const pos = daysBetween(viewStart, new Date(date));
    if (pos < 0 || pos > visibleDays) return null;
    return { left: `${(pos / visibleDays) * 100}%` };
  }

  function getTodayStyle() {
    if (!viewStart) return null;
    const pos = daysBetween(viewStart, new Date());
    if (pos < 0 || pos > visibleDays) return null;
    return { left: `${(pos / visibleDays) * 100}%` };
  }

  function formatHeader(date) {
    if (visibleDays <= 14) return date.toLocaleDateString('en', { weekday: 'short', day: 'numeric' });
    if (visibleDays <= 90) return `W${Math.ceil(date.getDate() / 7)} ${date.toLocaleDateString('en', { month: 'short' })}`;
    return date.toLocaleDateString('en', { month: 'short', year: '2-digit' });
  }

  const milestoneRows = milestones.filter(m => m.planned_date);
  const wbsRows = wbsItems.filter(w => w.planned_start || w.planned_end);
  const todayStyle = getTodayStyle();

  // WBS dependency arrows
  const depArrows = useMemo(() => {
    if (!viewStart || !showDeps) return [];
    const byId = Object.fromEntries(wbsItems.map(i => [i.id, i]));
    const arrows = [];
    for (const item of wbsRows) {
      for (const predId of (item.predecessor_ids || [])) {
        const pred = byId[predId];
        if (!pred) continue;
        const predEnd = pred.actual_end || pred.planned_end;
        const itemStart = item.actual_start || item.planned_start;
        if (!predEnd || !itemStart) continue;
        const fromPct = clamp(pct(predEnd), 0, 100);
        const toPct = clamp(pct(itemStart), 0, 100);
        const isConflict = (wbsImpact[item.id] || {}).delayed;
        arrows.push({ predId, itemId: item.id, fromPct, toPct, isConflict });
      }
    }
    return arrows;
  }, [wbsItems, wbsRows, viewStart, showDeps, wbsImpact]);

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-7 h-7 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" />
    </div>
  );

  if (milestoneRows.length === 0 && wbsRows.length === 0) return (
    <div className="text-center py-16 text-slate-400">
      <Calendar className="w-12 h-12 mx-auto mb-3 opacity-30" />
      <p className="text-sm">No WBS items or milestones with dates to display.</p>
      <p className="text-xs mt-1">Add planned dates to WBS items or milestones in their respective tabs to see the Gantt.</p>
    </div>
  );

  const ROW_H = 36;
  const SECTION_H = 28;
  const msSection = milestoneRows.length > 0 ? SECTION_H + milestoneRows.length * ROW_H : 0;
  const taskSectionStart = SECTION_H + msSection; // header row (36) + ms content

  return (
    <PanelWrapper
      title="Gantt Chart"
      exportData={wbsRows.map(w => ({
        wbs_code: w.wbs_code, name: w.name, status: w.status,
        assignee: w.assignee || '',
        planned_start: w.planned_start || '', planned_end: w.planned_end || '',
        actual_start: w.actual_start || '', actual_end: w.actual_end || '',
        progress: w.progress || 0,
      }))}
      exportCols={[
        { key: 'wbs_code', label: 'Code' }, { key: 'name', label: 'Name' },
        { key: 'status', label: 'Status' }, { key: 'assignee', label: 'Assignee' },
        { key: 'planned_start', label: 'Pln Start' }, { key: 'planned_end', label: 'Pln End' },
        { key: 'actual_start', label: 'Act Start' }, { key: 'actual_end', label: 'Act End' },
        { key: 'progress', label: 'Progress %' },
      ]}
    >
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center border border-slate-200 rounded overflow-hidden text-xs">
            <button onClick={() => setZoomIdx(i => Math.max(0, i - 1))} disabled={zoomIdx === 0}
              className="px-2 py-1.5 hover:bg-slate-100 disabled:opacity-40 border-r border-slate-200">
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            {ZOOM_LEVELS.map((z, i) => (
              <button key={z.label} onClick={() => setZoomIdx(i)}
                className={`px-3 py-1.5 font-medium border-r border-slate-200 last:border-0 transition ${i === zoomIdx ? 'bg-amber-500 text-slate-900' : 'hover:bg-slate-100 text-slate-600'}`}>
                {z.label}
              </button>
            ))}
            <button onClick={() => setZoomIdx(i => Math.min(ZOOM_LEVELS.length - 1, i + 1))} disabled={zoomIdx === ZOOM_LEVELS.length - 1}
              className="px-2 py-1.5 hover:bg-slate-100 disabled:opacity-40">
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex items-center border border-slate-200 rounded overflow-hidden">
            <button onClick={() => pan(-Math.ceil(visibleDays / 2))} className="p-1.5 hover:bg-slate-100 border-r border-slate-200">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button onClick={() => pan(Math.ceil(visibleDays / 2))} className="p-1.5 hover:bg-slate-100">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
            <input type="checkbox" checked={showDeps} onChange={e => setShowDeps(e.target.checked)} className="accent-amber-500" />
            Show dependencies
          </label>
        </div>
        <div className="flex gap-2">
          <button onClick={jumpToStart}
            className="px-3 py-1.5 text-xs border border-slate-200 rounded hover:bg-slate-100 text-slate-600 font-medium">
            Project Start
          </button>
          <button onClick={jumpToToday}
            className="px-3 py-1.5 text-xs border border-slate-200 rounded hover:bg-slate-100 text-slate-600 font-medium">
            Today
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-slate-500">
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-purple-400 inline-block" /> WBS Planned</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block" /> WBS Actual</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-red-400 inline-block" /> Schedule Conflict</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rotate-45 bg-amber-500 inline-block" /> Milestone</div>
        <div className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-slate-400 inline-block" /> Dependency</div>
        <div className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-red-500 inline-block" /> Dep. Conflict</div>
        <div className="flex items-center gap-1.5"><span className="w-4 border-l-2 border-red-400 inline-block h-3" /> Today</div>
      </div>

      {/* Chart */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="flex border-b border-slate-200 bg-slate-50">
          <div className="w-52 shrink-0 px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide border-r border-slate-200">Item</div>
          <div className="flex-1 relative h-8 overflow-hidden">
            {headerUnits.map((unit, i) => (
              <div key={i}
                className="absolute top-0 bottom-0 flex items-center text-xs text-slate-500 font-medium pl-1 border-l border-slate-200"
                style={{ left: `${(daysBetween(viewStart, unit) / visibleDays) * 100}%` }}>
                {formatHeader(unit)}
              </div>
            ))}
          </div>
        </div>

        {/* Milestones section */}
        {milestoneRows.length > 0 && (
          <>
            <div className="flex bg-amber-50 border-b border-slate-100">
              <div className="w-52 shrink-0 px-4 py-1.5 text-xs font-bold text-amber-700 uppercase tracking-wide border-r border-slate-200 flex items-center gap-1">
                <Flag className="w-3 h-3" /> Milestones
              </div>
              <div className="flex-1" />
            </div>
            {milestoneRows.map(m => {
              const ms = getMilestoneStyle(m.planned_date);
              return (
                <div key={m.id} className="flex border-b border-slate-100 hover:bg-slate-50" style={{ minHeight: ROW_H }}>
                  <div className="w-52 shrink-0 px-4 py-2 text-xs text-slate-700 font-medium truncate border-r border-slate-200 flex items-center gap-1">
                    <Flag className="w-3 h-3 text-amber-500 shrink-0" />
                    <span className="truncate">{m.title}</span>
                  </div>
                  <div className="flex-1 relative">
                    {headerUnits.map((unit, i) => (
                      <div key={i} className="absolute top-0 bottom-0 border-l border-slate-100"
                        style={{ left: `${(daysBetween(viewStart, unit) / visibleDays) * 100}%` }} />
                    ))}
                    {todayStyle && <div className="absolute top-0 bottom-0 border-l-2 border-red-400 border-dashed z-10" style={todayStyle} />}
                    {ms && (
                      <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 cursor-pointer z-20" style={ms}
                        onMouseEnter={e => setTooltip({ x: e.clientX, y: e.clientY, content: m.title, sub: formatDate(m.planned_date), status: m.status })}
                        onMouseLeave={() => setTooltip(null)}>
                        <div className={`w-4 h-4 rotate-45 ${MILESTONE_STATUS_COLORS[m.status] || 'bg-amber-500'} shadow-md border-2 border-white`} />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}

        {/* WBS section */}
        {wbsRows.length > 0 && (
          <div className="relative">
            <div className="flex bg-purple-50 border-b border-slate-100">
              <div className="w-52 shrink-0 px-4 py-1.5 text-xs font-bold text-purple-700 uppercase tracking-wide border-r border-slate-200 flex items-center gap-1">
                <Layers className="w-3 h-3" /> WBS Items
              </div>
              <div className="flex-1" />
            </div>
            {wbsRows.map(w => {
              const plannedBar = getBarStyle(w.planned_start, w.planned_end);
              const actualBar = (w.actual_start) ? getBarStyle(w.actual_start, w.actual_end || new Date().toISOString().slice(0,10)) : null;
              const linkedMs = milestones.find(m => m.id === w.milestone_id);
              const msStyle = linkedMs ? getMilestoneStyle(linkedMs.planned_date) : null;
              const dep = wbsImpact[w.id] || {};
              return (
                <div key={w.id} className={`flex border-b border-slate-100 hover:bg-slate-50 ${dep.delayed ? 'bg-red-50' : ''}`} style={{ minHeight: ROW_H }}>
                  <div className="w-52 shrink-0 px-4 py-2 text-xs text-slate-700 font-medium truncate border-r border-slate-200 flex items-center gap-1">
                    {dep.delayed && <AlertTriangle className="w-3 h-3 text-red-500 shrink-0" />}
                    <span className="font-mono text-slate-400 shrink-0">{w.wbs_code}</span>
                    <span className="truncate">{w.name}</span>
                  </div>
                  <div className="flex-1 relative" style={{ minHeight: ROW_H }}>
                    {headerUnits.map((unit, i) => (
                      <div key={i} className="absolute top-0 bottom-0 border-l border-slate-100"
                        style={{ left: `${(daysBetween(viewStart, unit) / visibleDays) * 100}%` }} />
                    ))}
                    {todayStyle && <div className="absolute top-0 bottom-0 border-l-2 border-red-400 border-dashed z-10" style={todayStyle} />}
                    {/* Planned bar (purple, top half) */}
                    {plannedBar && (
                      <div
                        className={`absolute h-4 rounded ${dep.delayed ? 'bg-red-400' : 'bg-purple-400'} opacity-70 hover:opacity-100 cursor-pointer z-20 flex items-center px-1 overflow-hidden`}
                        style={{ ...plannedBar, top: 4 }}
                        onMouseEnter={e => setTooltip({
                          x: e.clientX, y: e.clientY,
                          content: `${w.wbs_code} ${w.name}`,
                          sub: `Planned: ${formatDate(w.planned_start)} → ${formatDate(w.planned_end)}`,
                          status: w.status?.replace(/_/g, ' '),
                          assignee: w.assignee,
                          progress: w.progress,
                          milestone: linkedMs?.title,
                          delayed: dep.delayed,
                        })}
                        onMouseLeave={() => setTooltip(null)}
                      >
                        {w.progress > 0 && <div className="absolute left-0 top-0 h-full bg-black/20 rounded" style={{ width: `${w.progress}%` }} />}
                        <span className="text-white text-xs font-medium truncate relative z-10 drop-shadow">{w.name}</span>
                      </div>
                    )}
                    {/* Actual bar (emerald, bottom half) */}
                    {actualBar && (
                      <div
                        className="absolute h-3 rounded bg-emerald-500 opacity-80 z-20"
                        style={{ ...actualBar, top: 20 }}
                        title={`Actual: ${formatDate(w.actual_start)} → ${formatDate(w.actual_end) || 'ongoing'}`}
                      />
                    )}
                    {/* Linked milestone diamond */}
                    {msStyle && (
                      <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-30 pointer-events-none" style={msStyle}>
                        <div className={`w-3 h-3 rotate-45 ${MILESTONE_STATUS_COLORS[linkedMs.status] || 'bg-amber-500'} border border-white`} />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* WBS dependency arrows SVG overlay — drawn over the WBS rows */}
        {showDeps && depArrows.length > 0 && wbsRows.length > 0 && (
          <svg
            className="absolute pointer-events-none z-30"
            style={{ left: 208, width: 'calc(100% - 208px)', top: (milestoneRows.length > 0 ? (SECTION_H + milestoneRows.length * ROW_H) : 0) + SECTION_H, height: wbsRows.length * ROW_H }}
            overflow="visible"
          >
            <defs>
              <marker id="arrow-normal" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
                <path d="M0,0 L0,6 L6,3 z" fill="#94a3b8" />
              </marker>
              <marker id="arrow-conflict" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
                <path d="M0,0 L0,6 L6,3 z" fill="#ef4444" />
              </marker>
            </defs>
            {depArrows.map((arrow, i) => {
              const fromRowIdx = wbsRows.findIndex(w => w.id === arrow.predId);
              const toRowIdx = wbsRows.findIndex(w => w.id === arrow.itemId);
              if (fromRowIdx < 0 || toRowIdx < 0) return null;
              const fromX = `${arrow.fromPct}%`;
              const toX = `${arrow.toPct}%`;
              const fromY = fromRowIdx * ROW_H + ROW_H / 2;
              const toY = toRowIdx * ROW_H + ROW_H / 2;
              const color = arrow.isConflict ? '#ef4444' : '#94a3b8';
              const markerId = arrow.isConflict ? 'arrow-conflict' : 'arrow-normal';
              return (
                <g key={i}>
                  <path
                    d={`M ${fromX} ${fromY} C ${fromX} ${(fromY + toY) / 2}, ${toX} ${(fromY + toY) / 2}, ${toX} ${toY}`}
                    fill="none" stroke={color} strokeWidth="1.5" strokeDasharray="4 3"
                    markerEnd={`url(#${markerId})`} opacity="0.7"
                  />
                </g>
              );
            })}
          </svg>
        )}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 bg-slate-900 text-white rounded-lg shadow-xl px-3 py-2.5 text-xs pointer-events-none max-w-xs"
          style={{ left: tooltip.x + 14, top: tooltip.y - 10 }}
        >
          <div className="font-semibold text-sm mb-1">{tooltip.content}</div>
          {tooltip.sub && <div className="text-slate-300">{tooltip.sub}</div>}
          {tooltip.status && <div className="text-slate-400 capitalize mt-0.5">Status: {tooltip.status}</div>}
          {tooltip.priority && <div className="text-slate-400 capitalize">Priority: {tooltip.priority}</div>}
          {tooltip.assignee && <div className="text-slate-400">Assignee: {tooltip.assignee}</div>}
          {tooltip.progress > 0 && <div className="text-slate-400">Progress: {tooltip.progress}%</div>}
          {tooltip.predecessors?.length > 0 && (
            <div className="text-slate-400 mt-1">After: {tooltip.predecessors.join(', ')}</div>
          )}
          {tooltip.milestone && <div className="text-amber-400 mt-0.5">🏁 Milestone: {tooltip.milestone}</div>}
          {tooltip.delayed && <div className="text-red-400 font-semibold mt-1">⚠ Starts before predecessor finishes</div>}
        </div>
      )}
    </div>
    </PanelWrapper>
  );
}