import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useEntityList } from '@/hooks/useEntity';
import { CalendarDays, ChevronLeft, ChevronRight, Flag, CheckSquare, Filter, X, AlertTriangle } from 'lucide-react';
import { toLocalDate } from '@/lib/utils';

const TASK_STATUS_COLORS = {
  todo: 'bg-slate-200 text-slate-700 border-slate-300',
  in_progress: 'bg-blue-100 text-blue-700 border-blue-300',
  review: 'bg-amber-100 text-amber-800 border-amber-300',
  done: 'bg-emerald-100 text-emerald-700 border-emerald-300',
  blocked: 'bg-red-100 text-red-700 border-red-300',
};

const TASK_STATUS_DOT = {
  todo: 'bg-slate-400',
  in_progress: 'bg-blue-500',
  review: 'bg-amber-500',
  done: 'bg-emerald-500',
  blocked: 'bg-red-500',
};

const MILESTONE_STATUS_COLORS = {
  pending: 'bg-slate-100 text-slate-600 border-slate-300',
  in_progress: 'bg-amber-100 text-amber-800 border-amber-300',
  completed: 'bg-emerald-100 text-emerald-700 border-emerald-300',
  overdue: 'bg-red-100 text-red-700 border-red-300',
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function ymd(d) {
  return toLocalDate(d);
}

export default function Calendar() {
  const { data: projects = [], isLoading: pLoading, isError: pError, refetch: refetchP } = useEntityList('Project', null, '-updated_date', 500);
  const { data: tasks = [], isLoading: tLoading, isError: tError, refetch: refetchT } = useEntityList('Task', null, '-updated_date', 1000);
  const { data: milestones = [], isLoading: mLoading, isError: mError, refetch: refetchM } = useEntityList('Milestone', null, '-updated_date', 1000);
  const loading = pLoading || tLoading || mLoading;
  const isError = pError || tError || mError;
  const refetch = () => { refetchP(); refetchT(); refetchM(); };
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [filterProject, setFilterProject] = useState('');
  const [showTasks, setShowTasks] = useState(true);
  const [showMilestones, setShowMilestones] = useState(true);
  const [selectedDay, setSelectedDay] = useState(null);

  const projectById = useMemo(() => Object.fromEntries(projects.map(p => [p.id, p])), [projects]);

  // Build events keyed by date
  const eventsByDate = useMemo(() => {
    const map = {};
    function add(date, ev) {
      if (!date) return;
      const key = date.slice(0, 10);
      if (!map[key]) map[key] = [];
      map[key].push(ev);
    }
    if (showTasks) {
      tasks.forEach(t => {
        if (filterProject && t.project_id !== filterProject) return;
        add(t.due_date, { type: 'task', id: t.id, title: t.title, status: t.status, project_id: t.project_id, date: t.due_date });
      });
    }
    if (showMilestones) {
      milestones.forEach(m => {
        if (filterProject && m.project_id !== filterProject) return;
        add(m.planned_date, { type: 'milestone', id: m.id, title: m.title, status: m.status, project_id: m.project_id, date: m.planned_date });
      });
    }
    return map;
  }, [tasks, milestones, showTasks, showMilestones, filterProject]);

  // Month grid
  const grid = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const first = new Date(year, month, 1);
    const startDay = first.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = [];
    // leading blanks
    for (let i = 0; i < startDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(new Date(year, month, d));
    }
    // trailing to complete last week
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [cursor]);

  const today = ymd(new Date());
  const monthLabel = cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // Stats
  const totalEvents = Object.values(eventsByDate).reduce((s, a) => s + a.length, 0);
  const taskCount = Object.values(eventsByDate).reduce((s, a) => s + a.filter(e => e.type === 'task').length, 0);
  const milestoneCount = totalEvents - taskCount;

  function prevMonth() { setCursor(d => new Date(d.getFullYear(), d.getMonth() - 1, 1)); }
  function nextMonth() { setCursor(d => new Date(d.getFullYear(), d.getMonth() + 1, 1)); }
  function goToday() { const d = new Date(); d.setDate(1); setCursor(d); }

  const selectedEvents = selectedDay ? (eventsByDate[selectedDay] || []) : [];

  if (loading) {
    return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <AlertTriangle className="w-8 h-8 text-red-400" />
        <p className="text-sm text-red-500">Failed to load calendar data.</p>
        <button onClick={refetch} className="px-3 py-1.5 text-xs font-semibold border border-red-300 text-red-600 rounded hover:bg-red-50">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-6 h-6 text-amber-500" />
          <h1 className="text-xl font-bold text-slate-800">Portfolio Calendar</h1>
          <span className="text-xs text-slate-400">{totalEvents} events · {taskCount} tasks · {milestoneCount} milestones</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="p-2 border border-slate-200 rounded hover:bg-slate-100 text-slate-600"><ChevronLeft className="w-4 h-4" /></button>
          <span className="text-sm font-semibold text-slate-700 w-36 text-center">{monthLabel}</span>
          <button onClick={nextMonth} className="p-2 border border-slate-200 rounded hover:bg-slate-100 text-slate-600"><ChevronRight className="w-4 h-4" /></button>
          <button onClick={goToday} className="px-3 py-1.5 text-xs border border-slate-200 rounded hover:bg-slate-100 text-slate-600 font-medium">Today</button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 bg-white rounded-lg shadow-sm p-3 text-sm">
        <Filter className="w-4 h-4 text-slate-400" />
        <select value={filterProject} onChange={e => setFilterProject(e.target.value)}
          className="border border-slate-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white">
          <option value="">All Projects</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
        </select>
        <button onClick={() => setShowTasks(v => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold border ${showTasks ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-slate-200 text-slate-400'}`}>
          <CheckSquare className="w-3.5 h-3.5" /> Tasks
        </button>
        <button onClick={() => setShowMilestones(v => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold border ${showMilestones ? 'bg-amber-50 border-amber-300 text-amber-700' : 'bg-white border-slate-200 text-slate-400'}`}>
          <Flag className="w-3.5 h-3.5" /> Milestones
        </button>
        {(filterProject || !showTasks || !showMilestones) && (
          <button onClick={() => { setFilterProject(''); setShowTasks(true); setShowMilestones(true); }}
            className="text-xs text-slate-500 hover:text-red-500 underline">Reset</button>
        )}
      </div>

      {/* Calendar grid */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden border border-slate-200">
        <div className="grid grid-cols-7 bg-slate-50 border-b border-slate-200">
          {WEEKDAYS.map(d => (
            <div key={d} className="px-2 py-2 text-xs font-semibold text-slate-500 uppercase text-center">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {grid.map((cell, idx) => {
            if (!cell) return <div key={idx} className="min-h-[96px] border-r border-b border-slate-100 bg-slate-50/50" />;
            const key = ymd(cell);
            const events = eventsByDate[key] || [];
            const isToday = key === today;
            const isPast = key < today;
            return (
              <div key={idx}
                onClick={() => setSelectedDay(key)}
                className={`min-h-[96px] border-r border-b border-slate-100 p-1.5 cursor-pointer hover:bg-amber-50/40 transition ${isToday ? 'bg-amber-50' : ''}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-xs font-semibold ${isToday ? 'bg-amber-500 text-white rounded-full w-5 h-5 flex items-center justify-center' : isPast ? 'text-slate-400' : 'text-slate-700'}`}>
                    {cell.getDate()}
                  </span>
                  {events.length > 0 && <span className="text-[10px] text-slate-400">{events.length}</span>}
                </div>
                <div className="space-y-0.5">
                  {events.slice(0, 4).map((ev, i) => {
                    const proj = projectById[ev.project_id];
                    const isM = ev.type === 'milestone';
                    return (
                      <div key={i}
                        className={`flex items-center gap-1 text-[10px] px-1 py-0.5 rounded truncate ${isM ? MILESTONE_STATUS_COLORS[ev.status] || MILESTONE_STATUS_COLORS.pending : TASK_STATUS_COLORS[ev.status] || TASK_STATUS_COLORS.todo}`}>
                        {isM ? <Flag className="w-2.5 h-2.5 shrink-0" /> : <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${TASK_STATUS_DOT[ev.status] || 'bg-slate-400'}`} />}
                        <span className="truncate">{ev.title}</span>
                      </div>
                    );
                  })}
                  {events.length > 4 && <div className="text-[10px] text-slate-400 pl-1">+{events.length - 4} more</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected day drawer */}
      {selectedDay && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setSelectedDay(null)}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="relative w-full max-w-md bg-white h-full shadow-xl overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
              <div>
                <div className="text-xs text-slate-400 uppercase tracking-wide">Events on</div>
                <div className="font-semibold text-slate-800">{new Date(selectedDay).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</div>
              </div>
              <button onClick={() => setSelectedDay(null)} className="p-1.5 hover:bg-slate-100 rounded text-slate-500"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 space-y-2">
              {selectedEvents.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">No events on this day.</p>
              ) : (
                selectedEvents
                  .sort((a, b) => (a.type === 'milestone' ? -1 : 1) - (b.type === 'milestone' ? -1 : 1))
                  .map(ev => {
                    const proj = projectById[ev.project_id];
                    const isM = ev.type === 'milestone';
                    return (
                      <Link key={`${ev.type}-${ev.id}`} to={`/projects/${ev.project_id}`}
                        onClick={() => setSelectedDay(null)}
                        className={`block rounded-lg border p-3 hover:shadow-sm transition ${isM ? MILESTONE_STATUS_COLORS[ev.status] || MILESTONE_STATUS_COLORS.pending : TASK_STATUS_COLORS[ev.status] || TASK_STATUS_COLORS.todo}`}>
                        <div className="flex items-center gap-2">
                          {isM ? <Flag className="w-4 h-4" /> : <CheckSquare className="w-4 h-4" />}
                          <span className="font-semibold text-sm text-slate-800 flex-1 truncate">{ev.title}</span>
                          <span className="text-[10px] uppercase font-bold opacity-70">{isM ? 'Milestone' : 'Task'}</span>
                        </div>
                        <div className="text-xs text-slate-500 mt-1 flex items-center gap-2">
                          {proj && <span>{proj.code} · {proj.name}</span>}
                          <span className="opacity-60">· {ev.status}</span>
                        </div>
                      </Link>
                    );
                  })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}