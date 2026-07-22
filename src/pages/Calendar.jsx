import { useState, useMemo, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useEntityList } from '@/hooks/useEntity';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { CalendarDays, ChevronLeft, ChevronRight, CheckSquare, Filter, X, AlertTriangle } from 'lucide-react';
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

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function ymd(d) {
  return toLocalDate(d);
}

export default function Calendar() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: projects = [], isLoading: pLoading, isError: pError, refetch: refetchP } = useEntityList('Project', null, '-updated_date', 500);
  const { data: tasks = [], isLoading: tLoading, isError: tError, refetch: refetchT } = useEntityList('Task', null, '-updated_date', 1000);
  const loading = pLoading || tLoading;
  const isError = pError || tError;
  const refetch = () => { refetchP(); refetchT(); };
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [filterProject, setFilterProject] = useState('');
  const [selectedDay, setSelectedDay] = useState(null);

  // Real-time: invalidate the Task query whenever tasks change (create / update /
  // delete) so the calendar stays in sync with the Tasks tab without a manual
  // refresh. Project query is also watched for project renames.
  useEffect(() => {
    const unsubs = [
      base44.entities.Project?.subscribe?.(() => queryClient.invalidateQueries({ queryKey: ['Project'] })),
      base44.entities.Task?.subscribe?.(() => queryClient.invalidateQueries({ queryKey: ['Task'] })),
    ];
    return () => { unsubs.forEach(u => { try { u && u(); } catch (_) {} }); };
  }, [queryClient]);

  const projectById = useMemo(() => Object.fromEntries(projects.map(p => [p.id, p])), [projects]);

  // Build task events keyed by due date
  const eventsByDate = useMemo(() => {
    const map = {};
    function add(date, ev) {
      if (!date) return;
      const key = date.slice(0, 10);
      if (!map[key]) map[key] = [];
      map[key].push(ev);
    }
    tasks.forEach(t => {
      if (filterProject && t.project_id !== filterProject) return;
      add(t.due_date, { type: 'task', id: t.id, title: t.title, status: t.status, project_id: t.project_id, date: t.due_date });
    });
    return map;
  }, [tasks, filterProject]);

  // Month grid
  const grid = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const first = new Date(year, month, 1);
    const startDay = first.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < startDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [cursor]);

  const today = ymd(new Date());
  const monthLabel = cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const totalEvents = Object.values(eventsByDate).reduce((s, a) => s + a.length, 0);

  function prevMonth() { setCursor(d => new Date(d.getFullYear(), d.getMonth() - 1, 1)); }
  function nextMonth() { setCursor(d => new Date(d.getFullYear(), d.getMonth() + 1, 1)); }
  function goToday() { const d = new Date(); d.setDate(1); setCursor(d); }

  function openTask(ev) {
    setSelectedDay(null);
    navigate(`/projects/${ev.project_id}?tab=tasks&task=${ev.id}`);
  }

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
          <h1 className="text-xl font-bold text-slate-800">Task Calendar</h1>
          <span className="text-xs text-slate-400">{totalEvents} tasks</span>
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
        {filterProject && (
          <button onClick={() => setFilterProject('')}
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
                    const cls = TASK_STATUS_COLORS[ev.status] || TASK_STATUS_COLORS.todo;
                    return (
                      <button key={i} onClick={(e) => { e.stopPropagation(); openTask(ev); }}
                        className={`w-full flex items-center gap-1 text-[10px] px-1 py-0.5 rounded truncate text-left ${cls}`}
                        title={ev.title}>
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${TASK_STATUS_DOT[ev.status] || 'bg-slate-400'}`} />
                        <span className="truncate">{ev.title}</span>
                      </button>
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
                <div className="text-xs text-slate-400 uppercase tracking-wide">Tasks on</div>
                <div className="font-semibold text-slate-800">{new Date(selectedDay).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</div>
              </div>
              <button onClick={() => setSelectedDay(null)} className="p-1.5 hover:bg-slate-100 rounded text-slate-500"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 space-y-2">
              {selectedEvents.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">No tasks on this day.</p>
              ) : (
                selectedEvents.map(ev => {
                  const proj = projectById[ev.project_id];
                  const cls = TASK_STATUS_COLORS[ev.status] || TASK_STATUS_COLORS.todo;
                  return (
                    <Link key={ev.id} to={`/projects/${ev.project_id}?tab=tasks&task=${ev.id}`}
                      onClick={() => setSelectedDay(null)}
                      className={`block rounded-lg border p-3 hover:shadow-sm transition ${cls}`}>
                      <div className="flex items-center gap-2">
                        <CheckSquare className="w-4 h-4" />
                        <span className="font-semibold text-sm text-slate-800 flex-1 truncate">{ev.title}</span>
                        <span className="text-[10px] uppercase font-bold opacity-70">Task</span>
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