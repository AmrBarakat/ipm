import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import {
  Activity as ActivityIcon, RefreshCw, Filter, Search,
  CheckCircle2, DollarSign, ShoppingCart, Flag, GitBranch, FileText,
  AlertTriangle, FileBarChart, FolderOpen, Package, Bell, Cpu,
} from 'lucide-react';

const ENTITY_ICON = {
  Task: CheckCircle2, Expense: DollarSign, PurchaseOrder: ShoppingCart,
  Milestone: Flag, ChangeOrder: GitBranch, Invoice: FileText,
  Risk: AlertTriangle, Report: FileBarChart, Project: FolderOpen,
  BOMItem: Package, Document: FileText, Notification: Bell,
};
const ACTION_STYLE = {
  created: 'bg-blue-100 text-blue-700',
  completed: 'bg-emerald-100 text-emerald-700',
  updated: 'bg-slate-100 text-slate-600',
  auto_completed: 'bg-emerald-100 text-emerald-700',
  auto_invoiced: 'bg-amber-100 text-amber-700',
  progress_synced: 'bg-indigo-100 text-indigo-700',
  delay_alerted: 'bg-red-100 text-red-700',
  deleted: 'bg-red-100 text-red-700',
  generated: 'bg-purple-100 text-purple-700',
};
const ACTION_LABEL = {
  created: 'Created', completed: 'Completed', updated: 'Updated',
  auto_completed: 'Auto-completed', auto_invoiced: 'Auto-invoiced',
  progress_synced: 'Progress synced', delay_alerted: 'Delay alerted',
  deleted: 'Deleted', generated: 'Generated',
};

function relTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}
function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' });
}

export default function Activity() {
  const [logs, setLogs] = useState([]);
  const [projects, setProjects] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [projectFilter, setProjectFilter] = useState('all');
  const [entityFilter, setEntityFilter] = useState('all');
  const [search, setSearch] = useState('');

  async function load() {
    setRefreshing(true);
    try {
      const [entries, projs] = await Promise.all([
        base44.entities.AuditLog.list('-created_date', 200),
        base44.entities.Project.list('-updated_date', 500),
      ]);
      setLogs(entries || []);
      const map = {};
      (projs || []).forEach((p) => { map[p.id] = p; });
      setProjects(map);
    } catch (_) {
      setLogs([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { load(); }, []);

  // Live: new audit rows appear at the top without a manual refresh.
  useEffect(() => {
    const unsub = base44.entities.AuditLog?.subscribe?.((ev) => {
      if (ev?.type === 'create' && ev?.data) {
        setLogs((prev) => [ev.data, ...prev.filter((l) => l.id !== ev.data.id)].slice(0, 300));
      }
    });
    return () => { try { unsub && unsub(); } catch (_) {} };
  }, []);

  const entityTypes = useMemo(() => {
    const s = new Set(logs.map((l) => l.entity_type).filter(Boolean));
    return ['all', ...Array.from(s).sort()];
  }, [logs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((l) => {
      if (projectFilter !== 'all' && l.project_id !== projectFilter) return false;
      if (entityFilter !== 'all' && l.entity_type !== entityFilter) return false;
      if (q && !`${l.summary || ''} ${l.actor || ''} ${l.entity_type || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [logs, projectFilter, entityFilter, search]);

  const groups = useMemo(() => {
    const g = {};
    filtered.forEach((l) => { const k = dayLabel(l.created_date); (g[k] ||= []).push(l); });
    return Object.entries(g);
  }, [filtered]);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <ActivityIcon className="w-6 h-6 text-amber-500" /> Activity
          </h1>
          <p className="text-sm text-slate-500">A chronological feed of changes across all your projects.</p>
        </div>
        <button onClick={load} disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-100 text-slate-600 font-medium disabled:opacity-60">
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-6 bg-white border border-slate-200 rounded-lg p-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search activity…"
            className="pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-400 w-56" />
        </div>
        <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}
          className="px-2.5 py-1.5 text-sm border border-slate-200 rounded-md bg-white">
          <option value="all">All projects</option>
          {Object.values(projects).map((p) => (
            <option key={p.id} value={p.id}>{p.code} · {p.name}</option>
          ))}
        </select>
        <select value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)}
          className="px-2.5 py-1.5 text-sm border border-slate-200 rounded-md bg-white">
          {entityTypes.map((t) => (
            <option key={t} value={t}>{t === 'all' ? 'All types' : t}</option>
          ))}
        </select>
        <span className="ml-auto text-xs text-slate-400 flex items-center gap-1">
          <Filter className="w-3.5 h-3.5" /> {filtered.length} events
        </span>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-slate-400">
          <ActivityIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No activity yet. Changes to tasks, expenses, POs, milestones, and change orders will appear here in real time.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map(([day, items]) => (
            <div key={day}>
              <div className="sticky top-0 z-10 bg-slate-50/90 backdrop-blur px-1 py-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                {day}
              </div>
              <div className="space-y-2">
                {items.map((l) => {
                  const Icon = ENTITY_ICON[l.entity_type] || (l.actor === 'system' ? Cpu : ActivityIcon);
                  const proj = projects[l.project_id];
                  return (
                    <div key={l.id} className="flex gap-3 bg-white border border-slate-200 rounded-lg p-3 hover:shadow-sm transition">
                      <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 shrink-0">
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`px-1.5 py-0.5 rounded text-[11px] font-semibold ${ACTION_STYLE[l.action] || 'bg-slate-100 text-slate-600'}`}>
                            {ACTION_LABEL[l.action] || l.action}
                          </span>
                          {proj && (
                            <Link to={`/projects/${proj.id}`} className="text-xs font-medium text-amber-600 hover:underline">
                              {proj.code} · {proj.name}
                            </Link>
                          )}
                          <span className="text-xs text-slate-400">·</span>
                          <span className="text-xs text-slate-500">{l.entity_type}</span>
                        </div>
                        <p className="text-sm text-slate-700 mt-1">{l.summary || '—'}</p>
                        <div className="flex items-center gap-2 mt-1.5 text-xs text-slate-400">
                          <span className="inline-flex items-center gap-1">
                            {l.actor === 'system' ? <Cpu className="w-3 h-3" /> : null}
                            {l.actor || '—'}
                          </span>
                          <span>·</span>
                          <span>{relTime(l.created_date)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}