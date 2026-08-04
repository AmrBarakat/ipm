import { Link2 } from 'lucide-react';

const inp = 'border border-slate-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white w-full';

/** Step 5 — Expense. R5: if an Expense with the same reference exists, default OFF + link. */
export default function StepExpense({ draft, setDraft, projectId }) {
  const e = draft.expense;
  const dupId = draft.duplicates?.expense_id;
  function setE(patch) { setDraft((prev) => ({ ...prev, expense: { ...prev.expense, ...patch } })); }

  return (
    <div className="space-y-4">
      {dupId && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 flex items-center gap-2">
          <Link2 className="w-4 h-4" /> An expense with reference <span className="font-mono font-semibold">{e.reference_number}</span> already exists on this project — create toggle is OFF. Applying will link the PO to it.
        </div>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={e.createToggle} onChange={(ev) => setE({ createToggle: ev.target.checked })} className="w-4 h-4 accent-amber-500" />
        Create this expense
      </label>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="md:col-span-2"><label className="text-xs text-slate-500 mb-1 block">Description</label>
          <input value={e.description} onChange={(ev) => setE({ description: ev.target.value })} className={inp} /></div>
        <div><label className="text-xs text-slate-500 mb-1 block">Category</label>
          <select value={e.category} onChange={(ev) => setE({ category: ev.target.value })} className={inp}>
            {['material', 'labor', 'subcontract', 'travel', 'other'].map((o) => <option key={o} value={o}>{o}</option>)}
          </select></div>
        <div><label className="text-xs text-slate-500 mb-1 block">Status</label>
          <select value={e.status} onChange={(ev) => setE({ status: ev.target.value })} className={inp}>
            {['planned', 'committed', 'paid', 'cancelled'].map((o) => <option key={o} value={o}>{o}</option>)}
          </select></div>
        <div><label className="text-xs text-slate-500 mb-1 block">Vendor</label>
          <input value={e.vendor} onChange={(ev) => setE({ vendor: ev.target.value })} className={inp} /></div>
        <div><label className="text-xs text-slate-500 mb-1 block">Reference number</label>
          <input value={e.reference_number} onChange={(ev) => setE({ reference_number: ev.target.value })} className={inp} /></div>
        <div><label className="text-xs text-slate-500 mb-1 block">Planned date</label>
          <input type="date" value={e.planned_date} onChange={(ev) => setE({ planned_date: ev.target.value })} className={inp} /></div>
        <div><label className="text-xs text-slate-500 mb-1 block">Planned amount</label>
          <input type="number" step="0.01" value={e.planned_amount} onChange={(ev) => setE({ planned_amount: Number(ev.target.value) || 0 })} className={inp} /></div>
        <div className="md:col-span-2"><label className="text-xs text-slate-500 mb-1 block">Notes</label>
          <textarea value={e.notes} onChange={(ev) => setE({ notes: ev.target.value })} className={inp + ' h-16 resize-none'} /></div>
      </div>
    </div>
  );
}