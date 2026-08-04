import { useState } from 'react';
import { CheckCircle, AlertTriangle, ExternalLink, X } from 'lucide-react';
import { reconcile } from './helpers';

const inp = 'border border-slate-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white w-full';

/** Step 1 — Document header + reconciliation strip + warnings. No VAT field. */
export default function StepDocument({ draft, setDraft, doc }) {
  const [taxGuardDismissed, setTaxGuardDismissed] = useState(false);
  const d = draft.document;
  const rec = reconcile(draft.lines, d.subtotal_net, d.total_amount);
  const taxGuardWarning = (draft.warnings || []).find((w) => w.toLowerCase().includes('tax'));
  const otherWarnings = (draft.warnings || []).filter((w) => !w.toLowerCase().includes('tax'));

  function setDoc(patch) {
    setDraft((prev) => ({ ...prev, document: { ...prev.document, ...patch } }));
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-slate-500 mb-1 block">Document type</label>
          <select value={d.type} onChange={(e) => setDoc({ type: e.target.value })} className={inp}>
            <option value="po">Purchase Order</option>
            <option value="delivery_note">Delivery Note / Packing Slip</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500 mb-1 block">Document number *</label>
          <input value={d.number} onChange={(e) => setDoc({ number: e.target.value })} className={inp} />
        </div>
        <div>
          <label className="text-xs text-slate-500 mb-1 block">Document date</label>
          <input type="date" value={d.date} onChange={(e) => setDoc({ date: e.target.value })} className={inp} />
        </div>
        <div>
          <label className="text-xs text-slate-500 mb-1 block">Currency</label>
          <input value={d.currency} onChange={(e) => setDoc({ currency: e.target.value })} className={inp} />
        </div>
        <div>
          <label className="text-xs text-slate-500 mb-1 block">Subtotal (net)</label>
          <input type="number" step="0.01" value={d.subtotal_net ?? ''} onChange={(e) => setDoc({ subtotal_net: e.target.value === '' ? null : Number(e.target.value) })} className={inp} />
        </div>
        <div>
          <label className="text-xs text-slate-500 mb-1 block">Total</label>
          <input type="number" step="0.01" value={d.total_amount ?? ''} onChange={(e) => setDoc({ total_amount: e.target.value === '' ? null : Number(e.target.value) })} className={inp} />
        </div>
      </div>

      {/* Reconciliation strip */}
      <div className={`rounded-lg border px-4 py-3 text-sm ${rec.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-300 bg-amber-50 text-amber-800'}`}>
        <div className="flex items-center gap-2">
          {rec.ok ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          <span className="font-semibold">
            Line sum {rec.sumNet.toLocaleString()} {rec.docTotal != null ? `vs document total ${Number(rec.docTotal).toLocaleString()}` : ''} — {rec.ok ? 'reconciles' : 'does not reconcile'}
          </span>
          {rec.docTotal != null && <span className="ml-2 text-xs">· qty sum {rec.sumQty}</span>}
        </div>
        {otherWarnings.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs">
            {otherWarnings.map((w, i) => (
              <li key={i} className="flex items-start gap-1"><span className="text-amber-500">•</span><span>{w}</span></li>
            ))}
          </ul>
        )}
        {taxGuardWarning && !taxGuardDismissed && (
          <div className="mt-2 flex items-start gap-2 rounded bg-amber-100/70 border border-amber-300 px-3 py-2 text-xs text-amber-900">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span className="flex-1">{taxGuardWarning} <span className="block text-[11px] text-amber-700 mt-0.5">No conversion is applied on your behalf — confirm the unit prices on the lines step before applying.</span></span>
            <button onClick={() => setTaxGuardDismissed(true)} className="text-amber-700 hover:text-amber-900 p-0.5" title="Dismiss"><X className="w-3.5 h-3.5" /></button>
          </div>
        )}
      </div>

      {/* Source file */}
      {doc?.file_url && (
        <a href={doc.file_url} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-amber-700 hover:text-amber-900 underline">
          <ExternalLink className="w-3.5 h-3.5" /> Open source document: {doc.title}
        </a>
      )}
    </div>
  );
}