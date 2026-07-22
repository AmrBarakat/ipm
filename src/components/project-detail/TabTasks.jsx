import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useEntityList, useEntityMutation, runBatch } from '@/hooks/useEntity';
import { ENTITY_QUERY } from '@/lib/entityQueryDefaults';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { Plus, Pencil, X, Trash2, RefreshCw, Layers, Check, Save, ListTodo } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';

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

export default function TabTasks({ projectId, focusTaskId }) {
  const { data: tasks = [], isLoading } = useEntityList('Task', { project_id: projectId }, ENTITY_QUERY.Task.sort, ENTITY_QUERY.Task.limit);
  const taskMutation = useEntityMutation('Task', ['WBSItem']);
  const wbsMutation = useEntityMutation('WBSItem', ['Task']);
  const confirmDialog = useConfirm();
  const [syncing, setSyncing] = useState(false);
  const [addingCol, setAddingCol] = useState(null);
  const [newTitle, setNewTitle] = useState('');
  const [newPriority, setNewPriority] = useState('medium');
  const [newAssignee, setNewAssignee] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkField, setBulkField] = useState('');
  const [bulkValue, setBulkValue] = useState('');

  // Deep-link from the Calendar: scroll the focused task card into view and
  // highlight it so the user lands directly on the selected task.
  useEffect(() => {
    if (!focusTaskId || isLoading) return;
    const el = document.querySelector(`[data-task-id="${focusTaskId}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusTaskId, isLoading, tasks]);

  async function createTask(e, colId) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    await taskMutation.mutateAsync({
      action: 'create',
      data: {
        project_id: projectId,
        title: newTitle.trim(),
        priority: newPriority,
        assignee: newAssignee.trim() || undefined,
        status: colId,
      },
    });
    setNewTitle(''); setNewPriority('medium'); setNewAssignee(''); setAddingCol(null);
  }

  function startEdit(task) {
    setEditingId(task.id);
    setEditForm({ title: task.title, priority: task.priority, assignee: task.assignee || '', description: task.description || '' });
  }

  async function saveEdit(id) {
    await taskMutation.mutateAsync({ action: 'update', id, data: editForm });
    setEditingId(null);
  }

  async function deleteTask(id) {
    if (!(await confirmDialog({ title: 'Delete task', description: 'Delete this task?', confirmText: 'Delete', destructive: true }))) return;
    await taskMutation.mutateAsync({ action: 'delete', id });
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
          ops.push(taskMutation.mutateAsync({ action: 'update', id: existing.id, data: { status: taskStatus } }));
        }
      } else {
        // Create new task from WBS item
        ops.push(taskMutation.mutateAsync({
          action: 'create',
          data: {
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
          },
        }));
      }
    }
    await runBatch(ops, 'task sync operations');
    setSyncing(false);
  }

  function toggleSelect(id) {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function selectAll() { setSelectedIds(new Set(tasks.map(t => t.id))); }
  function clearSelection() { setSelectedIds(new Set()); setBulkField(''); setBulkValue(''); }

  async function bulkDelete() {
    if (!(await confirmDialog({
      title: `Delete ${selectedIds.size} task${selectedIds.size === 1 ? '' : 's'}?`,
      description: 'The selected tasks will be permanently removed. This action cannot be undone.',
      confirmText: 'Delete', destructive: true,
    }))) return;
    await runBatch([...selectedIds].map(id => taskMutation.mutateAsync({ action: 'delete', id })), 'task deletions');
    clearSelection();
  }

  async function applyBulkEdit() {
    if (!bulkField || !bulkValue) return;
    const value = bulkField === 'progress' ? Number(bulkValue) : bulkValue;
    await runBatch([...selectedIds].map(id => taskMutation.mutateAsync({ action: 'update', id, data: { [bulkField]: value } })), 'task updates');
    clearSelection();
  }

  async function moveTask(task, status) {
    await taskMutation.mutateAsync({ action: 'update', id: task.id, data: { status } });
    // Sync back to WBS if this task is linked
    const tag = (task.tags || '').split(',').find(x => x.trim().startsWith('wbs:'));
    if (tag) {
      const wbsCode = tag.trim().replace('wbs:', '');
      const wbsItems = await base44.entities.WBSItem.filter({ project_id: projectId, wbs_code: wbsCode }, 'wbs_code', 1);
      if (wbsItems[0]) {
        const newWbsStatus = TASK_TO_WBS_STATUS[status] || 'in_progress';
        await wbsMutation.mutateAsync({ action: 'update', id: wbsItems[0].id, data: { status: newWbsStatus } });
      }
    }
  }

  const byCol = {};
  COLUMNS.forEach(c => { byCol[c.id] = tasks.filter(t => t.status === c.id); });

  if (isLoading) return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
      {COLUMNS.map(c => (
        <div key={c.id} className="rounded-lg border-t-4 border-slate-200 p-3 min-h-[200px]">
          <div className="h-3 w-20 bg-slate-200 rounded animate-pulse mb-3" />
          <div className="space-y-2">
            <div className="h-16 bg-slate-100 rounded animate-pulse" />
            <div className="h-16 bg-slate-100 rounded animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <p className="text-sm text-slate-500">{tasks.length} task{tasks.length !== 1 ? 's' : ''}</p>
        <div className="flex items-center gap-2">
          <button onClick={selectedIds.size === tasks.length ? clearSelection : selectAll}
            className="text-xs text-slate-500 hover:text-slate-700 underline hidden sm:block">
            {selectedIds.size === tasks.length && tasks.length > 0 ? 'Deselect all' : 'Select all'}
          </button>
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

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 bg-slate-800 text-white rounded-lg px-4 py-2.5 text-sm mb-3">
          <span className="font-semibold text-amber-400">{selectedIds.size} selected</span>
          <span className="text-slate-400">·</span>
          <select value={bulkField} onChange={e => { setBulkField(e.target.value); setBulkValue(''); }}
            className="text-xs bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white focus:outline-none focus:border-amber-400">
            <option value="">Field…</option>
            <option value="status">Status</option>
            <option value="priority">Priority</option>
            <option value="assignee">Assignee</option>
            <option value="progress">Progress %</option>
          </select>
          {bulkField === 'status' && (
            <select value={bulkValue} onChange={e => setBulkValue(e.target.value)}
              className="text-xs bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white focus:outline-none focus:border-amber-400">
              <option value="">Value…</option>
              {COLUMNS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          )}
          {bulkField === 'priority' && (
            <select value={bulkValue} onChange={e => setBulkValue(e.target.value)}
              className="text-xs bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white focus:outline-none focus:border-amber-400">
              <option value="">Value…</option>
              {['low','medium','high','critical'].map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
          {bulkField === 'assignee' && (
            <input value={bulkValue} onChange={e => setBulkValue(e.target.value)} placeholder="Assignee name"
              className="text-xs bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white placeholder-slate-400 focus:outline-none focus:border-amber-400 w-36" />
          )}
          {bulkField === 'progress' && (
            <input type="number" min="0" max="100" value={bulkValue} onChange={e => setBulkValue(e.target.value)} placeholder="0–100"
              className="text-xs bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white placeholder-slate-400 focus:outline-none focus:border-amber-400 w-20" />
          )}
          {bulkField && bulkValue && (
            <button onClick={applyBulkEdit}
              className="flex items-center gap-1 px-3 py-1 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-xs rounded">
              <Save className="w-3 h-3" /> Apply
            </button>
          )}
          <button onClick={bulkDelete}
            className="flex items-center gap-1 px-3 py-1 bg-red-600 hover:bg-red-500 text-white font-semibold text-xs rounded ml-auto">
            <Trash2 className="w-3.5 h-3.5" /> Delete {selectedIds.size}
          </button>
          <button onClick={clearSelection} className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {tasks.length === 0 && !addingCol ? (
        <EmptyState
          icon={<ListTodo className="w-12 h-12 opacity-40" />}
          title="No tasks yet"
          message="Add a task to the board, or sync tasks from the project's WBS items."
          actions={[
            { label: 'Add a task', primary: true, icon: <Plus className="w-4 h-4" />, onClick: () => { setAddingCol('todo'); setNewTitle(''); setNewPriority('medium'); setNewAssignee(''); } },
            { label: 'Sync from WBS', icon: <Layers className="w-4 h-4" />, onClick: syncFromWBS },
          ]}
        />
      ) : (
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
                  <div key={task.id} data-task-id={task.id} className={`bg-white rounded-lg shadow-sm p-3 text-xs border ${selectedIds.has(task.id) ? 'border-amber-400 bg-amber-50/30' : 'border-slate-100'} ${focusTaskId === task.id ? 'ring-2 ring-amber-400 border-amber-400' : ''}`}>
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
                          <div className="flex items-start gap-1.5 flex-1 min-w-0">
                            <button onClick={() => toggleSelect(task.id)} className="mt-0.5 shrink-0">
                              <div className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center transition-colors ${selectedIds.has(task.id) ? 'bg-amber-400 border-amber-400' : 'border-slate-300 hover:border-amber-400'}`}>
                                {selectedIds.has(task.id) && <Check className="w-2 h-2 text-slate-900" />}
                              </div>
                            </button>
                            <span className="font-semibold text-slate-800 leading-tight">{task.title}</span>
                          </div>
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
                        {(task.progress || 0) > 0 && (
                          <div className="flex items-center gap-1 mt-1.5">
                            <div className="flex-1 bg-slate-200 rounded-full h-1.5">
                              <div className="bg-amber-500 h-1.5 rounded-full" style={{ width: `${task.progress}%` }} />
                            </div>
                            <span className="text-xs text-slate-400">{task.progress}%</span>
                          </div>
                        )}
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
        )}
        </div>
        );
        }