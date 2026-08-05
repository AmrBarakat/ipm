import { useState, useMemo, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';
import { formatCurrency } from '@/lib/constants';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import {
  Save, PackageCheck, Eraser, Loader2, CheckCircle2, AlertCircle,
} from 'lucide-react';

const inp = 'border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400 bg-white w-full';
const inpNum = inp + ' text-right';

/**
 * Per-line PO receipts editor. Lives inside the expandable PO panel in
 * TabVendors. Calls applyPOReceipt on save, which rolls receipts up into the
 * PO status and cascades into BOM + Procurement.
 */
export default function POReceiptsPanel({ po, projectId }) {
  const queryClient = useQueryClient();
  const confirmDialog = useConfirm();

  const lines = (po.items || []).filter((it) => it.quantity != null);
  const [receipts, setReceipts] = useState(() => buildInitial(po));
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  // Re-seed when the PO changes (e.g. after a save refreshes the data).
  useEffect(() => { setReceipts(buildInitial(po)); }, [po.id, po.updated_date]);

  const subtotalNet = po.subtotal_net != null
    ? Number(po.subtotal_net)
    : lines.reduce((s, it) => s + (Number(it.net_amount) || 0), 0);

  const { receivedNet, linesComplete, totalLines } = useMemo(() => {
    let rn = 0, lc = 0;
    for (const it of lines) {
      const q = Number(it.quantity) || 0;
      const rq = Number(receipts[it.line_no]?.received_qty) || 0;
      const up = Number(it.unit_price) || 0;
      const ratio = q > 0 ? Math.min(rq / q, 1) : 0;
      rn += ratio * (Number(it.net_amount) || (q * up));
      if (q > 0 && rq >= q) lc++;
    }
    return { receivedNet: rn, linesComplete: lc, totalLines: lines.length };
  }, [receipts, lines, subtotalNet]);

  const progress = subtotalNet > 0 ? Math.round((receivedNet / subtotalNet) * 1000) / 10 : 0;
  const hasChanges = useMemo(() => {
    return lines.some((it) => {
      const orig = { received_qty: Number(it.received_qty) || 0, received_date: it.received_date || '', receipt_note: it.receipt_note || '' };
      const cur = receipts[it.line_no] || {};
      return Number(cur.received_qty) !== orig.received_qty
        || (cur.received_date || '') !== orig.received_date
        || (cur.receipt_note || '') !== (orig.receipt_note || '');
    });
  }, [receipts, lines]);

  function updateLine(line_no, patch) {
    setReceipts(prev => ({ ...prev, [line_no]: { ...(prev[line_no] || {}), ...patch } }));
  }

  function fillAll() {
    const today = new Date().toISOString().slice(0, 10);
    const next = {};
    for (const it of lines) {
      next[it.line_no] = {
        received_qty: Number(it.quantity) || 0,
        received_date: today,
        receipt_note: receipts[it.line_no]?.receipt_note || '',
      };
    }
    setReceipts(next);
  }

  function clearAll() {
    const next = {};
    for (const it of lines) {
      next[it.line_no] = { received_qty: 0, received_date: '', receipt_note: '' };
    }
    setReceipts(next);
  }

  async function handleFillAll() {
    if (!(await confirmDialog({ title: 'Mark entire PO as received', description: `Fill all ${lines.length} lines with full received quantity?`, confirmText: 'Fill all' }))) return;
    fillAll();
  }

  async function handleClearAll() {
    if (!(await confirmDialog({ title: 'Clear all receipts', description: 'Zero out received quantities on all lines?', destructive: true, confirmText: 'Clear' }))) return;
    clearAll();
  }

  async function save() {
    setSaving(true);
    setResult(null);
    try {
      const payload = {
        purchase_order_id: po.id,
        project_id: projectId,
        mode: 'partial',
        lines: lines.map((it) => ({
          line_no: it.line_no,
          received_qty: Number(receipts[it.line_no]?.received_qty) || 0,
          received_date: receipts[it.line_no]?.received_date || '',
          receipt_note: receipts[it.line_no]?.receipt_note || '',
        })),
      };
      const res = await base44.functions.invoke('applyPOReceipt', payload);
      const r = res?.data;
      if (!r || r.error) throw new Error(r?.error || 'No response from receipt service.');

      queryClient.invalidateQueries({ queryKey: ['PurchaseOrder'] });
      queryClient.invalidateQueries({ queryKey: ['BOMItem'] });
      setResult(r);
    } catch (err) {
      setResult({ error: err?.response?.data?.error || err?.message || 'Save failed.' });
    } finally {
      setSaving(false);
    }
  }

  if (lines.length === 0) {
    return <p className="text-xs text-slate-400 italic py-2">No line items on this PO.</p>;
  }

  const currency = po.currency || 'SAR';

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide flex items-center gap-1.5">
          <PackageCheck className="w-3.5 h-3.5 text-amber-500" /> Receipts
        </h4>
        <div className="flex items-center gap-1.5">
          <button onClick={handleFillAll} disabled={saving}
            className="flex items-center gap-1 px-2 py-1 text-[11px] bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded font-semibold border border-emerald-200 disabled:opacity-40">
            <CheckCircle2 className="w-3 h-3" /> Mark all received
          </button>
          <button onClick={handleClearAll} disabled={saving}
            className="flex items-center gap-1 px-2 py-1 text-[11px] bg-slate-50 hover:bg-slate-100 text-slate-600 rounded font-semibold border border-slate-200 disabled:opacity-40">
            <Eraser className="w-3 h-3" /> Clear all
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div>
        <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
          <span>{formatCurrency(receivedNet, currency)} of {formatCurrency(subtotalNet, currency)} received</span>
          <span>{linesComplete} of {totalLines} lines complete · {progress}%</span>
        </div>
        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${progress >= 100 ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${Math.min(progress, 100)}%` }} />
        </div>
      </div>

      {/* Lines table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-slate-50 text-slate-500 text-[10px] uppercase">
              <th className="px-2 py-1.5 text-left">Line</th>
              <th className="px-2 py-1.5 text-left">Part No.</th>
              <th className="px-2 py-1.5 text-left">Description</th>
              <th className="px-2 py-1.5 text-right">Ordered</th>
              <th className="px-2 py-1.5 text-right">Received</th>
              <th className="px-2 py-1.5 text-right">Remaining</th>
              <th className="px-2 py-1.5 text-left">Date</th>
              <th className="px-2 py-1.5 text-left">Note</th>
              <th className="px-2 py-1.5 text-center">Full</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((it, i) => {
              const q = Number(it.quantity) || 0;
              const rq = Number(receipts[it.line_no]?.received_qty) || 0;
              const rem = Math.max(0, q - rq);
              const isFull = q > 0 && rq >= q;
              return (
                <tr key={i} className={`border-t border-slate-100 ${isFull ? 'bg-emerald-50/40' : ''}`}>
                  <td className="px-2 py-1 text-slate-400 font-mono">{it.line_no ?? i + 1}</td>
                  <td className="px-2 py-1 font-mono text-slate-600 truncate max-w-[120px]">{it.part_number || '—'}</td>
                  <td className="px-2 py-1 text-slate-700 truncate max-w-[200px]">{it.description || '—'}</td>
                  <td className="px-2 py-1 text-right text-slate-600">{q}</td>
                  <td className="px-1 py-0.5">
                    <input type="number" min="0" max={q} value={rq}
                      onChange={(e) => updateLine(it.line_no, { received_qty: Math.max(0, Math.min(Number(e.target.value) || 0, q)) })}
                      className={inpNum} style={{ width: 60 }} />
                  </td>
                  <td className="px-2 py-1 text-right text-slate-500">{rem}</td>
                  <td className="px-1 py-0.5">
                    <input type="date" value={receipts[it.line_no]?.received_date || ''}
                      onChange={(e) => updateLine(it.line_no, { received_date: e.target.value })}
                      className={inp} style={{ width: 130 }} />
                  </td>
                  <td className="px-1 py-0.5">
                    <input type="text" value={receipts[it.line_no]?.receipt_note || ''}
                      onChange={(e) => updateLine(it.line_no, { receipt_note: e.target.value })}
                      placeholder="—" className={inp} style={{ width: 120 }} />
                  </td>
                  <td className="px-2 py-1 text-center">
                    <input type="checkbox" checked={isFull}
                      onChange={(e) => {
                        if (e.target.checked) {
                          updateLine(it.line_no, { received_qty: q, received_date: receipts[it.line_no]?.received_date || new Date().toISOString().slice(0, 10) });
                        } else {
                          updateLine(it.line_no, { received_qty: 0 });
                        }
                      }}
                      className="w-3.5 h-3.5 accent-amber-500 cursor-pointer" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Save + result */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {result && !result.error && (
          <div className="flex items-center gap-1.5 text-xs text-emerald-700">
            <CheckCircle2 className="w-3.5 h-3.5" />
            PO status: <strong>{result.po_status}</strong> · {result.bom_updated?.length || 0} BOM row{(result.bom_updated?.length || 0) !== 1 ? 's' : ''} updated · {result.receipt_progress}% received
          </div>
        )}
        {result?.error && (
          <div className="flex items-center gap-1.5 text-xs text-red-700">
            <AlertCircle className="w-3.5 h-3.5" /> {result.error}
          </div>
        )}
        <button onClick={save} disabled={saving || !hasChanges}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-900 text-xs font-semibold rounded disabled:opacity-40 ml-auto">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Save Receipts
        </button>
      </div>
    </div>
  );
}

function buildInitial(po) {
  const map = {};
  for (const it of (po.items || [])) {
    if (it.quantity == null) continue;
    map[it.line_no] = {
      received_qty: Number(it.received_qty) || 0,
      received_date: it.received_date || '',
      receipt_note: it.receipt_note || '',
    };
  }
  return map;
}