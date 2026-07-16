import { useState, useMemo } from 'react';
import { useEntityList } from '@/hooks/useEntity';
import { Users, AlertTriangle, TrendingUp, Clock, ChevronDown, ChevronRight } from 'lucide-react';

const CAPACITY_HOURS_PER_WEEK = 40; // assumed weekly capacity per person

export default function Resources() {
  const { data: tasks = [], isLoading: tLoading, isError: tError, refetch: refetchT } = useEntityList('Task', null, '-created_date', 1000);
  const { data: wbsItems = [], isLoading: wLoading, isError: wError, refetch: refetchW } = useEntityList('WBSItem', null, '-created_date', 1000);
  const { data: projects = [], isLoading: pLoading, isError: pError, refetch: refetchP } = useEntityList('Project', null, '-updated_date', 200);
  const loading = tLoading || wLoading || pLoading;
  const isError = tError || wError || pError;
  const refetch = () => { refetchT(); refetchW(); refetchP(); };
  const [expanded, setExpanded] = useState({});

  const projectMap = useMemo(() => Object.fromEntries(projects.map(p => [p.id, p])), [projects]);

  // Build per-person resource data from Tasks + WBS Items
  const resourceMap = useMemo(() => {
    const map = {};

    function ensure(name) {
      if (!map[name]) map[name] = { name, estimatedHours: 0, actualHours: 0, taskCount: 0, openTasks: 0, criticalTasks: 0, projects: new Set(), items: [] };
    }

    tasks.forEach(t => {
      const person = (t.assignee || '').trim();
      if (!person) return;
      ensure(person);
      map[person].estimatedHours += t.estimate_hours || 0;
      map[person].actualHours += t.actual_hours || 0;
      map[person].taskCount++;
      if (t.status !== 'done') map[person].openTasks++;
      if (t.priority === 'critical') map[person].criticalTasks++;
      if (t.project_id) map[person].projects.add(t.project_id);
      map[person].items.push({ type: 'task', label: t.title, status: t.status, priority: t.priority, projectId: t.project_id, estimatedHours: t.estimate_hours || 0 });
    });

    wbsItems.forEach(w => {
      const person = (w.assignee || '').trim();
      if (!person) return;
      ensure(person);
      map[person].estimatedHours += w.planned_hours || 0;
      map[person].actualHours += w.actual_hours || 0;
      map[person].taskCount++;
      if (w.status !== 'completed') map[person].openTasks++;
      if (w.project_id) map[person].projects.add(w.project_id);
      map[person].items.push({ type: 'wbs', label: `[${w.wbs_code}] ${w.name}`, status: w.status, projectId: w.project_id, estimatedHours: w.planned_hours || 0 });
    });

    return map;
  }, [tasks, wbsItems]);

  const resources = useMemo(() =>
    Object.values(resourceMap)
      .map(r => ({
        ...r,
        projects: [...r.projects],
        utilizationPct: CAPACITY_HOURS_PER_WEEK > 0
          ? Math.min(Math.round((r.estimatedHours / CAPACITY_HOURS_PER_WEEK) * 100), 200)
          : 0,
        isBottleneck: r.openTasks > 5 || r.estimatedHours > CAPACITY_HOURS_PER_WEEK * 1.2 || r.criticalTasks > 0,
      }))
      .sort((a, b) => b.estimatedHours - a.estimatedHours),
    [resourceMap]
  );

  const totalPeople = resources.length;
  const overloaded = resources.filter(r => r.estimatedHours > CAPACITY_HOURS_PER_WEEK).length;
  const bottlenecks = resources.filter(r => r.isBottleneck).length;
  const totalHours = resources.reduce((s, r) => s + r.estimatedHours, 0);

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" />
    </div>
  );

  if (isError) return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <AlertTriangle className="w-8 h-8 text-red-400" />
      <p className="text-sm text-red-500">Failed to load resources data.</p>
      <button onClick={refetch} className="px-3 py-1.5 text-xs font-semibold border border-red-300 text-red-600 rounded hover:bg-red-50">Retry</button>
    </div>
  );

  if (resources.length === 0) return (
    <div className="text-center py-20 text-slate-400">
      <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
      <p className="text-sm">No assignees found. Assign team members to tasks or WBS items to see resource data.</p>
    </div>
  );

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
          <Users className="text-amber-500 w-6 h-6" /> Resource Management
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">Team workload across all projects · Assumed {CAPACITY_HOURS_PER_WEEK}h/week capacity per person</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Team Members" value={totalPeople} icon={<Users className="w-5 h-5" />} color="border-blue-400" />
        <KpiCard label="Total Est. Hours" value={`${totalHours.toLocaleString()}h`} icon={<Clock className="w-5 h-5" />} color="border-amber-400" />
        <KpiCard label="Overloaded" value={overloaded} sub={`>${CAPACITY_HOURS_PER_WEEK}h assigned`} icon={<TrendingUp className="w-5 h-5" />} color="border-red-400" />
        <KpiCard label="Bottlenecks" value={bottlenecks} sub="critical tasks or overload" icon={<AlertTriangle className="w-5 h-5" />} color="border-purple-400" />
      </div>

      {/* Resource Table */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200">
          <h2 className="font-semibold text-slate-700 text-sm">Team Workload Breakdown</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 uppercase text-xs border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left w-8"></th>
                <th className="px-4 py-3 text-left">Person</th>
                <th className="px-4 py-3 text-right">Est. Hours</th>
                <th className="px-4 py-3 text-right">Actual Hours</th>
                <th className="px-4 py-3 text-right">Open Tasks</th>
                <th className="px-4 py-3 text-right">Projects</th>
                <th className="px-4 py-3 text-left">Utilization</th>
                <th className="px-4 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {resources.map(r => {
                const isExpanded = expanded[r.name];
                const util = r.utilizationPct;
                const utilColor = util > 120 ? 'bg-red-500' : util > 90 ? 'bg-amber-500' : 'bg-emerald-500';
                const rowBg = r.isBottleneck ? 'bg-red-50' : '';

                return (
                  <>
                    <tr
                      key={r.name}
                      className={`border-t border-slate-100 hover:bg-slate-50 cursor-pointer ${rowBg}`}
                      onClick={() => setExpanded(prev => ({ ...prev, [r.name]: !prev[r.name] }))}
                    >
                      <td className="pl-4 pr-2 py-3 text-slate-400">
                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-600 shrink-0">
                            {r.name.charAt(0).toUpperCase()}
                          </div>
                          <span className="font-semibold text-slate-800">{r.name}</span>
                          {r.criticalTasks > 0 && (
                            <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-semibold">{r.criticalTasks} critical</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-700">{r.estimatedHours}h</td>
                      <td className="px-4 py-3 text-right text-slate-600">{r.actualHours > 0 ? `${r.actualHours}h` : '—'}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{r.openTasks}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{r.projects.length}</td>
                      <td className="px-4 py-3 w-48">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                            <div
                              className={`h-2 rounded-full transition-all ${utilColor}`}
                              style={{ width: `${Math.min(util, 100)}%` }}
                            />
                          </div>
                          <span className={`text-xs font-semibold w-10 text-right ${util > 100 ? 'text-red-600' : 'text-slate-600'}`}>
                            {util}%
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {r.estimatedHours > CAPACITY_HOURS_PER_WEEK * 1.2 ? (
                          <span className="text-xs px-2 py-0.5 rounded font-semibold bg-red-100 text-red-700">Overloaded</span>
                        ) : r.estimatedHours > CAPACITY_HOURS_PER_WEEK * 0.8 ? (
                          <span className="text-xs px-2 py-0.5 rounded font-semibold bg-amber-100 text-amber-700">High Load</span>
                        ) : r.estimatedHours === 0 ? (
                          <span className="text-xs px-2 py-0.5 rounded font-semibold bg-slate-100 text-slate-500">Untracked</span>
                        ) : (
                          <span className="text-xs px-2 py-0.5 rounded font-semibold bg-emerald-100 text-emerald-700">Available</span>
                        )}
                      </td>
                    </tr>

                    {/* Expanded detail rows */}
                    {isExpanded && r.items.map((item, i) => {
                      const proj = projectMap[item.projectId];
                      return (
                        <tr key={`${r.name}-${i}`} className="border-t border-slate-50 bg-slate-50/60">
                          <td className="pl-4 pr-2 py-2" />
                          <td className="px-4 py-2 pl-12" colSpan={2}>
                            <div className="text-xs text-slate-700 truncate max-w-xs">{item.label}</div>
                            {proj && <div className="text-xs text-slate-400">{proj.code} · {proj.name}</div>}
                          </td>
                          <td className="px-4 py-2 text-right text-xs text-slate-500">{item.estimatedHours > 0 ? `${item.estimatedHours}h` : '—'}</td>
                          <td className="px-4 py-2" colSpan={3}>
                            <span className={`text-xs px-1.5 py-0.5 rounded capitalize ${
                              item.status === 'done' || item.status === 'completed'
                                ? 'bg-emerald-100 text-emerald-700'
                                : item.status === 'blocked'
                                ? 'bg-red-100 text-red-700'
                                : 'bg-slate-100 text-slate-600'
                            }`}>
                              {(item.status || '').replace(/_/g, ' ')}
                            </span>
                            {item.priority === 'critical' && (
                              <span className="ml-1 text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700">critical</span>
                            )}
                          </td>
                          <td />
                        </tr>
                      );
                    })}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, sub, icon, color }) {
  return (
    <div className={`bg-white rounded-lg shadow-sm p-4 border-l-4 ${color}`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">{label}</div>
          <div className="text-xl font-semibold text-slate-800">{value}</div>
          {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
        </div>
        <div className="text-slate-300 shrink-0 mt-0.5">{icon}</div>
      </div>
    </div>
  );
}