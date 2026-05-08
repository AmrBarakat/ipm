import { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { formatDate } from '@/lib/constants';
import { Plus, ChevronRight, ChevronDown, Trash2, Pencil, Save, X, Layers } from 'lucide-react';
import PanelWrapper from '@/components/ui/PanelWrapper';

const STATUS_COLORS = {
  not_started: 'bg-slate-100 text-slate-600',
  in_progress:  'bg-blue-100 text-blue-700',
  completed:    'bg-emerald-100 text-emerald-700',
  blocked:      'bg-red-100 text-red-700',
};

const STATUS_OPTIONS = ['not_started', 'in_progress', 'completed', 'blocked'];

const inp = 'border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white w-full';

export default function TabWBS({ projectId }) {
  const [items, setItems] = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState({});
  const [adding, setAdding] = useState(null); // parentId or 'root'
  const [form, setForm] = useState({ wbs_code: '', name: '', assignee: '', planned_start: '', planned_end: '', weight: '', milestone_id: '' });
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});

  useEffect(() => { load(); }, [projectId]);

  async function load() {
    setLoading(true);
    const [w, m] = await Promise.all([
      base44.entities.WBSItem.filter({ project_id: projectId }, 'wbs_code', 500),
      base44.entities.Milestone.filter({ project_id: projectId }, 'planned_date', 100),
    ]);
    setItems(w);
    setMilestones(m);
    // auto-expand roots
    const roots = w.filter(i => !i.parent_id).map(i => i.id);
    setExpanded(prev => {
      const e = { ...prev };
      roots.forEach(id => { e[id] = true; });
      return e;
    });
    setLoading(false);
  }

  // Build tree
  const tree = useMemo(() => {
    const byParent = {};
    items.forEach(i => {
      const pid = i.parent_id || '__root__';
      if (!byParent[pid]) byParent[pid] = [];
      byParent[pid].push(i);
    });
    // sort by wbs_code
    Object.keys(byParent).forEach(k => byParent[k].sort((a, b) => a.wbs_code.localeCompare(b.wbs_code)));
    return byParent;
  }, [items]);

  function toggleExpand(id) {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  }

  function startAdd(parentId) {
    setAdding(parentId || 'root');
    setForm({ wbs_code: '', name: '', assignee: '', planned_start: '', planned_end: '', weight: '', milestone_id: '' });
  }

  async function createItem(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.wbs_code.trim()) return;
    await base44.entities.WBSItem.create({
      ...form,
      project_id: projectId,
      parent_id: adding === 'root' ? null : adding,
      weight: Number(form.weight) || 0,
    });
    setAdding(null);
    load();
  }

  function startEdit(item) {
    setEditingId(item.id);
    setEditForm({
      wbs_code: item.wbs_code,
      name: item.name,
      assignee: item.assignee || '',
      status: item.status || 'not_started',
      planned_start: item.planned_start || '',
      planned_end: item.planned_end || '',
      weight: item.weight ?? '',
      progress: item.progress ?? 0,
      milestone_id: item.milestone_id || '',
    });
  }

  async function saveEdit(id) {
    await base44.entities.WBSItem.update(id, { ...editForm, weight: Number(editForm.weight) || 0, progress: Number(editForm.progress) || 0 });
    setEditingId(null);
    load();
  }

  async function deleteItem(id) {
    // Also delete children
    const descendants = getDescendants(id);
    await Promise.all([id, ...descendants].map(did => base44.entities.WBSItem.delete(did)));
    load();
  }

  function getDescendants(id) {
    const children = (tree[id] || []).map(c => c.id);
    return children.flatMap(cid => [cid, ...getDescendants(cid)]);
  }

  async function updateStatus(item, status) {
    await base44.entities.WBSItem.update(item.id, { status });
    load();
  }

  function renderNode(item, depth = 0) {
    const children = tree[item.id] || [];
    const hasChildren = children.length > 0;
    const isExpanded = expanded[item.id];
    const isEditing = editingId === item.id;
    const msName = milestones.find(m => m.id === item.milestone_id)?.title;

    return (
      <div key={item.id}>
        <div
          className={`flex items-start gap-2 px-3 py-2 border-b border-slate-100 hover:bg-slate-50 ${depth > 0 ? 'bg-white' : 'bg-slate-50/50'}`}
          style={{ paddingLeft: `${12 + depth * 20}px` }}
        >
          {/* Expand toggle */}
          <button
            onClick={() => hasChildren && toggleExpand(item.id)}
            className={`mt-0.5 p-0.5 rounded text-slate-400 shrink-0 ${hasChildren ? 'hover:text-slate-700 cursor-pointer' : 'opacity-0 pointer-events-none'}`}
          >
            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>

          {/* WBS Code */}
          {isEditing ? (
            <input value={editForm.wbs_code} onChange={e => setEditForm(f => ({ ...f, wbs_code: e.target.value }))}
              className={inp} style={{ width: 70 }} placeholder="Code" />
          ) : (
            <span className="font-mono text-xs text-slate-500 shrink-0 pt-0.5 w-16">{item.wbs_code}</span>
          )}

          {/* Name */}
          <div className="flex-1 min-w-0">
            {isEditing ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
                <input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                  className={inp + ' col-span-2'} placeholder="Name *" />
                <input value={editForm.assignee} onChange={e => setEditForm(f => ({ ...f, assignee: e.target.value }))}
                  className={inp} placeholder="Assignee" />
                <input type="number" min="0" max="100" value={editForm.weight}
                  onChange={e => setEditForm(f => ({ ...f, weight: e.target.value }))}
                  className={inp} placeholder="Weight %" />
                <input type="date" value={editForm.planned_start} onChange={e => setEditForm(f => ({ ...f, planned_start: e.target.value }))} className={inp} />
                <input type="date" value={editForm.planned_end} onChange={e => setEditForm(f => ({ ...f, planned_end: e.target.value }))} className={inp} />
                <input type="number" min="0" max="100" value={editForm.progress}
                  onChange={e => setEditForm(f => ({ ...f, progress: e.target.value }))}
                  className={inp} placeholder="Progress %" />
                <select value={editForm.milestone_id} onChange={e => setEditForm(f => ({ ...f, milestone_id: e.target.value }))} className={inp}>
                  <option value="">— No Milestone —</option>
                  {milestones.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
                </select>
              </div>
            ) : (
              <div>
                <span className={`font-medium text-slate-800 text-sm ${depth === 0 ? 'font-semibold' : ''}`}>{item.name}</span>
                <div className="flex flex-wrap gap-2 mt-0.5 text-xs text-slate-500">
                  {item.assignee && <span>👤 {item.assignee}</span>}
                  {item.planned_start && <span>📅 {formatDate(item.planned_start)} → {formatDate(item.planned_end)}</span>}
                  {item.weight > 0 && <span>⚖ {item.weight}%</span>}
                  {msName && <span className="text-amber-600">🏁 {msName}</span>}
                </div>
              </div>
            )}
          </div>

          {/* Status */}
          {!isEditing && (
            <select value={item.status || 'not_started'} onChange={e => updateStatus(item, e.target.value)}
              className={`text-xs px-2 py-1 rounded font-semibold border-0 cursor-pointer shrink-0 ${STATUS_COLORS[item.status || 'not_started']}`}>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          )}

          {/* Progress bar */}
          {!isEditing && (
            <div className="flex items-center gap-1 w-20 shrink-0">
              <div className="flex-1 bg-slate-200 rounded-full h-1.5">
                <div className="bg-amber-500 h-1.5 rounded-full" style={{ width: `${item.progress || 0}%` }} />
              </div>
              <span className="text-xs text-slate-400">{item.progress || 0}%</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-1 shrink-0">
            {isEditing ? (
              <>
                <button onClick={() => saveEdit(item.id)} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"><Save className="w-3.5 h-3.5" /></button>
                <button onClick={() => setEditingId(null)} className="p-1 text-slate-400 hover:bg-slate-100 rounded"><X className="w-3.5 h-3.5" /></button>
              </>
            ) : (
              <>
                <button onClick={() => startAdd(item.id)} className="p-1 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded" title="Add child"><Plus className="w-3.5 h-3.5" /></button>
                <button onClick={() => startEdit(item)} className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded"><Pencil className="w-3.5 h-3.5" /></button>
                <button onClick={() => deleteItem(item.id)} className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 className="w-3.5 h-3.5" /></button>
              </>
            )}
          </div>
        </div>

        {/* Add child form */}
        {adding === item.id && (
          <AddForm
            depth={depth + 1}
            form={form}
            setForm={setForm}
            milestones={milestones}
            onSubmit={createItem}
            onCancel={() => setAdding(null)}
          />
        )}

        {/* Children */}
        {isExpanded && children.map(child => renderNode(child, depth + 1))}
      </div>
    );
  }

  const roots = tree['__root__'] || [];

  if (loading) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-slate-500">{items.length} WBS item{items.length !== 1 ? 's' : ''}</p>
        <button onClick={() => startAdd('root')}
          className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded">
          <Plus className="w-4 h-4" /> Add WBS Item
        </button>
      </div>

      {adding === 'root' && (
        <AddForm
          depth={0}
          form={form}
          setForm={setForm}
          milestones={milestones}
          onSubmit={createItem}
          onCancel={() => setAdding(null)}
        />
      )}

      {items.length === 0 && adding !== 'root' ? (
        <div className="text-center py-12 text-slate-400">
          <Layers className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No WBS items yet. Add a root-level item to get started.</p>
        </div>
      ) : (
        <PanelWrapper title="Work Breakdown Structure"
          exportData={items.map(i => ({
            wbs_code: i.wbs_code,
            name: i.name,
            status: i.status,
            assignee: i.assignee || '',
            planned_start: i.planned_start || '',
            planned_end: i.planned_end || '',
            weight: i.weight || 0,
            progress: i.progress || 0,
            milestone: milestones.find(m => m.id === i.milestone_id)?.title || '',
          }))}
          exportCols={[
            { key: 'wbs_code', label: 'WBS Code' }, { key: 'name', label: 'Name' },
            { key: 'status', label: 'Status' }, { key: 'assignee', label: 'Assignee' },
            { key: 'planned_start', label: 'Start' }, { key: 'planned_end', label: 'End' },
            { key: 'weight', label: 'Weight %' }, { key: 'progress', label: 'Progress %' },
            { key: 'milestone', label: 'Milestone' },
          ]}
        >
          <div className="bg-white rounded-lg shadow-sm overflow-hidden border border-slate-200">
            {/* Header */}
            <div className="flex items-center gap-2 px-3 py-2 bg-slate-100 text-xs font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200">
              <span className="w-4" />
              <span className="w-16">Code</span>
              <span className="flex-1">Name / Details</span>
              <span className="w-28">Status</span>
              <span className="w-20">Progress</span>
              <span className="w-24">Actions</span>
            </div>
            {roots.map(item => renderNode(item, 0))}
          </div>
        </PanelWrapper>
      )}
    </div>
  );
}

function AddForm({ depth, form, setForm, milestones, onSubmit, onCancel }) {
  const inp = 'border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white w-full';
  return (
    <form onSubmit={onSubmit}
      className="bg-amber-50 border border-amber-200 rounded-lg p-3 mx-3 my-1 grid grid-cols-2 md:grid-cols-4 gap-2"
      style={{ marginLeft: `${12 + depth * 20}px` }}
    >
      <input value={form.wbs_code} onChange={e => setForm(f => ({ ...f, wbs_code: e.target.value }))}
        placeholder="WBS Code *" className={inp} required />
      <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
        placeholder="Name *" className={inp + ' col-span-1 md:col-span-2'} required />
      <input value={form.assignee} onChange={e => setForm(f => ({ ...f, assignee: e.target.value }))}
        placeholder="Assignee" className={inp} />
      <input type="date" value={form.planned_start} onChange={e => setForm(f => ({ ...f, planned_start: e.target.value }))} className={inp} />
      <input type="date" value={form.planned_end} onChange={e => setForm(f => ({ ...f, planned_end: e.target.value }))} className={inp} />
      <input type="number" value={form.weight} onChange={e => setForm(f => ({ ...f, weight: e.target.value }))}
        placeholder="Weight %" className={inp} min="0" max="100" />
      <select value={form.milestone_id} onChange={e => setForm(f => ({ ...f, milestone_id: e.target.value }))} className={inp}>
        <option value="">— Link to Milestone —</option>
        {milestones.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
      </select>
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