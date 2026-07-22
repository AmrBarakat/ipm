import { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { runBatch } from '@/hooks/useEntity';
import { useQueryClient } from '@tanstack/react-query';
import { formatCurrency } from '@/lib/constants';
import { toast } from '@/components/ui/use-toast';
import { todayLocal } from '@/lib/utils';
import { X, Loader2, FileText } from 'lucide-react';

const inp = 'border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white w-full';

function manualSentinel() {
  return `manual-${crypto.randomUUID()}`;
}

/**
 * Bulk invoice generation dialog for selected deliverables.
 *
 * Combined mode → one Invoice (manual-<uuid> sentinel) covering all selected.
 * Per-deliverable mode → one Invoice per row; uses the real milestone_id only
 * when the deliverable links to a milestone that has no invoice yet (and that
 * milestone isn't already claimed earlier in the same batch), otherwise the
 * manual-<uuid> sentinel. Each invoice's notes lists the deliverable(s) it covers.
 */
export default function BulkInvoiceDialog({ open, onClose, projectId, deliverables, milestones, contractValue, currency }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState('combined');
  const [rows, setRows] = useState([]);
  const [invoiceDate, setInvoiceDate] = useState(todayLocal());
  const [status, setStatus] = useState('planned');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);

  const milestoneById = useMemo(() => Object.fromEntries(milestones.map(m => [m.id, m])), [milestones]);

  useEffect(() => {
    if (!open) return;
    setMode('combined');
    setInvoiceDate(todayLocal());
    setStatus('planned');
    const cv = Number(contractValue) || 0;
    const initRows = deliverables.map(d => {
      let amt = 0;
      const ms = d.milestone_id ? milestoneById[d.milestone_id] : null;
      if (ms && Number(ms.weight) > 0 && cv > 0) {
        amt = Math.round(cv * (Number(ms.weight) / 100) * 100) / 100;
      }
      return { id: d.id, name: d.name, milestone_id: d.milestone_id || '', amount: amt };
    });
    setRows(initRows);
    const first3 = deliverables.slice(0, 3).map(d => d.name).filter(Boolean).join(', ');
    setDescription(`Deliverables: ${first3}${deliverables.length > 3 ? '…' : ''}`);
  }, [open, deliverables, milestoneById, contractValue]);

  if (!open) return null;

  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);

  function setAmount(id, val) {
    setRows(prev => prev.map(r => (r.id === id ? { ...r, amount: Number(val) || 0 } : r)));
  }

  async function handleConfirm() {
    if (rows.length === 0) return;
    setCreating(true);
    try {
      // Detect milestones that already have an invoice, so we only attach the
      // real milestone_id when the milestone is still invoice-free.
      const existing = await base44.entities.Invoice.filter({ project_id: projectId }, '-created_date', 500);
      const milestonesWithInvoice = new Set(existing.map(i => i.milestone_id).filter(Boolean));
      const claimedThisBatch = new Set();

      const names = deliverables.map(d => d.name).filter(Boolean);

      let promises;
      if (mode === 'combined') {
        promises = [base44.entities.Invoice.create({
          project_id: projectId,
          description: description.trim() || `Deliverables: ${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}`,
          milestone_id: manualSentinel(),
          status,
          planned_date: invoiceDate,
          planned_amount: total,
          notes: `Covers deliverables: ${names.join(', ')}`,
        })];
      } else {
        promises = deliverables.map((d, idx) => {
          const amt = Number(rows[idx]?.amount) || 0;
          const ms = d.milestone_id;
          const useRealMs = ms && !milestonesWithInvoice.has(ms) && !claimedThisBatch.has(ms);
          if (useRealMs) claimedThisBatch.add(ms);
          return base44.entities.Invoice.create({
            project_id: projectId,
            description: d.name,
            milestone_id: useRealMs ? ms : manualSentinel(),
            status,
            planned_date: invoiceDate,
            planned_amount: amt,
            notes: `Covers deliverable: ${d.name}`,
          });
        });
      }

      const res = await runBatch(promises, 'invoices');
      queryClient.invalidateQueries({ queryKey: ['Invoice'] });
      queryClient.invalidateQueries({ queryKey: ['Deliverable'] });
      if (res.failed === 0) {
        toast({ title: `${res.succeeded} invoice${res.succeeded === 1 ? '' : 's'} created` });
      }
      onClose();
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2">
            <FileText className="w-4 h-4 text-amber-500" /> Generate Invoices
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Mode toggle */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500 w-16">Mode</span>
            <div className="flex bg-slate-100 rounded-lg p-0.5">
              <button onClick={() => setMode('combined')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${mode === 'combined' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>
                One combined invoice
              </button>
              <button onClick={() => setMode('per')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${mode === 'per' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>
                One invoice per deliverable
              </button>
            </div>
          </div>

          {/* Shared fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 block mb-0.5">Invoice date</label>
              <input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} className={inp} />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-0.5">Status</label>
              <select value={status} onChange={e => setStatus(e.target.value)} className={inp}>
                <option value="planned">Planned</option>
                <option value="invoiced">Invoiced</option>
              </select>
            </div>
          </div>

          {mode === 'combined' && (
            <div>
              <label className="text-xs text-slate-400 block mb-0.5">Description</label>
              <input value={description} onChange={e => setDescription(e.target.value)} className={inp} />
            </div>
          )}

          {/* Rows table */}
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Deliverable</th>
                  <th className="px-3 py-2 text-left">Milestone</th>
                  <th className="px-3 py-2 text-right w-32">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const ms = r.milestone_id ? milestoneById[r.milestone_id] : null;
                  return (
                    <tr key={r.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 text-slate-700">{r.name || '—'}</td>
                      <td className="px-3 py-2 text-slate-500">
                        {ms ? <span>{ms.title} <span className="text-slate-400">({Number(ms.weight) || 0}%)</span></span> : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" min="0" value={r.amount} onChange={e => setAmount(r.id, e.target.value)} className={inp + ' text-right'} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {mode === 'combined' && (
                <tfoot className="bg-slate-50 border-t border-slate-200">
                  <tr>
                    <td colSpan={2} className="px-3 py-2 text-right font-semibold text-slate-600">Total</td>
                    <td className="px-3 py-2 text-right font-bold text-slate-800">{formatCurrency(total, currency || 'SAR')}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {contractValue ? (
            <p className="text-[11px] text-slate-400">
              Amounts pre-filled from milestone weight × contract value ({formatCurrency(Number(contractValue) || 0, currency || 'SAR')}). Edit as needed.
            </p>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
          <button onClick={onClose} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded hover:bg-slate-100">Cancel</button>
          <button onClick={handleConfirm} disabled={creating || rows.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded disabled:opacity-50">
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            {creating ? 'Creating…' : mode === 'combined' ? 'Create Invoice' : `Create ${rows.length} Invoices`}
          </button>
        </div>
      </div>
    </div>
  );
}