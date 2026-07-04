import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Plus, Package, Pencil, Trash2, Save, X, CheckCircle, Wand2, Loader2, Check } from 'lucide-react';
import PanelWrapper from '@/components/ui/PanelWrapper';

const STATUS_COLORS = {
  pending:     'bg-slate-100 text-slate-600',
  in_progress: 'bg-blue-100 text-blue-700',
  delivered:   'bg-amber-100 text-amber-800',
  accepted:    'bg-emerald-100 text-emerald-700',
  rejected:    'bg-red-100 text-red-700',
};

const STATUS_OPTIONS = ['pending', 'in_progress', 'delivered', 'accepted', 'rejected'];
const TYPE_OPTIONS   = ['hardware', 'software', 'document', 'service', 'training', 'other'];

const inp = 'border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white w-full';

const EMPTY = {
  name: '', description: '', type: 'hardware', status: 'pending',
  quantity: 1, unit: 'pc', milestone_id: '',
  planned_delivery_date: '', actual_delivery_date: '', acceptance_date: '',
};

export default function TabDeliverables({ projectId }) {
  const [items, setItems]       = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [adding, setAdding]     = useState(false);
  const [form, setForm]         = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [generating, setGenerating] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkField, setBulkField] = useState('');
  const [bulkValue, setBulkValue] = useState('');

  useEffect(() => { load(); }, [projectId]);

  async function load() {
    setLoading(true);
    const [d, m] = await Promise.all([
      base44.entities.Deliverable.filter({ project_id: projectId }, '-created_date', 200),
      base44.entities.Milestone.filter({ project_id: projectId }, 'planned_date', 100),
    ]);
    setItems(d);
    setMilestones(m);
    setLoading(false);
  }

  async function create(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    await base44.entities.Deliverable.create({
      ...form,
      project_id: projectId,
      quantity: Number(form.quantity) || 1,
    });
    setForm(EMPTY);
    setAdding(false);
    load();
  }

  function startEdit(item) {
    setEditingId(item.id);
    setEditForm({
      name: item.name,
      description: item.description || '',
      type: item.type || 'hardware',
      status: item.status || 'pending',
      quantity: item.quantity ?? 1,
      unit: item.unit || 'pc',
      milestone_id: item.milestone_id || '',
      planned_delivery_date: item.planned_delivery_date || '',
      actual_delivery_date: item.actual_delivery_date || '',
      acceptance_date: item.acceptance_date || '',
    });
  }

  async function saveEdit(id) {
    await base44.entities.Deliverable.update(id, {
      ...editForm,
      quantity: Number(editForm.quantity) || 1,
    });
    // If accepted, auto-complete linked milestone
    if (editForm.status === 'accepted' && editForm.milestone_id) {
      await base44.entities.Milestone.update(editForm.milestone_id, {
        status: 'completed',
        completed_date: editForm.acceptance_date || new Date().toISOString().slice(0, 10),
      });
    }
    setEditingId(null);
    load();
  }

  async function deleteItem(id) {
    await base44.entities.Deliverable.delete(id);
    load();
  }

  async function quickStatus(item, status) {
    const update = { status };
    if (status === 'accepted' && !item.acceptance_date)
      update.acceptance_date = new Date().toISOString().slice(0, 10);
    await base44.entities.Deliverable.update(item.id, update);
    if (status === 'accepted' && item.milestone_id) {
      await base44.entities.Milestone.update(item.milestone_id, {
        status: 'completed',
        completed_date: update.acceptance_date || item.acceptance_date,
      });
    }
    load();
  }

  async function autoGenerate() {
    if (!confirm('This will create deliverables from BOM items (panel, software & IT-HW as combined lines, others individually). Continue?')) return;
    setGenerating(true);
    try {
      const bomItems = await base44.entities.BOMItem.filter({ project_id: projectId }, 'category', 500);

      const toCreate = [];

      // Panel items → one deliverable per individual panel item
      const panelItems = bomItems.filter(i => i.category === 'panel');
      for (const item of panelItems) {
        // Extract just the panel name: take the first meaningful segment before any dash-separated suffix details
        // or use the raw description as-is if it looks like a clean name already
        const rawName = item.description || item.manufacturer_part_number || 'Panel / Enclosure';
        // Strip common generic prefixes like "Supply of", "Supply and Install", "Manufacture of", etc.
        const panelName = rawName
          .replace(/^(supply\s+(of\s+|and\s+install\s+of\s+)?|manufacture\s+of\s+|fabrication\s+of\s+|provision\s+of\s+)/i, '')
          .trim();
        toCreate.push({
          project_id: projectId,
          name: panelName,
          description: item.manufacturer_part_number ? `Part No: ${item.manufacturer_part_number}` : '',
          type: 'hardware',
          status: 'pending',
          quantity: Number(item.quantity) || 1,
          unit: item.unit || 'pc',
        });
      }

      // Software items → one combined deliverable
      const softwareItems = bomItems.filter(i => i.category === 'software');
      if (softwareItems.length > 0) {
        const names = [...new Set(softwareItems.map(i => i.description).filter(Boolean))];
        toCreate.push({
          project_id: projectId,
          name: `Software & Licenses (${softwareItems.length} items)`,
          description: names.slice(0, 5).join(', ') + (names.length > 5 ? '…' : ''),
          type: 'software',
          status: 'pending',
          quantity: softwareItems.reduce((s, i) => s + (Number(i.quantity) || 1), 0),
          unit: 'license',
        });
      }

      // IT-HW items → one combined deliverable
      const itHwItems = bomItems.filter(i => i.category === 'IT-HW');
      if (itHwItems.length > 0) {
        const names = [...new Set(itHwItems.map(i => i.description).filter(Boolean))];
        toCreate.push({
          project_id: projectId,
          name: `IT Hardware (${itHwItems.length} items)`,
          description: names.slice(0, 5).join(', ') + (names.length > 5 ? '…' : ''),
          type: 'hardware',
          status: 'pending',
          quantity: itHwItems.reduce((s, i) => s + (Number(i.quantity) || 1), 0),
          unit: 'pc',
        });
      }

      // All other categories → individual deliverables per item (excluding ignored categories)
      const groupedCats = new Set(['panel', 'software', 'IT-HW']);
      const ignoredCats = new Set(['plc', 'hmi', 'drive', 'cable', 'network', 'service', 'other']);
      const otherItems = bomItems.filter(i => !groupedCats.has(i.category) && !ignoredCats.has(i.category));
      for (const item of otherItems) {
        toCreate.push({
          project_id: projectId,
          name: item.description || item.manufacturer_part_number || 'BOM Item',
          description: item.manufacturer_part_number ? `Part No: ${item.manufacturer_part_number}` : '',
          type: 'hardware',
          status: 'pending',
          quantity: Number(item.quantity) || 1,
          unit: item.unit || 'pc',
        });
      }

      await base44.entities.Deliverable.bulkCreate(toCreate);
      load();
    } finally {
      setGenerating(false);
    }
  }

  function toggleSelect(id) {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleSelectAll(visibleItems) {
    const allSel = visibleItems.every(i => selectedIds.has(i.id));
    setSelectedIds(allSel ? new Set() : new Set(visibleItems.map(i => i.id)));
  }

  async function bulkDelete() {
    await Promise.allSettled([...selectedIds].map(id => base44.entities.Deliverable.delete(id)));
    setSelectedIds(new Set());
    load();
  }

  async function applyBulkEdit() {
    if (!bulkField || !bulkValue) return;
    await Promise.all([...selectedIds].map(id => base44.entities.Deliverable.update(id, { [bulkField]: bulkValue })));
    setBulkField(''); setBulkValue('');
    setSelectedIds(new Set());
    load();
  }

  const milestoneById = Object.fromEntries(milestones.map(m => [m.id, m]));

  // Group deliverables by milestone
  const milestoneIds = new Set(milestones.map(m => m.id));
  const groups = milestones
    .map(m => ({ milestone: m, items: items.filter(d => d.milestone_id === m.id) }))
    .filter(g => g.items.length > 0);
  // Ungrouped = no milestone OR milestone that no longer exists
  const ungrouped = items.filter(d => !d.milestone_id || !milestoneIds.has(d.milestone_id));

  const accepted = items.filter(d => d.status === 'accepted').length;

  if (loading) return <div className="flex justify-center py-12"><div className="w-7 h-7 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi label="Total Deliverables" value={items.length} color="border-blue-400" />
        <Kpi label="Accepted" value={accepted} color="border-emerald-400" />
        <Kpi label="Pending / In Progress" value={items.filter(d => ['pending','in_progress'].includes(d.status)).length} color="border-amber-400" />
        <Kpi label="Linked to Milestones" value={items.filter(d => d.milestone_id).length} color="border-purple-400" />
      </div>

      {/* Toolbar */}
      <div className="flex justify-end gap-2">
        <button onClick={autoGenerate} disabled={generating}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm rounded disabled:opacity-50">
          {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
          Auto-Generate from BOM
        </button>
        <button onClick={() => { setAdding(v => !v); setForm(EMPTY); }}
          className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded">
          <Plus className="w-4 h-4" /> Add Deliverable
        </button>
      </div>

      {/* Add form */}
      {adding && (
        <form onSubmit={create} className="bg-amber-50 border border-amber-200 rounded-lg p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="Name *" className={inp + ' col-span-2'} required />
          <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className={inp}>
            {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className={inp}>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
          <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            placeholder="Description" className={inp + ' col-span-2 md:col-span-4'} />
          <input type="number" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
            placeholder="Qty" className={inp} min="0" />
          <input value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
            placeholder="Unit" className={inp} />
          <select value={form.milestone_id} onChange={e => setForm(f => ({ ...f, milestone_id: e.target.value }))} className={inp + ' col-span-2'}>
            <option value="">— Link to Milestone —</option>
            {milestones.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
          </select>
          <div><label className="text-xs text-slate-400 block mb-0.5">Planned Delivery</label>
            <input type="date" value={form.planned_delivery_date} onChange={e => setForm(f => ({ ...f, planned_delivery_date: e.target.value }))} className={inp} /></div>
          <div><label className="text-xs text-slate-400 block mb-0.5">Actual Delivery</label>
            <input type="date" value={form.actual_delivery_date} onChange={e => setForm(f => ({ ...f, actual_delivery_date: e.target.value }))} className={inp} /></div>
          <div className="col-span-2 md:col-span-4 flex gap-2">
            <button type="submit" className="px-4 py-2 bg-amber-500 text-slate-900 font-semibold text-sm rounded hover:bg-amber-400">Save</button>
            <button type="button" onClick={() => setAdding(false)} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded hover:bg-slate-100">Cancel</button>
          </div>
        </form>
      )}

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 bg-slate-800 text-white rounded-lg px-4 py-2.5 text-sm">
          <span className="font-semibold text-amber-400">{selectedIds.size} selected</span>
          <span className="text-slate-400">·</span>
          <span className="text-slate-300 text-xs">Bulk edit:</span>
          <select value={bulkField} onChange={e => { setBulkField(e.target.value); setBulkValue(''); }}
            className="text-xs bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white focus:outline-none focus:border-amber-400">
            <option value="">Field…</option>
            <option value="status">Status</option>
            <option value="type">Type</option>
            <option value="milestone_id">Milestone</option>
          </select>
          {bulkField === 'status' && (
            <select value={bulkValue} onChange={e => setBulkValue(e.target.value)}
              className="text-xs bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white focus:outline-none focus:border-amber-400">
              <option value="">Value…</option>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
            </select>
          )}
          {bulkField === 'type' && (
            <select value={bulkValue} onChange={e => setBulkValue(e.target.value)}
              className="text-xs bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white focus:outline-none focus:border-amber-400">
              <option value="">Value…</option>
              {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          {bulkField === 'milestone_id' && (
            <select value={bulkValue} onChange={e => setBulkValue(e.target.value)}
              className="text-xs bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white focus:outline-none focus:border-amber-400">
              <option value="">Value…</option>
              {milestones.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
            </select>
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

      {items.length === 0 && !adding ? (
        <div className="text-center py-14 text-slate-400">
          <Package className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No deliverables yet.</p>
        </div>
      ) : (
        <PanelWrapper title="Deliverables"
          exportData={items.map(d => ({
            name: d.name, type: d.type, status: d.status,
            quantity: d.quantity, unit: d.unit,
            milestone: milestoneById[d.milestone_id]?.title || '',
            planned_delivery: d.planned_delivery_date || '',
            actual_delivery: d.actual_delivery_date || '',
            acceptance_date: d.acceptance_date || '',
          }))}
          exportCols={[
            { key: 'name', label: 'Name' }, { key: 'type', label: 'Type' },
            { key: 'status', label: 'Status' }, { key: 'quantity', label: 'Qty' },
            { key: 'unit', label: 'Unit' }, { key: 'milestone', label: 'Milestone' },
            { key: 'planned_delivery', label: 'Planned Delivery' },
            { key: 'actual_delivery', label: 'Actual Delivery' },
            { key: 'acceptance_date', label: 'Acceptance Date' },
          ]}
        >
          <div className="space-y-4">
            {/* Grouped by milestone */}
            {groups.map(({ milestone, items: gItems }) => (
              <div key={milestone.id} className="bg-white rounded-lg shadow-sm overflow-hidden border border-slate-200">
                <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-amber-500" />
                  <span className="font-semibold text-amber-800 text-sm">{milestone.title}</span>
                  <span className={`ml-auto text-xs px-2 py-0.5 rounded font-semibold ${milestone.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                    {milestone.status?.replace(/_/g, ' ')}
                  </span>
                </div>
                <DeliverableTable items={gItems} editingId={editingId} editForm={editForm}
                  setEditForm={setEditForm} milestones={milestones} inp={inp}
                  onEdit={startEdit} onSave={saveEdit} onCancel={() => setEditingId(null)}
                  onDelete={deleteItem} onQuickStatus={quickStatus}
                  selectedIds={selectedIds} onToggle={toggleSelect} onToggleAll={toggleSelectAll} />
              </div>
            ))}

            {/* Ungrouped */}
            {ungrouped.length > 0 && (
              <div className="bg-white rounded-lg shadow-sm overflow-hidden border border-slate-200">
                <div className="px-4 py-2 bg-slate-50 border-b border-slate-200">
                  <span className="font-semibold text-slate-600 text-sm">Not linked to a milestone</span>
                </div>
                <DeliverableTable items={ungrouped} editingId={editingId} editForm={editForm}
                  setEditForm={setEditForm} milestones={milestones} inp={inp}
                  onEdit={startEdit} onSave={saveEdit} onCancel={() => setEditingId(null)}
                  onDelete={deleteItem} onQuickStatus={quickStatus}
                  selectedIds={selectedIds} onToggle={toggleSelect} onToggleAll={toggleSelectAll} />
              </div>
            )}
          </div>
        </PanelWrapper>
      )}
    </div>
  );
}

function DeliverableTable({ items, editingId, editForm, setEditForm, milestones, inp, onEdit, onSave, onCancel, onDelete, onQuickStatus, selectedIds, onToggle, onToggleAll }) {
  const allSel = items.length > 0 && items.every(i => selectedIds.has(i.id));
  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-50 text-slate-500 text-xs uppercase border-b border-slate-200">
        <tr>
          <th className="px-3 py-2 w-8">
            <button onClick={() => onToggleAll(items)} className="flex items-center justify-center">
              <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${allSel ? 'bg-amber-400 border-amber-400' : 'border-slate-300 hover:border-amber-400'}`}>
                {allSel && <Check className="w-2.5 h-2.5 text-slate-900" />}
              </div>
            </button>
          </th>
          <th className="px-4 py-2 text-left">Name</th>
          <th className="px-4 py-2 text-left">Type</th>
          <th className="px-4 py-2 text-left">Qty</th>
          <th className="px-4 py-2 text-left">Status</th>
          <th className="px-4 py-2 text-left">Planned Delivery</th>
          <th className="px-4 py-2 text-left">Actual Delivery</th>
          <th className="px-4 py-2 text-left">Milestone</th>
          <th className="px-4 py-2 w-20"></th>
        </tr>
      </thead>
      <tbody>
        {items.map(d => {
          const isEditing = editingId === d.id;
          const msTitle = milestones.find(m => m.id === d.milestone_id)?.title;
          return (
            <tr key={d.id} className={`border-t border-slate-100 hover:bg-slate-50 ${selectedIds.has(d.id) ? 'bg-amber-50' : ''}`}>
              <td className="px-3 py-2">
                <button onClick={() => onToggle(d.id)} className="flex items-center justify-center">
                  <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${selectedIds.has(d.id) ? 'bg-amber-400 border-amber-400' : 'border-slate-300 hover:border-amber-400'}`}>
                    {selectedIds.has(d.id) && <Check className="w-2.5 h-2.5 text-slate-900" />}
                  </div>
                </button>
              </td>
              <td className="px-4 py-2">
                {isEditing
                  ? <input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} className={inp} />
                  : <div><div className="font-medium text-slate-800">{d.name}</div>{d.description && <div className="text-xs text-slate-400">{d.description}</div>}</div>}
              </td>
              <td className="px-4 py-2">
                {isEditing
                  ? <select value={editForm.type} onChange={e => setEditForm(f => ({ ...f, type: e.target.value }))} className={inp}>
                      {['hardware','software','document','service','training','other'].map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  : <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">{d.type}</span>}
              </td>
              <td className="px-4 py-2">
                {isEditing
                  ? <input type="number" value={editForm.quantity} onChange={e => setEditForm(f => ({ ...f, quantity: e.target.value }))} className={inp} style={{ width: 60 }} min="0" />
                  : <span>{d.quantity} {d.unit}</span>}
              </td>
              <td className="px-4 py-2">
                {isEditing
                  ? <select value={editForm.status} onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))} className={inp}>
                      {['pending','in_progress','delivered','accepted','rejected'].map(s => <option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
                    </select>
                  : <select value={d.status} onChange={e => onQuickStatus(d, e.target.value)}
                      className={`text-xs px-2 py-1 rounded font-semibold border-0 cursor-pointer ${STATUS_COLORS[d.status] || 'bg-slate-100 text-slate-600'}`}>
                      {['pending','in_progress','delivered','accepted','rejected'].map(s => <option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
                    </select>}
              </td>
              <td className="px-4 py-2 text-slate-600">
                {isEditing
                  ? <input type="date" value={editForm.planned_delivery_date} onChange={e => setEditForm(f => ({ ...f, planned_delivery_date: e.target.value }))} className={inp} />
                  : d.planned_delivery_date || '—'}
              </td>
              <td className="px-4 py-2 text-slate-600">
                {isEditing
                  ? <input type="date" value={editForm.actual_delivery_date} onChange={e => setEditForm(f => ({ ...f, actual_delivery_date: e.target.value }))} className={inp} />
                  : d.actual_delivery_date || '—'}
              </td>
              <td className="px-4 py-2">
                {isEditing
                  ? <select value={editForm.milestone_id} onChange={e => setEditForm(f => ({ ...f, milestone_id: e.target.value }))} className={inp}>
                      <option value="">— None —</option>
                      {milestones.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
                    </select>
                  : msTitle
                    ? <span className="text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded">🏁 {msTitle}</span>
                    : <span className="text-xs text-slate-400">—</span>}
              </td>
              <td className="px-4 py-2">
                <div className="flex gap-1">
                  {isEditing
                    ? <><button onClick={() => onSave(d.id)} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"><Save className="w-4 h-4" /></button>
                        <button onClick={onCancel} className="p-1 text-slate-400 hover:bg-slate-100 rounded"><X className="w-4 h-4" /></button></>
                    : <><button onClick={() => onEdit(d)} className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => onDelete(d.id)} className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 className="w-4 h-4" /></button></>}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Kpi({ label, value, color }) {
  return (
    <div className={`bg-white rounded-lg shadow-sm p-4 border-l-4 ${color}`}>
      <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">{label}</div>
      <div className="text-2xl font-semibold text-slate-800">{value}</div>
    </div>
  );
}