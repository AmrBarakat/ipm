import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Save, Loader2, Link2 } from 'lucide-react';
import { useConfirm } from '@/components/ui/ConfirmDialog';

const inp = 'border border-slate-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white w-full';

const EMPTY_LINE = {
  line_no: '', part_number: '', erp_item_code: '', description: '',
  quantity: 0, unit: 'EA', unit_price: 0, net_amount: 0,
  supplier_delivery_date: '', bom_item_id: '', quoted_unit_price: null, price_variance_pct: null,
};

function cleanLine(it) {
  return {
    line_no: it.line_no ? Number(it.line_no) : undefined,
    description: it.description || '',
    quantity: Number(it.quantity) || 0,
    unit: it.unit || '',
    unit_price: Number(it.unit_price) || 0,
    net_amount: Number(it.net_amount) || 0,
    part_number: it.part_number || '',
    erp_item_code: it.erp_item_code || '',
    bom_item_id: it.bom_item_id || undefined,
    supplier_delivery_date: it.supplier_delivery_date || '',
    quoted_unit_price: it.quoted_unit_price ?? undefined,
    price_variance_pct: it.price_variance_pct ?? undefined,
  };
}

function fmtPct(frac) {
  if (frac == null || isNaN(Number(frac))) return '—';
  return `${(Number(frac) * 100).toFixed(2)}%`;
}

/**
 * Expandable line-items editor beneath a PO. Add / edit / delete rows with the
 * full column set. Editing a line's unit_price that has a linked BOM row offers
 * "also update the linked BOM row's actual_cost_price?" as an explicit confirm —
 * never a silent cascade.
 */
export default function POLineItemsEditor({ po, bomItems = [] }) {
  const [items, setItems] = useState([]);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const confirmDialog = useConfirm();
  const queryClient = useQueryClient();

  useEffect(() => {
    setItems((po.items || []).map((it) => ({ ...it })));
  }, [po.id, po.items]);

  function update(idx, patch) {
    setItems((prev) => {
      const next = prev.slice();
      next[idx] = { ...next[idx], ...patch };
      if (patch.quantity != null || patch.unit_price != null) {
        const q = Number(next[idx].quantity) || 0;
        const up = Number(next[idx].unit_price) || 0;
        next[idx].net_amount = +(q * up).toFixed(2);
      }
      return next;
    });
  }

  function addRow() {
    setItems((prev) => [...prev, { ...EMPTY_LINE, line_no: prev.length + 1 }]);
  }

  function delRow(idx) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  async function save() {
    const original = po.items || [];
    // Lines whose unit_price changed AND have a linked BOM row → cascade candidates.
    const cascade = items.filter((it, i) =>
      it.bom_item_id && Number(it.unit_price) !== Number(original[i]?.unit_price));
    let updateBom = false;
    if (cascade.length > 0) {
      updateBom = await confirmDialog({
        title: 'Also update linked BOM rows?',
        description: `${cascade.length} line(s) have a linked BOM row. Update those BOM rows' actual_cost_price to the new unit price as well?`,
        confirmText: 'Yes, update BOM too',
        cancelText: 'PO only',
      });
    }
    setSaving(true);
    try {
      await base44.entities.PurchaseOrder.update(po.id, { items: items.map(cleanLine) });
      if (updateBom) {
        await Promise.allSettled(cascade.map((it) =>
          base44.entities.BOMItem.update(it.bom_item_id, { actual_cost_price: Number(it.unit_price) || 0 })));
        queryClient.invalidateQueries({ queryKey: ['BOMItem'] });
      }
      queryClient.invalidateQueries({ queryKey: ['PurchaseOrder'] });
    } finally {
      setSaving(false);
    }
  }

  const bomById = Object.fromEntries(bomItems.map((b) => [b.id, b]));
  const lineNet = items.reduce((s, it) => s + (Number(it.net_amount) || 0), 0);

  return (
    <div className="border border-slate-200 rounded-lg bg-white">
      <button onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">
        <span>Line items ({items.length})</span>
        <span className="text-slate-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="p-3 space-y-2">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="px-1 py-1 text-left">Line</th>
                  <th className="px-1 py-1 text-left">Part #</th>
                  <th className="px-1 py-1 text-left">ERP code</th>
                  <th className="px-1 py-1 text-left min-w-[180px]">Description</th>
                  <th className="px-1 py-1 text-right">Qty</th>
                  <th className="px-1 py-1 text-left">Unit</th>
                  <th className="px-1 py-1 text-right">Unit price</th>
                  <th className="px-1 py-1 text-right">Net amount</th>
                  <th className="px-1 py-1 text-left">Supplier delivery</th>
                  <th className="px-1 py-1 text-right">Quoted</th>
                  <th className="px-1 py-1 text-right">Var %</th>
                  <th className="px-1 py-1 text-left min-w-[160px]">BOM row link</th>
                  <th className="px-1 py-1"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => {
                  const bom = it.bom_item_id ? bomById[it.bom_item_id] : null;
                  return (
                    <tr key={idx} className="border-t border-slate-100">
                      <td className="px-1 py-1"><input value={it.line_no ?? ''} onChange={(e) => update(idx, { line_no: e.target.value })} className={inp + ' w-12'} /></td>
                      <td className="px-1 py-1"><input value={it.part_number || ''} onChange={(e) => update(idx, { part_number: e.target.value })} className={inp} /></td>
                      <td className="px-1 py-1"><input value={it.erp_item_code || ''} onChange={(e) => update(idx, { erp_item_code: e.target.value })} className={inp + ' w-20'} /></td>
                      <td className="px-1 py-1"><input value={it.description || ''} onChange={(e) => update(idx, { description: e.target.value })} className={inp} /></td>
                      <td className="px-1 py-1"><input type="number" step="any" value={it.quantity ?? 0} onChange={(e) => update(idx, { quantity: e.target.value === '' ? 0 : Number(e.target.value) })} className={inp + ' w-16 text-right'} /></td>
                      <td className="px-1 py-1"><input value={it.unit || ''} onChange={(e) => update(idx, { unit: e.target.value })} className={inp + ' w-14'} /></td>
                      <td className="px-1 py-1"><input type="number" step="any" value={it.unit_price ?? 0} onChange={(e) => update(idx, { unit_price: e.target.value === '' ? 0 : Number(e.target.value) })} className={inp + ' w-24 text-right'} /></td>
                      <td className="px-1 py-1 text-right font-medium text-slate-700">{(Number(it.net_amount) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="px-1 py-1"><input type="date" value={it.supplier_delivery_date || ''} onChange={(e) => update(idx, { supplier_delivery_date: e.target.value })} className={inp} /></td>
                      <td className="px-1 py-1 text-right text-slate-400">{it.quoted_unit_price != null ? Number(it.quoted_unit_price).toLocaleString() : '—'}</td>
                      <td className="px-1 py-1 text-right text-slate-400">{fmtPct(it.price_variance_pct)}</td>
                      <td className="px-1 py-1">
                        <select value={it.bom_item_id || ''} onChange={(e) => update(idx, { bom_item_id: e.target.value || '' })} className={inp}>
                          <option value="">— none —</option>
                          {bomItems.map((b) => (
                            <option key={b.id} value={b.id}>{(b.manufacturer_part_number || b.item_code || '?')} — {(b.description || '').slice(0, 40)}</option>
                          ))}
                        </select>
                        {bom && <span className="block text-[10px] text-slate-400 mt-0.5 flex items-center gap-0.5"><Link2 className="w-2.5 h-2.5" /> {bom.description?.slice(0, 30)}</span>}
                      </td>
                      <td className="px-1 py-1">
                        <button onClick={() => delRow(idx)} className="text-slate-300 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between pt-1">
            <div className="text-xs text-slate-500">
              Line total: <strong className="text-slate-700">{lineNet.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={addRow} className="flex items-center gap-1 px-2.5 py-1 text-xs border border-slate-300 rounded hover:bg-slate-100 text-slate-600"><Plus className="w-3 h-3" /> Add row</button>
              <button onClick={save} disabled={saving}
                className="flex items-center gap-1 px-3 py-1 bg-amber-500 hover:bg-amber-400 text-slate-900 text-xs rounded font-semibold disabled:opacity-50">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save items
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}