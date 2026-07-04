import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { formatCurrency, formatDate, BOM_CATEGORY_LABELS } from '@/lib/constants';
import { Plus, Package, Trash2, Filter, Tag, Truck, ShoppingCart, TrendingUp, CheckCircle, Clock, Edit2, X, Check, ChevronDown, ChevronRight, Layers } from 'lucide-react';
import PanelWrapper from '@/components/ui/PanelWrapper';
import SkeletonTable from '@/components/ui/SkeletonTable';
import EmptyState from '@/components/ui/EmptyState';

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
  const saveTimers = useRef({});

  // Panel expand/collapse
  const [expandedPanels, setExpandedPanels] = useState({});

  // Multi-select / bulk edit
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkEdit, setBulkEdit] = useState(null); // { field, value }

  // Filters
  const [filterCategory, setFilterCategory] = useState('');
  const [filterOrderStatus, setFilterOrderStatus] = useState('');
  const [filterDelivery, setFilterDelivery] = useState('');
  const [filterSupplier, setFilterSupplier] = useState('');

  // Clear selection when filters change
  useEffect(() => { setSelectedIds(new Set()); }, [filterCategory, filterOrderStatus, filterDelivery, filterSupplier]);

  useEffect(() => { load(); }, [projectId]);

  async function load() {
    setLoading(true);
    const b = await base44.entities.BOMItem.filter({ project_id: projectId }, '-created_date', 300);
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
    // Debounce saves per item to avoid rate limiting on rapid edits
    if (saveTimers.current[item.id]) clearTimeout(saveTimers.current[item.id]);
    saveTimers.current[item.id] = setTimeout(() => saveItem(updated), 600);
  }

  // Selection helpers
  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(i => i.id)));
    }
  }

  async function applyBulkEdit() {
    if (!bulkEdit || selectedIds.size === 0) return;
    const { field, value } = bulkEdit;
    // Expand selected (possibly aggregated) rows into their underlying BOMItem ids
    const selectedRows = allTopLevel.filter(i => selectedIds.has(i.id));
    const ids = selectedRows.flatMap(i => i._ids || [i.id]);
    // Optimistic UI update first
    setItems(prev => prev.map(i =>
      ids.includes(i.id) ? { ...i, [field]: value, ...(field === 'order_status' ? { ordered: value === 'ordered' } : {}) } : i
    ));
    setBulkEdit(null);
    setSelectedIds(new Set());
    // Single batched request instead of one call per item
    const extra = field === 'order_status' ? { ordered: value === 'ordered' } : {};
    await base44.entities.BOMItem.bulkUpdate(ids.map(id => ({ id, [field]: value, ...extra })));
  }

  async function bulkDelete() {
    if (!confirm(`Delete ${selectedIds.size} selected item(s)?`)) return;
    const selectedRows = allTopLevel.filter(i => selectedIds.has(i.id));
    const ids = selectedRows.flatMap(i => i._ids || [i.id]);
    setItems(prev => prev.filter(i => !ids.includes(i.id)));
    setSelectedIds(new Set());
    await base44.entities.BOMItem.deleteMany({ id: { $in: ids } });
  }

  function handleSelectChange(item, field, value) {
    const updated = { ...item, [field]: value };
    setItems(prev => prev.map(i => i.id === item.id ? updated : i));
    if (saveTimers.current[item.id]) clearTimeout(saveTimers.current[item.id]);
    saveTimers.current[item.id] = setTimeout(() => saveItem(updated), 300);
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

  // Separate panel parents, panel children, and standalone items
  const panelParents = useMemo(() => items.filter(i => !i.parent_id && i.category === 'panel'), [items]);
  const childItems = useMemo(() => items.filter(i => !!i.parent_id), [items]);
  const standaloneItems = useMemo(() => items.filter(i => !i.parent_id && i.category !== 'panel'), [items]);

  // Aggregate standalone items by part_no+description into single lines
  const aggregatedStandalone = useMemo(() => {
    const map = new Map();
    for (const item of standaloneItems) {
      const key = `${(item.manufacturer_part_number || '').trim().toLowerCase()}||${(item.description || '').trim().toLowerCase()}`;
      if (map.has(key)) {
        const agg = map.get(key);
        agg._qty_total = (agg._qty_total || agg.quantity || 1) + (item.quantity || 1);
        agg._ids = [...(agg._ids || [agg.id]), item.id];
        agg.quantity = agg._qty_total;
      } else {
        map.set(key, { ...item, _qty_total: item.quantity || 1, _ids: [item.id] });
      }
    }
    return [...map.values()];
  }, [standaloneItems]);

  // Children lookup by parent_id
  const childrenByParent = useMemo(() => {
    const map = {};
    for (const c of childItems) {
      if (!map[c.parent_id]) map[c.parent_id] = [];
      map[c.parent_id].push(c);
    }
    return map;
  }, [childItems]);

  // All top-level items for filtering: panel parents + aggregated standalone
  const allTopLevel = useMemo(() => [...panelParents, ...aggregatedStandalone], [panelParents, aggregatedStandalone]);

  const filtered = useMemo(() => allTopLevel.filter(item => {
    if (filterCategory && item.category !== filterCategory) return false;
    const os = item.order_status || (item.ordered ? 'ordered' : 'not_ordered');
    if (filterOrderStatus && os !== filterOrderStatus) return false;
    if (filterDelivery && item.delivery_status !== filterDelivery) return false;
    if (filterSupplier && item.supplier !== filterSupplier) return false;
    return true;
  }), [allTopLevel, filterCategory, filterOrderStatus, filterDelivery, filterSupplier]);

  // Dashboard KPIs — based on top-level items only (panels + aggregated standalone)
  const totalItems = allTopLevel.length;
  const totalPlannedCost = allTopLevel.reduce((s, i) => s + (Number(i.planned_cost_price) || Number(i.cost_price) || 0) * (Number(i.quantity) || 1), 0);
  const totalActualCost = allTopLevel.reduce((s, i) => s + (Number(i.actual_cost_price) || 0) * (Number(i.quantity) || 1), 0);
  const totalSell = allTopLevel.reduce((s, i) => s + (Number(i.selling_price) || 0) * (Number(i.quantity) || 1), 0);
  const orderedCount = allTopLevel.filter(i => (i.order_status || (i.ordered ? 'ordered' : 'not_ordered')) === 'ordered').length;
  const receivedCount = allTopLevel.filter(i => i.delivery_status === 'received').length;
  const pendingDelivery = allTopLevel.filter(i => i.delivery_status === 'pending' || i.delivery_status === 'partially_received').length;

  const byCategory = useMemo(() => {
    const map = {};
    allTopLevel.forEach(i => {
      const cat = i.category || 'other';
      if (!map[cat]) map[cat] = { count: 0, plannedCost: 0, actualCost: 0, sellValue: 0 };
      map[cat].count++;
      map[cat].plannedCost += (Number(i.planned_cost_price) || Number(i.cost_price) || 0) * (Number(i.quantity) || 1);
      map[cat].actualCost += (Number(i.actual_cost_price) || 0) * (Number(i.quantity) || 1);
      map[cat].sellValue += (Number(i.selling_price) || 0) * (Number(i.quantity) || 1);
    });
    return Object.entries(map).sort((a, b) => b[1].plannedCost - a[1].plannedCost);
  }, [allTopLevel]);

  const bySupplier = useMemo(() => {
    const map = {};
    allTopLevel.forEach(i => {
      const sup = i.supplier || '(No Supplier)';
      if (!map[sup]) map[sup] = { count: 0, plannedCost: 0, actualCost: 0, sellValue: 0 };
      map[sup].count++;
      map[sup].plannedCost += (Number(i.planned_cost_price) || Number(i.cost_price) || 0) * (Number(i.quantity) || 1);
      map[sup].actualCost += (Number(i.actual_cost_price) || 0) * (Number(i.quantity) || 1);
      map[sup].sellValue += (Number(i.selling_price) || 0) * (Number(i.quantity) || 1);
    });
    return Object.entries(map).sort((a, b) => b[1].plannedCost - a[1].plannedCost);
  }, [allTopLevel]);

  if (loading) return <SkeletonTable columns={6} rows={6} />;

  return (
    <div className="space-y-5">

      {/* Dashboard KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Total Items" value={totalItems} icon={<Package className="w-5 h-5" />} color="border-slate-400" />
        <KpiCard label="Planned Cost" value={formatCurrency(totalPlannedCost, 'SAR')} icon={<Tag className="w-5 h-5" />} color="border-blue-400" />
        <KpiCard label="Actual Cost" value={formatCurrency(totalActualCost, 'SAR')} icon={<Tag className="w-5 h-5" />} color="border-amber-400" />
        <KpiCard label="Sell Value" value={formatCurrency(totalSell, 'SAR')} icon={<TrendingUp className="w-5 h-5" />} color="border-emerald-400" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Ordered" value={orderedCount} icon={<Truck className="w-5 h-5" />} color="border-blue-400" />
        <KpiCard label="Not Ordered" value={totalItems - orderedCount} icon={<ShoppingCart className="w-5 h-5" />} color="border-slate-400" />
        <KpiCard label="Received" value={receivedCount} icon={<CheckCircle className="w-5 h-5" />} color="border-emerald-400" />
        <KpiCard label="Pending Delivery" value={pendingDelivery} icon={<Clock className="w-5 h-5" />} color="border-amber-400" />
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

      {/* Bulk Edit Toolbar */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 bg-slate-800 text-white rounded-lg px-4 py-2.5 text-sm">
          <span className="font-semibold text-amber-400">{selectedIds.size} selected</span>
          <span className="text-slate-400">·</span>
          <span className="text-slate-300 text-xs">Bulk edit:</span>

          {/* Order Status */}
          <div className="flex items-center gap-1.5">
            <select
              className="text-xs bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white focus:outline-none focus:border-amber-400"
              value={bulkEdit?.field === 'order_status' ? bulkEdit.value : ''}
              onChange={e => setBulkEdit(e.target.value ? { field: 'order_status', value: e.target.value } : null)}
            >
              <option value="">Order Status…</option>
              <option value="ordered">Ordered</option>
              <option value="not_ordered">Not Ordered</option>
            </select>
          </div>

          {/* Delivery Status */}
          <div className="flex items-center gap-1.5">
            <select
              className="text-xs bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white focus:outline-none focus:border-amber-400"
              value={bulkEdit?.field === 'delivery_status' ? bulkEdit.value : ''}
              onChange={e => setBulkEdit(e.target.value ? { field: 'delivery_status', value: e.target.value } : null)}
            >
              <option value="">Delivery Status…</option>
              <option value="pending">Pending</option>
              <option value="partially_received">Partially Received</option>
              <option value="received">Received</option>
            </select>
          </div>

          {/* Category */}
          <div className="flex items-center gap-1.5">
            <select
              className="text-xs bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white focus:outline-none focus:border-amber-400"
              value={bulkEdit?.field === 'category' ? bulkEdit.value : ''}
              onChange={e => setBulkEdit(e.target.value ? { field: 'category', value: e.target.value } : null)}
            >
              <option value="">Category…</option>
              {Object.entries(BOM_CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>

          {/* Supplier */}
          <div className="flex items-center gap-1.5">
            <input
              className="text-xs bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white placeholder-slate-400 focus:outline-none focus:border-amber-400 w-28"
              placeholder="Set supplier…"
              value={bulkEdit?.field === 'supplier' ? bulkEdit.value : ''}
              onChange={e => setBulkEdit(e.target.value ? { field: 'supplier', value: e.target.value } : null)}
            />
          </div>

          {bulkEdit && (
            <button onClick={applyBulkEdit}
              className="flex items-center gap-1 px-3 py-1 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-xs rounded">
              <Check className="w-3.5 h-3.5" /> Apply
            </button>
          )}

          <button onClick={bulkDelete}
            className="flex items-center gap-1 px-3 py-1 bg-red-600 hover:bg-red-500 text-white font-semibold text-xs rounded ml-auto">
            <Trash2 className="w-3.5 h-3.5" /> Delete {selectedIds.size}
          </button>

          <button onClick={() => { setSelectedIds(new Set()); setBulkEdit(null); }}
            className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

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
        <EmptyState
          icon={<Package className="w-12 h-12 opacity-40" />}
          title="No BOM items yet"
          message="Add items manually here, or import and extract a BOM from a document in the Documents tab."
          actions={[
            { label: 'Add Item', primary: true, icon: <Plus className="w-4 h-4" />, onClick: () => setAdding(true) },
          ]}
        />
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
          {/* Group items by category */}
          {(() => {
            // Build ordered category groups from filtered items
            const catOrder = Object.keys(BOM_CATEGORY_LABELS);
            const groups = {};
            filtered.forEach(item => {
              const cat = item.category || 'other';
              if (!groups[cat]) groups[cat] = [];
              groups[cat].push(item);
            });
            // Include any category in the data, even if not in catOrder (fallback at end)
            const knownCats = catOrder.filter(c => groups[c]);
            const unknownCats = Object.keys(groups).filter(c => !catOrder.includes(c));
            const sortedCats = [...knownCats, ...unknownCats];

            function GroupTableHeader({ catItems }) {
              const allCatSelected = catItems.length > 0 && catItems.every(i => selectedIds.has(i.id));
              function toggleGroupAll() {
                setSelectedIds(prev => {
                  const next = new Set(prev);
                  if (allCatSelected) catItems.forEach(i => next.delete(i.id));
                  else catItems.forEach(i => next.add(i.id));
                  return next;
                });
              }
              return (
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase border-b border-slate-200 sticky top-0 z-10">
                  <tr>
                    <th className="px-3 py-3 w-8">
                      <button onClick={toggleGroupAll} className="flex items-center justify-center">
                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${allCatSelected ? 'bg-amber-400 border-amber-400' : 'border-slate-300 hover:border-amber-400'}`}>
                          {allCatSelected && <Check className="w-2.5 h-2.5 text-slate-900" />}
                        </div>
                      </button>
                    </th>
                    <th className="px-3 py-3 text-left">Description / Part No.</th>
                    <th className="px-3 py-3 text-left">Category</th>
                    <th className="px-3 py-3 text-left">Supplier</th>
                    <th className="px-3 py-3 text-right">Qty</th>
                    <th className="px-3 py-3 text-right">Stock</th>
                    <th className="px-3 py-3 text-right">Order Qty</th>
                    <th className="px-3 py-3 text-right">Planned Cost</th>
                    <th className="px-3 py-3 text-right">Actual Cost</th>
                    <th className="px-3 py-3 text-right">Sell Value</th>
                    <th className="px-3 py-3 text-left">Order</th>
                    <th className="px-3 py-3 text-left">Delivery</th>
                    <th className="px-3 py-3 text-left">Exp. Delivery</th>
                    <th className="px-3 py-3 w-8"></th>
                  </tr>
                </thead>
              );
            }

            return (
              <div className="space-y-3">
                <div className="text-xs text-slate-500">{filtered.length} of {items.length} items · <span className="italic">Click any cell to edit · Check rows for bulk edit</span></div>
                {sortedCats.map(cat => {
                  const catItems = groups[cat];
                  const catPlanned = catItems.reduce((s, i) => s + (Number(i.planned_cost_price) || Number(i.cost_price) || 0) * (Number(i.quantity) || 1), 0);
                  const catActual = catItems.reduce((s, i) => s + (Number(i.actual_cost_price) || 0) * (Number(i.quantity) || 1), 0);
                  const catSell = catItems.reduce((s, i) => s + (Number(i.selling_price) || 0) * (Number(i.quantity) || 1), 0);
                  return (
                    <div key={cat} className="bg-white rounded-lg shadow-sm overflow-hidden border border-slate-200">
                      {/* Category header row */}
                      <div className="flex items-center gap-3 px-4 py-2.5 bg-slate-800 text-white text-xs font-semibold">
                        <span className="uppercase tracking-wide text-slate-300">{BOM_CATEGORY_LABELS[cat] || cat}</span>
                        <span className="text-slate-400">·</span>
                        <span className="text-slate-300">{catItems.length} item{catItems.length !== 1 ? 's' : ''}</span>
                        <span className="ml-auto flex gap-4 text-xs">
                          <span>Planned: <span className="text-amber-300 font-bold">{formatCurrency(catPlanned, 'SAR')}</span></span>
                          <span>Actual: <span className="text-blue-300 font-bold">{formatCurrency(catActual, 'SAR')}</span></span>
                          <span>Sell: <span className="text-emerald-300 font-bold">{formatCurrency(catSell, 'SAR')}</span></span>
                        </span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm min-w-[1200px]">
                          <GroupTableHeader catItems={catItems} />
                          <tbody>
                            {catItems.map(item => {
                              const oQty = orderQty(item);
                              const plannedUnit = Number(item.planned_cost_price) || Number(item.cost_price) || 0;
                              const actualUnit = Number(item.actual_cost_price) || 0;
                              const itemOrderStatus = item.order_status || (item.ordered ? 'ordered' : 'not_ordered');
                              const isSaving = saving[item.id];
                              const isSelected = selectedIds.has(item.id);
                              const isPanel = item.category === 'panel';
                              const panelChildren = isPanel ? (childrenByParent[item.id] || []) : [];
                              const isPanelExpanded = expandedPanels[item.id];
                              return [
                                <tr key={item.id} className={`border-t border-slate-100 hover:bg-amber-50/30 ${isSaving ? 'opacity-70' : ''} ${isSelected ? 'bg-amber-50' : ''} ${isPanel ? 'bg-orange-50/40' : ''}`}>
                                  <td className="px-3 py-1">
                                    <div className="flex items-center gap-1">
                                      {isPanel && (
                                        <button onClick={() => setExpandedPanels(p => ({ ...p, [item.id]: !isPanelExpanded }))}
                                          className="text-orange-500 hover:text-orange-700 shrink-0">
                                          {isPanelExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                                        </button>
                                      )}
                                      <button onClick={() => toggleSelect(item.id)} className="flex items-center justify-center">
                                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${isSelected ? 'bg-amber-400 border-amber-400' : 'border-slate-300 hover:border-amber-400'}`}>
                                          {isSelected && <Check className="w-2.5 h-2.5 text-slate-900" />}
                                        </div>
                                      </button>
                                    </div>
                                  </td>
                                  <td className="px-1 py-1">
                                    <div className="space-y-0.5">
                                      <div className="flex items-center gap-1">
                                        {isPanel && <Layers className="w-3 h-3 text-orange-400 shrink-0" />}
                                        <input className={inp + (isPanel ? ' font-semibold text-orange-800' : '')} value={item.description || ''} onChange={e => updateField(item.id, 'description', e.target.value)} onBlur={e => handleBlur(item, 'description', e.target.value)} placeholder="Description" />
                                      </div>
                                      {!isPanel && <input className={inp + ' text-slate-400'} value={item.manufacturer_part_number || ''} onChange={e => updateField(item.id, 'manufacturer_part_number', e.target.value)} onBlur={e => handleBlur(item, 'manufacturer_part_number', e.target.value)} placeholder="Part No." />}
                                      {isPanel && panelChildren.length > 0 && <span className="text-xs text-orange-500">{panelChildren.length} component{panelChildren.length !== 1 ? 's' : ''}</span>}
                                    </div>
                                  </td>
                                  <td className="px-1 py-1">
                                    <select className={inp + ' cursor-pointer'} value={item.category || 'other'} onChange={e => handleSelectChange(item, 'category', e.target.value)}>
                                      {Object.entries(BOM_CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                                    </select>
                                  </td>
                                  <td className="px-1 py-1">
                                    <input className={inp} value={item.supplier || ''} onChange={e => updateField(item.id, 'supplier', e.target.value)} onBlur={e => handleBlur(item, 'supplier', e.target.value)} placeholder="Supplier" />
                                  </td>
                                  <td className="px-1 py-1 text-right">
                                    <div className="flex gap-1 justify-end items-center">
                                      <input type="number" className={inp + ' text-right'} style={{ width: 55 }} value={item.quantity ?? 1} onChange={e => updateField(item.id, 'quantity', e.target.value)} onBlur={e => handleBlur(item, 'quantity', e.target.value)} min="0" />
                                      <input className={inp} style={{ width: 40 }} value={item.unit || 'pcs'} onChange={e => updateField(item.id, 'unit', e.target.value)} onBlur={e => handleBlur(item, 'unit', e.target.value)} />
                                    </div>
                                  </td>
                                  <td className="px-1 py-1 text-right">
                                    <input type="number" className={inp + ' text-right'} style={{ width: 65 }} value={item.stock_qty ?? 0} onChange={e => updateField(item.id, 'stock_qty', e.target.value)} onBlur={e => handleBlur(item, 'stock_qty', e.target.value)} min="0" />
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    <span className={`font-semibold text-xs ${oQty > 0 ? 'text-amber-700' : 'text-emerald-600'}`}>{oQty}</span>
                                  </td>
                                  <td className="px-1 py-1 text-right">
                                    <div className="flex flex-col items-end">
                                      <input type="number" className={inp + ' text-right'} style={{ width: 90 }} value={item.planned_cost_price ?? 0} onChange={e => updateField(item.id, 'planned_cost_price', e.target.value)} onBlur={e => handleBlur(item, 'planned_cost_price', e.target.value)} min="0" placeholder="0" />
                                      <span className="text-xs text-slate-400 mt-0.5">= {formatCurrency(plannedUnit * (Number(item.quantity) || 1), item.currency || 'SAR')}</span>
                                    </div>
                                  </td>
                                  <td className="px-1 py-1 text-right">
                                    <div className="flex flex-col items-end">
                                      <input type="number" className={inp + ' text-right'} style={{ width: 90 }} value={item.actual_cost_price ?? 0} onChange={e => updateField(item.id, 'actual_cost_price', e.target.value)} onBlur={e => handleBlur(item, 'actual_cost_price', e.target.value)} min="0" placeholder="0" />
                                      <span className="text-xs text-slate-400 mt-0.5">= {formatCurrency(actualUnit * (Number(item.quantity) || 1), item.currency || 'SAR')}</span>
                                    </div>
                                  </td>
                                  <td className="px-1 py-1 text-right">
                                    <div className="flex flex-col items-end">
                                      <input type="number" className={inp + ' text-right'} style={{ width: 90 }} value={item.selling_price ?? 0} onChange={e => updateField(item.id, 'selling_price', e.target.value)} onBlur={e => handleBlur(item, 'selling_price', e.target.value)} min="0" placeholder="0" />
                                      <span className="text-xs text-slate-400 mt-0.5">= {formatCurrency((Number(item.selling_price) || 0) * (Number(item.quantity) || 1), item.currency || 'SAR')}</span>
                                    </div>
                                  </td>
                                  <td className="px-1 py-1">
                                    <select className={`text-xs px-2 py-1 rounded font-semibold border-0 cursor-pointer ${ORDER_COLORS[itemOrderStatus] || 'bg-slate-100 text-slate-600'}`} value={itemOrderStatus} onChange={e => handleSelectChange(item, 'order_status', e.target.value)}>
                                      <option value="not_ordered">Not Ordered</option>
                                      <option value="ordered">Ordered</option>
                                    </select>
                                  </td>
                                  <td className="px-1 py-1">
                                    <select className={`text-xs px-2 py-1 rounded font-semibold border-0 cursor-pointer ${DELIVERY_COLORS[item.delivery_status] || 'bg-slate-100 text-slate-600'}`} value={item.delivery_status || 'pending'} onChange={e => handleSelectChange(item, 'delivery_status', e.target.value)}>
                                      <option value="pending">Pending</option>
                                      <option value="partially_received">Partially Received</option>
                                      <option value="received">Received</option>
                                    </select>
                                  </td>
                                  <td className="px-1 py-1">
                                    <input type="date" className={inp} value={item.expected_delivery_date || ''} onChange={e => updateField(item.id, 'expected_delivery_date', e.target.value)} onBlur={e => handleBlur(item, 'expected_delivery_date', e.target.value)} />
                                  </td>
                                  <td className="px-2 py-1">
                                    <button onClick={() => deleteItem(item.id)} className="p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded">
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </td>
                                </tr>,
                                // Panel children expanded sub-table
                                isPanel && isPanelExpanded && panelChildren.length > 0 && (
                                  <tr key={`${item.id}_children`}>
                                    <td colSpan={14} className="p-0">
                                      <div className="bg-orange-50/60 border-t border-orange-100 pl-8">
                                        <table className="w-full text-xs">
                                          <thead className="bg-orange-100 text-orange-800">
                                            <tr>
                                              <th className="px-3 py-1.5 text-left">Part No.</th>
                                              <th className="px-3 py-1.5 text-left">Description</th>
                                              <th className="px-3 py-1.5 text-left">Supplier</th>
                                              <th className="px-3 py-1.5 text-right">Qty</th>
                                              <th className="px-3 py-1.5 text-left">Unit</th>
                                              <th className="px-3 py-1.5 text-right">Unit Cost</th>
                                              <th className="px-3 py-1.5 text-right">Total Cost</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {panelChildren.map(child => (
                                              <tr key={child.id} className="border-t border-orange-100 hover:bg-orange-50">
                                                <td className="px-3 py-1.5 font-mono text-slate-500">{child.manufacturer_part_number || '—'}</td>
                                                <td className="px-3 py-1.5 text-slate-700">{child.description}</td>
                                                <td className="px-3 py-1.5 text-slate-500">{child.supplier || '—'}</td>
                                                <td className="px-3 py-1.5 text-right font-semibold">{child.quantity}</td>
                                                <td className="px-3 py-1.5 text-slate-500">{child.unit || 'pcs'}</td>
                                                <td className="px-3 py-1.5 text-right">{formatCurrency(child.planned_cost_price || 0, 'SAR')}</td>
                                                <td className="px-3 py-1.5 text-right font-semibold">{formatCurrency((child.planned_cost_price || 0) * (child.quantity || 1), 'SAR')}</td>
                                              </tr>
                                            ))}
                                          </tbody>
                                          <tfoot className="border-t border-orange-200 bg-orange-100/60">
                                            <tr>
                                              <td colSpan={6} className="px-3 py-1.5 text-xs text-orange-700 font-semibold">Total ({panelChildren.length} components)</td>
                                              <td className="px-3 py-1.5 text-right text-xs font-bold text-orange-800">
                                                {formatCurrency(panelChildren.reduce((s, c) => s + (c.planned_cost_price || 0) * (c.quantity || 1), 0), 'SAR')}
                                              </td>
                                            </tr>
                                          </tfoot>
                                        </table>
                                      </div>
                                    </td>
                                  </tr>
                                ),
                              ];
                            })}
                          </tbody>
                          <tfoot className="bg-slate-50 border-t border-slate-200 text-xs font-semibold text-slate-600">
                            <tr>
                              <td colSpan={7} className="px-3 py-2">Subtotal ({catItems.length})</td>
                              <td className="px-3 py-2 text-right">{formatCurrency(catPlanned, 'SAR')}</td>
                              <td className="px-3 py-2 text-right">{formatCurrency(catActual, 'SAR')}</td>
                              <td className="px-3 py-2 text-right text-emerald-700">{formatCurrency(catSell, 'SAR')}</td>
                              <td colSpan={4}></td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  );
                })}
                {/* Grand total */}
                <div className="bg-slate-800 text-white rounded-lg px-4 py-3 flex flex-wrap gap-6 text-xs font-semibold">
                  <span className="text-slate-300">Grand Total ({filtered.length} items)</span>
                  <span className="ml-auto flex gap-6">
                    <span>Planned: <span className="text-amber-300">{formatCurrency(filtered.reduce((s, i) => s + (Number(i.planned_cost_price) || Number(i.cost_price) || 0) * (Number(i.quantity) || 1), 0), 'SAR')}</span></span>
                    <span>Actual: <span className="text-blue-300">{formatCurrency(filtered.reduce((s, i) => s + (Number(i.actual_cost_price) || 0) * (Number(i.quantity) || 1), 0), 'SAR')}</span></span>
                    <span>Sell: <span className="text-emerald-300">{formatCurrency(filtered.reduce((s, i) => s + (Number(i.selling_price) || 0) * (Number(i.quantity) || 1), 0), 'SAR')}</span></span>
                  </span>
                </div>
              </div>
            );
          })()}
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
          <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">{label}</div>
          <div className="text-xl font-semibold text-slate-800">{value}</div>
        </div>
        <div className="text-slate-300 mt-0.5">{icon}</div>
      </div>
    </div>
  );
}