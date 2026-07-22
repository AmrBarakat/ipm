import { useState, useEffect, useMemo, useRef } from 'react';
import { useEntityList } from '@/hooks/useEntity';
import { ENTITY_QUERY } from '@/lib/entityQueryDefaults';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { formatCurrency, formatDate, BOM_CATEGORY_LABELS, BOM_CATEGORY_OPTIONS } from '@/lib/constants';
import { ShoppingCart, Package, ChevronDown, ChevronRight, Check, AlertCircle, X, Save, Trash2, RefreshCw, Filter } from 'lucide-react';
import { useConfirm } from '@/components/ui/ConfirmDialog';

// Items eligible for procurement: not ordered, top-level (not panel children),
// and not an engineering/service line item.
function isProcurementItem(i) {
  if (i.parent_id) return false;
  const pn = (i.manufacturer_part_number || '').trim().toLowerCase();
  if (i.category === 'service' || pn === 'engineering') return false;
  return true;
}

// Material-status options with their badge / select styling.
const MATERIAL_STATUS = [
  { value: 'not_ordered', label: 'Not Ordered', badge: 'bg-slate-100 text-slate-600', sel: 'border-slate-300 text-slate-700' },
  { value: 'ordered', label: 'Ordered', badge: 'bg-blue-100 text-blue-700', sel: 'border-blue-400 text-blue-700 font-semibold' },
  { value: 'received', label: 'Received', badge: 'bg-amber-100 text-amber-700', sel: 'border-amber-400 text-amber-700 font-semibold' },
  { value: 'delivered', label: 'Delivered', badge: 'bg-emerald-100 text-emerald-700', sel: 'border-emerald-400 text-emerald-700 font-semibold' },
];
const MS_BY_VALUE = Object.fromEntries(MATERIAL_STATUS.map(s => [s.value, s]));

/** Effective material_status, deriving from legacy fields when missing (one-time migration). */
function effectiveMaterialStatus(i) {
  const ms = i.material_status;
  if (ms && ms !== 'not_ordered') return ms;
  const dq = Number(i.delivered_qty) || 0;
  const qty = Number(i.quantity) || 0;
  if (qty > 0 && dq >= qty) return 'received';
  if (i.order_status === 'ordered' || i.ordered) return 'ordered';
  return 'not_ordered';
}

/** Order qty = max(0, quantity − stock_qty). Read-only computed field. */
function orderQtyOf(i) {
  return Math.max(0, (Number(i.quantity) || 0) - (Number(i.stock_qty) || 0));
}

// Session cache so locally-deleted procurement items (and the frozen BOM
// snapshot) survive tab switches / unmounts WITHOUT touching the BOM entity.
// Cleared by "Sync with BOM" or a full page reload.
const procurementCache = {}; // { [projectId]: { snapshot: array|null, hiddenIds: Set } }

export default function TabProcurement({ projectId, project }) {
  const { data: all = [], isLoading } = useEntityList('BOMItem', { project_id: projectId }, ENTITY_QUERY.BOMItem.sort, ENTITY_QUERY.BOMItem.limit);
  const [snapshot, setSnapshot] = useState(() => procurementCache[projectId]?.snapshot ?? null);
  const [hiddenIds, setHiddenIds] = useState(() => new Set(procurementCache[projectId]?.hiddenIds ?? []));
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [collapsedSuppliers, setCollapsedSuppliers] = useState(new Set());
  const [bulkEdit, setBulkEdit] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [materialFilter, setMaterialFilter] = useState('');
  const queryClient = useQueryClient();
  const confirmDialog = useConfirm();
  const saveTimers = useRef({});
  const pendingChanges = useRef({});

  useEffect(() => {
    procurementCache[projectId] = { snapshot, hiddenIds };
  }, [snapshot, hiddenIds, projectId]);

  async function refreshSnapshot() {
    await queryClient.refetchQueries({ queryKey: ['BOMItem', { project_id: projectId }] });
    setSnapshot(queryClient.getQueryData(['BOMItem', { project_id: projectId }]) || []);
  }

  useEffect(() => {
    const c = procurementCache[projectId];
    setSnapshot(c?.snapshot ?? null);
    setHiddenIds(new Set(c?.hiddenIds ?? []));
    setSelectedIds(new Set());
  }, [projectId]);

  useEffect(() => {
    if (snapshot === null && all.length > 0) setSnapshot(all);
  }, [all, snapshot]);

  const items = useMemo(
    () => (snapshot || all).filter(i => isProcurementItem(i) && !hiddenIds.has(i.id) && (!materialFilter || effectiveMaterialStatus(i) === materialFilter)),
    [snapshot, all, hiddenIds, materialFilter]
  );

  useEffect(() => {
    if (snapshot === null) return;
    setSelectedIds(new Set(snapshot.filter(isProcurementItem).map(i => i.id)));
  }, [snapshot]);

  // Group by supplier
  const grouped = useMemo(() => {
    const map = {};
    items.forEach(i => {
      const sup = i.supplier || '(No Supplier)';
      if (!map[sup]) map[sup] = [];
      map[sup].push(i);
    });
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  }, [items]);

  function toggleItem(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSupplierAll(supplier, supplierItems) {
    const allSelected = supplierItems.every(i => selectedIds.has(i.id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) supplierItems.forEach(i => next.delete(i.id));
      else supplierItems.forEach(i => next.add(i.id));
      return next;
    });
  }

  function toggleSupplierCollapse(supplier) {
    setCollapsedSuppliers(prev => {
      const next = new Set(prev);
      next.has(supplier) ? next.delete(supplier) : next.add(supplier);
      return next;
    });
  }

  function toggleAll() {
    if (selectedIds.size === items.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(items.map(i => i.id)));
  }

  // ── Inline editing ──────────────────────────────────────────────────────
  function updateField(item, field, value) {
    setSnapshot(prev => (prev || all).map(i => (i.id === item.id ? { ...i, [field]: value } : i)));
  }

  // Apply a set of changes to local state + debounce a single BOMItem.update
  // with only the changed fields.
  function patchAndSave(item, changes) {
    setSnapshot(prev => (prev || all).map(i => (i.id === item.id ? { ...i, ...changes } : i)));
    pendingChanges.current[item.id] = { ...(pendingChanges.current[item.id] || {}), ...changes };
    if (saveTimers.current[item.id]) clearTimeout(saveTimers.current[item.id]);
    saveTimers.current[item.id] = setTimeout(async () => {
      const payload = pendingChanges.current[item.id];
      delete pendingChanges.current[item.id];
      saveTimers.current[item.id] = null;
      if (!payload) return;
      try {
        await base44.entities.BOMItem.update(item.id, payload);
        queryClient.invalidateQueries({ queryKey: ['BOMItem'] });
      } catch (e) {
        // surface via refresh so the row reflects persisted state
        refreshSnapshot();
      }
    }, 600);
  }

  function handleStockBlur(item, value) {
    const v = Math.max(0, Number(value) || 0);
    patchAndSave(item, { stock_qty: v });
  }

  function handleReceivedBlur(item, value) {
    const qty = Number(item.quantity) || 0;
    let v = Math.max(0, Number(value) || 0);
    if (qty > 0) v = Math.min(v, qty);
    const cur = effectiveMaterialStatus(item);
    let ms;
    if (cur === 'delivered') ms = 'delivered'; // never downgrade
    else if (v === 0) ms = cur === 'ordered' || cur === 'not_ordered' ? cur : 'not_ordered';
    else if (qty > 0 && v >= qty) ms = 'received';
    else ms = 'ordered'; // partial → ordered
    patchAndSave(item, {
      received_qty: v,
      delivered_qty: v, // mirror to legacy field
      remaining_qty: Math.max(0, qty - v),
      delivery_status: qty > 0 && v >= qty ? 'delivered' : v > 0 ? 'partially_delivered' : 'not_delivered',
      material_status: ms,
    });
  }

  function handleMaterialStatusChange(item, value) {
    const changes = { material_status: value };
    const qty = Number(item.quantity) || 0;
    const received = Number(item.received_qty) || Number(item.delivered_qty) || 0;
    if (value === 'ordered') {
      changes.order_status = 'ordered';
      changes.ordered = true;
    } else if (value === 'received') {
      if (qty > 0 && received >= qty) {
        changes.delivered_qty = received;
        changes.remaining_qty = 0;
        changes.delivery_status = 'delivered';
      }
    } else if (value === 'delivered') {
      changes.site_delivered_date = new Date().toISOString().slice(0, 10);
    }
    patchAndSave(item, changes);
  }

  async function applyBulkEdit() {
    if (!bulkEdit || selectedIds.size === 0) return;
    const { field, value } = bulkEdit;
    const ids = [...selectedIds];
    let updates;
    if (field === 'material_status') {
      const today = new Date().toISOString().slice(0, 10);
      updates = ids.map(id => {
        const extra = {};
        if (value === 'ordered') { extra.order_status = 'ordered'; extra.ordered = true; }
        else if (value === 'delivered') { extra.site_delivered_date = today; }
        return { id, material_status: value, ...extra };
      });
    } else {
      updates = ids.map(id => ({ id, [field]: value }));
    }
    try {
      await base44.entities.BOMItem.bulkUpdate(updates);
    } catch (e) {
      alert('Bulk update failed: ' + (e?.message || 'unknown error'));
      return;
    }
    setBulkEdit(null);
    await refreshSnapshot();
  }

  async function syncWithBOM() {
    setSyncing(true);
    await refreshSnapshot();
    setHiddenIds(new Set());
    setSyncing(false);
  }

  async function bulkDelete() {
    if (selectedIds.size === 0) return;
    if (!(await confirmDialog({ title: 'Remove from procurement', description: `Remove ${selectedIds.size} selected item(s) from procurement? They stay in the BOM — use "Sync with BOM" to restore.`, confirmText: 'Continue', destructive: false }))) return;
    setHiddenIds(prev => new Set([...prev, ...selectedIds]));
    setSelectedIds(new Set());
    setBulkEdit(null);
  }

  // KPIs
  const totalItems = items.length;
  const orderedCount = items.filter(i => effectiveMaterialStatus(i) === 'ordered').length;
  const receivedCount = items.filter(i => effectiveMaterialStatus(i) === 'received').length;
  const deliveredCount = items.filter(i => effectiveMaterialStatus(i) === 'delivered').length;
  const outstandingOrderQty = items
    .filter(i => effectiveMaterialStatus(i) === 'not_ordered')
    .reduce((s, i) => s + orderQtyOf(i), 0);
  const totalValue = items.reduce((s, i) => s + (Number(i.planned_cost_price) || Number(i.cost_price) || 0) * (Number(i.quantity) || 1), 0);
  const selectedValue = items
    .filter(i => selectedIds.has(i.id))
    .reduce((s, i) => s + (Number(i.planned_cost_price) || Number(i.cost_price) || 0) * (Number(i.quantity) || 1), 0);

  if (isLoading) return <Spinner />;

  const inp = 'border border-slate-300 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white';
  const stop = e => e.stopPropagation();

  return (
    <div className="space-y-5">

      {/* Header KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Total Items" value={totalItems} color="border-slate-400" />
        <KpiCard label="Ordered" value={orderedCount} color="border-blue-400" />
        <KpiCard label="Received" value={receivedCount} color="border-amber-400" />
        <KpiCard label="Delivered" value={deliveredCount} color="border-emerald-400" />
        <KpiCard label="Outstanding Order Qty" value={outstandingOrderQty} color="border-slate-400" />
        <KpiCard label="Total Value" value={formatCurrency(totalValue, project?.currency || 'SAR')} color="border-slate-400" />
        <KpiCard label="Selected Value" value={formatCurrency(selectedValue, project?.currency || 'SAR')} color="border-emerald-400" />
      </div>

      {/* Top toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          {items.length > 0 && (
            <button onClick={toggleAll}
              className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
              <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${selectedIds.size === items.length ? 'bg-amber-400 border-amber-400' : 'border-slate-300'}`}>
                {selectedIds.size === items.length && <Check className="w-2.5 h-2.5 text-slate-900" />}
              </div>
              <span>{selectedIds.size === items.length ? 'Deselect All' : 'Select All'} ({items.length} items)</span>
            </button>
          )}
          <div className="flex items-center gap-1.5 text-sm">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <select value={materialFilter} onChange={e => setMaterialFilter(e.target.value)}
              className="text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white">
              <option value="">All Material Status</option>
              {MATERIAL_STATUS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2 text-xs text-slate-400">
            <AlertCircle className="w-3.5 h-3.5" />
            BOM materials grouped by supplier
          </span>
          <button onClick={syncWithBOM} disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-amber-300 rounded hover:bg-amber-50 text-amber-700 font-semibold disabled:opacity-60">
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing…' : 'Sync with BOM'}
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg shadow-sm border border-slate-100">
          <CheckGreen />
          <h3 className="font-semibold text-slate-700 text-lg mt-4 mb-1">
            {hiddenIds.size > 0 ? 'Items removed from procurement' : 'No procurement materials'}
          </h3>
          <p className="text-slate-400 text-sm">
            {hiddenIds.size > 0
              ? `${hiddenIds.size} item(s) hidden — press "Sync with BOM" above to restore them.`
              : 'No materials to show. Press "Sync with BOM" above to load from the BOM.'}
          </p>
        </div>
      ) : (
        <>
          {/* Bulk edit toolbar */}
          {selectedIds.size > 0 && (
            <div className="flex flex-wrap items-center gap-3 bg-slate-800 text-white rounded-lg px-4 py-2.5 text-sm">
              <span className="font-semibold text-amber-400">{selectedIds.size} selected</span>
              <span className="text-slate-400">·</span>
              <span className="text-slate-300 text-xs">Bulk edit:</span>

              <input
                className="text-xs bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white placeholder-slate-400 focus:outline-none focus:border-amber-400 w-32"
                placeholder="Set supplier…"
                value={bulkEdit?.field === 'supplier' ? bulkEdit.value : ''}
                onChange={e => setBulkEdit(e.target.value ? { field: 'supplier', value: e.target.value } : null)}
              />

              <select
                className="text-xs bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white focus:outline-none focus:border-amber-400"
                value={bulkEdit?.field === 'material_status' ? bulkEdit.value : ''}
                onChange={e => setBulkEdit(e.target.value ? { field: 'material_status', value: e.target.value } : null)}
              >
                <option value="">Material Status…</option>
                {MATERIAL_STATUS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>

              <input type="number" min="0"
                className="text-xs bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white placeholder-slate-400 focus:outline-none focus:border-amber-400 w-28"
                placeholder="Stock Qty…"
                value={bulkEdit?.field === 'stock_qty' ? bulkEdit.value : ''}
                onChange={e => setBulkEdit(e.target.value !== '' ? { field: 'stock_qty', value: Number(e.target.value) } : null)}
              />

              <select
                className="text-xs bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white focus:outline-none focus:border-amber-400"
                value={bulkEdit?.field === 'category' ? bulkEdit.value : ''}
                onChange={e => setBulkEdit(e.target.value ? { field: 'category', value: e.target.value } : null)}
              >
                <option value="">Category…</option>
                {BOM_CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>

              <input type="date"
                className="text-xs bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white focus:outline-none focus:border-amber-400"
                value={bulkEdit?.field === 'expected_delivery_date' ? bulkEdit.value : ''}
                onChange={e => setBulkEdit(e.target.value ? { field: 'expected_delivery_date', value: e.target.value } : null)}
              />

              <input type="number" min="0"
                className="text-xs bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white placeholder-slate-400 focus:outline-none focus:border-amber-400 w-28"
                placeholder="Unit Cost…"
                value={bulkEdit?.field === 'planned_cost_price' ? bulkEdit.value : ''}
                onChange={e => setBulkEdit(e.target.value !== '' ? { field: 'planned_cost_price', value: Number(e.target.value) } : null)}
              />

              {bulkEdit && (
                <button onClick={applyBulkEdit}
                  className="flex items-center gap-1 px-3 py-1 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-xs rounded">
                  <Save className="w-3.5 h-3.5" /> Apply to {selectedIds.size}
                </button>
              )}

              <button onClick={bulkDelete}
                className="flex items-center gap-1 px-3 py-1 bg-red-600 hover:bg-red-500 text-white font-semibold text-xs rounded ml-auto">
                <Trash2 className="w-3.5 h-3.5" /> Delete {selectedIds.size}
              </button>

              <button onClick={() => { setBulkEdit(null); setSelectedIds(new Set()); }}
                className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Supplier groups */}
          <div className="space-y-4">
            {grouped.map(([supplier, supplierItems]) => {
              const isCollapsed = collapsedSuppliers.has(supplier);
              const allSupSelected = supplierItems.every(i => selectedIds.has(i.id));
              const someSupSelected = supplierItems.some(i => selectedIds.has(i.id));

              return (
                <div key={supplier} className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                  {/* Supplier header */}
                  <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 border-b border-slate-200">
                    <button onClick={() => toggleSupplierAll(supplier, supplierItems)}
                      className="flex items-center justify-center shrink-0">
                      <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${allSupSelected ? 'bg-amber-400 border-amber-400' : someSupSelected ? 'bg-amber-200 border-amber-400' : 'border-slate-300'}`}>
                        {allSupSelected && <Check className="w-2.5 h-2.5 text-slate-900" />}
                        {someSupSelected && !allSupSelected && <div className="w-1.5 h-1.5 bg-amber-500 rounded-sm" />}
                      </div>
                    </button>

                    <button onClick={() => toggleSupplierCollapse(supplier)} className="flex items-center gap-2 flex-1 text-left">
                      {isCollapsed ? <ChevronRight className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                      <Package className="w-4 h-4 text-amber-500 shrink-0" />
                      <span className="font-semibold text-slate-800">{supplier}</span>
                      <span className="text-xs text-slate-400 ml-1">{supplierItems.length} item{supplierItems.length !== 1 ? 's' : ''}</span>
                    </button>
                  </div>

                  {/* Items table */}
                  {!isCollapsed && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs min-w-[1100px]">
                        <thead className="bg-slate-100 text-slate-500 uppercase">
                          <tr>
                            <th className="px-3 py-2 w-8"></th>
                            <th className="px-3 py-2 text-left">Description</th>
                            <th className="px-3 py-2 text-left">Part No.</th>
                            <th className="px-3 py-2 text-left">Category</th>
                            <th className="px-3 py-2 text-left">Supplier</th>
                            <th className="px-3 py-2 text-right">Qty</th>
                            <th className="px-3 py-2 text-right">Stock Qty</th>
                            <th className="px-3 py-2 text-right">Order Qty</th>
                            <th className="px-3 py-2 text-left">Material Status</th>
                            <th className="px-3 py-2 text-right">Received Qty</th>
                            <th className="px-3 py-2 text-left">Exp. Delivery</th>
                            <th className="px-3 py-2 text-left">PO Number</th>
                          </tr>
                        </thead>
                        <tbody>
                          {supplierItems.map((item, idx) => {
                            const isChecked = selectedIds.has(item.id);
                            const qty = Number(item.quantity) || 0;
                            const stock = Number(item.stock_qty) || 0;
                            const oQty = orderQtyOf(item);
                            const ms = effectiveMaterialStatus(item);
                            const msMeta = MS_BY_VALUE[ms] || MATERIAL_STATUS[0];
                            const received = Number(item.received_qty) || Number(item.delivered_qty) || 0;
                            const partial = ms === 'ordered' && received > 0 && (qty === 0 || received < qty);
                            return (
                              <tr
                                key={item.id}
                                onClick={() => toggleItem(item.id)}
                                className={`border-t border-slate-100 cursor-pointer transition ${isChecked ? 'bg-amber-50' : idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'} hover:bg-amber-50/70`}
                              >
                                <td className="px-3 py-2">
                                  <div className={`w-4 h-4 rounded border-2 flex items-center justify-center mx-auto transition-colors ${isChecked ? 'bg-amber-400 border-amber-400' : 'border-slate-300'}`}>
                                    {isChecked && <Check className="w-2.5 h-2.5 text-slate-900" />}
                                  </div>
                                </td>
                                <td className="px-3 py-2 font-medium text-slate-800 max-w-[200px]">
                                  <div className="truncate">{item.description || '—'}</div>
                                </td>
                                <td className="px-3 py-2 font-mono text-slate-500">{item.manufacturer_part_number || '—'}</td>
                                <td className="px-3 py-2">
                                  <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-semibold">
                                    {BOM_CATEGORY_LABELS[item.category] || item.category || '—'}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-slate-600">{item.supplier || '—'}</td>
                                <td className="px-3 py-2 text-right font-semibold text-slate-700">{qty}</td>
                                <td className="px-1 py-1 text-right">
                                  <input type="number" min="0" onClick={stop} value={stock} onChange={e => updateField(item, 'stock_qty', e.target.value)} onBlur={e => handleStockBlur(item, e.target.value)} className={inp + ' text-right'} style={{ width: 56 }} />
                                </td>
                                <td className="px-3 py-2 text-right text-slate-700">{oQty}</td>
                                <td className="px-1 py-1">
                                  <select onClick={stop} value={ms} onChange={e => handleMaterialStatusChange(item, e.target.value)} className={`text-[10px] font-semibold border rounded px-1.5 py-1 bg-white ${msMeta.sel}`}>
                                    {MATERIAL_STATUS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                                  </select>
                                  {partial && <div className="text-[10px] text-amber-600 mt-0.5">partial {received}/{qty}</div>}
                                </td>
                                <td className="px-1 py-1 text-right">
                                  <input type="number" min="0" max={qty} onClick={stop} value={received} onChange={e => updateField(item, 'received_qty', e.target.value)} onBlur={e => handleReceivedBlur(item, e.target.value)} className={inp + ' text-right'} style={{ width: 56 }} />
                                </td>
                                <td className="px-3 py-2 text-slate-500">{formatDate(item.expected_delivery_date)}</td>
                                <td className="px-3 py-2 font-mono text-slate-500">{item.po_number || '—'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot className="border-t-2 border-slate-200 bg-slate-50">
                          <tr>
                            <td colSpan={11} className="px-3 py-2 text-slate-500 text-xs font-semibold">Supplier Total — {supplierItems.length} item{supplierItems.length !== 1 ? 's' : ''}</td>
                            <td></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({ label, value, color }) {
  return (
    <div className={`bg-white rounded-lg shadow-sm p-4 border-l-4 ${color}`}>
      <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">{label}</div>
      <div className="text-xl font-semibold text-slate-800">{value}</div>
    </div>
  );
}

function CheckGreen() {
  return (
    <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto">
      <ShoppingCart className="w-8 h-8 text-emerald-400" />
    </div>
  );
}

function Spinner() {
  return <div className="flex justify-center py-12"><div className="w-7 h-7 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;
}