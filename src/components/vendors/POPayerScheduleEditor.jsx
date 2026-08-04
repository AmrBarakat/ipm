import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Save, AlertTriangle, Loader2 } from 'lucide-react';
import { expectedDateFor } from '@/components/documents/podn-review/helpers';

const smInp = 'border border-slate-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white w-full';
const TRIGGERS = ['on_order', 'on_delivery', 'days_after_invoice', 'days_after_delivery', 'milestone', 'unknown'];

/** Editable payment_schedule table on the PO, with a warning when % != 100. */
export default function POPayerScheduleEditor({ po }) {
  const [sched, setSched] = useState([]);
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    setSched((po.payment_schedule || []).map((r) => ({ ...r })));
  }, [po.id, po.payment_schedule]);

  const pctTotal = sched.reduce((s, r) => s + (Number(r.percent_due) || 0), 0);
  const pctWarn = sched.length > 0 && Math.abs(pctTotal - 100) > 0.01;

  function setRow(idx, patch) {
    setSched((prev) => {
      const next = prev.slice();
      const merged = { ...next[idx], ...patch };
      if (patch.percent_due != null) {
        const pct = Number(patch.percent_due) || 0;
        merged.amount_due = +((pct / 100) * (Number(po.amount) || 0)).toFixed(2);
      }
      if (patch.trigger != null || patch.offset_days != null) merged._manualExpected = false;
      next[idx] = merged;
      return next;
    });
  }
  function addRow() {
    setSched((prev) => [...prev, { label: '', percent_due: 0, amount_due: 0, trigger: 'unknown', offset_days: 0, expected_date: '' }]);
  }
  function delRow(idx) {
    setSched((prev) => prev.filter((_, i) => i !== idx));
  }

  async function save() {
    setSaving(true);
    try {
      // Auto-fill expected_date for rows the user hasn't manually edited.
      const cleaned = sched.map((row) => {
        const r = { ...row };
        if (!r._manualExpected) r.expected_date = expectedDateFor(r, po);
        delete r._manualExpected;
        return r;
      });
      await base44.entities.PurchaseOrder.update(po.id, { payment_schedule: cleaned });
      queryClient.invalidateQueries({ queryKey: ['PurchaseOrder'] });
    } finally { setSaving(false); }
  }

  return (
    <div className="border border-slate-200 rounded-lg p-3 space-y-2 bg-white">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Payment schedule</span>
        <button onClick={addRow} className="flex items-center gap-1 text-xs text-amber-700 hover:text-amber-900"><Plus className="w-3.5 h-3.5" /> Add row</button>
      </div>
      {sched.length === 0 ? (
        <p className="text-xs text-slate-400 italic">No payment-schedule rows. Click "Add row" to define cash-flow milestones.</p>
      ) : (
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
              {sched.map((row, idx) => (
                <tr key={idx} className="border-t border-slate-100">
                  <td className="px-1 py-1"><input value={row.label || ''} onChange={(e) => setRow(idx, { label: e.target.value })} className={smInp} /></td>
                  <td className="px-1 py-1"><input type="number" value={row.percent_due ?? 0} onChange={(e) => setRow(idx, { percent_due: Number(e.target.value) || 0 })} className={smInp + ' w-16 text-right'} /></td>
                  <td className="px-1 py-1 text-right text-slate-600 font-medium">{(Number(row.amount_due) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="px-1 py-1"><select value={row.trigger} onChange={(e) => setRow(idx, { trigger: e.target.value })} className={smInp}>{TRIGGERS.map((t) => <option key={t} value={t}>{t}</option>)}</select></td>
                  <td className="px-1 py-1"><input type="number" value={row.offset_days ?? 0} onChange={(e) => setRow(idx, { offset_days: Number(e.target.value) || 0 })} className={smInp + ' w-16 text-right'} /></td>
                  <td className="px-1 py-1"><input type="date" value={row.expected_date || ''} onChange={(e) => setRow(idx, { expected_date: e.target.value, _manualExpected: true })} className={smInp} /></td>
                  <td className="px-1 py-1"><button onClick={() => delRow(idx)} className="text-slate-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          {pctWarn ? (
            <div className="flex items-center gap-1.5 text-xs text-amber-700"><AlertTriangle className="w-3.5 h-3.5" /> Percentages total {pctTotal}% — they should total 100%.</div>
          ) : (
            <div className="text-xs text-slate-400">Total: {pctTotal}%</div>
          )}
        </div>
        <button onClick={save} disabled={saving}
          className="flex items-center gap-1 px-3 py-1 bg-amber-500 hover:bg-amber-400 text-slate-900 text-xs rounded font-semibold disabled:opacity-50">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save schedule
        </button>
      </div>
    </div>
  );
}