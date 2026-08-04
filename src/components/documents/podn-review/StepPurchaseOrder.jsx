import { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { expectedDateFor } from './helpers';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';

const inp = 'border border-slate-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white w-full';
const smInp = 'border border-slate-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white w-full';

const TRIGGERS = ['on_order', 'on_delivery', 'days_after_invoice', 'days_after_delivery', 'milestone', 'unknown'];

/** Step 4 — Purchase Order form + R7 expected date + R8 payment schedule. */
export default function StepPurchaseOrder({ draft, setDraft }) {
  const po = draft.po;
  const dupId = draft.duplicates?.purchase_order_id;
  const [existing, setExisting] = useState(null);

  useEffect(() => {
    if (!dupId) return;
    base44.entities.PurchaseOrder.get(dupId).then(setExisting).catch(() => setExisting(null));
  }, [dupId]);

  // R7 — distinct supplier_delivery_date values across selected lines.
  const deliveryDates = useMemo(() => {
    const set = new Set((draft.lines || []).filter((l) => l.selected).map((l) => l.supplier_delivery_date).filter(Boolean));
    return [...set].sort();
  }, [draft.lines]);

  function setPO(patch) {
    setDraft((prev) => ({ ...prev, po: { ...prev.po, ...patch } }));
  }

  function setSched(idx, patch) {
    setDraft((prev) => {
      const next = prev.po.payment_schedule.slice();
      const merged = { ...next[idx], ...patch };
      if (patch.percent_due != null) {
        const pct = Number(patch.percent_due) || 0;
        merged.amount_due = Number(((pct / 100) * (Number(prev.po.amount) || 0)).toFixed(2));
      }
      next[idx] = merged;
      return { ...prev, po: { ...prev.po, payment_schedule: next } };
    });
  }

  function addSchedRow() {
    setDraft((prev) => ({
      ...prev,
      po: { ...prev.po, payment_schedule: [...prev.po.payment_schedule, { label: '', percent_due: 0, amount_due: 0, trigger: 'unknown', offset_days: 0, expected_date: '' }] },
    }));
  }

  function delSchedRow(idx) {
    setDraft((prev) => ({ ...prev, po: { ...prev.po, payment_schedule: prev.po.payment_schedule.filter((_, i) => i !== idx) } }));
  }

  // Auto-fill expected_date for rows the user hasn't manually edited.
  const schedSig = JSON.stringify(po.payment_schedule.map((r) => `${r.trigger}|${r.offset_days}`));
  useEffect(() => {
    setDraft((prev) => {
      let changed = false;
      const next = prev.po.payment_schedule.map((row) => {
        if (row._manualExpected) return row;
        const auto = expectedDateFor(row, prev.po);
        if (auto !== (row.expected_date || '')) {
          changed = true;
          return { ...row, expected_date: auto };
        }
        return row;
      });
      return changed ? { ...prev, po: { ...prev.po, payment_schedule: next } } : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [po.issue_date, po.expected_delivery_date, schedSig]);

  const pctTotal = po.payment_schedule.reduce((s, r) => s + (Number(r.percent_due) || 0), 0);
  const pctWarn = Math.abs(pctTotal - 100) > 0.01;

  return (
    <div className="space-y-4">
      {dupId && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          A PO with this number already exists on this project — the toggle below reads "Update existing PO" and applying will update it.
        </div>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={po.createToggle} onChange={(e) => setPO({ createToggle: e.target.checked })} className="w-4 h-4 accent-amber-500" />
        {dupId ? 'Update existing PO' : 'Create this PO'}
      </label>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-1">
          <label className="text-xs text-slate-500 mb-1 block">PO number *</label>
          <input value={po.po_number} onChange={(e) => setPO({ po_number: e.target.value })} className={inp} />
        </div>
        <div className="md:col-span-2">
          <label className="text-xs text-slate-500 mb-1 block">Description</label>
          <input value={po.description} onChange={(e) => setPO({ description: e.target.value })} className={inp} />
        </div>
        <div><label className="text-xs text-slate-500 mb-1 block">Type</label>
          <select value={po.type} onChange={(e) => setPO({ type: e.target.value })} className={inp}>
            {['equipment', 'subcontract', 'service', 'material', 'other'].map((o) => <option key={o} value={o}>{o}</option>)}
          </select></div>
        <div><label className="text-xs text-slate-500 mb-1 block">Status</label>
          <select value={po.status} onChange={(e) => setPO({ status: e.target.value })} className={inp}>
            {['draft', 'issued', 'acknowledged', 'in_transit', 'partially_delivered', 'delivered', 'cancelled'].map((o) => <option key={o} value={o}>{o}</option>)}
          </select></div>
        <div><label className="text-xs text-slate-500 mb-1 block">Priority</label>
          <select value={po.priority} onChange={(e) => setPO({ priority: e.target.value })} className={inp}>
            {['low', 'medium', 'high', 'critical'].map((o) => <option key={o} value={o}>{o}</option>)}
          </select></div>
        <div><label className="text-xs text-slate-500 mb-1 block">Amount ({po.currency})</label>
          <input type="number" step="0.01" value={po.amount} onChange={(e) => setPO({ amount: Number(e.target.value) || 0 })} className={inp} /></div>
        <div><label className="text-xs text-slate-500 mb-1 block">Currency</label>
          <input value={po.currency} onChange={(e) => setPO({ currency: e.target.value })} className={inp} /></div>
        <div><label className="text-xs text-slate-500 mb-1 block">Issue date</label>
          <input type="date" value={po.issue_date} onChange={(e) => setPO({ issue_date: e.target.value })} className={inp} /></div>
        <div>
          <label className="text-xs text-slate-500 mb-1 block">Expected delivery date</label>
          <input type="date" value={po.expected_delivery_date} onChange={(e) => setPO({ expected_delivery_date: e.target.value })} className={inp} />
          <div className="text-[11px] text-slate-400 mt-0.5">Drives the overdue-shipment alert.</div>
          {deliveryDates.length > 1 && (
            <div className="text-[11px] text-slate-500 mt-1">Collapsed from line dates: {deliveryDates.join(', ')}</div>
          )}
        </div>
        <div><label className="text-xs text-slate-500 mb-1 block">Delivery location</label>
          <input value={po.delivery_location} onChange={(e) => setPO({ delivery_location: e.target.value })} className={inp} /></div>
        <div><label className="text-xs text-slate-500 mb-1 block">Payment terms</label>
          <input value={po.payment_terms} onChange={(e) => setPO({ payment_terms: e.target.value })} className={inp} /></div>
        <div><label className="text-xs text-slate-500 mb-1 block">Incoterm</label>
          <input value={po.incoterm} onChange={(e) => setPO({ incoterm: e.target.value })} className={inp} /></div>
        <div><label className="text-xs text-slate-500 mb-1 block">Mode of shipping</label>
          <input value={po.mode_of_shipping} onChange={(e) => setPO({ mode_of_shipping: e.target.value })} className={inp} /></div>
        <div><label className="text-xs text-slate-500 mb-1 block">Warehouse code</label>
          <input value={po.warehouse_code} onChange={(e) => setPO({ warehouse_code: e.target.value })} className={inp} /></div>
        <div><label className="text-xs text-slate-500 mb-1 block">Supplier ref</label>
          <input value={po.supplier_ref} onChange={(e) => setPO({ supplier_ref: e.target.value })} className={inp} /></div>
        <div><label className="text-xs text-slate-500 mb-1 block">PR number</label>
          <input value={po.pr_number} onChange={(e) => setPO({ pr_number: e.target.value })} className={inp} /></div>
        <div><label className="text-xs text-slate-500 mb-1 block">Purchaser</label>
          <input value={po.purchaser} onChange={(e) => setPO({ purchaser: e.target.value })} className={inp} /></div>
        <div><label className="text-xs text-slate-500 mb-1 block">Requested by</label>
          <input value={po.requested_by} onChange={(e) => setPO({ requested_by: e.target.value })} className={inp} /></div>
      </div>
      <div><label className="text-xs text-slate-500 mb-1 block">Notes</label>
        <textarea value={po.notes} onChange={(e) => setPO({ notes: e.target.value })} className={inp + ' h-16 resize-none'} /></div>

      {/* R8 payment schedule */}
      <div className="border border-slate-200 rounded-lg p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Payment schedule</span>
          <button onClick={addSchedRow} className="flex items-center gap-1 text-xs text-amber-700 hover:text-amber-900"><Plus className="w-3.5 h-3.5" /> Add row</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="px-1 py-1 text-left">Label</th>
                <th className="px-1 py-1 text-right">% due</th>
                <th className="px-1 py-1 text-right">Amount due</th>
                <th className="px-1 py-1 text-left">Trigger</th>
                <th className="px-1 py-1 text-right">Offset (days)</th>
                <th className="px-1 py-1 text-left">Expected date</th>
                <th className="px-1 py-1"></th>
              </tr>
            </thead>
            <tbody>
              {po.payment_schedule.map((row, idx) => (
                <tr key={idx} className="border-t border-slate-100">
                  <td className="px-1 py-1"><input value={row.label || ''} onChange={(e) => setSched(idx, { label: e.target.value })} className={smInp} /></td>
                  <td className="px-1 py-1"><input type="number" value={row.percent_due ?? 0} onChange={(e) => setSched(idx, { percent_due: Number(e.target.value) || 0 })} className={smInp + ' w-16 text-right'} /></td>
                  <td className="px-1 py-1 text-right text-slate-600 font-medium">{(Number(row.amount_due) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="px-1 py-1"><select value={row.trigger} onChange={(e) => setSched(idx, { trigger: e.target.value, _manualExpected: false })} className={smInp}>{TRIGGERS.map((t) => <option key={t} value={t}>{t}</option>)}</select></td>
                  <td className="px-1 py-1"><input type="number" value={row.offset_days ?? 0} onChange={(e) => setSched(idx, { offset_days: Number(e.target.value) || 0, _manualExpected: false })} className={smInp + ' w-16 text-right'} /></td>
                  <td className="px-1 py-1"><input type="date" value={row.expected_date || ''} onChange={(e) => setSched(idx, { expected_date: e.target.value, _manualExpected: true })} className={smInp} /></td>
                  <td className="px-1 py-1"><button onClick={() => delSchedRow(idx)} className="text-slate-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pctWarn && (
          <div className="flex items-center gap-1.5 text-xs text-amber-700"><AlertTriangle className="w-3.5 h-3.5" /> Percentages total {pctTotal}% — they should total 100%.</div>
        )}
      </div>

      {dupId && existing && <PODiff existing={existing} po={po} />}
    </div>
  );
}

function PODiff({ existing, po }) {
  const fields = ['po_number', 'description', 'type', 'status', 'priority', 'amount', 'currency', 'issue_date', 'expected_delivery_date', 'incoterm', 'mode_of_shipping', 'warehouse_code', 'supplier_ref', 'pr_number', 'purchaser', 'requested_by'];
  const diffs = fields.filter((f) => String(existing[f] || '') !== String(po[f] || '') && (existing[f] || po[f]));
  if (!diffs.length) return <div className="text-xs text-slate-500">No fields differ from the existing PO.</div>;
  return (
    <div className="border border-slate-200 rounded-lg p-3">
      <div className="text-xs font-semibold text-slate-600 mb-2">Fields that will change on the existing PO:</div>
      <ul className="text-xs space-y-1">
        {diffs.map((f) => (
          <li key={f} className="flex gap-2"><span className="text-slate-400 w-40">{f}</span><span className="text-slate-500 line-through">{existing[f] || '—'}</span><span className="text-slate-400">→</span><span className="text-slate-800 font-medium">{po[f] || '—'}</span></li>
        ))}
      </ul>
    </div>
  );
}