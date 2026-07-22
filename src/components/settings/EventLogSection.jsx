import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { ScrollText, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';

const ACTION_STYLES = {
  created: 'bg-blue-100 text-blue-700',
  updated: 'bg-slate-100 text-slate-600',
  auto_completed: 'bg-emerald-100 text-emerald-700',
  auto_invoiced: 'bg-amber-100 text-amber-700',
  progress_synced: 'bg-indigo-100 text-indigo-700',
  delay_alerted: 'bg-red-100 text-red-700',
};

const ACTION_LABELS = {
  created: 'Created',
  updated: 'Updated',
  auto_completed: 'Auto-completed',
  auto_invoiced: 'Auto-invoiced',
  progress_synced: 'Progress synced',
  delay_alerted: 'Delay alerted',
};

function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

export default function EventLogSection() {
  const [logs, setLogs] = useState([]);
  const [projects, setProjects] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Collapsed by default — the log is reference material, not primary content.
  const [open, setOpen] = useState(false);

  async function load() {
    setRefreshing(true);
    try {
      const [entries, projs] = await Promise.all([
        base44.entities.AuditLog.list('-created_date', 50),
        base44.entities.Project.list(),
      ]);
      setLogs(entries || []);
      const map = {};
      (projs || []).forEach(p => { map[p.id] = p; });
      setProjects(map);
    } catch (_) {
      setLogs([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { if (open) load(); }, [open]);

  return (
    <section className="bg-white rounded-lg shadow-sm border border-slate-200 p-5 mb-4">
      <div className="flex items-center gap-3">
        <button onClick={() => setOpen(v => !v)} className="flex items-center gap-3 flex-1 text-left">
          {open ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
          <div className="w-8 h-8 rounded-md bg-slate-100 flex items-center justify-center text-slate-500 shrink-0">
            <ScrollText className="w-4 h-4" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-800">Event Log</h2>
            <p className="text-xs text-slate-500">Recent automated and user actions across your projects. Click to {open ? 'collapse' : 'expand'}.</p>
          </div>
        </button>
        {open && (
          <button onClick={load} disabled={refreshing}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-slate-200 rounded hover:bg-slate-100 text-slate-600 font-medium disabled:opacity-60">
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
          </button>
        )}
      </div>

      {open && (
        loading ? (
          <div className="flex justify-center py-10 mt-2">
            <div className="w-7 h-7 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" />
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-10 text-slate-400 mt-2">
            <ScrollText className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No events recorded yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-xs">
              <thead className="text-slate-500 uppercase border-b border-slate-200">
                <tr>
                  <th className="text-left py-2 px-2">When</th>
                  <th className="text-left py-2 px-2">Project</th>
                  <th className="text-left py-2 px-2">Actor</th>
                  <th className="text-left py-2 px-2">Action</th>
                  <th className="text-left py-2 px-2">Entity</th>
                  <th className="text-left py-2 px-2">Summary</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => {
                  const proj = projects[log.project_id];
                  return (
                    <tr key={log.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-2 px-2 text-slate-500 whitespace-nowrap">{fmtDateTime(log.created_date)}</td>
                      <td className="py-2 px-2 text-slate-700 whitespace-nowrap">{proj ? proj.code : '—'}</td>
                      <td className="py-2 px-2 text-slate-600">{log.actor || '—'}</td>
                      <td className="py-2 px-2">
                        <span className={`px-1.5 py-0.5 rounded font-semibold ${ACTION_STYLES[log.action] || 'bg-slate-100 text-slate-600'}`}>
                          {ACTION_LABELS[log.action] || log.action}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-slate-600">{log.entity_type || '—'}</td>
                      <td className="py-2 px-2 text-slate-700">{log.summary || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </section>
  );
}