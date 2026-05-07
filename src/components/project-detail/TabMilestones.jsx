import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { formatDate } from '@/lib/constants';
import { Plus, Flag } from 'lucide-react';

const STATUS_COLORS = {
  pending: 'bg-slate-100 text-slate-600',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-emerald-100 text-emerald-700',
  overdue: 'bg-red-100 text-red-700',
};

export default function TabMilestones({ projectId }) {
  const [milestones, setMilestones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: '', planned_date: '', weight: '' });

  useEffect(() => { load(); }, [projectId]);

  async function load() {
    setLoading(true);
    const m = await base44.entities.Milestone.filter({ project_id: projectId }, 'planned_date', 100);
    setMilestones(m);
    setLoading(false);
  }

  async function create(e) {
    e.preventDefault();
    if (!form.title.trim()) return;
    await base44.entities.Milestone.create({ ...form, project_id: projectId, weight: Number(form.weight) || 0 });
    setForm({ title: '', planned_date: '', weight: '' });
    setAdding(false);
    load();
  }

  async function updateStatus(m, status) {
    await base44.entities.Milestone.update(m.id, { status });
    load();
  }

  if (loading) return <Spinner />;

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-slate-500">{milestones.length} milestone{milestones.length !== 1 ? 's' : ''}</p>
        <button onClick={() => setAdding(v => !v)}
          className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded">
          <Plus className="w-4 h-4" /> Add Milestone
        </button>
      </div>

      {adding && (
        <form onSubmit={create} className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            placeholder="Milestone title *" className={inp} required />
          <input type="date" value={form.planned_date} onChange={e => setForm(f => ({ ...f, planned_date: e.target.value }))} className={inp} />
          <input type="number" value={form.weight} onChange={e => setForm(f => ({ ...f, weight: e.target.value }))}
            placeholder="Weight %" className={inp} min="0" max="100" />
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-2 bg-amber-500 text-slate-900 font-semibold text-sm rounded hover:bg-amber-400">Save</button>
            <button type="button" onClick={() => setAdding(false)} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded hover:bg-slate-100">Cancel</button>
          </div>
        </form>
      )}

      {milestones.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <Flag className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No milestones yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {milestones.map(m => (
            <div key={m.id} className="bg-white rounded-lg shadow-sm px-4 py-3 flex flex-wrap items-center gap-4">
              <Flag className="w-4 h-4 text-amber-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-800 text-sm">{m.title}</div>
                {m.planned_date && <div className="text-xs text-slate-500">Planned: {formatDate(m.planned_date)}</div>}
              </div>
              {m.weight > 0 && <span className="text-xs text-slate-500">{m.weight}%</span>}
              <select value={m.status} onChange={e => updateStatus(m, e.target.value)}
                className={`text-xs px-2 py-1 rounded font-semibold border-0 cursor-pointer ${STATUS_COLORS[m.status] || 'bg-slate-100 text-slate-600'}`}>
                {['pending','in_progress','completed','overdue'].map(s => (
                  <option key={s} value={s}>{s.replace(/_/g,' ')}</option>
                ))}
              </select>
              {m.progress > 0 && (
                <div className="flex items-center gap-1 w-24">
                  <div className="flex-1 bg-slate-200 rounded-full h-1.5">
                    <div className="bg-amber-500 h-1.5 rounded-full" style={{ width: `${m.progress}%` }} />
                  </div>
                  <span className="text-xs text-slate-500">{m.progress}%</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const inp = 'border border-slate-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white w-full';
function Spinner() {
  return <div className="flex justify-center py-12"><div className="w-7 h-7 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;
}