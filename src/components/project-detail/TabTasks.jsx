import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { formatDate } from '@/lib/constants';
import { Plus, CheckSquare } from 'lucide-react';

const STATUS_COLORS = {
  todo: 'bg-slate-100 text-slate-600',
  in_progress: 'bg-blue-100 text-blue-700',
  review: 'bg-purple-100 text-purple-700',
  done: 'bg-emerald-100 text-emerald-700',
  blocked: 'bg-red-100 text-red-700',
};

const PRIORITY_COLORS = {
  low: 'bg-slate-100 text-slate-600',
  medium: 'bg-blue-100 text-blue-700',
  high: 'bg-amber-100 text-amber-800',
  critical: 'bg-red-100 text-red-700',
};

export default function TabTasks({ projectId }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newTask, setNewTask] = useState({ title: '', priority: 'medium', assignee: '', due_date: '' });

  useEffect(() => { loadTasks(); }, [projectId]);

  async function loadTasks() {
    setLoading(true);
    const t = await base44.entities.Task.filter({ project_id: projectId }, '-created_date', 200);
    setTasks(t);
    setLoading(false);
  }

  async function createTask(e) {
    e.preventDefault();
    if (!newTask.title.trim()) return;
    await base44.entities.Task.create({ ...newTask, project_id: projectId, status: 'todo' });
    setNewTask({ title: '', priority: 'medium', assignee: '', due_date: '' });
    setAdding(false);
    loadTasks();
  }

  async function updateStatus(task, status) {
    await base44.entities.Task.update(task.id, { status });
    loadTasks();
  }

  if (loading) return <Spinner />;

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-slate-500">{tasks.length} task{tasks.length !== 1 ? 's' : ''}</p>
        <button onClick={() => setAdding(v => !v)}
          className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded">
          <Plus className="w-4 h-4" /> Add Task
        </button>
      </div>

      {adding && (
        <form onSubmit={createTask} className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4 grid grid-cols-1 md:grid-cols-4 gap-3">
          <input value={newTask.title} onChange={e => setNewTask(f => ({ ...f, title: e.target.value }))}
            placeholder="Task title *" className={inp + ' md:col-span-2'} required />
          <select value={newTask.priority} onChange={e => setNewTask(f => ({ ...f, priority: e.target.value }))} className={inp}>
            {['low','medium','high','critical'].map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <input value={newTask.assignee} onChange={e => setNewTask(f => ({ ...f, assignee: e.target.value }))}
            placeholder="Assignee" className={inp} />
          <input type="date" value={newTask.due_date} onChange={e => setNewTask(f => ({ ...f, due_date: e.target.value }))} className={inp} />
          <div className="md:col-span-3 flex gap-2">
            <button type="submit" className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded">Save</button>
            <button type="button" onClick={() => setAdding(false)} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded hover:bg-slate-100">Cancel</button>
          </div>
        </form>
      )}

      {tasks.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <CheckSquare className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No tasks yet.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left">Title</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Priority</th>
                <th className="px-4 py-3 text-left">Assignee</th>
                <th className="px-4 py-3 text-left">Due Date</th>
                <th className="px-4 py-3 text-left">Progress</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map(t => (
                <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{t.title}</td>
                  <td className="px-4 py-3">
                    <select value={t.status} onChange={e => updateStatus(t, e.target.value)}
                      className={`text-xs px-2 py-0.5 rounded font-semibold border-0 cursor-pointer ${STATUS_COLORS[t.status]}`}>
                      {['todo','in_progress','review','done','blocked'].map(s => (
                        <option key={s} value={s}>{s.replace(/_/g,' ')}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded font-semibold ${PRIORITY_COLORS[t.priority]}`}>
                      {t.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{t.assignee || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(t.due_date)}</td>
                  <td className="px-4 py-3 w-28">
                    <div className="flex items-center gap-1">
                      <div className="flex-1 bg-slate-200 rounded-full h-1.5">
                        <div className="bg-amber-500 h-1.5 rounded-full" style={{ width: `${t.progress || 0}%` }} />
                      </div>
                      <span className="text-xs text-slate-500">{t.progress || 0}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const inp = 'border border-slate-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white w-full';
function Spinner() {
  return <div className="flex justify-center py-12"><div className="w-7 h-7 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;
}