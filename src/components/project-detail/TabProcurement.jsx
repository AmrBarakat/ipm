import { useState, useEffect, useMemo } from 'react';
import { useEntityList } from '@/hooks/useEntity';
import { formatCurrency, formatDate, BOM_CATEGORY_LABELS } from '@/lib/constants';
import { ShoppingCart, Package, ChevronDown, ChevronRight, Check, FileText, Loader2, AlertCircle } from 'lucide-react';
import { jsPDF } from 'jspdf';

export default function TabProcurement({ projectId, project }) {
  const { data: all = [], isLoading } = useEntityList('BOMItem', { project_id: projectId }, 'supplier', 500);
  const items = useMemo(() => all.filter(i => (i.order_status || (i.ordered ? 'ordered' : 'not_ordered')) === 'not_ordered'), [all]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [collapsedSuppliers, setCollapsedSuppliers] = useState(new Set());
  const [generatingPO, setGeneratingPO] = useState(null); // supplier name being exported

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

  function generatePO(supplier, supplierItems) {
    const selectedSupplierItems = supplierItems.filter(i => selectedIds.has(i.id));
    if (!selectedSupplierItems.length) return;
    setGeneratingPO(supplier);

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = 210;
    const margin = 14;
    const colW = W - margin * 2;
    const cur = project?.currency || 'SAR';
    let y = 0;

    // ── Header band ──────────────────────────────────────────────────────
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, W, 32, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.setFont(undefined, 'bold');
    doc.text('PURCHASE ORDER', margin, 13);
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.text(`Date: ${new Date().toLocaleDateString('en-GB')}`, margin, 20);
    doc.text(`Project: ${project?.code || ''} — ${project?.name || ''}`, margin, 26);
    doc.setTextColor(0, 0, 0);
    y = 40;

    // ── Vendor & Project Info ────────────────────────────────────────────
    // Vendor box
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(margin, y, colW * 0.45, 28, 2, 2, 'F');
    doc.setFontSize(7);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(100, 116, 139);
    doc.text('VENDOR', margin + 3, y + 6);
    doc.setFontSize(10);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(supplier === '(No Supplier)' ? 'TBD' : supplier, margin + 3, y + 13);
    doc.setFontSize(8);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text('Supplier / Vendor', margin + 3, y + 19);

    // Project box
    const px = margin + colW * 0.48;
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(px, y, colW * 0.52, 28, 2, 2, 'F');
    doc.setFontSize(7);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(100, 116, 139);
    doc.text('SHIP TO / PROJECT', px + 3, y + 6);
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(project?.name || '', px + 3, y + 13, { maxWidth: colW * 0.5 });
    doc.setFontSize(8);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(project?.client || '', px + 3, y + 19);
    doc.text(project?.location || '', px + 3, y + 24);
    y += 36;

    // ── Table header ─────────────────────────────────────────────────────
    const cols = [
      { label: '#',           w: 0.04, align: 'left'  },
      { label: 'Part No.',    w: 0.14, align: 'left'  },
      { label: 'Description', w: 0.35, align: 'left'  },
      { label: 'Category',    w: 0.13, align: 'left'  },
      { label: 'Qty',         w: 0.06, align: 'right' },
      { label: 'Unit',        w: 0.07, align: 'left'  },
      { label: 'Unit Cost',   w: 0.10, align: 'right' },
      { label: 'Total',       w: 0.11, align: 'right' },
    ];

    function drawTableRow(doc, y, rowData, isHeader = false, isAlt = false) {
      if (isHeader) {
        doc.setFillColor(15, 23, 42);
        doc.rect(margin, y - 5, colW, 8, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont(undefined, 'bold');
        doc.setFontSize(7.5);
      } else {
        if (isAlt) {
          doc.setFillColor(248, 250, 252);
          doc.rect(margin, y - 5, colW, 7, 'F');
        }
        doc.setTextColor(30, 41, 59);
        doc.setFont(undefined, 'normal');
        doc.setFontSize(7.5);
      }
      let x = margin + 2;
      rowData.forEach((val, i) => {
        const c = cols[i];
        const cw = colW * c.w;
        if (c.align === 'right') {
          doc.text(String(val), x + cw - 4, y, { align: 'right', maxWidth: cw - 2 });
        } else {
          doc.text(String(val), x, y, { maxWidth: cw - 2 });
        }
        x += cw;
      });
    }

    drawTableRow(doc, y, cols.map(c => c.label), true);
    y += 8;

    let grandTotal = 0;
    selectedSupplierItems.forEach((item, idx) => {
      if (y > 265) { doc.addPage(); y = 20; }
      const unitCost = Number(item.planned_cost_price) || Number(item.cost_price) || 0;
      const qty = Number(item.quantity) || 1;
      const total = unitCost * qty;
      grandTotal += total;
      drawTableRow(doc, y, [
        idx + 1,
        item.manufacturer_part_number || '—',
        item.description || '—',
        BOM_CATEGORY_LABELS[item.category] || item.category || '—',
        qty,
        item.unit || 'pcs',
        unitCost > 0 ? formatCurrency(unitCost, cur) : '—',
        total > 0 ? formatCurrency(total, cur) : '—',
      ], false, idx % 2 === 1);
      y += 7;
    });

    // ── Totals ────────────────────────────────────────────────────────────
    y += 4;
    doc.setFillColor(245, 158, 11);
    doc.rect(margin + colW * 0.6, y - 4, colW * 0.4, 8, 'F');
    doc.setTextColor(15, 23, 42);
    doc.setFont(undefined, 'bold');
    doc.setFontSize(9);
    doc.text('TOTAL:', margin + colW * 0.62, y);
    doc.text(formatCurrency(grandTotal, cur), margin + colW - 2, y, { align: 'right' });
    y += 14;

    // ── Notes / Signatures ────────────────────────────────────────────────
    if (y < 240) {
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.3);
      doc.line(margin, y, margin + colW * 0.45, y);
      doc.line(margin + colW * 0.55, y, margin + colW, y);
      doc.setFontSize(7);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(148, 163, 184);
      doc.text('Prepared by', margin, y + 4);
      doc.text('Approved by', margin + colW * 0.55, y + 4);
    }

    // ── Footer ────────────────────────────────────────────────────────────
    const pageCount = doc.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p);
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.setFont(undefined, 'normal');
      doc.text(
        `${project?.name || ''} · PO for ${supplier} · Page ${p} of ${pageCount}`,
        W / 2, 290, { align: 'center' }
      );
    }

    const safeSupplier = supplier.replace(/[^a-z0-9]/gi, '_').slice(0, 30);
    doc.save(`PO_${project?.code || 'PRJ'}_${safeSupplier}_${new Date().toISOString().slice(0, 10)}.pdf`);
    setGeneratingPO(null);
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
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <AlertCircle className="w-3.5 h-3.5" />
              Select items per supplier, then generate a PO PDF
            </div>
          </div>

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
                      <button
                        onClick={() => generatePO(supplier, supplierItems)}
                        disabled={selectedSupItems.length === 0 || generatingPO === supplier}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-xs rounded disabled:opacity-40 disabled:cursor-not-allowed transition"
                      >
                        {generatingPO === supplier
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <FileText className="w-3.5 h-3.5" />}
                        Generate PO ({selectedSupItems.length})
                      </button>
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