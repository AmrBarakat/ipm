import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { X, Loader2, CheckCircle, Wand2, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';

const TYPE_LABELS = {
  invoice: 'Invoice',
  contract: 'Contract',
  po: 'Purchase Order',
  delivery_note: 'Delivery Note',
  other: 'General Document',
};

const inp = 'border border-slate-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white w-full';

function deriveMapped(r, document) {
  const general = r.general || {};
  const specific = r.specific || {};
  return {
    description: specific.description || general.document_title || document.title || '',
    reference_number: specific.invoice_number || specific.po_number || general.reference_number || '',
    planned_date: specific.planned_date || specific.issue_date || general.document_date || '',
    planned_amount: specific.planned_amount ?? specific.amount ?? general.total_amount ?? '',
    actual_amount: specific.actual_amount ?? '',
    status: specific.status || 'planned',
    vendor: specific.vendor_name || '',
    notes: specific.notes || '',
    currency: general.currency || 'SAR',
  };
}
function deriveSaveTarget(r) {
  const t = r.document_type || 'other';
  if (t === 'invoice') return 'invoice';
  if (t === 'po') return 'expense';
  if (t === 'contract') return 'project_info';
  return 'invoice';
}

export default function DocumentExtractionModal({ document, projectId, onClose, onApplied, initialResult }) {
  const [step, setStep] = useState(initialResult ? 'review' : 'idle'); // idle | extracting | review | applying | done
  const [result, setResult] = useState(initialResult || null);
  const [error, setError] = useState(null);
  const [showLineItems, setShowLineItems] = useState(false);

  // Editable mapped fields
  const [mapped, setMapped] = useState(() => initialResult ? deriveMapped(initialResult, document) : {});
  const [saveTarget, setSaveTarget] = useState(() => initialResult ? deriveSaveTarget(initialResult) : 'invoice'); // invoice | expense | milestone | project_info

  async function startExtraction() {
    setStep('extracting');
    setError(null);
    let res;
    try {
      res = await base44.functions.invoke('extractDocumentData', {
        file_url: document.file_url,
        document_category: document.category,
      });
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Extraction failed. The file type may not be supported.');
      setStep('idle');
      return;
    }
    if (res.data?.error) {
      setError(res.data.error);
      setStep('idle');
      return;
    }
    const r = res.data?.result;
    if (!r) { setError('No data could be extracted from this document.'); setStep('idle'); return; }

    setResult(r);
    setMapped(deriveMapped(r, document));
    setSaveTarget(deriveSaveTarget(r));
    setStep('review');
  }

  async function apply() {
    setStep('applying');
    if (saveTarget === 'invoice') {
      await base44.entities.Invoice.create({
        project_id: projectId,
        description: mapped.description,
        invoice_number: mapped.reference_number || undefined,
        planned_date: mapped.planned_date || undefined,
        planned_amount: Number(mapped.planned_amount) || 0,
        actual_amount: mapped.actual_amount !== '' ? Number(mapped.actual_amount) : undefined,
        status: mapped.status || 'planned',
        notes: mapped.notes || undefined,
      });
    } else if (saveTarget === 'expense') {
      await base44.entities.Expense.create({
        project_id: projectId,
        description: mapped.description,
        reference_number: mapped.reference_number || undefined,
        vendor: mapped.vendor || undefined,
        planned_date: mapped.planned_date || undefined,
        planned_amount: Number(mapped.planned_amount) || 0,
        actual_amount: mapped.actual_amount !== '' ? Number(mapped.actual_amount) : undefined,
        status: 'planned',
        notes: mapped.notes || undefined,
      });
    } else if (saveTarget === 'milestone') {
      await base44.entities.Milestone.create({
        project_id: projectId,
        title: mapped.description,
        planned_date: mapped.planned_date || undefined,
        description: mapped.notes || undefined,
        status: 'pending',
      });
    }
    setStep('done');
    setTimeout(() => { onApplied(); onClose(); }, 1200);
  }

  const conf = result ? Math.round((result.confidence || 0) * 100) : 0;
  const lineItems = result?.line_items || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div>
            <h2 className="font-bold text-slate-800 text-lg flex items-center gap-2">
              <Wand2 className="w-5 h-5 text-amber-500" /> Smart Document Extractor
            </h2>
            <p className="text-sm text-slate-500 mt-0.5 truncate max-w-lg">{document.title}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500"><X className="w-5 h-5" /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-6">

          {step === 'idle' && (
            <div className="text-center py-10">
              <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <Wand2 className="w-8 h-8 text-amber-500" />
              </div>
              <h3 className="font-semibold text-slate-700 text-lg mb-2">Extract & Map Document Data</h3>
              <p className="text-slate-500 text-sm max-w-md mx-auto mb-6">
                AI will read this document (PDF, Excel, or image) and extract key fields — then let you review and map them to your project records (Invoices, Expenses, or Milestones).
              </p>
              {error && <p className="text-red-600 text-sm mb-4 bg-red-50 border border-red-200 rounded p-3">{error}</p>}
              <button onClick={startExtraction}
                className="px-6 py-3 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold rounded-lg text-sm">
                Start Extraction
              </button>
            </div>
          )}

          {step === 'extracting' && (
            <div className="text-center py-16">
              <Loader2 className="w-10 h-10 animate-spin text-amber-500 mx-auto mb-4" />
              <h3 className="font-semibold text-slate-700 text-lg mb-1">Analyzing Document…</h3>
              <p className="text-slate-400 text-sm">AI is reading and extracting structured data. This may take 15–30 seconds.</p>
            </div>
          )}

          {step === 'applying' && (
            <div className="text-center py-16">
              <Loader2 className="w-10 h-10 animate-spin text-blue-500 mx-auto mb-4" />
              <h3 className="font-semibold text-slate-700 text-lg">Saving record…</h3>
            </div>
          )}

          {step === 'done' && (
            <div className="text-center py-16">
              <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
              <h3 className="font-semibold text-slate-700 text-lg">Record Created Successfully!</h3>
            </div>
          )}

          {step === 'review' && result && (
            <div className="space-y-5">
              {/* Detection summary */}
              <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
                <div className="flex-1">
                  <span className="text-sm font-semibold text-slate-700">Detected: </span>
                  <span className="text-sm text-amber-600 font-bold">{TYPE_LABELS[result.document_type] || 'Document'}</span>
                  {result.general?.parties?.length > 0 && (
                    <span className="text-xs text-slate-400 ml-3">Parties: {result.general.parties.slice(0, 3).join(', ')}</span>
                  )}
                </div>
                <div className="text-xs text-slate-500 shrink-0">
                  Confidence: <span className={`font-bold ${conf >= 70 ? 'text-emerald-600' : conf >= 40 ? 'text-amber-600' : 'text-red-500'}`}>{conf}%</span>
                </div>
              </div>

              {conf < 40 && (
                <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-3">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  Low confidence — please review and correct the extracted fields before saving.
                </div>
              )}

              {/* Save target selector */}
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 block">Save as</label>
                <div className="flex gap-2 flex-wrap">
                  {[
                    { id: 'invoice', label: 'Invoice' },
                    { id: 'expense', label: 'Expense' },
                    { id: 'milestone', label: 'Milestone' },
                  ].map(t => (
                    <button key={t.id} onClick={() => setSaveTarget(t.id)}
                      className={`px-4 py-2 text-sm rounded-lg border font-medium transition ${
                        saveTarget === t.id
                          ? 'bg-amber-500 border-amber-500 text-slate-900'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Editable fields */}
              <div className="space-y-3">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block">Extracted Fields (edit before saving)</label>

                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Description *</label>
                  <input value={mapped.description} onChange={e => setMapped(m => ({ ...m, description: e.target.value }))} className={inp} placeholder="Description" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Reference / {saveTarget === 'invoice' ? 'Invoice' : 'PO'} No.</label>
                    <input value={mapped.reference_number} onChange={e => setMapped(m => ({ ...m, reference_number: e.target.value }))} className={inp} placeholder="Reference number" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Date</label>
                    <input type="date" value={mapped.planned_date} onChange={e => setMapped(m => ({ ...m, planned_date: e.target.value }))} className={inp} />
                  </div>
                </div>

                {saveTarget !== 'milestone' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block">Planned Amount ({mapped.currency})</label>
                      <input type="number" value={mapped.planned_amount} onChange={e => setMapped(m => ({ ...m, planned_amount: e.target.value }))} className={inp} placeholder="0" min="0" />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block">Actual Amount ({mapped.currency})</label>
                      <input type="number" value={mapped.actual_amount} onChange={e => setMapped(m => ({ ...m, actual_amount: e.target.value }))} className={inp} placeholder="0" min="0" />
                    </div>
                  </div>
                )}

                {saveTarget === 'expense' && (
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Vendor</label>
                    <input value={mapped.vendor} onChange={e => setMapped(m => ({ ...m, vendor: e.target.value }))} className={inp} placeholder="Vendor name" />
                  </div>
                )}

                {saveTarget === 'invoice' && (
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Status</label>
                    <select value={mapped.status} onChange={e => setMapped(m => ({ ...m, status: e.target.value }))} className={inp}>
                      {['planned','invoiced','paid','partial','overdue','cancelled'].map(s =>
                        <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                      )}
                    </select>
                  </div>
                )}

                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Notes</label>
                  <textarea value={mapped.notes} onChange={e => setMapped(m => ({ ...m, notes: e.target.value }))} className={inp + ' h-16 resize-none'} placeholder="Additional notes" />
                </div>
              </div>

              {/* Line items collapsible */}
              {lineItems.length > 0 && (
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <button onClick={() => setShowLineItems(v => !v)}
                    className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 text-sm font-medium text-slate-700 hover:bg-slate-100">
                    <span>{lineItems.length} Line Item{lineItems.length !== 1 ? 's' : ''} detected</span>
                    {showLineItems ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  {showLineItems && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-100 text-slate-500">
                          <tr>
                            <th className="px-3 py-2 text-left">Description</th>
                            <th className="px-3 py-2 text-right">Qty</th>
                            <th className="px-3 py-2 text-left">Unit</th>
                            <th className="px-3 py-2 text-right">Unit Price</th>
                            <th className="px-3 py-2 text-right">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lineItems.map((li, i) => (
                            <tr key={i} className="border-t border-slate-100">
                              <td className="px-3 py-2">{li.description || '—'}</td>
                              <td className="px-3 py-2 text-right">{li.quantity ?? '—'}</td>
                              <td className="px-3 py-2">{li.unit || '—'}</td>
                              <td className="px-3 py-2 text-right">{li.unit_price != null ? li.unit_price.toLocaleString() : '—'}</td>
                              <td className="px-3 py-2 text-right font-medium">{li.total != null ? li.total.toLocaleString() : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 'review' && (
          <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-3 shrink-0 bg-slate-50">
            <button onClick={onClose} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-slate-100">
              Cancel
            </button>
            <button onClick={apply} disabled={!mapped.description}
              className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded-lg disabled:opacity-40">
              Save as {saveTarget.charAt(0).toUpperCase() + saveTarget.slice(1)}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}