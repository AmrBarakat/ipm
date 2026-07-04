import { useState, useEffect, useMemo } from 'react';
import { useEntityList } from '@/hooks/useEntity';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { formatCurrency, formatDate, BOM_CATEGORY_LABELS } from '@/lib/constants';
import { ShoppingCart, Package, ChevronDown, ChevronRight, Check, AlertCircle, X, Save, Trash2, RefreshCw } from 'lucide-react';

export default function TabProcurement({ projectId, project }) {
  const { data: all = [], isLoading } = useEntityList('BOMItem', { project_id: projectId }, 'supplier', 500);
  const items = useMemo(() => all.filter(i => {
    const os = i.order_status || (i.ordered ? 'ordered' : 'not_ordered');
    if (os !== 'not_ordered') return false;
    // Exclude panel child items (they're ordered as part of their panel parent)
    if (i.parent_id) return false;
    // Exclude engineering / service line items (non-material, not procured via PO)
    const pn = (i.manufacturer_part_number || '').trim().toLowerCase();
    if (i.category === 'service' || pn === 'engineering') return false;
    return true;
  }), [all]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [collapsedSuppliers, setCollapsedSuppliers] = useState(new Set());
  const [bulkEdit, setBulkEdit] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const queryClient = useQueryClient();

  // Auto-select all unordered items whenever the list refreshes
  useEffect(() => { setSelectedIds(new Set(items.map(i => i.id))); }, [items]);

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

  async function applyBulkEdit() {
    if (!bulkEdit || selectedIds.size === 0) return;
    const { field, value } = bulkEdit;
    const ids = [...selectedIds];
    const extra = field === 'order_status' ? { ordered: value === 'ordered' } : {};
    await base44.entities.BOMItem.bulkUpdate(ids.map(id => ({ id, [field]: value, ...extra })));
    setBulkEdit(null);
    setSelectedIds(new Set());
    queryClient.invalidateQueries({ queryKey: ['BOMItem'] });
  }

  async function syncWithBOM() {
    setSyncing(true);
    await queryClient.invalidateQueries({ queryKey: ['BOMItem'] });
    setSyncing(false);
  }

  async function bulkDelete() {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} selected item(s)? This removes them from the BOM.`)) return;
    const ids = [...selectedIds];
    setSelectedIds(new Set());
    setBulkEdit(null);
    await base44.entities.BOMItem.deleteMany({ id: { $in: ids } });
    queryClient.invalidateQueries({ queryKey: ['BOMItem'] });
  }

  // KPIs
  const totalItems = items.length;
  const totalValue = items.reduce((s, i) => s + (Number(i.planned_cost_price) || Number(i.cost_price) || 0) * (Number(i.quantity) || 1), 0);
  const selectedValue = items
    .filter(i => selectedIds.has(i.id))
    .reduce((s, i) => s + (Number(i.planned_cost_price) || Number(i.cost_price) || 0) * (Number(i.quantity) || 1), 0);

  if (isLoading) return <Spinner />;

  return (
    <div className="space-y-5">

      {/* Header KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Items to Order" value={totalItems} color="border-amber-400" />
        <KpiCard label="Suppliers" value={grouped.length} color="border-blue-400" />
        <KpiCard label="Total Value" value={formatCurrency(totalValue, project?.currency || 'SAR')} color="border-slate-400" />
        <KpiCard label="Selected Value" value={formatCurrency(selectedValue, project?.currency || 'SAR')} color="border-emerald-400" />
      </div>

      {items.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg shadow-sm border border-slate-100">
          <CheckGreen />
          <h3 className="font-semibold text-slate-700 text-lg mt-4 mb-1">All items are ordered!</h3>
          <p className="text-slate-400 text-sm">No BOM items with "Not Ordered" status found.</p>
        </div>
      ) : (
        <>
          {/* Global select-all + info */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={toggleAll}
                className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
                <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${selectedIds.size === items.length ? 'bg-amber-400 border-amber-400' : 'border-slate-300'}`}>
                  {selectedIds.size === items.length && <Check className="w-2.5 h-2.5 text-slate-900" />}
                </div>
                <span>{selectedIds.size === items.length ? 'Deselect All' : 'Select All'} ({items.length} items)</span>
              </button>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-2 text-xs text-slate-400">
                <AlertCircle className="w-3.5 h-3.5" />
                Unordered BOM items grouped by supplier
              </span>
              <button onClick={syncWithBOM} disabled={syncing}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-amber-300 rounded hover:bg-amber-50 text-amber-700 font-semibold disabled:opacity-60">
                <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                {syncing ? 'Syncing…' : 'Sync with BOM'}
              </button>
            </div>
          </div>

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
                value={bulkEdit?.field === 'order_status' ? bulkEdit.value : ''}
                onChange={e => setBulkEdit(e.target.value ? { field: 'order_status', value: e.target.value } : null)}
              >
                <option value="">Order Status…</option>
                <option value="ordered">Mark Ordered</option>
                <option value="not_ordered">Not Ordered</option>
              </select>

              <select
                className="text-xs bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white focus:outline-none focus:border-amber-400"
                value={bulkEdit?.field === 'category' ? bulkEdit.value : ''}
                onChange={e => setBulkEdit(e.target.value ? { field: 'category', value: e.target.value } : null)}
              >
                <option value="">Category…</option>
                {Object.entries(BOM_CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
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
                onChange={e => setBulkEdit(e.target.value ? { field: 'planned_cost_price', value: Number(e.target.value) } : null)}
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
              const selectedSupItems = supplierItems.filter(i => selectedIds.has(i.id));
              const supTotal = selectedSupItems.reduce((s, i) => s + (Number(i.planned_cost_price) || Number(i.cost_price) || 0) * (Number(i.quantity) || 1), 0);

              return (
                <div key={supplier} className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                  {/* Supplier header */}
                  <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 border-b border-slate-200">
                    {/* Supplier select-all checkbox */}
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

                    <div className="flex items-center gap-3 shrink-0">
                      {selectedSupItems.length > 0 && (
                        <span className="text-xs text-slate-500 hidden sm:block">
                          {selectedSupItems.length} selected · <span className="font-semibold text-slate-700">{formatCurrency(supTotal, project?.currency || 'SAR')}</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Items table */}
                  {!isCollapsed && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs min-w-[700px]">
                        <thead className="bg-slate-100 text-slate-500 uppercase">
                          <tr>
                            <th className="px-3 py-2 w-8"></th>
                            <th className="px-3 py-2 text-left">Description</th>
                            <th className="px-3 py-2 text-left">Part No.</th>
                            <th className="px-3 py-2 text-left">Category</th>
                            <th className="px-3 py-2 text-right">Qty</th>
                            <th className="px-3 py-2 text-left">Unit</th>
                            <th className="px-3 py-2 text-right">Unit Cost</th>
                            <th className="px-3 py-2 text-right">Total Cost</th>
                            <th className="px-3 py-2 text-left">Exp. Delivery</th>
                          </tr>
                        </thead>
                        <tbody>
                          {supplierItems.map((item, idx) => {
                            const isChecked = selectedIds.has(item.id);
                            const unitCost = Number(item.planned_cost_price) || Number(item.cost_price) || 0;
                            const qty = Number(item.quantity) || 1;
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
                                <td className="px-3 py-2 text-right font-semibold text-slate-700">{qty}</td>
                                <td className="px-3 py-2 text-slate-500">{item.unit || 'pcs'}</td>
                                <td className="px-3 py-2 text-right text-slate-700">{unitCost > 0 ? formatCurrency(unitCost, project?.currency || 'SAR') : '—'}</td>
                                <td className="px-3 py-2 text-right font-semibold text-slate-800">{unitCost > 0 ? formatCurrency(unitCost * qty, project?.currency || 'SAR') : '—'}</td>
                                <td className="px-3 py-2 text-slate-500">{formatDate(item.expected_delivery_date)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot className="border-t-2 border-slate-200 bg-slate-50">
                          <tr>
                            <td colSpan={7} className="px-3 py-2 text-slate-500 text-xs font-semibold">Supplier Total</td>
                            <td className="px-3 py-2 text-right font-bold text-slate-800">
                              {formatCurrency(
                                supplierItems.reduce((s, i) => s + (Number(i.planned_cost_price) || Number(i.cost_price) || 0) * (Number(i.quantity) || 1), 0),
                                project?.currency || 'SAR'
                              )}
                            </td>
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