import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { formatDate } from '@/lib/constants';
import { computeDependencyImpact, toDateStr } from '@/lib/dependencies';
import { Plus, CheckSquare, AlertTriangle, X, Pencil, Save } from 'lucide-react';

const STATUS_COLORS = {
  todo:        'bg-slate-100 text-slate-600',
  in_progress: 'bg-blue-100 text-blue-700',
  review:      'bg-purple-100 text-purple-700',
  done:        'bg-emerald-100 text-emerald-700',
  blocked:     'bg-red-100 text-red-700',
};

const PRIORITY_COLORS = {
  low:      'bg-slate-100 text-slate-600',
  medium:   'bg-blue-100 text-blue-700',
  high:     'bg-amber-100 text-amber-800',
  critical: 'bg-red-100 text-red-700',
};

export default function TabTasks({ projectId }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [newTask, setNewTask] = useState({ title: '', priority: 'medium', assignee: '', start_date: '', due_date: '', predecessor_ids: [] });
  const [editForm, setEditForm] = useState({});

  useEffect(() => { loadTasks(); }, [projectId]);

  async function loadTasks() {
    setLoading(true);
    const t = await base44.entities.Task.filter({ project_id: projectId }, 'start_date', 200);
    setTasks(t);
    setLoading(false);
  }

  async function createTask(e) {
    e.preventDefault();
    if (!newTask.title.trim()) return;
    await base44.entities.Task.create({ ...newTask, project_id: projectId, status: 'todo' });
    setNewTask({ title: '', priority: 'medium', assignee: '', start_date: '', due_date: '', predecessor_ids: [] });
    setAdding(false);
    loadTasks();
  }

  async function updateStatus(task, status) {
    await base44.entities.Task.update(task.id, { status });
    loadTasks();
  }

  function startEdit(task) {
    setEditingId(task.id);
    setEditForm({
      title: task.title,
      assignee: task.assignee || '',
      start_date: task.start_date || '',
      due_date: task.due_date || '',
      predecessor_ids: task.predecessor_ids || [],
      priority: task.priority,
      progress: task.progress || 0,
    });
  }

  async function saveEdit(task) {
    await base44.entities.Task.update(task.id, editForm);
    setEditingId(null);
    loadTasks();
  }

  function togglePredecessor(taskId, predId) {
    setEditForm(f => {
      const ids = f.predecessor_ids || [];
      return {
        ...f,
        predecessor_ids: ids.includes(predId)
          ? ids.filter(id => id !== predId)
          : [...ids, predId],
      };
    });
  }

  function toggleNewPredecessor(predId) {
    setNewTask(f => {
      const ids = f.predecessor_ids || [];
      return {
        ...f,
        predecessor_ids: ids.includes(predId)
          ? ids.filter(id => id !== predId)
          : [...ids, predId],
      };
    });
  }

  const impact = computeDependencyImpact(tasks);
  const byId = Object.fromEntries(tasks.map(t => [t.id, t]));

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
        <form onSubmit={createTask} className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input value={newTask.title} onChange={e => setNewTask(f => ({ ...f, title: e.target.value }))}
              placeholder="Task title *" className={inp + ' md:col-span-2'} required />
            <select value={newTask.priority} onChange={e => setNewTask(f => ({ ...f, priority: e.target.value }))} className={inp}>
              {['low', 'medium', 'high', 'critical'].map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <input value={newTask.assignee} onChange={e => setNewTask(f => ({ ...f, assignee: e.target.value }))}
              placeholder="Assignee" className={inp} />
            <input type="date" value={newTask.start_date} onChange={e => setNewTask(f => ({ ...f, start_date: e.target.value }))} className={inp} placeholder="Start Date" />
            <input type="date" value={newTask.due_date} onChange={e => setNewTask(f => ({ ...f, due_date: e.target.value }))} className={inp} />
          </div>
          {tasks.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-600 mb-1">Predecessors (must finish before this starts):</p>
              <div className="flex flex-wrap gap-2">
                {tasks.map(t => (
                  <label key={t.id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input type="checkbox"
                      checked={(newTask.predecessor_ids || []).includes(t.id)}
                      onChange={() => toggleNewPredecessor(t.id)}
                      className="accent-amber-500" />
                    <span className="text-slate-700">{t.title}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-2">
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
                <th className="px-4 py-3 text-left">Start</th>
                <th className="px-4 py-3 text-left">Due</th>
                <th className="px-4 py-3 text-left">Predecessors</th>
                <th className="px-4 py-3 text-left">Progress</th>
                <th className="px-4 py-3 text-left"></th>
              </tr>
            </thead>
            <tbody>
              {tasks.map(t => {
                const dep = impact[t.id] || {};
                const isDelayed = dep.delayed;
                const isEditing = editingId === t.id;

                return (
                  <tr key={t.id} className={`border-t border-slate-100 hover:bg-slate-50 ${isDelayed ? 'bg-red-50' : ''}`}>
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {isEditing ? (
                        <input value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
                          className={inp} />
                      ) : (
                        <div className="flex items-center gap-1.5">
                          {isDelayed && (
                            <span title={`Should start no earlier than ${toDateStr(dep.earliestStart)}`}>
                              <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                            </span>
                          )}
                          {t.title}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <select value={t.status} onChange={e => updateStatus(t, e.target.value)}
                        className={`text-xs px-2 py-0.5 rounded font-semibold border-0 cursor-pointer ${STATUS_COLORS[t.status]}`}>
                        {['todo', 'in_progress', 'review', 'done', 'blocked'].map(s => (
                          <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <select value={editForm.priority} onChange={e => setEditForm(f => ({ ...f, priority: e.target.value }))} className={inp}>
                          {['low', 'medium', 'high', 'critical'].map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                      ) : (
                        <span className={`text-xs px-2 py-0.5 rounded font-semibold ${PRIORITY_COLORS[t.priority]}`}>
                          {t.priority}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {isEditing ? (
                        <input value={editForm.assignee} onChange={e => setEditForm(f => ({ ...f, assignee: e.target.value }))}
                          placeholder="Assignee" className={inp} />
                      ) : (
                        t.assignee || '—'
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                      {isEditing ? (
                        <input type="date" value={editForm.start_date} onChange={e => setEditForm(f => ({ ...f, start_date: e.target.value }))} className={inp} />
                      ) : (
                        <span className={isDelayed ? 'text-red-600 font-semibold' : ''}>
                          {formatDate(t.start_date)}
                          {isDelayed && dep.earliestStart && (
                            <div className="text-xs text-red-500">→ {toDateStr(dep.earliestStart)}</div>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                      {isEditing ? (
                        <input type="date" value={editForm.due_date} onChange={e => setEditForm(f => ({ ...f, due_date: e.target.value }))} className={inp} />
                      ) : formatDate(t.due_date)}
                    </td>
                    <td className="px-4 py-3 text-slate-600 max-w-[160px]">
                      {isEditing ? (
                        <div className="space-y-1">
                          {tasks.filter(ot => ot.id !== t.id).map(ot => (
                            <label key={ot.id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                              <input type="checkbox"
                                checked={(editForm.predecessor_ids || []).includes(ot.id)}
                                onChange={() => togglePredecessor(t.id, ot.id)}
                                className="accent-amber-500" />
                              <span className="truncate">{ot.title}</span>
                            </label>
                          ))}
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {(t.predecessor_ids || []).length === 0 ? (
                            <span className="text-slate-400 text-xs">—</span>
                          ) : (
                            (t.predecessor_ids || []).map(pid => (
                              <span key={pid} className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded truncate max-w-[120px]">
                                {byId[pid]?.title || pid.slice(0, 8)}
                              </span>
                            ))
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 w-28">
                      {isEditing ? (
                        <input type="number" min="0" max="100" value={editForm.progress}
                          onChange={e => setEditForm(f => ({ ...f, progress: Number(e.target.value) }))}
                          className={inp} />
                      ) : (
                        <div className="flex items-center gap-1">
                          <div className="flex-1 bg-slate-200 rounded-full h-1.5">
                            <div className="bg-amber-500 h-1.5 rounded-full" style={{ width: `${t.progress || 0}%` }} />
                          </div>
                          <span className="text-xs text-slate-500">{t.progress || 0}%</span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <div className="flex gap-1">
                          <button onClick={() => saveEdit(t)} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded" title="Save">
                            <Save className="w-4 h-4" />
                          </button>
                          <button onClick={() => setEditingId(null)} className="p-1 text-slate-400 hover:bg-slate-100 rounded" title="Cancel">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => startEdit(t)} className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded" title="Edit">
                          <Pencil className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Delay warning summary */}
      {Object.values(impact).some(d => d.delayed) && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <strong>Scheduling conflicts detected.</strong> Some tasks start before their predecessors finish.
            The suggested earliest start dates are shown in red. Edit the tasks to fix the dates.
          </div>
        </div>
      )}
    </div>
  );
}

const inp = 'border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white w-full';
function Spinner() {
  return <div className="flex justify-center py-12"><div className="w-7 h-7 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;
}