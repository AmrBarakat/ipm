import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { formatCurrency } from '@/lib/constants';
import { BOM_CATEGORY_LABELS } from '@/lib/constants';
import { Plus, Package, Pencil, Trash2, Save, X } from 'lucide-react';
import PanelWrapper from '@/components/ui/PanelWrapper';

const DELIVERY_COLORS = {
  pending: 'bg-slate-100 text-slate-600',
  ordered: 'bg-blue-100 text-blue-700',
  partially_received: 'bg-amber-100 text-amber-800',
  received: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
};

export default function TabBOM({ projectId }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ description: '', category: 'other', quantity: 1, unit: 'pcs', cost_price: '', selling_price: '', currency: 'SAR', manufacturer: '', manufacturer_part_number: '' });
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});

  useEffect(() => { load(); }, [projectId]);

  async function load() {
    setLoading(true);
    const b = await base44.entities.BOMItem.filter({ project_id: projectId }, '-created_date', 500);
    setItems(b);
    setLoading(false);
  }

  async function create(e) {
    e.preventDefault();
    if (!form.description.trim()) return;
    await base44.entities.BOMItem.create({ ...form, project_id: projectId, quantity: Number(form.quantity) || 1, cost_price: Number(form.cost_price) || 0, selling_price: Number(form.selling_price) || 0 });
    setForm({ description: '', category: 'other', quantity: 1, unit: 'pcs', cost_price: '', selling_price: '', currency: 'SAR', manufacturer: '', manufacturer_part_number: '' });
    setAdding(false);
    load();
  }

  function startEdit(item) {
    setEditingId(item.id);
    setEditForm({ description: item.description, category: item.category, quantity: item.quantity, unit: item.unit, cost_price: item.cost_price, selling_price: item.selling_price, manufacturer: item.manufacturer || '', manufacturer_part_number: item.manufacturer_part_number || '', delivery_status: item.delivery_status || 'pending', ordered: item.ordered || false });
  }

  async function saveEdit(id) {
    await base44.entities.BOMItem.update(id, { ...editForm, quantity: Number(editForm.quantity) || 1, cost_price: Number(editForm.cost_price) || 0, selling_price: Number(editForm.selling_price) || 0 });
    setEditingId(null);
    load();
  }

  async function deleteItem(id) {
    if (!confirm('Delete this BOM item?')) return;
    await base44.entities.BOMItem.delete(id);
    load();
  }

  const totalCost = items.reduce((s, i) => s + (i.cost_price || 0) * (i.quantity || 1), 0);
  const totalSell = items.reduce((s, i) => s + (i.selling_price || 0) * (i.quantity || 1), 0);

  if (loading) return <Spinner />;

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div className="flex gap-4 text-sm">
          <span className="text-slate-500">{items.length} item{items.length !== 1 ? 's' : ''}</span>
          {items.length > 0 && (
            <>
              <span className="text-slate-500">Cost: <strong>{formatCurrency(totalCost, 'SAR')}</strong></span>
              <span className="text-slate-500">Sell: <strong>{formatCurrency(totalSell, 'SAR')}</strong></span>
            </>
          )}
        </div>
        <button onClick={() => setAdding(v => !v)} className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded">
          <Plus className="w-4 h-4" /> Add Item
        </button>
      </div>

      {adding && (
        <form onSubmit={create} className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Description *" className={inp + ' col-span-2'} required />
          <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className={inp}>
            {Object.entries(BOM_CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input value={form.manufacturer} onChange={e => setForm(f => ({ ...f, manufacturer: e.target.value }))} placeholder="Manufacturer" className={inp} />
          <input value={form.manufacturer_part_number} onChange={e => setForm(f => ({ ...f, manufacturer_part_number: e.target.value }))} placeholder="Part Number" className={inp} />
          <input type="number" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} placeholder="Qty" className={inp} min="0" />
          <input value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} placeholder="Unit" className={inp} />
          <input type="number" value={form.cost_price} onChange={e => setForm(f => ({ ...f, cost_price: e.target.value }))} placeholder="Cost Price" className={inp} min="0" />
          <input type="number" value={form.selling_price} onChange={e => setForm(f => ({ ...f, selling_price: e.target.value }))} placeholder="Selling Price" className={inp} min="0" />
          <div className="col-span-2 flex gap-2">
            <button type="submit" className="px-4 py-2 bg-amber-500 text-slate-900 font-semibold text-sm rounded hover:bg-amber-400">Save</button>
            <button type="button" onClick={() => setAdding(false)} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded hover:bg-slate-100">Cancel</button>
          </div>
        </form>
      )}

      {items.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <Package className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No BOM items yet.</p>
        </div>
      ) : (
        <PanelWrapper title="Bill of Materials"
          exportData={items.map(i => ({ ...i, total_cost: i.cost_price * i.quantity, total_sell: i.selling_price * i.quantity }))}
          exportCols={[
            { key: 'description', label: 'Description' }, { key: 'category', label: 'Category' },
            { key: 'manufacturer', label: 'Manufacturer' }, { key: 'manufacturer_part_number', label: 'Part No.' },
            { key: 'quantity', label: 'Qty' }, { key: 'unit', label: 'Unit' },
            { key: 'cost_price', label: 'Unit Cost' }, { key: 'total_cost', label: 'Total Cost' },
            { key: 'selling_price', label: 'Unit Sell' }, { key: 'total_sell', label: 'Total Sell' },
            { key: 'delivery_status', label: 'Delivery' },
          ]}
        >
          <div className="bg-white rounded-lg shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left">Description</th>
                  <th className="px-4 py-3 text-left">Category</th>
                  <th className="px-4 py-3 text-left">Manufacturer</th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th className="px-4 py-3 text-right">Cost</th>
                  <th className="px-4 py-3 text-right">Sell</th>
                  <th className="px-4 py-3 text-left">Delivery</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => {
                  const isEditing = editingId === item.id;
                  return (
                    <tr key={item.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <div className="space-y-1">
                            <input value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} className={inp} />
                            <input value={editForm.manufacturer_part_number} onChange={e => setEditForm(f => ({ ...f, manufacturer_part_number: e.target.value }))} placeholder="Part No." className={inp} />
                          </div>
                        ) : (
                          <div>
                            <div className="font-medium text-slate-800">{item.description}</div>
                            {item.manufacturer_part_number && <div className="text-xs text-slate-400">{item.manufacturer_part_number}</div>}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <select value={editForm.category} onChange={e => setEditForm(f => ({ ...f, category: e.target.value }))} className={inp}>
                            {Object.entries(BOM_CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </select>
                        ) : <span className="text-slate-600">{BOM_CATEGORY_LABELS[item.category] || item.category}</span>}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? <input value={editForm.manufacturer} onChange={e => setEditForm(f => ({ ...f, manufacturer: e.target.value }))} placeholder="Manufacturer" className={inp} /> : <span className="text-slate-600">{item.manufacturer || '—'}</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isEditing ? (
                          <div className="flex gap-1">
                            <input type="number" value={editForm.quantity} onChange={e => setEditForm(f => ({ ...f, quantity: e.target.value }))} className={inp} min="0" style={{ width: 60 }} />
                            <input value={editForm.unit} onChange={e => setEditForm(f => ({ ...f, unit: e.target.value }))} className={inp} style={{ width: 50 }} />
                          </div>
                        ) : <span className="text-slate-700">{item.quantity} {item.unit}</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isEditing ? <input type="number" value={editForm.cost_price} onChange={e => setEditForm(f => ({ ...f, cost_price: e.target.value }))} className={inp} min="0" /> : formatCurrency(item.cost_price * item.quantity, item.currency)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isEditing ? <input type="number" value={editForm.selling_price} onChange={e => setEditForm(f => ({ ...f, selling_price: e.target.value }))} className={inp} min="0" /> : formatCurrency(item.selling_price * item.quantity, item.currency)}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <select value={editForm.delivery_status} onChange={e => setEditForm(f => ({ ...f, delivery_status: e.target.value }))} className={inp}>
                            {Object.keys(DELIVERY_COLORS).map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                          </select>
                        ) : (
                          <span className={`text-xs px-2 py-0.5 rounded font-semibold ${DELIVERY_COLORS[item.delivery_status] || 'bg-slate-100 text-slate-600'}`}>
                            {item.delivery_status?.replace(/_/g, ' ') || 'pending'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          {isEditing ? (
                            <>
                              <button onClick={() => saveEdit(item.id)} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"><Save className="w-4 h-4" /></button>
                              <button onClick={() => setEditingId(null)} className="p-1 text-slate-400 hover:bg-slate-100 rounded"><X className="w-4 h-4" /></button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => startEdit(item)} className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded"><Pencil className="w-4 h-4" /></button>
                              <button onClick={() => deleteItem(item.id)} className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 className="w-4 h-4" /></button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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