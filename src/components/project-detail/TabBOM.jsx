import { useState, useEffect, useMemo, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { formatCurrency, formatDate, BOM_CATEGORY_LABELS } from '@/lib/constants';
import { Plus, Package, Trash2, Filter, Tag, Truck, ShoppingCart, TrendingUp, CheckCircle, Clock } from 'lucide-react';
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

const inp = 'border border-transparent rounded px-1.5 py-1 text-xs focus:outline-none focus:border-amber-400 focus:bg-white bg-transparent w-full hover:bg-slate-100 transition-colors';
const selCls = 'border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400 bg-white';
const addInp = 'border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white w-full';

export default function TabBOM({ projectId }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState({});

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

  // Direct cell update — debounced save per item
  const updateField = useCallback(async (id, field, value) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, [field]: value } : i));
  }, []);

  const saveItem = useCallback(async (item) => {
    setSaving(s => ({ ...s, [item.id]: true }));
    const qty = Number(item.quantity) || 1;
    const stockQty = Number(item.stock_qty) || 0;
    await base44.entities.BOMItem.update(item.id, {
      ...item,
      quantity: qty,
      stock_qty: stockQty,
      planned_cost_price: Number(item.planned_cost_price) || 0,
      actual_cost_price: Number(item.actual_cost_price) || 0,
      cost_price: Number(item.planned_cost_price) || 0,
      selling_price: Number(item.selling_price) || 0,
      ordered: item.order_status === 'ordered',
    });
    setSaving(s => ({ ...s, [item.id]: false }));
  }, []);

  function handleBlur(item, field, rawValue) {
    const parsed = ['quantity', 'stock_qty', 'planned_cost_price', 'actual_cost_price', 'selling_price'].includes(field)
      ? Number(rawValue) || 0
      : rawValue;
    const updated = { ...item, [field]: parsed };
    saveItem(updated);
  }

  function handleSelectChange(item, field, value) {
    const updated = { ...item, [field]: value };
    setItems(prev => prev.map(i => i.id === item.id ? updated : i));
    saveItem(updated);
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

  async function deleteItem(id) {
    if (!confirm('Delete this BOM item?')) return;
    await base44.entities.BOMItem.delete(id);
    load();
  }

  function orderQty(item) {
    return Math.max(0, (Number(item.quantity) || 1) - (Number(item.stock_qty) || 0));
  }

  const suppliers = useMemo(() => [...new Set(items.map(i => i.supplier).filter(Boolean))], [items]);

  const filtered = useMemo(() => items.filter(item => {
    if (filterCategory && item.category !== filterCategory) return false;
    const os = item.order_status || (item.ordered ? 'ordered' : 'not_ordered');
    if (filterOrderStatus && os !== filterOrderStatus) return false;
    if (filterDelivery && item.delivery_status !== filterDelivery) return false;
    if (filterSupplier && item.supplier !== filterSupplier) return false;
    return true;
  }), [items, filterCategory, filterOrderStatus, filterDelivery, filterSupplier]);

  // Dashboard KPIs
  const totalItems = items.length;
  const totalPlannedCost = items.reduce((s, i) => s + (Number(i.planned_cost_price) || Number(i.cost_price) || 0) * (Number(i.quantity) || 1), 0);
  const totalActualCost = items.reduce((s, i) => s + (Number(i.actual_cost_price) || 0) * (Number(i.quantity) || 1), 0);
  const totalSell = items.reduce((s, i) => s + (Number(i.selling_price) || 0) * (Number(i.quantity) || 1), 0);
  const orderedCount = items.filter(i => (i.order_status || (i.ordered ? 'ordered' : 'not_ordered')) === 'ordered').length;
  const receivedCount = items.filter(i => i.delivery_status === 'received').length;
  const pendingDelivery = items.filter(i => i.delivery_status === 'pending' || i.delivery_status === 'partially_received').length;

  const byCategory = useMemo(() => {
    const map = {};
    items.forEach(i => {
      const cat = i.category || 'other';
      if (!map[cat]) map[cat] = { count: 0, plannedCost: 0, actualCost: 0, sellValue: 0 };
      map[cat].count++;
      map[cat].plannedCost += (Number(i.planned_cost_price) || Number(i.cost_price) || 0) * (Number(i.quantity) || 1);
      map[cat].actualCost += (Number(i.actual_cost_price) || 0) * (Number(i.quantity) || 1);
      map[cat].sellValue += (Number(i.selling_price) || 0) * (Number(i.quantity) || 1);
    });
    return Object.entries(map).sort((a, b) => b[1].plannedCost - a[1].plannedCost);
  }, [items]);

  const bySupplier = useMemo(() => {
    const map = {};
    items.forEach(i => {
      const sup = i.supplier || '(No Supplier)';
      if (!map[sup]) map[sup] = { count: 0, plannedCost: 0, actualCost: 0, sellValue: 0 };
      map[sup].count++;
      map[sup].plannedCost += (Number(i.planned_cost_price) || Number(i.cost_price) || 0) * (Number(i.quantity) || 1);
      map[sup].actualCost += (Number(i.actual_cost_price) || 0) * (Number(i.quantity) || 1);
      map[sup].sellValue += (Number(i.selling_price) || 0) * (Number(i.quantity) || 1);
    });
    return Object.entries(map).sort((a, b) => b[1].plannedCost - a[1].plannedCost);
  }, [items]);

  if (loading) return <Spinner />;

  return (
    <div className="space-y-5">

      {/* Dashboard KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Total Items" value={totalItems} icon={<Package className="w-6 h-6 text-slate-300" />} color="border-slate-400" />
        <KpiCard label="Planned Cost" value={formatCurrency(totalPlannedCost, 'SAR')} icon={<Tag className="w-6 h-6 text-blue-300" />} color="border-blue-500" />
        <KpiCard label="Actual Cost" value={formatCurrency(totalActualCost, 'SAR')} icon={<Tag className="w-6 h-6 text-amber-300" />} color="border-amber-500" />
        <KpiCard label="Sell Value" value={formatCurrency(totalSell, 'SAR')} icon={<TrendingUp className="w-6 h-6 text-emerald-300" />} color="border-emerald-500" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Ordered" value={orderedCount} icon={<Truck className="w-6 h-6 text-blue-300" />} color="border-blue-500" />
        <KpiCard label="Not Ordered" value={totalItems - orderedCount} icon={<ShoppingCart className="w-6 h-6 text-slate-300" />} color="border-slate-400" />
        <KpiCard label="Received" value={receivedCount} icon={<CheckCircle className="w-6 h-6 text-emerald-300" />} color="border-emerald-500" />
        <KpiCard label="Pending Delivery" value={pendingDelivery} icon={<Clock className="w-6 h-6 text-amber-300" />} color="border-amber-500" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
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

      {/* Add Form */}
      {adding && (
        <form onSubmit={create} className="bg-amber-50 border border-amber-200 rounded-lg p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Description *" className={addInp + ' col-span-2'} required />
          <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className={addInp}>
            {Object.entries(BOM_CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input value={form.supplier} onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))} placeholder="Supplier" className={addInp} />
          <input value={form.manufacturer_part_number} onChange={e => setForm(f => ({ ...f, manufacturer_part_number: e.target.value }))} placeholder="Part Number" className={addInp} />
          <input type="number" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} placeholder="Qty" className={addInp} min="0" />
          <input type="number" value={form.stock_qty} onChange={e => setForm(f => ({ ...f, stock_qty: e.target.value }))} placeholder="Stock Qty" className={addInp} min="0" />
          <input value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} placeholder="Unit" className={addInp} />
          <input type="number" value={form.planned_cost_price} onChange={e => setForm(f => ({ ...f, planned_cost_price: e.target.value }))} placeholder="Planned Cost/Unit" className={addInp} min="0" />
          <input type="number" value={form.actual_cost_price} onChange={e => setForm(f => ({ ...f, actual_cost_price: e.target.value }))} placeholder="Actual Cost/Unit" className={addInp} min="0" />
          <input type="number" value={form.selling_price} onChange={e => setForm(f => ({ ...f, selling_price: e.target.value }))} placeholder="Selling Price" className={addInp} min="0" />
          <select value={form.order_status} onChange={e => setForm(f => ({ ...f, order_status: e.target.value }))} className={addInp}>
            <option value="not_ordered">Not Ordered</option>
            <option value="ordered">Ordered</option>
          </select>
          <select value={form.delivery_status} onChange={e => setForm(f => ({ ...f, delivery_status: e.target.value }))} className={addInp}>
            <option value="pending">Pending</option>
            <option value="partially_received">Partially Received</option>
            <option value="received">Received</option>
          </select>
          <input type="date" value={form.expected_delivery_date} onChange={e => setForm(f => ({ ...f, expected_delivery_date: e.target.value }))} className={addInp} />
          <div className="col-span-2 flex gap-2">
            <button type="submit" className="px-4 py-2 bg-amber-500 text-slate-900 font-semibold text-sm rounded hover:bg-amber-400">Save</button>
            <button type="button" onClick={() => setAdding(false)} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded hover:bg-slate-100">Cancel</button>
          </div>
        </form>
      )}

      {/* Table */}
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
            planned_cost_unit: Number(i.planned_cost_price) || Number(i.cost_price) || 0,
            actual_cost_unit: Number(i.actual_cost_price) || 0,
            total_planned: (Number(i.planned_cost_price) || Number(i.cost_price) || 0) * (Number(i.quantity) || 1),
            total_actual: (Number(i.actual_cost_price) || 0) * (Number(i.quantity) || 1),
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
          <div className="text-xs text-slate-500 mb-2">{filtered.length} of {items.length} items · <span className="italic">Click any cell to edit</span></div>
          <div className="bg-white rounded-lg shadow-sm overflow-x-auto">
            <table className="w-full text-sm min-w-[1200px]">
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
                  <th className="px-3 py-3 text-right">Sell Value</th>
                  <th className="px-3 py-3 text-left">Order Status</th>
                  <th className="px-3 py-3 text-left">Delivery</th>
                  <th className="px-3 py-3 text-left">Exp. Delivery</th>
                  <th className="px-3 py-3 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(item => {
                  const oQty = orderQty(item);
                  const plannedUnit = Number(item.planned_cost_price) || Number(item.cost_price) || 0;
                  const actualUnit = Number(item.actual_cost_price) || 0;
                  const itemOrderStatus = item.order_status || (item.ordered ? 'ordered' : 'not_ordered');
                  const isSaving = saving[item.id];

                  return (
                    <tr key={item.id} className={`border-t border-slate-100 hover:bg-amber-50/30 ${isSaving ? 'opacity-70' : ''}`}>
                      {/* Description / Part No */}
                      <td className="px-1 py-1">
                        <div className="space-y-0.5">
                          <input
                            className={inp}
                            value={item.description || ''}
                            onChange={e => updateField(item.id, 'description', e.target.value)}
                            onBlur={e => handleBlur(item, 'description', e.target.value)}
                            placeholder="Description"
                          />
                          <input
                            className={inp + ' text-slate-400'}
                            value={item.manufacturer_part_number || ''}
                            onChange={e => updateField(item.id, 'manufacturer_part_number', e.target.value)}
                            onBlur={e => handleBlur(item, 'manufacturer_part_number', e.target.value)}
                            placeholder="Part No."
                          />
                        </div>
                      </td>
                      {/* Category */}
                      <td className="px-1 py-1">
                        <select
                          className={inp + ' cursor-pointer'}
                          value={item.category || 'other'}
                          onChange={e => handleSelectChange(item, 'category', e.target.value)}
                        >
                          {Object.entries(BOM_CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </td>
                      {/* Supplier */}
                      <td className="px-1 py-1">
                        <input
                          className={inp}
                          value={item.supplier || ''}
                          onChange={e => updateField(item.id, 'supplier', e.target.value)}
                          onBlur={e => handleBlur(item, 'supplier', e.target.value)}
                          placeholder="Supplier"
                        />
                      </td>
                      {/* Qty */}
                      <td className="px-1 py-1 text-right">
                        <div className="flex gap-1 justify-end items-center">
                          <input
                            type="number"
                            className={inp + ' text-right'}
                            style={{ width: 55 }}
                            value={item.quantity ?? 1}
                            onChange={e => updateField(item.id, 'quantity', e.target.value)}
                            onBlur={e => handleBlur(item, 'quantity', e.target.value)}
                            min="0"
                          />
                          <input
                            className={inp}
                            style={{ width: 40 }}
                            value={item.unit || 'pcs'}
                            onChange={e => updateField(item.id, 'unit', e.target.value)}
                            onBlur={e => handleBlur(item, 'unit', e.target.value)}
                          />
                        </div>
                      </td>
                      {/* Stock Qty */}
                      <td className="px-1 py-1 text-right">
                        <input
                          type="number"
                          className={inp + ' text-right'}
                          style={{ width: 65 }}
                          value={item.stock_qty ?? 0}
                          onChange={e => updateField(item.id, 'stock_qty', e.target.value)}
                          onBlur={e => handleBlur(item, 'stock_qty', e.target.value)}
                          min="0"
                        />
                      </td>
                      {/* Order Qty (computed, read-only) */}
                      <td className="px-3 py-2 text-right">
                        <span className={`font-semibold text-xs ${oQty > 0 ? 'text-amber-700' : 'text-emerald-600'}`}>{oQty}</span>
                      </td>
                      {/* Planned Cost */}
                      <td className="px-1 py-1 text-right">
                        <div className="flex flex-col items-end">
                          <input
                            type="number"
                            className={inp + ' text-right'}
                            style={{ width: 90 }}
                            value={item.planned_cost_price ?? 0}
                            onChange={e => updateField(item.id, 'planned_cost_price', e.target.value)}
                            onBlur={e => handleBlur(item, 'planned_cost_price', e.target.value)}
                            min="0"
                            placeholder="0"
                          />
                          <span className="text-xs text-slate-400 mt-0.5">= {formatCurrency(plannedUnit * (Number(item.quantity) || 1), item.currency || 'SAR')}</span>
                        </div>
                      </td>
                      {/* Actual Cost */}
                      <td className="px-1 py-1 text-right">
                        <div className="flex flex-col items-end">
                          <input
                            type="number"
                            className={inp + ' text-right'}
                            style={{ width: 90 }}
                            value={item.actual_cost_price ?? 0}
                            onChange={e => updateField(item.id, 'actual_cost_price', e.target.value)}
                            onBlur={e => handleBlur(item, 'actual_cost_price', e.target.value)}
                            min="0"
                            placeholder="0"
                          />
                          <span className="text-xs text-slate-400 mt-0.5">= {formatCurrency(actualUnit * (Number(item.quantity) || 1), item.currency || 'SAR')}</span>
                        </div>
                      </td>
                      {/* Sell Value */}
                      <td className="px-1 py-1 text-right">
                        <div className="flex flex-col items-end">
                          <input
                            type="number"
                            className={inp + ' text-right'}
                            style={{ width: 90 }}
                            value={item.selling_price ?? 0}
                            onChange={e => updateField(item.id, 'selling_price', e.target.value)}
                            onBlur={e => handleBlur(item, 'selling_price', e.target.value)}
                            min="0"
                            placeholder="0"
                          />
                          <span className="text-xs text-slate-400 mt-0.5">= {formatCurrency((Number(item.selling_price) || 0) * (Number(item.quantity) || 1), item.currency || 'SAR')}</span>
                        </div>
                      </td>
                      {/* Order Status */}
                      <td className="px-1 py-1">
                        <select
                          className={`text-xs px-2 py-1 rounded font-semibold border-0 cursor-pointer ${ORDER_COLORS[itemOrderStatus] || 'bg-slate-100 text-slate-600'}`}
                          value={itemOrderStatus}
                          onChange={e => handleSelectChange(item, 'order_status', e.target.value)}
                        >
                          <option value="not_ordered">Not Ordered</option>
                          <option value="ordered">Ordered</option>
                        </select>
                      </td>
                      {/* Delivery Status */}
                      <td className="px-1 py-1">
                        <select
                          className={`text-xs px-2 py-1 rounded font-semibold border-0 cursor-pointer ${DELIVERY_COLORS[item.delivery_status] || 'bg-slate-100 text-slate-600'}`}
                          value={item.delivery_status || 'pending'}
                          onChange={e => handleSelectChange(item, 'delivery_status', e.target.value)}
                        >
                          <option value="pending">Pending</option>
                          <option value="partially_received">Partially Received</option>
                          <option value="received">Received</option>
                        </select>
                      </td>
                      {/* Expected Delivery */}
                      <td className="px-1 py-1">
                        <input
                          type="date"
                          className={inp}
                          value={item.expected_delivery_date || ''}
                          onChange={e => updateField(item.id, 'expected_delivery_date', e.target.value)}
                          onBlur={e => handleBlur(item, 'expected_delivery_date', e.target.value)}
                        />
                      </td>
                      {/* Delete */}
                      <td className="px-2 py-1">
                        <button onClick={() => deleteItem(item.id)} className="p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {filtered.length > 0 && (
                <tfoot className="bg-slate-50 border-t-2 border-slate-300 text-xs font-semibold text-slate-700">
                  <tr>
                    <td className="px-3 py-2 text-slate-500" colSpan={6}>Totals ({filtered.length} items)</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(filtered.reduce((s, i) => s + (Number(i.planned_cost_price) || Number(i.cost_price) || 0) * (Number(i.quantity) || 1), 0), 'SAR')}</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(filtered.reduce((s, i) => s + (Number(i.actual_cost_price) || 0) * (Number(i.quantity) || 1), 0), 'SAR')}</td>
                    <td className="px-3 py-2 text-right text-emerald-700">{formatCurrency(filtered.reduce((s, i) => s + (Number(i.selling_price) || 0) * (Number(i.quantity) || 1), 0), 'SAR')}</td>
                    <td colSpan={4}></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </PanelWrapper>
      )}

      {/* Summary tables */}
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
                  <th className="text-right py-1">Sell Value</th>
                </tr>
              </thead>
              <tbody>
                {byCategory.map(([cat, data]) => (
                  <tr key={cat} className="border-t border-slate-100">
                    <td className="py-1.5 text-slate-700 font-medium">{BOM_CATEGORY_LABELS[cat] || cat}</td>
                    <td className="py-1.5 text-right text-slate-500">{data.count}</td>
                    <td className="py-1.5 text-right text-slate-700">{formatCurrency(data.plannedCost, 'SAR')}</td>
                    <td className="py-1.5 text-right text-slate-600">{data.actualCost > 0 ? formatCurrency(data.actualCost, 'SAR') : '—'}</td>
                    <td className="py-1.5 text-right text-emerald-700">{data.sellValue > 0 ? formatCurrency(data.sellValue, 'SAR') : '—'}</td>
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
                  <th className="text-right py-1">Sell Value</th>
                </tr>
              </thead>
              <tbody>
                {bySupplier.map(([sup, data]) => (
                  <tr key={sup} className="border-t border-slate-100">
                    <td className="py-1.5 text-slate-700 font-medium">{sup}</td>
                    <td className="py-1.5 text-right text-slate-500">{data.count}</td>
                    <td className="py-1.5 text-right text-slate-700">{formatCurrency(data.plannedCost, 'SAR')}</td>
                    <td className="py-1.5 text-right text-slate-600">{data.actualCost > 0 ? formatCurrency(data.actualCost, 'SAR') : '—'}</td>
                    <td className="py-1.5 text-right text-emerald-700">{data.sellValue > 0 ? formatCurrency(data.sellValue, 'SAR') : '—'}</td>
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

function KpiCard({ label, value, icon, color }) {
  return (
    <div className={`bg-white rounded-lg shadow-sm p-4 border-l-4 ${color}`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs text-slate-500 uppercase tracking-wide">{label}</div>
          <div className="text-2xl font-bold text-slate-800 mt-1">{value}</div>
        </div>
        {icon}
      </div>
    </div>
  );
}

function Spinner() {
  return <div className="flex justify-center py-12"><div className="w-7 h-7 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;
}