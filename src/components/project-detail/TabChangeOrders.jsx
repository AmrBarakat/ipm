import { useState } from 'react';
import { useEntityList, useEntityMutation } from '@/hooks/useEntity';
import { formatCurrency, formatDate } from '@/lib/constants';
import { Plus, FileEdit, Trash2, Save, X, Pencil, TrendingUp, Percent } from 'lucide-react';
import SkeletonTable from '@/components/ui/SkeletonTable';
import EmptyState from '@/components/ui/EmptyState';
import { useConfirm } from '@/components/ui/ConfirmDialog';

const CO_STATUS_LABELS = {
  pending: 'Pending',
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
  implemented: 'Implemented',
};

const CO_STATUS_COLORS = {
  pending: 'bg-slate-100 text-slate-600',
  submitted: 'bg-blue-100 text-blue-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
  implemented: 'bg-purple-100 text-purple-700',
};

const CO_TYPE_LABELS = {
  scope: 'Scope',
  cost: 'Cost',
  schedule: 'Schedule',
  scope_cost: 'Scope + Cost',
  scope_schedule: 'Scope + Schedule',
  all: 'All',
};

const EMPTY_FORM = {
  title: '',
  description: '',
  type: 'scope',
  status: 'pending',
  impact_cost: '',
  impact_days: '',
  co_cost: '',
  co_selling: '',
  submitted_by: '',
  approved_by: '',
  submitted_date: '',
  approved_date: '',
};

function profitMargin(co_cost, co_selling) {
  const cost = Number(co_cost);
  const sell = Number(co_selling);
  if (!isFinite(cost) || !isFinite(sell)) return null;
  if (cost === 0 && sell === 0) return null;
  const profit = sell - cost;
  const margin = sell > 0 ? Math.round((profit / sell) * 100) : null;
  return { profit, margin };
}

const inp = 'border border-slate-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white w-full';
const num = 'border border-slate-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white w-full';

export default function TabChangeOrders({ projectId, project }) {
  const { data: changeOrders = [], isLoading } = useEntityList('ChangeOrder', { project_id: projectId }, '-created_date', 200);
  const mutation = useEntityMutation('ChangeOrder');
  const confirmDialog = useConfirm();

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);

  const currency = project?.currency || 'SAR';

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }));
  }
  function setEdit(field, value) {
    setEditForm(f => ({ ...f, [field]: value }));
  }

  async function create(e) {
    e.preventDefault();
    if (!form.title.trim()) return;
    await mutation.mutateAsync({
      action: 'create',
      data: {
        ...form,
        project_id: projectId,
        impact_cost: Number(form.impact_cost) || 0,
        impact_days: Number(form.impact_days) || 0,
        co_cost: Number(form.co_cost) || 0,
        co_selling: Number(form.co_selling) || 0,
      },
    });
    setForm(EMPTY_FORM);
    setAdding(false);
  }

  function startEdit(co) {
    setEditingId(co.id);
    setEditForm({
      title: co.title || '',
      description: co.description || '',
      type: co.type || 'scope',
      status: co.status || 'pending',
      impact_cost: co.impact_cost ?? '',
      impact_days: co.impact_days ?? '',
      co_cost: co.co_cost ?? '',
      co_selling: co.co_selling ?? '',
      submitted_by: co.submitted_by || '',
      approved_by: co.approved_by || '',
      submitted_date: co.submitted_date || '',
      approved_date: co.approved_date || '',
    });
  }

  async function saveEdit(id) {
    await mutation.mutateAsync({
      action: 'update',
      id,
      data: {
        ...editForm,
        impact_cost: Number(editForm.impact_cost) || 0,
        impact_days: Number(editForm.impact_days) || 0,
        co_cost: Number(editForm.co_cost) || 0,
        co_selling: Number(editForm.co_selling) || 0,
      },
    });
    setEditingId(null);
  }

  async function remove(id) {
    if (!(await confirmDialog({ title: 'Delete change order', description: 'Delete this change order?', confirmText: 'Delete', destructive: true }))) return;
    await mutation.mutateAsync({ action: 'delete', id });
  }

  if (isLoading) return <SkeletonTable columns={6} rows={5} />;

  const livePm = profitMargin(form.co_cost, form.co_selling);

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-slate-700 flex items-center gap-2">
          <FileEdit className="w-4 h-4 text-amber-500" /> Change Orders
          <span className="text-slate-400 font-normal">({changeOrders.length})</span>
        </h3>
        <button
          onClick={() => setAdding(v => !v)}
          className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded"
        >
          <Plus className="w-4 h-4" /> New Change Order
        </button>
      </div>

      {/* Add form */}
      {adding && (
        <form onSubmit={create} className="bg-amber-50 border border-amber-200 rounded-lg p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <input value={form.title} onChange={e => set('title', e.target.value)} placeholder="Title *" className={inp + ' md:col-span-2'} required />
          <select value={form.type} onChange={e => set('type', e.target.value)} className={inp}>
            {Object.entries(CO_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <textarea value={form.description} onChange={e => set('description', e.target.value)} placeholder="Description" className={inp + ' md:col-span-3 min-h-[70px]'} />
          <select value={form.status} onChange={e => set('status', e.target.value)} className={inp}>
            {Object.entries(CO_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input type="number" value={form.impact_cost} onChange={e => set('impact_cost', e.target.value)} placeholder="Impact Cost" className={num} />
          <input type="number" value={form.impact_days} onChange={e => set('impact_days', e.target.value)} placeholder="Impact Days" className={num} />
          <input type="number" value={form.co_cost} onChange={e => set('co_cost', e.target.value)} placeholder="CO Cost" className={num} min="0" />
          <input type="number" value={form.co_selling} onChange={e => set('co_selling', e.target.value)} placeholder="CO Selling" className={num} min="0" />
          <div className="flex items-center gap-3 text-xs">
            {livePm ? (
              <>
                <span className="flex items-center gap-1 text-slate-600">
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                  Profit: <span className={livePm.profit >= 0 ? 'text-emerald-700 font-semibold' : 'text-red-600 font-semibold'}>{formatCurrency(livePm.profit, currency)}</span>
                </span>
                <span className="flex items-center gap-1 text-slate-600">
                  <Percent className="w-3.5 h-3.5 text-slate-400" />
                  Margin: <span className={livePm.margin >= 0 ? 'text-emerald-700 font-semibold' : 'text-red-600 font-semibold'}>{livePm.margin}%</span>
                </span>
              </>
            ) : <span className="text-slate-400">Enter CO Cost &amp; Selling for profit/margin</span>}
          </div>
          <input value={form.submitted_by} onChange={e => set('submitted_by', e.target.value)} placeholder="Submitted By" className={inp} />
          <input value={form.approved_by} onChange={e => set('approved_by', e.target.value)} placeholder="Approved By" className={inp} />
          <input type="date" value={form.submitted_date} onChange={e => set('submitted_date', e.target.value)} className={inp} />
          <input type="date" value={form.approved_date} onChange={e => set('approved_date', e.target.value)} className={inp} />
          <div className="md:col-span-3 flex gap-2">
            <button type="submit" className="px-4 py-2 bg-amber-500 text-slate-900 font-semibold text-sm rounded hover:bg-amber-400">Save</button>
            <button type="button" onClick={() => { setAdding(false); setForm(EMPTY_FORM); }} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded hover:bg-slate-100">Cancel</button>
          </div>
        </form>
      )}

      {/* List */}
      {changeOrders.length === 0 ? (
        <EmptyState
          icon={<FileEdit className="w-12 h-12 opacity-40" />}
          title="No change orders yet"
          message="Track scope, cost, and schedule changes with live profit and margin calculation."
          actions={[
            { label: 'New Change Order', primary: true, icon: <Plus className="w-4 h-4" />, onClick: () => setAdding(true) },
          ]}
        />
      ) : (
        <div className="bg-white rounded-lg shadow-sm overflow-x-auto">
          <table className="w-full text-sm min-w-[1100px]">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase border-b">
              <tr>
                <th className="px-4 py-3 text-left">Title</th>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-right">Impact Cost</th>
                <th className="px-4 py-3 text-right">Impact Days</th>
                <th className="px-4 py-3 text-right">CO Cost</th>
                <th className="px-4 py-3 text-right">CO Selling</th>
                <th className="px-4 py-3 text-right">Profit</th>
                <th className="px-4 py-3 text-right">Margin</th>
                <th className="px-4 py-3 text-left">Submitted</th>
                <th className="px-4 py-3 text-left">Approved</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {changeOrders.map(co => {
                const pm = profitMargin(co.co_cost, co.co_selling);
                const isEditing = editingId === co.id;
                if (isEditing) {
                  const editPm = profitMargin(editForm.co_cost, editForm.co_selling);
                  return (
                    <tr key={co.id} className="border-t border-slate-100 bg-amber-50/40">
                      <td className="px-4 py-3">
                        <input value={editForm.title} onChange={e => setEdit('title', e.target.value)} className={inp} />
                        <textarea value={editForm.description} onChange={e => setEdit('description', e.target.value)} placeholder="Description" className={inp + ' mt-1 min-h-[50px]'} />
                      </td>
                      <td className="px-4 py-3">
                        <select value={editForm.type} onChange={e => setEdit('type', e.target.value)} className={inp}>
                          {Object.entries(CO_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <select value={editForm.status} onChange={e => setEdit('status', e.target.value)} className={inp}>
                          {Object.entries(CO_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-3"><input type="number" value={editForm.impact_cost} onChange={e => setEdit('impact_cost', e.target.value)} className={num} /></td>
                      <td className="px-4 py-3"><input type="number" value={editForm.impact_days} onChange={e => setEdit('impact_days', e.target.value)} className={num} /></td>
                      <td className="px-4 py-3"><input type="number" value={editForm.co_cost} onChange={e => setEdit('co_cost', e.target.value)} className={num} min="0" /></td>
                      <td className="px-4 py-3"><input type="number" value={editForm.co_selling} onChange={e => setEdit('co_selling', e.target.value)} className={num} min="0" /></td>
                      <td className="px-4 py-3 text-right text-xs">
                        {editPm ? <span className={editPm.profit >= 0 ? 'text-emerald-700 font-semibold' : 'text-red-600 font-semibold'}>{formatCurrency(editPm.profit, currency)}</span> : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-xs">
                        {editPm ? <span className={editPm.margin >= 0 ? 'text-emerald-700 font-semibold' : 'text-red-600 font-semibold'}>{editPm.margin}%</span> : '—'}
                      </td>
                      <td className="px-4 py-3 space-y-1">
                        <input value={editForm.submitted_by} onChange={e => setEdit('submitted_by', e.target.value)} placeholder="By" className={inp} />
                        <input type="date" value={editForm.submitted_date} onChange={e => setEdit('submitted_date', e.target.value)} className={inp} />
                      </td>
                      <td className="px-4 py-3 space-y-1">
                        <input value={editForm.approved_by} onChange={e => setEdit('approved_by', e.target.value)} placeholder="By" className={inp} />
                        <input type="date" value={editForm.approved_date} onChange={e => setEdit('approved_date', e.target.value)} className={inp} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button onClick={() => saveEdit(co.id)} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"><Save className="w-4 h-4" /></button>
                          <button onClick={() => setEditingId(null)} className="p-1 text-slate-400 hover:bg-slate-100 rounded"><X className="w-4 h-4" /></button>
                        </div>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={co.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{co.title}</div>
                      {co.description && <div className="text-xs text-slate-500 mt-0.5 line-clamp-2 max-w-md">{co.description}</div>}
                    </td>
                    <td className="px-4 py-3"><span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-600">{CO_TYPE_LABELS[co.type] || co.type}</span></td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded font-semibold ${CO_STATUS_COLORS[co.status] || 'bg-slate-100 text-slate-600'}`}>
                        {CO_STATUS_LABELS[co.status] || co.status}
                      </span>
                    </td>
                    <td className={`px-4 py-3 text-right ${(co.impact_cost || 0) > 0 ? 'text-red-600' : (co.impact_cost || 0) < 0 ? 'text-emerald-600' : 'text-slate-600'}`}>
                      {co.impact_cost ? formatCurrency(co.impact_cost, currency) : '—'}
                    </td>
                    <td className={`px-4 py-3 text-right ${(co.impact_days || 0) > 0 ? 'text-red-600' : (co.impact_days || 0) < 0 ? 'text-emerald-600' : 'text-slate-600'}`}>
                      {co.impact_days ? `${co.impact_days}d` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600">{co.co_cost ? formatCurrency(co.co_cost, currency) : '—'}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{co.co_selling ? formatCurrency(co.co_selling, currency) : '—'}</td>
                    <td className={`px-4 py-3 text-right font-semibold ${pm && pm.profit >= 0 ? 'text-emerald-700' : pm ? 'text-red-600' : 'text-slate-400'}`}>
                      {pm ? formatCurrency(pm.profit, currency) : '—'}
                    </td>
                    <td className={`px-4 py-3 text-right font-semibold ${pm && pm.margin >= 0 ? 'text-emerald-700' : pm ? 'text-red-600' : 'text-slate-400'}`}>
                      {pm ? `${pm.margin}%` : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {co.submitted_by && <div>{co.submitted_by}</div>}
                      {co.submitted_date && <div>{formatDate(co.submitted_date)}</div>}
                      {!co.submitted_by && !co.submitted_date && '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {co.approved_by && <div>{co.approved_by}</div>}
                      {co.approved_date && <div>{formatDate(co.approved_date)}</div>}
                      {!co.approved_by && !co.approved_date && '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button onClick={() => startEdit(co)} className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => remove(co.id)} className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}