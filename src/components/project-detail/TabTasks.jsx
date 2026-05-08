import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Plus, Pencil, X, Trash2, RefreshCw, Layers } from 'lucide-react';

// Map WBS status -> Task status
const WBS_TO_TASK_STATUS = {
  not_started: 'todo',
  in_progress: 'in_progress',
  completed:   'done',
  blocked:     'blocked',
};
// Map Task status -> WBS status
const TASK_TO_WBS_STATUS = {
  todo:        'not_started',
  in_progress: 'in_progress',
  review:      'in_progress',
  done:        'completed',
  blocked:     'blocked',
};

const COLUMNS = [
  { id: 'todo',        label: 'To Do',       color: 'border-slate-300 bg-slate-50' },
  { id: 'in_progress', label: 'In Progress',  color: 'border-blue-300 bg-blue-50'  },
  { id: 'review',      label: 'Review',       color: 'border-purple-300 bg-purple-50' },
  { id: 'done',        label: 'Done',         color: 'border-emerald-300 bg-emerald-50' },
  { id: 'blocked',     label: 'Blocked',      color: 'border-red-300 bg-red-50'    },
];

const PRIORITY_COLORS = {
  low:      'bg-slate-100 text-slate-500',
  medium:   'bg-blue-100 text-blue-600',
  high:     'bg-amber-100 text-amber-700',
  critical: 'bg-red-100 text-red-700',
};

const inp = 'border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white w-full';

export default function TabTasks({ projectId }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [addingCol, setAddingCol] = useState(null);
  const [newTitle, setNewTitle] = useState('');
  const [newPriority, setNewPriority] = useState('medium');
  const [newAssignee, setNewAssignee] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});

  useEffect(() => { load(); }, [projectId]);

  async function load() {
    setLoading(true);
    const t = await base44.entities.Task.filter({ project_id: projectId }, '-created_date', 300);
    setTasks(t);
    setLoading(false);
  }

  async function createTask(e, colId) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    await base44.entities.Task.create({
      project_id: projectId,
      title: newTitle.trim(),
      priority: newPriority,
      assignee: newAssignee.trim() || undefined,
      status: colId,
    });
    setNewTitle(''); setNewPriority('medium'); setNewAssignee(''); setAddingCol(null);
    load();
  }

  function startEdit(task) {
    setEditingId(task.id);
    setEditForm({ title: task.title, priority: task.priority, assignee: task.assignee || '', description: task.description || '' });
  }

  async function saveEdit(id) {
    await base44.entities.Task.update(id, editForm);
    setEditingId(null); load();
  }

  async function deleteTask(id) {
    if (!confirm('Delete this task?')) return;
    await base44.entities.Task.delete(id); load();
  }

  async function syncFromWBS() {
    setSyncing(true);
    const wbsItems = await base44.entities.WBSItem.filter({ project_id: projectId }, 'wbs_code', 500);
    const existingTasks = await base44.entities.Task.filter({ project_id: projectId }, '-created_date', 500);

    // Index existing tasks by their linked wbs_code (stored in tags field as "wbs:<code>")
    const existingByWbsCode = {};
    existingTasks.forEach(t => {
      const tag = (t.tags || '').split(',').find(x => x.trim().startsWith('wbs:'));
      if (tag) existingByWbsCode[tag.trim().replace('wbs:', '')] = t;
    });

    const ops = [];
    for (const item of wbsItems) {
      const taskStatus = WBS_TO_TASK_STATUS[item.status] || 'todo';
      const existing = existingByWbsCode[item.wbs_code];
      if (existing) {
        // Update status if WBS changed
        if (TASK_TO_WBS_STATUS[existing.status] !== item.status) {
          ops.push(base44.entities.Task.update(existing.id, { status: taskStatus }));
        }
      } else {
        // Create new task from WBS item
        ops.push(base44.entities.Task.create({
          project_id: projectId,
          title: `[${item.wbs_code}] ${item.name}`,
          description: item.description || '',
          assignee: item.assignee || '',
          status: taskStatus,
          priority: 'medium',
          start_date: item.planned_start || '',
          due_date: item.planned_end || '',
          milestone_id: item.milestone_id || '',
          tags: `wbs:${item.wbs_code}`,
        }));
      }
    }
    await Promise.all(ops);
    setSyncing(false);
    load();
  }

  async function moveTask(task, status) {
    await base44.entities.Task.update(task.id, { status });
    // Sync back to WBS if this task is linked
    const tag = (task.tags || '').split(',').find(x => x.trim().startsWith('wbs:'));
    if (tag) {
      const wbsCode = tag.trim().replace('wbs:', '');
      const wbsItems = await base44.entities.WBSItem.filter({ project_id: projectId, wbs_code: wbsCode }, 'wbs_code', 1);
      if (wbsItems[0]) {
        const newWbsStatus = TASK_TO_WBS_STATUS[status] || 'in_progress';
        await base44.entities.WBSItem.update(wbsItems[0].id, { status: newWbsStatus });
      }
    }
    load();
  }

  const byCol = {};
  COLUMNS.forEach(c => { byCol[c.id] = tasks.filter(t => t.status === c.id); });

  if (loading) return <Spinner />;

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <p className="text-sm text-slate-500">{tasks.length} task{tasks.length !== 1 ? 's' : ''}</p>
        <div className="flex items-center gap-2">
          <p className="text-xs text-slate-400 italic hidden sm:block">Move tasks via status buttons on each card</p>
          <button
            onClick={syncFromWBS}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-semibold text-xs rounded"
          >
            {syncing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Layers className="w-3.5 h-3.5" />}
            Sync from WBS
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-start">
        {COLUMNS.map(col => (
          <div key={col.id} className={`rounded-lg border-t-4 ${col.color} p-3 min-h-[200px]`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wide">{col.label}</h3>
              <span className="text-xs bg-white border border-slate-200 rounded-full px-1.5 py-0.5 text-slate-500 font-semibold">{byCol[col.id].length}</span>
            </div>

            <div className="space-y-2">
              {byCol[col.id].map(task => {
                const isEditing = editingId === task.id;
                return (
                  <div key={task.id} className="bg-white rounded-lg shadow-sm p-3 text-xs border border-slate-100">
                    {isEditing ? (
                      <div className="space-y-1.5">
                        <input value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} className={inp} placeholder="Title" />
                        <textarea value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                          className={inp + ' resize-none'} rows={2} placeholder="Description" />
                        <input value={editForm.assignee} onChange={e => setEditForm(f => ({ ...f, assignee: e.target.value }))} className={inp} placeholder="Assignee" />
                        <select value={editForm.priority} onChange={e => setEditForm(f => ({ ...f, priority: e.target.value }))} className={inp}>
                          {['low','medium','high','critical'].map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                        <div className="flex gap-1">
                          <button onClick={() => saveEdit(task.id)} className="flex-1 py-1 bg-emerald-500 text-white rounded text-xs font-semibold hover:bg-emerald-400">Save</button>
                          <button onClick={() => setEditingId(null)} className="px-2 py-1 border border-slate-200 rounded text-slate-500 hover:bg-slate-50"><X className="w-3 h-3" /></button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-start justify-between gap-1 mb-1.5">
                          <span className="font-semibold text-slate-800 leading-tight">{task.title}</span>
                          <div className="flex gap-0.5 shrink-0">
                            <button onClick={() => startEdit(task)} className="p-0.5 text-slate-300 hover:text-slate-600 rounded"><Pencil className="w-3 h-3" /></button>
                            <button onClick={() => deleteTask(task.id)} className="p-0.5 text-slate-300 hover:text-red-500 rounded"><Trash2 className="w-3 h-3" /></button>
                          </div>
                        </div>
                        {task.description && <p className="text-slate-400 mb-1.5 text-xs leading-relaxed">{task.description}</p>}
                        <div className="flex flex-wrap gap-1 items-center">
                          <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.medium}`}>{task.priority}</span>
                          {task.assignee && <span className="text-slate-400">👤 {task.assignee}</span>}
                          {(task.tags || '').includes('wbs:') && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-semibold flex items-center gap-0.5">
                              <Layers className="w-2.5 h-2.5" /> WBS
                            </span>
                          )}
                        </div>
                        {/* Move buttons */}
                        <div className="flex gap-1 mt-2 flex-wrap">
                          {COLUMNS.filter(c => c.id !== col.id).map(c => (
                            <button key={c.id} onClick={() => moveTask(task, c.id)}
                              className="text-xs px-1.5 py-0.5 border border-slate-200 rounded hover:bg-slate-100 text-slate-400 truncate max-w-[70px]">
                              → {c.label}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}

              {/* Add card form */}
              {addingCol === col.id ? (
                <form onSubmit={e => createTask(e, col.id)} className="bg-amber-50 border border-amber-200 rounded-lg p-2 space-y-1.5">
                  <input value={newTitle} onChange={e => setNewTitle(e.target.value)}
                    placeholder="Task title *" className={inp} required autoFocus />
                  <input value={newAssignee} onChange={e => setNewAssignee(e.target.value)}
                    placeholder="Assignee" className={inp} />
                  <select value={newPriority} onChange={e => setNewPriority(e.target.value)} className={inp}>
                    {['low','medium','high','critical'].map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <div className="flex gap-1">
                    <button type="submit" className="flex-1 py-1 bg-amber-500 text-slate-900 font-semibold text-xs rounded hover:bg-amber-400">Add</button>
                    <button type="button" onClick={() => setAddingCol(null)} className="px-2 py-1 border border-slate-200 rounded text-slate-500 hover:bg-slate-50"><X className="w-3 h-3" /></button>
                  </div>
                </form>
              ) : (
                <button onClick={() => { setAddingCol(col.id); setNewTitle(''); setNewPriority('medium'); setNewAssignee(''); }}
                  className="w-full py-1.5 text-xs text-slate-400 hover:text-slate-600 hover:bg-white/70 rounded border border-dashed border-slate-200 flex items-center justify-center gap-1">
                  <Plus className="w-3 h-3" /> Add card
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Spinner() {
  return <div className="flex justify-center py-12"><div className="w-7 h-7 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;
}