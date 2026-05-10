import { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { formatDate } from '@/lib/constants';
import { Plus, ChevronRight, ChevronDown, Trash2, Pencil, Save, X, Layers, AlertTriangle, Link, Wand2 } from 'lucide-react';
import PanelWrapper from '@/components/ui/PanelWrapper';
import ScheduleAssistantModal from './ScheduleAssistantModal';

const STATUS_COLORS = {
  not_started: 'bg-slate-100 text-slate-600',
  in_progress:  'bg-blue-100 text-blue-700',
  completed:    'bg-emerald-100 text-emerald-700',
  blocked:      'bg-red-100 text-red-700',
};
const STATUS_OPTIONS = ['not_started', 'in_progress', 'completed', 'blocked'];
const inp = 'border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white w-full';

/** Compute earliest start per item based on predecessor_ids finish dates */
function computeWBSImpact(items) {
  const byId = Object.fromEntries(items.map(i => [i.id, i]));
  const result = {};
  for (const item of items) {
    const preds = (item.predecessor_ids || []).map(pid => byId[pid]).filter(Boolean);
    if (preds.length === 0) { result[item.id] = { delayed: false }; continue; }
    // earliest start = max of all predecessor planned_end (or actual_end if available)
    const predEnds = preds.map(p => p.actual_end || p.planned_end).filter(Boolean);
    if (predEnds.length === 0) { result[item.id] = { delayed: false }; continue; }
    const latestPredEnd = predEnds.reduce((a, b) => (a > b ? a : b));
    const myStart = item.actual_start || item.planned_start;
    const delayed = myStart && myStart <= latestPredEnd;
    result[item.id] = { delayed, earliestStart: latestPredEnd, predNames: preds.map(p => p.name) };
  }
  return result;
}

/** Auto-rollup: a parent's progress = weighted avg of children (or simple avg if no weights) */
function rollupProgress(id, tree, byId) {
  const children = tree[id] || [];
  if (children.length === 0) return byId[id]?.progress || 0;
  const childProgresses = children.map(c => ({ p: rollupProgress(c.id, tree, byId), w: c.weight || 1 }));
  const totalWeight = childProgresses.reduce((s, c) => s + c.w, 0);
  return Math.round(childProgresses.reduce((s, c) => s + c.p * c.w, 0) / (totalWeight || 1));
}

/** Compute overall project progress from root WBS items using weighted rollup */
async function syncProjectProgress(projectId, items, tree, byId) {
  const roots = tree['__root__'] || [];
  if (roots.length === 0) return 0;
  const rootProgresses = roots.map(r => ({ p: rollupProgress(r.id, tree, byId), w: r.weight || 1 }));
  const totalWeight = rootProgresses.reduce((s, r) => s + r.w, 0);
  const overallProgress = Math.round(
    rootProgresses.reduce((s, r) => s + r.p * r.w, 0) / (totalWeight || 1)
  );
  await base44.entities.Project.update(projectId, { progress: overallProgress });
  return overallProgress;
}

export default function TabWBS({ projectId, onProgressChange }) {
  const [items, setItems] = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState({});
  const [adding, setAdding] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [showScheduleAssistant, setShowScheduleAssistant] = useState(false);

  function emptyForm() {
    return { wbs_code: '', name: '', assignee: '', description: '',
      planned_start: '', planned_end: '', actual_start: '', actual_end: '',
      planned_hours: '', actual_hours: '', planned_cost: '', actual_cost: '',
      weight: '', milestone_id: '', predecessor_ids: [] };
  }

  useEffect(() => { load(); }, [projectId]);

  // Sync project progress from WBS on every tab open to fix any stale data
  useEffect(() => {
    base44.functions.invoke('syncWBSProgress', { project_id: projectId })
      .then(res => { if (res?.data?.overallProgress != null) onProgressChange?.(res.data.overallProgress); })
      .catch(() => {}); // silent — non-critical
  }, [projectId]);

  async function load() {
    setLoading(true);
    const [w, m] = await Promise.all([
      base44.entities.WBSItem.filter({ project_id: projectId }, 'wbs_code', 500),
      base44.entities.Milestone.filter({ project_id: projectId }, 'planned_date', 100),
    ]);
    setItems(w);
    setMilestones(m);
    setExpanded(prev => {
      const e = { ...prev };
      w.filter(i => !i.parent_id).forEach(i => { e[i.id] = true; });
      return e;
    });
    setLoading(false);
  }

  const tree = useMemo(() => {
    const byParent = {};
    items.forEach(i => {
      const pid = i.parent_id || '__root__';
      if (!byParent[pid]) byParent[pid] = [];
      byParent[pid].push(i);
    });
    Object.keys(byParent).forEach(k => byParent[k].sort((a, b) => a.wbs_code.localeCompare(b.wbs_code)));
    return byParent;
  }, [items]);

  const byId = useMemo(() => Object.fromEntries(items.map(i => [i.id, i])), [items]);
  const impact = useMemo(() => computeWBSImpact(items), [items]);

  // Computed rollup progress for all items
  const rolledUp = useMemo(() => {
    const result = {};
    items.forEach(i => { result[i.id] = rollupProgress(i.id, tree, byId); });
    return result;
  }, [items, tree, byId]);

  function toggleExpand(id) {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  }

  function startAdd(parentId) {
    setAdding(parentId || 'root');
    setForm(emptyForm());
  }

  async function createItem(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.wbs_code.trim()) return;
    await base44.entities.WBSItem.create({
      ...form,
      project_id: projectId,
      parent_id: adding === 'root' ? null : adding,
      weight: Number(form.weight) || 0,
      planned_hours: form.planned_hours ? Number(form.planned_hours) : null,
      actual_hours: form.actual_hours ? Number(form.actual_hours) : null,
      planned_cost: form.planned_cost ? Number(form.planned_cost) : null,
      actual_cost: form.actual_cost ? Number(form.actual_cost) : null,
    });
    setAdding(null);
    load();
  }

  function startEdit(item) {
    setEditingId(item.id);
    setEditForm({
      wbs_code: item.wbs_code,
      name: item.name,
      description: item.description || '',
      assignee: item.assignee || '',
      status: item.status || 'not_started',
      planned_start: item.planned_start || '',
      planned_end: item.planned_end || '',
      actual_start: item.actual_start || '',
      actual_end: item.actual_end || '',
      planned_hours: item.planned_hours ?? '',
      actual_hours: item.actual_hours ?? '',
      planned_cost: item.planned_cost ?? '',
      actual_cost: item.actual_cost ?? '',
      weight: item.weight ?? '',
      progress: item.progress ?? 0,
      milestone_id: item.milestone_id || '',
      predecessor_ids: item.predecessor_ids || [],
    });
  }

  async function saveEdit(id) {
    const data = {
      ...editForm,
      weight: Number(editForm.weight) || 0,
      progress: Number(editForm.progress) || 0,
      planned_hours: editForm.planned_hours !== '' ? Number(editForm.planned_hours) : null,
      actual_hours: editForm.actual_hours !== '' ? Number(editForm.actual_hours) : null,
      planned_cost: editForm.planned_cost !== '' ? Number(editForm.planned_cost) : null,
      actual_cost: editForm.actual_cost !== '' ? Number(editForm.actual_cost) : null,
    };
    await base44.entities.WBSItem.update(id, data);
    // Auto-complete linked milestone if this item is now completed
    if (data.status === 'completed' && data.milestone_id) {
      await base44.entities.Milestone.update(data.milestone_id, { status: 'completed', completed_date: data.actual_end || new Date().toISOString().slice(0, 10) });
    }
    setEditingId(null);
    // Reload then sync project progress
    const updated = await base44.entities.WBSItem.filter({ project_id: projectId }, 'wbs_code', 500);
    setItems(updated);
    const newById = Object.fromEntries(updated.map(i => [i.id, i]));
    const newTree = {};
    updated.forEach(i => {
      const pid = i.parent_id || '__root__';
      if (!newTree[pid]) newTree[pid] = [];
      newTree[pid].push(i);
    });
    const newProgress = await syncProjectProgress(projectId, updated, newTree, newById);
    onProgressChange?.(newProgress);
  }

  async function updateStatus(item, status) {
    await base44.entities.WBSItem.update(item.id, { status });
    // Auto-complete milestone
    if (status === 'completed' && item.milestone_id) {
      await base44.entities.Milestone.update(item.milestone_id, { status: 'completed', completed_date: item.actual_end || new Date().toISOString().slice(0, 10) });
    }
    // Reload then sync project progress
    const updated = await base44.entities.WBSItem.filter({ project_id: projectId }, 'wbs_code', 500);
    setItems(updated);
    const newById = Object.fromEntries(updated.map(i => [i.id, i]));
    const newTree = {};
    updated.forEach(i => {
      const pid = i.parent_id || '__root__';
      if (!newTree[pid]) newTree[pid] = [];
      newTree[pid].push(i);
    });
    const newProgress = await syncProjectProgress(projectId, updated, newTree, newById);
    onProgressChange?.(newProgress);
  }

  function getDescendants(id) {
    const children = (tree[id] || []).map(c => c.id);
    return children.flatMap(cid => [cid, ...getDescendants(cid)]);
  }

  async function deleteItem(id) {
    const descendants = getDescendants(id);
    await Promise.all([id, ...descendants].map(did => base44.entities.WBSItem.delete(did)));
    // Reload and sync progress after deletion
    const updated = await base44.entities.WBSItem.filter({ project_id: projectId }, 'wbs_code', 500);
    setItems(updated);
    const newById = Object.fromEntries(updated.map(i => [i.id, i]));
    const newTree = {};
    updated.forEach(i => {
      const pid = i.parent_id || '__root__';
      if (!newTree[pid]) newTree[pid] = [];
      newTree[pid].push(i);
    });
    const newProgress = await syncProjectProgress(projectId, updated, newTree, newById);
    onProgressChange?.(newProgress);
    setLoading(false);
  }

  function togglePred(form, setForm, predId) {
    setForm(f => {
      const ids = f.predecessor_ids || [];
      return { ...f, predecessor_ids: ids.includes(predId) ? ids.filter(x => x !== predId) : [...ids, predId] };
    });
  }

  function renderNode(item, depth = 0) {
    const children = tree[item.id] || [];
    const hasChildren = children.length > 0;
    const isExpanded = expanded[item.id];
    const isEditing = editingId === item.id;
    const msName = milestones.find(m => m.id === item.milestone_id)?.title;
    const dep = impact[item.id] || {};
    const displayProgress = hasChildren ? rolledUp[item.id] : (item.progress || 0);
    const otherItems = items.filter(i => i.id !== item.id && !getDescendants(item.id).includes(i.id));

    return (
      <div key={item.id}>
        <div
          className={`flex items-start gap-1.5 px-2 py-2 border-b border-slate-100 hover:bg-slate-50 ${dep.delayed ? 'bg-red-50' : depth === 0 ? 'bg-slate-50/60' : 'bg-white'}`}
          style={{ paddingLeft: `${8 + depth * 18}px` }}
        >
          {/* Expand */}
          <button onClick={() => hasChildren && toggleExpand(item.id)}
            className={`mt-0.5 p-0.5 rounded shrink-0 ${hasChildren ? 'text-slate-500 hover:text-slate-800 cursor-pointer' : 'opacity-0 pointer-events-none'}`}>
            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>

          {dep.delayed && !isEditing && (
            <AlertTriangle className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" title={`Should start after ${dep.earliestStart}`} />
          )}

          {/* WBS Code */}
          {isEditing ? (
            <input value={editForm.wbs_code} onChange={e => setEditForm(f => ({ ...f, wbs_code: e.target.value }))}
              className={inp} style={{ width: 65 }} placeholder="Code" />
          ) : (
            <span className="font-mono text-xs text-slate-400 shrink-0 pt-0.5 w-14">{item.wbs_code}</span>
          )}

          {/* Main content */}
          <div className="flex-1 min-w-0">
            {isEditing ? (
              <div className="space-y-2">
                {/* Row 1: Name, assignee, weight */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
                  <input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                    className={inp + ' md:col-span-2'} placeholder="Name *" />
                  <input value={editForm.assignee} onChange={e => setEditForm(f => ({ ...f, assignee: e.target.value }))}
                    className={inp} placeholder="Assignee" />
                  <input type="number" min="0" max="100" value={editForm.weight}
                    onChange={e => setEditForm(f => ({ ...f, weight: e.target.value }))}
                    className={inp} placeholder="Weight %" />
                </div>
                {/* Row 2: Planned dates */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
                  <div><label className="text-xs text-slate-400 block mb-0.5">Planned Start</label>
                    <input type="date" value={editForm.planned_start} onChange={e => setEditForm(f => ({ ...f, planned_start: e.target.value }))} className={inp} /></div>
                  <div><label className="text-xs text-slate-400 block mb-0.5">Planned End</label>
                    <input type="date" value={editForm.planned_end} onChange={e => setEditForm(f => ({ ...f, planned_end: e.target.value }))} className={inp} /></div>
                  <div><label className="text-xs text-slate-400 block mb-0.5">Actual Start</label>
                    <input type="date" value={editForm.actual_start} onChange={e => setEditForm(f => ({ ...f, actual_start: e.target.value }))} className={inp} /></div>
                  <div><label className="text-xs text-slate-400 block mb-0.5">Actual End</label>
                    <input type="date" value={editForm.actual_end} onChange={e => setEditForm(f => ({ ...f, actual_end: e.target.value }))} className={inp} /></div>
                </div>
                {/* Row 3: Hours + Cost */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
                  <input type="number" value={editForm.planned_hours} onChange={e => setEditForm(f => ({ ...f, planned_hours: e.target.value }))}
                    className={inp} placeholder="Planned Hrs" min="0" />
                  <input type="number" value={editForm.actual_hours} onChange={e => setEditForm(f => ({ ...f, actual_hours: e.target.value }))}
                    className={inp} placeholder="Actual Hrs" min="0" />
                  <input type="number" value={editForm.planned_cost} onChange={e => setEditForm(f => ({ ...f, planned_cost: e.target.value }))}
                    className={inp} placeholder="Planned Cost" min="0" />
                  <input type="number" value={editForm.actual_cost} onChange={e => setEditForm(f => ({ ...f, actual_cost: e.target.value }))}
                    className={inp} placeholder="Actual Cost" min="0" />
                </div>
                {/* Row 4: Progress, Milestone, Status */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
                  <input type="number" min="0" max="100" value={editForm.progress}
                    onChange={e => setEditForm(f => ({ ...f, progress: e.target.value }))}
                    className={inp} placeholder="Progress %" />
                  <select value={editForm.status} onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))} className={inp}>
                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                  </select>
                  <select value={editForm.milestone_id} onChange={e => setEditForm(f => ({ ...f, milestone_id: e.target.value }))} className={inp + ' md:col-span-2'}>
                    <option value="">— No Milestone —</option>
                    {milestones.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
                  </select>
                </div>
                {/* Predecessors */}
                {otherItems.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-slate-500 mb-1">Predecessors (must finish before this starts):</p>
                    <div className="flex flex-wrap gap-2">
                      {otherItems.map(oi => (
                        <label key={oi.id} className="flex items-center gap-1 text-xs cursor-pointer">
                          <input type="checkbox"
                            checked={(editForm.predecessor_ids || []).includes(oi.id)}
                            onChange={() => togglePred(editForm, setEditForm, oi.id)}
                            className="accent-amber-500" />
                          <span className="text-slate-600">{oi.wbs_code} {oi.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={`font-medium text-slate-800 text-sm ${depth === 0 ? 'font-semibold' : ''}`}>{item.name}</span>
                  {hasChildren && <span className="text-xs text-slate-400">(rollup: {displayProgress}%)</span>}
                </div>
                <div className="flex flex-wrap gap-2 mt-0.5 text-xs text-slate-500">
                  {item.assignee && <span>👤 {item.assignee}</span>}
                  {item.planned_start && (
                    <span className={dep.delayed ? 'text-red-600 font-semibold' : ''}>
                      📅 {formatDate(item.planned_start)} → {formatDate(item.planned_end)}
                      {dep.delayed && <span className="text-red-500"> (start after {dep.earliestStart})</span>}
                    </span>
                  )}
                  {item.actual_start && <span className="text-emerald-600">✅ {formatDate(item.actual_start)} → {formatDate(item.actual_end) || '…'}</span>}
                  {item.planned_hours && <span>⏱ {item.actual_hours ?? '?'}/{item.planned_hours}h</span>}
                  {msName && <span className="text-amber-600">🏁 {msName}</span>}
                  {(item.predecessor_ids || []).length > 0 && (
                    <span className="text-slate-400">← {(item.predecessor_ids || []).map(pid => byId[pid]?.wbs_code || pid.slice(0,4)).join(', ')}</span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Status badge */}
          {!isEditing && (
            <select value={item.status || 'not_started'} onChange={e => updateStatus(item, e.target.value)}
              className={`text-xs px-2 py-1 rounded font-semibold border-0 cursor-pointer shrink-0 ${STATUS_COLORS[item.status || 'not_started']}`}>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          )}

          {/* Progress */}
          {!isEditing && (
            <div className="flex items-center gap-1 w-16 shrink-0">
              <div className="flex-1 bg-slate-200 rounded-full h-1.5">
                <div className="bg-amber-500 h-1.5 rounded-full" style={{ width: `${displayProgress}%` }} />
              </div>
              <span className="text-xs text-slate-400">{displayProgress}%</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-0.5 shrink-0">
            {isEditing ? (
              <>
                <button onClick={() => saveEdit(item.id)} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"><Save className="w-3.5 h-3.5" /></button>
                <button onClick={() => setEditingId(null)} className="p-1 text-slate-400 hover:bg-slate-100 rounded"><X className="w-3.5 h-3.5" /></button>
              </>
            ) : (
              <>
                <button onClick={() => startAdd(item.id)} className="p-1 text-slate-300 hover:text-amber-600 hover:bg-amber-50 rounded" title="Add child"><Plus className="w-3.5 h-3.5" /></button>
                <button onClick={() => startEdit(item)} className="p-1 text-slate-300 hover:text-slate-700 hover:bg-slate-100 rounded"><Pencil className="w-3.5 h-3.5" /></button>
                <button onClick={() => deleteItem(item.id)} className="p-1 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 className="w-3.5 h-3.5" /></button>
              </>
            )}
          </div>
        </div>

        {/* Add child form */}
        {adding === item.id && (
          <AddForm depth={depth + 1} form={form} setForm={setForm} milestones={milestones}
            otherItems={items.filter(i => i.id !== item.id)} onSubmit={createItem} onCancel={() => setAdding(null)} />
        )}

        {/* Children */}
        {isExpanded && children.map(child => renderNode(child, depth + 1))}
      </div>
    );
  }

  const roots = tree['__root__'] || [];
  const hasConflicts = Object.values(impact).some(d => d.delayed);

  if (loading) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <p className="text-sm text-slate-500">{items.length} WBS item{items.length !== 1 ? 's' : ''}</p>
          {hasConflicts && (
            <div className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 border border-red-200 px-2 py-1 rounded">
              <AlertTriangle className="w-3.5 h-3.5" /> Scheduling conflicts detected
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowScheduleAssistant(true)}
            className="flex items-center gap-1 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white font-semibold text-sm rounded">
            <Wand2 className="w-4 h-4" /> Schedule Assistant
          </button>
          <button onClick={() => startAdd('root')}
            className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded">
            <Plus className="w-4 h-4" /> Add WBS Item
          </button>
        </div>
      </div>

      {adding === 'root' && (
        <AddForm depth={0} form={form} setForm={setForm} milestones={milestones}
          otherItems={items} onSubmit={createItem} onCancel={() => setAdding(null)} />
      )}

      {items.length === 0 && adding !== 'root' ? (
        <div className="text-center py-12 text-slate-400">
          <Layers className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No WBS items yet. Add a root-level item to get started.</p>
        </div>
      ) : (
        <PanelWrapper title="Work Breakdown Structure"
          exportData={items.map(i => ({
            wbs_code: i.wbs_code, name: i.name, status: i.status,
            assignee: i.assignee || '',
            planned_start: i.planned_start || '', planned_end: i.planned_end || '',
            actual_start: i.actual_start || '', actual_end: i.actual_end || '',
            planned_hours: i.planned_hours ?? '', actual_hours: i.actual_hours ?? '',
            planned_cost: i.planned_cost ?? '', actual_cost: i.actual_cost ?? '',
            weight: i.weight || 0, progress: rolledUp[i.id] || 0,
            milestone: milestones.find(m => m.id === i.milestone_id)?.title || '',
            predecessors: (i.predecessor_ids || []).map(pid => byId[pid]?.wbs_code || '').join(', '),
          }))}
          exportCols={[
            { key: 'wbs_code', label: 'Code' }, { key: 'name', label: 'Name' },
            { key: 'status', label: 'Status' }, { key: 'assignee', label: 'Assignee' },
            { key: 'planned_start', label: 'Pln Start' }, { key: 'planned_end', label: 'Pln End' },
            { key: 'actual_start', label: 'Act Start' }, { key: 'actual_end', label: 'Act End' },
            { key: 'planned_hours', label: 'Pln Hrs' }, { key: 'actual_hours', label: 'Act Hrs' },
            { key: 'planned_cost', label: 'Pln Cost' }, { key: 'actual_cost', label: 'Act Cost' },
            { key: 'weight', label: 'Weight %' }, { key: 'progress', label: 'Progress %' },
            { key: 'milestone', label: 'Milestone' }, { key: 'predecessors', label: 'Predecessors' },
          ]}
        >
          <div className="bg-white rounded-lg shadow-sm overflow-hidden border border-slate-200">
            <div className="flex items-center gap-2 px-3 py-2 bg-slate-100 text-xs font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200">
              <span className="w-4" /><span className="w-14">Code</span>
              <span className="flex-1">Name / Schedule / Cost</span>
              <span className="w-28 text-center">Status</span>
              <span className="w-16 text-center">Progress</span>
              <span className="w-20 text-right">Actions</span>
            </div>
            {roots.map(item => renderNode(item, 0))}
          </div>
        </PanelWrapper>
      )}

      {showScheduleAssistant && (
        <ScheduleAssistantModal
          projectId={projectId}
          onClose={() => setShowScheduleAssistant(false)}
          onApplied={() => { setShowScheduleAssistant(false); load(); }}
        />
      )}
    </div>
  );
}

function AddForm({ depth, form, setForm, milestones, otherItems, onSubmit, onCancel }) {
  return (
    <form onSubmit={onSubmit}
      className="bg-amber-50 border border-amber-200 rounded-lg p-3 my-1 grid grid-cols-2 md:grid-cols-4 gap-2"
      style={{ marginLeft: `${8 + depth * 18}px`, marginRight: 8 }}
    >
      <input value={form.wbs_code} onChange={e => setForm(f => ({ ...f, wbs_code: e.target.value }))}
        placeholder="WBS Code *" className={inp} required />
      <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
        placeholder="Name *" className={inp + ' col-span-1 md:col-span-2'} required />
      <input value={form.assignee} onChange={e => setForm(f => ({ ...f, assignee: e.target.value }))}
        placeholder="Assignee" className={inp} />
      <div><label className="text-xs text-slate-400">Planned Start</label>
        <input type="date" value={form.planned_start} onChange={e => setForm(f => ({ ...f, planned_start: e.target.value }))} className={inp} /></div>
      <div><label className="text-xs text-slate-400">Planned End</label>
        <input type="date" value={form.planned_end} onChange={e => setForm(f => ({ ...f, planned_end: e.target.value }))} className={inp} /></div>
      <div><label className="text-xs text-slate-400">Actual Start</label>
        <input type="date" value={form.actual_start} onChange={e => setForm(f => ({ ...f, actual_start: e.target.value }))} className={inp} /></div>
      <div><label className="text-xs text-slate-400">Actual End</label>
        <input type="date" value={form.actual_end} onChange={e => setForm(f => ({ ...f, actual_end: e.target.value }))} className={inp} /></div>
      <input type="number" value={form.weight} onChange={e => setForm(f => ({ ...f, weight: e.target.value }))}
        placeholder="Weight %" className={inp} min="0" max="100" />
      <select value={form.milestone_id} onChange={e => setForm(f => ({ ...f, milestone_id: e.target.value }))} className={inp + ' md:col-span-2'}>
        <option value="">— Link to Milestone —</option>
        {milestones.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
      </select>
      {otherItems.length > 0 && (
        <div className="col-span-2 md:col-span-4">
          <p className="text-xs font-semibold text-slate-500 mb-1">Predecessors:</p>
          <div className="flex flex-wrap gap-2">
            {otherItems.map(oi => (
              <label key={oi.id} className="flex items-center gap-1 text-xs cursor-pointer">
                <input type="checkbox"
                  checked={(form.predecessor_ids || []).includes(oi.id)}
                  onChange={() => setForm(f => {
                    const ids = f.predecessor_ids || [];
                    return { ...f, predecessor_ids: ids.includes(oi.id) ? ids.filter(x => x !== oi.id) : [...ids, oi.id] };
                  })}
                  className="accent-amber-500" />
                <span className="text-slate-600">{oi.wbs_code} {oi.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="col-span-2 md:col-span-4 flex gap-2">
        <button type="submit" className="px-3 py-1.5 bg-amber-500 text-slate-900 font-semibold text-xs rounded hover:bg-amber-400">Save</button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 border border-slate-300 text-slate-600 text-xs rounded hover:bg-slate-100">Cancel</button>
      </div>
    </form>
  );
}

function Spinner() {
  return <div className="flex justify-center py-12"><div className="w-7 h-7 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;
}