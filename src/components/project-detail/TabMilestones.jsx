import { useState, useEffect, useMemo, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { formatDate } from '@/lib/constants';
import { Plus, Flag, Pencil, Trash2, Save, X, Layers, Check } from 'lucide-react';
import PanelWrapper from '@/components/ui/PanelWrapper';

const STATUS_COLORS = {
  pending:     'bg-slate-100 text-slate-600',
  in_progress: 'bg-blue-100 text-blue-700',
  completed:   'bg-emerald-100 text-emerald-700',
  overdue:     'bg-red-100 text-red-700',
};

function buildTree(items) {
  const tree = {};
  items.forEach(i => {
    const pid = i.parent_id || '__root__';
    if (!tree[pid]) tree[pid] = [];
    tree[pid].push(i);
  });
  return tree;
}

function rollupProgress(id, tree, byId) {
  const children = tree[id] || [];
  if (children.length === 0) return byId[id]?.progress || 0;
  const childProgresses = children.map(c => ({ p: rollupProgress(c.id, tree, byId), w: c.weight || 1 }));
  const totalWeight = childProgresses.reduce((s, c) => s + c.w, 0);
  return Math.round(childProgresses.reduce((s, c) => s + c.p * c.w, 0) / (totalWeight || 1));
}

function computeMilestoneProgress(milestoneId, wbsItems) {
  const linked = wbsItems.filter(i => i.milestone_id === milestoneId);
  if (linked.length === 0) return null;
  const tree = buildTree(wbsItems);
  const byId = Object.fromEntries(wbsItems.map(i => [i.id, i]));
  const totalWeight = linked.reduce((s, i) => s + (i.weight || 1), 0);
  const weighted = linked.reduce((s, i) => s + rollupProgress(i.id, tree, byId) * (i.weight || 1), 0);
  return Math.round(weighted / (totalWeight || 1));
}

export default function TabMilestones({ projectId }) {
  const [milestones, setMilestones] = useState([]);
  const [wbsItems, setWbsItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: '', planned_date: '', weight: '' });
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkField, setBulkField] = useState('');
  const [bulkValue, setBulkValue] = useState('');

  useEffect(() => { load(); }, [projectId]);

  async function load() {
    setLoading(true);
    const [m, w] = await Promise.all([
      base44.entities.Milestone.filter({ project_id: projectId }, 'planned_date', 100),
      base44.entities.WBSItem.filter({ project_id: projectId }, 'wbs_code', 500),
    ]);
    setMilestones(m);
    setWbsItems(w);
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

  function startEdit(m) {
    setEditingId(m.id);
    setEditForm({ title: m.title, planned_date: m.planned_date || '', weight: m.weight || '' });
  }

  async function saveEdit(id) {
    await base44.entities.Milestone.update(id, { ...editForm, weight: Number(editForm.weight) || 0 });
    setEditingId(null);
    load();
  }

  async function deleteMilestone(id) {
    if (!confirm('Delete this milestone?')) return;
    await base44.entities.Milestone.delete(id);
    load();
  }

  function toggleSelect(id) {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleSelectAll() {
    setSelectedIds(milestones.every(m => selectedIds.has(m.id)) ? new Set() : new Set(milestones.map(m => m.id)));
  }
  async function bulkDelete() {
    if (!confirm(`Delete ${selectedIds.size} milestones?`)) return;
    await Promise.all([...selectedIds].map(id => base44.entities.Milestone.delete(id)));
    setSelectedIds(new Set()); setBulkField(''); setBulkValue('');
    load();
  }
  async function applyBulkEdit() {
    if (!bulkField || !bulkValue) return;
    await Promise.all([...selectedIds].map(id => base44.entities.Milestone.update(id, { [bulkField]: bulkValue })));
    setBulkField(''); setBulkValue(''); setSelectedIds(new Set());
    load();
  }

  if (loading) return <Spinner />;

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-slate-500">{milestones.length} milestone{milestones.length !== 1 ? 's' : ''}</p>
        <button onClick={() => setAdding(v => !v)} className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded">
          <Plus className="w-4 h-4" /> Add Milestone
        </button>
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 bg-slate-800 text-white rounded-lg px-4 py-2.5 text-sm mb-4">
          <span className="font-semibold text-amber-400">{selectedIds.size} selected</span>
          <span className="text-slate-400">·</span>
          <span className="text-slate-300 text-xs">Bulk edit:</span>
          <select value={bulkField} onChange={e => { setBulkField(e.target.value); setBulkValue(''); }}
            className="text-xs bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white focus:outline-none focus:border-amber-400">
            <option value="">Field…</option>
            <option value="status">Status</option>
            <option value="planned_date">Planned Date</option>
          </select>
          {bulkField === 'status' && (
            <select value={bulkValue} onChange={e => setBulkValue(e.target.value)}
              className="text-xs bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white focus:outline-none focus:border-amber-400">
              <option value="">Value…</option>
              {['pending','in_progress','completed','overdue'].map(s => <option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
            </select>
          )}
          {bulkField === 'planned_date' && (
            <input type="date" value={bulkValue} onChange={e => setBulkValue(e.target.value)}
              className="text-xs bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white focus:outline-none focus:border-amber-400" />
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
          <button onClick={() => { setSelectedIds(new Set()); setBulkField(''); setBulkValue(''); }}
            className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {adding && (
        <form onSubmit={create} className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Milestone title *" className={inp} required />
          <input type="date" value={form.planned_date} onChange={e => setForm(f => ({ ...f, planned_date: e.target.value }))} className={inp} />
          <input type="number" value={form.weight} onChange={e => setForm(f => ({ ...f, weight: e.target.value }))} placeholder="Weight %" className={inp} min="0" max="100" />
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
        <PanelWrapper title="Milestones" exportData={milestones} exportCols={[
          { key: 'title', label: 'Title' }, { key: 'status', label: 'Status' },
          { key: 'planned_date', label: 'Planned Date' }, { key: 'completed_date', label: 'Completed Date' },
          { key: 'weight', label: 'Weight %' }, { key: 'progress', label: 'Progress %' },
        ]}>
          <div className="space-y-2">
            {/* Select all */}
            {milestones.length > 0 && (
              <div className="flex items-center gap-2 px-2 py-1">
                <button onClick={toggleSelectAll} className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-700">
                  <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${milestones.every(m => selectedIds.has(m.id)) ? 'bg-amber-400 border-amber-400' : 'border-slate-300'}`}>
                    {milestones.every(m => selectedIds.has(m.id)) && <Check className="w-2.5 h-2.5 text-slate-900" />}
                  </div>
                  Select all
                </button>
              </div>
            )}
            {milestones.map(m => {
              const isEditing = editingId === m.id;
              const wbsProgress = computeMilestoneProgress(m.id, wbsItems);
              const displayProgress = wbsProgress !== null ? wbsProgress : (m.progress || 0);
              const linkedCount = wbsItems.filter(i => i.milestone_id === m.id).length;
              const isSelected = selectedIds.has(m.id);

              return (
                <div key={m.id} className={`bg-white rounded-lg shadow-sm px-4 py-3 flex flex-col gap-2 border ${isSelected ? 'border-amber-300 bg-amber-50/30' : 'border-transparent'}`}>
                  <div className="flex flex-wrap items-center gap-3">
                    {/* Checkbox */}
                    <button onClick={() => toggleSelect(m.id)} className="shrink-0">
                      <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${isSelected ? 'bg-amber-400 border-amber-400' : 'border-slate-300 hover:border-amber-400'}`}>
                        {isSelected && <Check className="w-2.5 h-2.5 text-slate-900" />}
                      </div>
                    </button>
                    <Flag className="w-4 h-4 text-amber-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <div className="flex gap-2 flex-wrap">
                          <input value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} className={inp} placeholder="Title" style={{ maxWidth: 200 }} />
                          <input type="date" value={editForm.planned_date} onChange={e => setEditForm(f => ({ ...f, planned_date: e.target.value }))} className={inp} style={{ maxWidth: 160 }} />
                          <input type="number" value={editForm.weight} onChange={e => setEditForm(f => ({ ...f, weight: e.target.value }))} placeholder="Weight %" className={inp} min="0" max="100" style={{ maxWidth: 100 }} />
                        </div>
                      ) : (
                        <>
                          <div className="font-semibold text-slate-800 text-sm">{m.title}</div>
                          <div className="flex flex-wrap gap-2 mt-0.5 text-xs text-slate-500">
                            {m.planned_date && <span>Planned: {formatDate(m.planned_date)}</span>}
                            {m.completed_date && <span className="text-emerald-600">✓ Completed: {formatDate(m.completed_date)}</span>}
                            {m.weight > 0 && <span>Weight: {m.weight}%</span>}
                            {linkedCount > 0 && (
                              <span className="flex items-center gap-0.5 text-blue-600">
                                <Layers className="w-3 h-3" /> {linkedCount} WBS item{linkedCount !== 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                    {!isEditing && (
                      <select value={m.status} onChange={e => updateStatus(m, e.target.value)}
                        className={`text-xs px-2 py-1 rounded font-semibold border-0 cursor-pointer shrink-0 ${STATUS_COLORS[m.status] || 'bg-slate-100 text-slate-600'}`}>
                        {['pending', 'in_progress', 'completed', 'overdue'].map(s => (
                          <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                        ))}
                      </select>
                    )}
                    <div className="flex gap-1 shrink-0">
                      {isEditing ? (
                        <>
                          <button onClick={() => saveEdit(m.id)} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"><Save className="w-4 h-4" /></button>
                          <button onClick={() => setEditingId(null)} className="p-1 text-slate-400 hover:bg-slate-100 rounded"><X className="w-4 h-4" /></button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => startEdit(m)} className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded"><Pencil className="w-4 h-4" /></button>
                          <button onClick={() => deleteMilestone(m.id)} className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 className="w-4 h-4" /></button>
                        </>
                      )}
                    </div>
                  </div>

                  {!isEditing && (displayProgress > 0 || linkedCount > 0) && (
                    <div className="pl-7">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                          <div
                            className={`h-2 rounded-full transition-all duration-500 ${displayProgress === 100 ? 'bg-emerald-500' : 'bg-amber-500'}`}
                            style={{ width: `${displayProgress}%` }}
                          />
                        </div>
                        <span className="text-xs font-semibold text-slate-600 w-10 text-right">{displayProgress}%</span>
                        {wbsProgress !== null && (
                          <span className="text-xs text-blue-500 whitespace-nowrap">← from WBS</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </PanelWrapper>
      )}
    </div>
  );
}

const inp = 'border border-slate-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white w-full';
function Spinner() {
  return <div className="flex justify-center py-12"><div className="w-7 h-7 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;
}