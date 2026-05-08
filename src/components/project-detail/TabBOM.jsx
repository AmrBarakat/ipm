import { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { formatCurrency, formatDate, BOM_CATEGORY_LABELS } from '@/lib/constants';
import { Plus, Package, Pencil, Trash2, Save, X, Filter } from 'lucide-react';
import PanelWrapper from '@/components/ui/PanelWrapper';

const DELIVERY_COLORS = {
  pending: 'bg-slate-100 text-slate-600',
  partially_received: 'bg-amber-100 text-amber-800',
  received: 'bg-emerald-100 text-emerald-700',
};

const ORDER_COLORS = {
  ordered: 'bg-blue-100 text-blue-700',
  not_ordered: 'bg-slate-100 text-slate-500',
};

const EMPTY_FORM = {
  description: '', category: 'other', quantity: 1, stock_qty: 0, unit: 'pcs',
  planned_cost_price: '', actual_cost_price: '', selling_price: '', currency: 'SAR',
  supplier: '', manufacturer_part_number: '',
  order_status: 'not_ordered', delivery_status: 'pending', expected_delivery_date: '',
};

export default function TabBOM({ projectId }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});

  // Filters
  const [filterCategory, setFilterCategory] = useState('');
  const [filterOrderStatus, setFilterOrderStatus] = useState('');
  const [filterDelivery, setFilterDelivery] = useState('');
  const [filterSupplier, setFilterSupplier] = useState('');

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
    await base44.entities.BOMItem.create({
      ...form,
      project_id: projectId,
      quantity: Number(form.quantity) || 1,
      stock_qty: Number(form.stock_qty) || 0,
      planned_cost_price: Number(form.planned_cost_price) || 0,
      actual_cost_price: Number(form.actual_cost_price) || 0,
      cost_price: Number(form.planned_cost_price) || 0,
      selling_price: Number(form.selling_price) || 0,
      ordered: form.order_status === 'ordered',
    });
    setForm(EMPTY_FORM);
    setAdding(false);
    load();
  }

  function startEdit(item) {
    setEditingId(item.id);
    setEditForm({
      description: item.description,
      category: item.category || 'other',
      quantity: item.quantity,
      stock_qty: item.stock_qty || 0,
      unit: item.unit,
      planned_cost_price: item.planned_cost_price ?? item.cost_price ?? 0,
      actual_cost_price: item.actual_cost_price ?? 0,
      selling_price: item.selling_price,
      supplier: item.supplier || '',
      manufacturer_part_number: item.manufacturer_part_number || '',
      order_status: item.order_status || (item.ordered ? 'ordered' : 'not_ordered'),
      delivery_status: item.delivery_status || 'pending',
      expected_delivery_date: item.expected_delivery_date || '',
    });
  }

  async function saveEdit(id) {
    await base44.entities.BOMItem.update(id, {
      ...editForm,
      quantity: Number(editForm.quantity) || 1,
      stock_qty: Number(editForm.stock_qty) || 0,
      planned_cost_price: Number(editForm.planned_cost_price) || 0,
      actual_cost_price: Number(editForm.actual_cost_price) || 0,
      cost_price: Number(editForm.planned_cost_price) || 0,
      selling_price: Number(editForm.selling_price) || 0,
      ordered: editForm.order_status === 'ordered',
    });
    setEditingId(null);
    load();
  }

  async function deleteItem(id) {
    if (!confirm('Delete this BOM item?')) return;
    await base44.entities.BOMItem.delete(id);
    load();
  }

  // Derived per item
  function orderQty(item) {
    return Math.max(0, (Number(item.quantity) || 1) - (Number(item.stock_qty) || 0));
  }

  // Unique suppliers for filter
  const suppliers = useMemo(() => [...new Set(items.map(i => i.supplier).filter(Boolean))], [items]);

  // Filtered items
  const filtered = useMemo(() => items.filter(item => {
    if (filterCategory && item.category !== filterCategory) return false;
    const os = item.order_status || (item.ordered ? 'ordered' : 'not_ordered');
    if (filterOrderStatus && os !== filterOrderStatus) return false;
    if (filterDelivery && item.delivery_status !== filterDelivery) return false;
    if (filterSupplier && item.supplier !== filterSupplier) return false;
    return true;
  }), [items, filterCategory, filterOrderStatus, filterDelivery, filterSupplier]);

  // Dashboard KPIs (over all items, not filtered)
  const totalItems = items.length;
  const totalPlannedCost = items.reduce((s, i) => s + (i.planned_cost_price ?? i.cost_price ?? 0) * (i.quantity || 1), 0);
  const totalActualCost = items.reduce((s, i) => s + (i.actual_cost_price || 0) * (i.quantity || 1), 0);
  const totalSell = items.reduce((s, i) => s + (i.selling_price || 0) * (i.quantity || 1), 0);
  const orderedCount = items.filter(i => (i.order_status || (i.ordered ? 'ordered' : 'not_ordered')) === 'ordered').length;
  const notOrderedCount = totalItems - orderedCount;
  const receivedCount = items.filter(i => i.delivery_status === 'received').length;
  const pendingDelivery = items.filter(i => i.delivery_status === 'pending').length;
  const partialCount = items.filter(i => i.delivery_status === 'partially_received').length;

  // Summary by category
  const byCategory = useMemo(() => {
    const map = {};
    items.forEach(i => {
      const cat = i.category || 'other';
      if (!map[cat]) map[cat] = { count: 0, plannedCost: 0, actualCost: 0 };
      map[cat].count++;
      map[cat].plannedCost += (i.planned_cost_price ?? i.cost_price ?? 0) * (i.quantity || 1);
      map[cat].actualCost += (i.actual_cost_price || 0) * (i.quantity || 1);
    });
    return Object.entries(map).sort((a, b) => b[1].plannedCost - a[1].plannedCost);
  }, [items]);

  // Summary by supplier
  const bySupplier = useMemo(() => {
    const map = {};
    items.forEach(i => {
      const sup = i.supplier || '(No Supplier)';
      if (!map[sup]) map[sup] = { count: 0, plannedCost: 0, actualCost: 0 };
      map[sup].count++;
      map[sup].plannedCost += (i.planned_cost_price ?? i.cost_price ?? 0) * (i.quantity || 1);
      map[sup].actualCost += (i.actual_cost_price || 0) * (i.quantity || 1);
    });
    return Object.entries(map).sort((a, b) => b[1].plannedCost - a[1].plannedCost);
  }, [items]);

  if (loading) return <Spinner />;

  return (
    <div className="space-y-5">

      {/* ── Dashboard KPIs ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Total Items" value={totalItems} color="border-slate-400" />
        <KpiCard label="Planned Cost" value={formatCurrency(totalPlannedCost, 'SAR')} color="border-blue-400" />
        <KpiCard label="Actual Cost" value={formatCurrency(totalActualCost, 'SAR')} color="border-amber-400" />
        <KpiCard label="Sell Value" value={formatCurrency(totalSell, 'SAR')} color="border-emerald-400" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Ordered" value={orderedCount} color="border-blue-500" badge />
        <KpiCard label="Not Ordered" value={notOrderedCount} color="border-slate-400" badge />
        <KpiCard label="Received" value={receivedCount} color="border-emerald-500" badge />
        <KpiCard label="Pending Delivery" value={pendingDelivery + partialCount} color="border-amber-500" badge />
      </div>

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-center text-sm">
          <Filter className="w-4 h-4 text-slate-400" />
          <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className={selCls}>
            <option value="">All Categories</option>
            {Object.entries(BOM_CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select value={filterOrderStatus} onChange={e => setFilterOrderStatus(e.target.value)} className={selCls}>
            <option value="">All Order Status</option>
            <option value="ordered">Ordered</option>
            <option value="not_ordered">Not Ordered</option>
          </select>
          <select value={filterDelivery} onChange={e => setFilterDelivery(e.target.value)} className={selCls}>
            <option value="">All Delivery</option>
            <option value="pending">Pending</option>
            <option value="partially_received">Partially Received</option>
            <option value="received">Received</option>
          </select>
          {suppliers.length > 0 && (
            <select value={filterSupplier} onChange={e => setFilterSupplier(e.target.value)} className={selCls}>
              <option value="">All Suppliers</option>
              {suppliers.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          {(filterCategory || filterOrderStatus || filterDelivery || filterSupplier) && (
            <button onClick={() => { setFilterCategory(''); setFilterOrderStatus(''); setFilterDelivery(''); setFilterSupplier(''); }}
              className="text-xs text-slate-500 hover:text-red-500 underline">Clear</button>
          )}
        </div>
        <button onClick={() => setAdding(v => !v)} className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded">
          <Plus className="w-4 h-4" /> Add Item
        </button>
      </div>

      {/* ── Add Form ── */}
      {adding && (
        <form onSubmit={create} className="bg-amber-50 border border-amber-200 rounded-lg p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Description *" className={inp + ' col-span-2'} required />
          <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className={inp}>
            {Object.entries(BOM_CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input value={form.supplier} onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))} placeholder="Supplier" className={inp} />
          <input value={form.manufacturer_part_number} onChange={e => setForm(f => ({ ...f, manufacturer_part_number: e.target.value }))} placeholder="Part Number" className={inp} />
          <input type="number" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} placeholder="Qty" className={inp} min="0" />
          <input type="number" value={form.stock_qty} onChange={e => setForm(f => ({ ...f, stock_qty: e.target.value }))} placeholder="Stock Qty" className={inp} min="0" />
          <input value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} placeholder="Unit" className={inp} />
          <input type="number" value={form.planned_cost_price} onChange={e => setForm(f => ({ ...f, planned_cost_price: e.target.value }))} placeholder="Planned Cost/Unit" className={inp} min="0" />
          <input type="number" value={form.actual_cost_price} onChange={e => setForm(f => ({ ...f, actual_cost_price: e.target.value }))} placeholder="Actual Cost/Unit" className={inp} min="0" />
          <input type="number" value={form.selling_price} onChange={e => setForm(f => ({ ...f, selling_price: e.target.value }))} placeholder="Selling Price" className={inp} min="0" />
          <select value={form.order_status} onChange={e => setForm(f => ({ ...f, order_status: e.target.value }))} className={inp}>
            <option value="not_ordered">Not Ordered</option>
            <option value="ordered">Ordered</option>
          </select>
          <select value={form.delivery_status} onChange={e => setForm(f => ({ ...f, delivery_status: e.target.value }))} className={inp}>
            <option value="pending">Pending</option>
            <option value="partially_received">Partially Received</option>
            <option value="received">Received</option>
          </select>
          <input type="date" value={form.expected_delivery_date} onChange={e => setForm(f => ({ ...f, expected_delivery_date: e.target.value }))} className={inp} placeholder="Expected Delivery" />
          <div className="col-span-2 flex gap-2">
            <button type="submit" className="px-4 py-2 bg-amber-500 text-slate-900 font-semibold text-sm rounded hover:bg-amber-400">Save</button>
            <button type="button" onClick={() => setAdding(false)} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded hover:bg-slate-100">Cancel</button>
          </div>
        </form>
      )}

      {/* ── Table ── */}
      {items.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <Package className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No BOM items yet.</p>
        </div>
      ) : (
        <PanelWrapper title="Bill of Materials"
          exportData={filtered.map(i => ({
            description: i.description,
            category: BOM_CATEGORY_LABELS[i.category] || i.category,
            supplier: i.supplier || '',
            part_no: i.manufacturer_part_number || '',
            qty: i.quantity,
            stock_qty: i.stock_qty || 0,
            order_qty: orderQty(i),
            unit: i.unit,
            planned_cost_unit: i.planned_cost_price ?? i.cost_price ?? 0,
            actual_cost_unit: i.actual_cost_price || 0,
            total_planned: (i.planned_cost_price ?? i.cost_price ?? 0) * (i.quantity || 1),
            total_actual: (i.actual_cost_price || 0) * (i.quantity || 1),
            order_status: i.order_status || (i.ordered ? 'ordered' : 'not_ordered'),
            delivery_status: i.delivery_status || 'pending',
            expected_delivery: i.expected_delivery_date || '',
          }))}
          exportCols={[
            { key: 'description', label: 'Description' }, { key: 'category', label: 'Category' },
            { key: 'supplier', label: 'Supplier' }, { key: 'part_no', label: 'Part No.' },
            { key: 'qty', label: 'Qty' }, { key: 'stock_qty', label: 'Stock Qty' },
            { key: 'order_qty', label: 'Order Qty' }, { key: 'unit', label: 'Unit' },
            { key: 'planned_cost_unit', label: 'Planned Cost/Unit' }, { key: 'actual_cost_unit', label: 'Actual Cost/Unit' },
            { key: 'total_planned', label: 'Total Planned' }, { key: 'total_actual', label: 'Total Actual' },
            { key: 'order_status', label: 'Order Status' }, { key: 'delivery_status', label: 'Delivery' },
            { key: 'expected_delivery', label: 'Expected Delivery' },
          ]}
        >
          <div className="text-xs text-slate-500 mb-2">{filtered.length} of {items.length} items</div>
          <div className="bg-white rounded-lg shadow-sm overflow-x-auto">
            <table className="w-full text-sm min-w-[1100px]">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase border-b border-slate-200">
                <tr>
                  <th className="px-3 py-3 text-left">Description / Part No.</th>
                  <th className="px-3 py-3 text-left">Category</th>
                  <th className="px-3 py-3 text-left">Supplier</th>
                  <th className="px-3 py-3 text-right">Qty</th>
                  <th className="px-3 py-3 text-right">Stock Qty</th>
                  <th className="px-3 py-3 text-right">Order Qty</th>
                  <th className="px-3 py-3 text-right">Planned Cost</th>
                  <th className="px-3 py-3 text-right">Actual Cost</th>
                  <th className="px-3 py-3 text-left">Order Status</th>
                  <th className="px-3 py-3 text-left">Delivery</th>
                  <th className="px-3 py-3 text-left">Exp. Delivery</th>
                  <th className="px-3 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(item => {
                  const isEditing = editingId === item.id;
                  const oQty = isEditing
                    ? Math.max(0, (Number(editForm.quantity) || 1) - (Number(editForm.stock_qty) || 0))
                    : orderQty(item);
                  const plannedUnit = item.planned_cost_price ?? item.cost_price ?? 0;
                  const actualUnit = item.actual_cost_price || 0;
                  const itemOrderStatus = item.order_status || (item.ordered ? 'ordered' : 'not_ordered');

                  return (
                    <tr key={item.id} className="border-t border-slate-100 hover:bg-slate-50">
                      {/* Description */}
                      <td className="px-3 py-2">
                        {isEditing ? (
                          <div className="space-y-1">
                            <input value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} className={inp} placeholder="Description" />
                            <input value={editForm.manufacturer_part_number} onChange={e => setEditForm(f => ({ ...f, manufacturer_part_number: e.target.value }))} placeholder="Part No." className={inp} />
                          </div>
                        ) : (
                          <div>
                            <div className="font-medium text-slate-800">{item.description}</div>
                            {item.manufacturer_part_number && <div className="text-xs text-slate-400">{item.manufacturer_part_number}</div>}
                          </div>
                        )}
                      </td>
                      {/* Category */}
                      <td className="px-3 py-2">
                        {isEditing ? (
                          <select value={editForm.category} onChange={e => setEditForm(f => ({ ...f, category: e.target.value }))} className={inp}>
                            {Object.entries(BOM_CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </select>
                        ) : <span className="text-slate-600 text-xs">{BOM_CATEGORY_LABELS[item.category] || item.category}</span>}
                      </td>
                      {/* Supplier */}
                      <td className="px-3 py-2">
                        {isEditing ? <input value={editForm.supplier} onChange={e => setEditForm(f => ({ ...f, supplier: e.target.value }))} placeholder="Supplier" className={inp} /> : <span className="text-slate-600">{item.supplier || '—'}</span>}
                      </td>
                      {/* Qty */}
                      <td className="px-3 py-2 text-right">
                        {isEditing ? (
                          <div className="flex gap-1 justify-end">
                            <input type="number" value={editForm.quantity} onChange={e => setEditForm(f => ({ ...f, quantity: e.target.value }))} className={inp} min="0" style={{ width: 60 }} />
                            <input value={editForm.unit} onChange={e => setEditForm(f => ({ ...f, unit: e.target.value }))} className={inp} style={{ width: 45 }} />
                          </div>
                        ) : <span className="text-slate-700">{item.quantity} {item.unit}</span>}
                      </td>
                      {/* Stock Qty */}
                      <td className="px-3 py-2 text-right">
                        {isEditing ? <input type="number" value={editForm.stock_qty} onChange={e => setEditForm(f => ({ ...f, stock_qty: e.target.value }))} className={inp} min="0" style={{ width: 70 }} /> : <span className="text-slate-600">{item.stock_qty || 0}</span>}
                      </td>
                      {/* Order Qty (computed) */}
                      <td className="px-3 py-2 text-right">
                        <span className={`font-semibold ${oQty > 0 ? 'text-amber-700' : 'text-emerald-600'}`}>{oQty}</span>
                      </td>
                      {/* Planned Cost */}
                      <td className="px-3 py-2 text-right">
                        {isEditing ? <input type="number" value={editForm.planned_cost_price} onChange={e => setEditForm(f => ({ ...f, planned_cost_price: e.target.value }))} className={inp} min="0" style={{ width: 90 }} /> : (
                          <div>
                            <div className="text-slate-700">{formatCurrency(plannedUnit * (item.quantity || 1), item.currency || 'SAR')}</div>
                            <div className="text-xs text-slate-400">{formatCurrency(plannedUnit, item.currency || 'SAR')}/unit</div>
                          </div>
                        )}
                      </td>
                      {/* Actual Cost */}
                      <td className="px-3 py-2 text-right">
                        {isEditing ? <input type="number" value={editForm.actual_cost_price} onChange={e => setEditForm(f => ({ ...f, actual_cost_price: e.target.value }))} className={inp} min="0" style={{ width: 90 }} /> : (
                          <div>
                            <div className={actualUnit > 0 ? 'text-slate-700' : 'text-slate-300'}>{actualUnit > 0 ? formatCurrency(actualUnit * (item.quantity || 1), item.currency || 'SAR') : '—'}</div>
                            {actualUnit > 0 && <div className="text-xs text-slate-400">{formatCurrency(actualUnit, item.currency || 'SAR')}/unit</div>}
                          </div>
                        )}
                      </td>
                      {/* Order Status */}
                      <td className="px-3 py-2">
                        {isEditing ? (
                          <select value={editForm.order_status} onChange={e => setEditForm(f => ({ ...f, order_status: e.target.value }))} className={inp}>
                            <option value="not_ordered">Not Ordered</option>
                            <option value="ordered">Ordered</option>
                          </select>
                        ) : (
                          <span className={`text-xs px-2 py-0.5 rounded font-semibold ${ORDER_COLORS[itemOrderStatus] || 'bg-slate-100 text-slate-600'}`}>
                            {itemOrderStatus === 'ordered' ? 'Ordered' : 'Not Ordered'}
                          </span>
                        )}
                      </td>
                      {/* Delivery Status */}
                      <td className="px-3 py-2">
                        {isEditing ? (
                          <select value={editForm.delivery_status} onChange={e => setEditForm(f => ({ ...f, delivery_status: e.target.value }))} className={inp}>
                            <option value="pending">Pending</option>
                            <option value="partially_received">Partially Received</option>
                            <option value="received">Received</option>
                          </select>
                        ) : (
                          <span className={`text-xs px-2 py-0.5 rounded font-semibold ${DELIVERY_COLORS[item.delivery_status] || 'bg-slate-100 text-slate-600'}`}>
                            {item.delivery_status?.replace(/_/g, ' ') || 'pending'}
                          </span>
                        )}
                      </td>
                      {/* Expected Delivery */}
                      <td className="px-3 py-2">
                        {isEditing ? <input type="date" value={editForm.expected_delivery_date} onChange={e => setEditForm(f => ({ ...f, expected_delivery_date: e.target.value }))} className={inp} /> : <span className="text-slate-600 text-xs">{formatDate(item.expected_delivery_date) || '—'}</span>}
                      </td>
                      {/* Actions */}
                      <td className="px-3 py-2">
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
              {/* Totals row */}
              {filtered.length > 0 && (
                <tfoot className="bg-slate-50 border-t-2 border-slate-300 text-xs font-semibold text-slate-700">
                  <tr>
                    <td className="px-3 py-2 text-slate-500" colSpan={6}>Totals ({filtered.length} items)</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(filtered.reduce((s, i) => s + (i.planned_cost_price ?? i.cost_price ?? 0) * (i.quantity || 1), 0), 'SAR')}</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(filtered.reduce((s, i) => s + (i.actual_cost_price || 0) * (i.quantity || 1), 0), 'SAR')}</td>
                    <td colSpan={4}></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </PanelWrapper>
      )}

      {/* ── Summary by Category ── */}
      {byCategory.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white rounded-lg shadow-sm p-4">
            <h4 className="font-semibold text-slate-700 text-sm mb-3 border-b pb-2">Summary by Category</h4>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-400 uppercase">
                  <th className="text-left py-1">Category</th>
                  <th className="text-right py-1">Items</th>
                  <th className="text-right py-1">Planned Cost</th>
                  <th className="text-right py-1">Actual Cost</th>
                </tr>
              </thead>
              <tbody>
                {byCategory.map(([cat, data]) => (
                  <tr key={cat} className="border-t border-slate-100">
                    <td className="py-1.5 text-slate-700 font-medium">{BOM_CATEGORY_LABELS[cat] || cat}</td>
                    <td className="py-1.5 text-right text-slate-500">{data.count}</td>
                    <td className="py-1.5 text-right text-slate-700">{formatCurrency(data.plannedCost, 'SAR')}</td>
                    <td className="py-1.5 text-right text-slate-600">{data.actualCost > 0 ? formatCurrency(data.actualCost, 'SAR') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-4">
            <h4 className="font-semibold text-slate-700 text-sm mb-3 border-b pb-2">Summary by Supplier</h4>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-400 uppercase">
                  <th className="text-left py-1">Supplier</th>
                  <th className="text-right py-1">Items</th>
                  <th className="text-right py-1">Planned Cost</th>
                  <th className="text-right py-1">Actual Cost</th>
                </tr>
              </thead>
              <tbody>
                {bySupplier.map(([sup, data]) => (
                  <tr key={sup} className="border-t border-slate-100">
                    <td className="py-1.5 text-slate-700 font-medium">{sup}</td>
                    <td className="py-1.5 text-right text-slate-500">{data.count}</td>
                    <td className="py-1.5 text-right text-slate-700">{formatCurrency(data.plannedCost, 'SAR')}</td>
                    <td className="py-1.5 text-right text-slate-600">{data.actualCost > 0 ? formatCurrency(data.actualCost, 'SAR') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, value, color, badge }) {
  return (
    <div className={`bg-white rounded-lg shadow-sm p-3 border-l-4 ${color}`}>
      <div className="text-xs text-slate-400 uppercase tracking-wide">{label}</div>
      <div className={`mt-1 font-bold ${badge ? 'text-2xl text-slate-700' : 'text-base text-slate-800'}`}>{value}</div>
    </div>
  );
}

const inp = 'border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white w-full';
const selCls = 'border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400 bg-white';
function Spinner() {
  return <div className="flex justify-center py-12"><div className="w-7 h-7 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;
}