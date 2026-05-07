import { useState, useEffect, useRef, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { formatDate } from '@/lib/constants';
import { ChevronLeft, ChevronRight, Flag, CheckSquare, ZoomIn, ZoomOut, Calendar } from 'lucide-react';

const TASK_STATUS_COLORS = {
  todo:        { bar: 'bg-slate-400',   text: 'text-slate-600' },
  in_progress: { bar: 'bg-blue-500',    text: 'text-blue-700'  },
  review:      { bar: 'bg-purple-500',  text: 'text-purple-700'},
  done:        { bar: 'bg-emerald-500', text: 'text-emerald-700'},
  blocked:     { bar: 'bg-red-500',     text: 'text-red-700'   },
};

const MILESTONE_STATUS_COLORS = {
  pending:     'bg-slate-400',
  in_progress: 'bg-blue-500',
  completed:   'bg-emerald-500',
  overdue:     'bg-red-500',
};

const ZOOM_LEVELS = [
  { label: 'Week',   days: 7  },
  { label: 'Month',  days: 30 },
  { label: 'Quarter',days: 90 },
  { label: 'Year',   days: 365},
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

function isSameDay(a, b) {
  return a.toDateString() === b.toDateString();
}

export default function TabGantt({ projectId, project }) {
  const [tasks, setTasks] = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [zoomIdx, setZoomIdx] = useState(1); // default Month
  const [viewStart, setViewStart] = useState(null);
  const [tooltip, setTooltip] = useState(null);
  const containerRef = useRef(null);

  const zoom = ZOOM_LEVELS[zoomIdx];
  const visibleDays = zoom.days;

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [t, m] = await Promise.all([
        base44.entities.Task.filter({ project_id: projectId }, 'start_date', 300),
        base44.entities.Milestone.filter({ project_id: projectId }, 'planned_date', 100),
      ]);
      setTasks(t);
      setMilestones(m);
      setLoading(false);
    }
    load();
  }, [projectId]);

  // Determine timeline bounds
  const { minDate, maxDate } = useMemo(() => {
    const dates = [];
    if (project?.start_date) dates.push(new Date(project.start_date));
    if (project?.target_completion_date) dates.push(new Date(project.target_completion_date));
    tasks.forEach(t => {
      if (t.start_date) dates.push(new Date(t.start_date));
      if (t.due_date) dates.push(new Date(t.due_date));
    });
    milestones.forEach(m => {
      if (m.planned_date) dates.push(new Date(m.planned_date));
    });
    if (dates.length === 0) {
      const now = new Date();
      return { minDate: addDays(now, -15), maxDate: addDays(now, 45) };
    }
    const min = new Date(Math.min(...dates.map(d => d.getTime())));
    const max = new Date(Math.max(...dates.map(d => d.getTime())));
    return {
      minDate: addDays(min, -7),
      maxDate: addDays(max, 14),
    };
  }, [tasks, milestones, project]);

  // Initialize viewStart
  useEffect(() => {
    if (!viewStart) {
      const start = project?.start_date ? new Date(project.start_date) : new Date();
      setViewStart(addDays(start, -3));
    }
  }, [minDate]);

  const viewEnd = viewStart ? addDays(viewStart, visibleDays) : null;

  function pan(n) {
    setViewStart(v => addDays(v, n));
  }

  function jumpToToday() {
    setViewStart(addDays(new Date(), -Math.floor(visibleDays / 4)));
  }

  function jumpToStart() {
    setViewStart(addDays(minDate, -3));
  }

  // Build header days/weeks/months
  const headerUnits = useMemo(() => {
    if (!viewStart) return [];
    const units = [];
    if (visibleDays <= 14) {
      // Show every day
      for (let i = 0; i < visibleDays; i++) {
        units.push(addDays(viewStart, i));
      }
    } else if (visibleDays <= 90) {
      // Show weeks
      let cur = new Date(viewStart);
      while (cur < viewEnd) {
        units.push(new Date(cur));
        cur = addDays(cur, 7);
      }
    } else {
      // Show months
      let cur = new Date(viewStart);
      cur.setDate(1);
      while (cur < viewEnd) {
        units.push(new Date(cur));
        cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      }
    }
    return units;
  }, [viewStart, visibleDays]);

  function getBarStyle(startDate, endDate) {
    if (!viewStart || !startDate) return null;
    const start = new Date(startDate);
    const end = endDate ? new Date(endDate) : addDays(start, 1);
    const left = clamp(daysBetween(viewStart, start), 0, visibleDays);
    const right = clamp(daysBetween(viewStart, end), 0, visibleDays);
    const width = right - left;
    if (width <= 0) return null;
    return {
      left: `${(left / visibleDays) * 100}%`,
      width: `${(width / visibleDays) * 100}%`,
    };
  }

  function getMilestoneStyle(date) {
    if (!viewStart || !date) return null;
    const d = new Date(date);
    const pos = daysBetween(viewStart, d);
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
    if (visibleDays <= 14) {
      return date.toLocaleDateString('en', { weekday: 'short', day: 'numeric' });
    } else if (visibleDays <= 90) {
      return `W${Math.ceil(date.getDate() / 7)} ${date.toLocaleDateString('en', { month: 'short' })}`;
    } else {
      return date.toLocaleDateString('en', { month: 'short', year: '2-digit' });
    }
  }

  // Rows: tasks with dates + milestones as single-day markers
  const taskRows = tasks.filter(t => t.start_date || t.due_date);
  const milestoneRows = milestones.filter(m => m.planned_date);

  const todayStyle = getTodayStyle();

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-7 h-7 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" />
    </div>
  );

  if (taskRows.length === 0 && milestoneRows.length === 0) return (
    <div className="text-center py-16 text-slate-400">
      <Calendar className="w-12 h-12 mx-auto mb-3 opacity-30" />
      <p className="text-sm">No tasks or milestones with dates to display.</p>
      <p className="text-xs mt-1">Add start/due dates to tasks or milestones to see the Gantt chart.</p>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {/* Zoom */}
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

          {/* Pan */}
          <div className="flex items-center border border-slate-200 rounded overflow-hidden">
            <button onClick={() => pan(-Math.ceil(visibleDays / 2))} className="p-1.5 hover:bg-slate-100 border-r border-slate-200">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button onClick={() => pan(Math.ceil(visibleDays / 2))} className="p-1.5 hover:bg-slate-100">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
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
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-blue-500 inline-block" /> In Progress</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block" /> Done / Completed</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-slate-400 inline-block" /> Todo</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-red-500 inline-block" /> Blocked / Overdue</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-amber-500 inline-block" /><span className="w-3 h-3 rounded-full bg-amber-500 inline-block -ml-1" /> Milestone</div>
        <div className="flex items-center gap-1.5"><div className="w-px h-3 bg-red-400 border-dashed border-red-400" /> Today</div>
      </div>

      {/* Chart */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden border border-slate-200">
        {/* Header row */}
        <div className="flex border-b border-slate-200 bg-slate-50">
          <div className="w-52 shrink-0 px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide border-r border-slate-200">
            Item
          </div>
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

        {/* Section: Milestones */}
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
                <div key={m.id} className="flex border-b border-slate-100 hover:bg-slate-50 group" style={{ minHeight: 36 }}>
                  <div className="w-52 shrink-0 px-4 py-2 text-xs text-slate-700 font-medium truncate border-r border-slate-200 flex items-center gap-1">
                    <Flag className="w-3 h-3 text-amber-500 shrink-0" />
                    <span className="truncate">{m.title}</span>
                  </div>
                  <div className="flex-1 relative">
                    {/* Vertical grid lines */}
                    {headerUnits.map((unit, i) => (
                      <div key={i} className="absolute top-0 bottom-0 border-l border-slate-100"
                        style={{ left: `${(daysBetween(viewStart, unit) / visibleDays) * 100}%` }} />
                    ))}
                    {/* Today line */}
                    {todayStyle && (
                      <div className="absolute top-0 bottom-0 border-l-2 border-red-400 border-dashed z-10" style={todayStyle} />
                    )}
                    {ms && (
                      <div
                        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 cursor-pointer z-20"
                        style={ms}
                        onMouseEnter={e => setTooltip({ x: e.clientX, y: e.clientY, content: m.title, sub: formatDate(m.planned_date), status: m.status, type: 'milestone' })}
                        onMouseLeave={() => setTooltip(null)}
                      >
                        <div className={`w-4 h-4 rotate-45 ${MILESTONE_STATUS_COLORS[m.status] || 'bg-amber-500'} shadow-md border-2 border-white`} />
                      </div>
                    )}
                    {!ms && (
                      <div className="flex items-center h-full pl-2 text-xs text-slate-400 italic">out of view</div>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}

        {/* Section: Tasks */}
        {taskRows.length > 0 && (
          <>
            <div className="flex bg-blue-50 border-b border-slate-100">
              <div className="w-52 shrink-0 px-4 py-1.5 text-xs font-bold text-blue-700 uppercase tracking-wide border-r border-slate-200 flex items-center gap-1">
                <CheckSquare className="w-3 h-3" /> Tasks
              </div>
              <div className="flex-1" />
            </div>
            {taskRows.map(t => {
              const bs = getBarStyle(t.start_date || t.due_date, t.due_date || t.start_date);
              const colors = TASK_STATUS_COLORS[t.status] || TASK_STATUS_COLORS.todo;
              return (
                <div key={t.id} className="flex border-b border-slate-100 hover:bg-slate-50 group" style={{ minHeight: 36 }}>
                  <div className="w-52 shrink-0 px-4 py-2 text-xs text-slate-700 font-medium border-r border-slate-200 flex items-center gap-1">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${colors.bar}`} />
                    <span className="truncate">{t.title}</span>
                  </div>
                  <div className="flex-1 relative flex items-center">
                    {/* Vertical grid lines */}
                    {headerUnits.map((unit, i) => (
                      <div key={i} className="absolute top-0 bottom-0 border-l border-slate-100"
                        style={{ left: `${(daysBetween(viewStart, unit) / visibleDays) * 100}%` }} />
                    ))}
                    {/* Today line */}
                    {todayStyle && (
                      <div className="absolute top-0 bottom-0 border-l-2 border-red-400 border-dashed z-10" style={todayStyle} />
                    )}
                    {bs ? (
                      <div
                        className={`absolute h-5 rounded-full ${colors.bar} opacity-90 group-hover:opacity-100 cursor-pointer transition-opacity z-20 flex items-center px-2 overflow-hidden`}
                        style={bs}
                        onMouseEnter={e => setTooltip({
                          x: e.clientX, y: e.clientY,
                          content: t.title,
                          sub: `${formatDate(t.start_date || t.due_date)} → ${formatDate(t.due_date || t.start_date)}`,
                          status: t.status?.replace(/_/g, ' '),
                          priority: t.priority,
                          assignee: t.assignee,
                          progress: t.progress,
                          type: 'task',
                        })}
                        onMouseLeave={() => setTooltip(null)}
                      >
                        {t.progress > 0 && (
                          <div
                            className="absolute left-0 top-0 h-full bg-black/20 rounded-full"
                            style={{ width: `${t.progress}%` }}
                          />
                        )}
                        <span className="text-white text-xs font-medium truncate relative z-10 drop-shadow">
                          {t.title}
                        </span>
                      </div>
                    ) : (
                      <div className="text-xs text-slate-400 italic pl-2">out of view</div>
                    )}
                  </div>
                </div>
              );
            })}
          </>
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
          {tooltip.progress !== undefined && tooltip.progress > 0 && (
            <div className="text-slate-400">Progress: {tooltip.progress}%</div>
          )}
        </div>
      )}
    </div>
  );
}