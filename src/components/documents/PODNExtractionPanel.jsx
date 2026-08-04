import { useState, useMemo } from 'react';
import { useEntityList } from '@/hooks/useEntity';
import { ENTITY_QUERY } from '@/lib/entityQueryDefaults';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';
import { X, PackageCheck, Truck, Loader2, ScanEye } from 'lucide-react';
import { buildInitialDraft, liveSummary } from './podn-review/helpers';
import DuplicateBanner from './podn-review/DuplicateBanner';
import StepDocument from './podn-review/StepDocument';
import StepVendor from './podn-review/StepVendor';
import StepLines from './podn-review/StepLines';
import StepPurchaseOrder from './podn-review/StepPurchaseOrder';
import StepExpense from './podn-review/StepExpense';
import SecondaryDocumentPanel from './podn-review/SecondaryDocumentPanel';

const STEPS = ['Document', 'Vendor', 'Line items', 'Purchase Order', 'Expense'];

/**
 * R1 review-and-confirm modal. Opens after extractPODN returns, when NOTHING has
 * been written yet. Every value is editable before Apply. Apply calls
 * applyPODNExtraction (PROMPT 5) with the fully-edited payload; Cancel marks the
 * Extraction "failed" and writes nothing else. No VAT field anywhere.
 */
export default function PODNExtractionPanel({ document: doc, result, projectId, onClose, onApplied }) {
  const [draft, setDraft] = useState(() => buildInitialDraft(result));
  const [step, setStep] = useState(0);
  const [applying, setApplying] = useState(false);
  const [reExtracting, setReExtracting] = useState(false);
  const queryClient = useQueryClient();

  const { data: vendors = [] } = useEntityList('Vendor', {}, '-created_date', 500);
  const { data: bomItems = [] } = useEntityList('BOMItem', { project_id: projectId }, ENTITY_QUERY.BOMItem.sort, ENTITY_QUERY.BOMItem.limit);

  const isPO = draft.document.type === 'po';
  const summary = useMemo(() => liveSummary(draft), [draft]);

  const canApply = useMemo(() => {
    if (applying) return false;
    if (!draft.document.number) return false;
    if (draft.po.createToggle && !draft.po.po_number) return false;
    if (draft.expense.createToggle && !draft.expense.description) return false;
    return true;
  }, [applying, draft]);

  async function apply() {
    setApplying(true);
    try {
      await base44.functions.invoke('applyPODNExtraction', {
        extraction_id: draft.extraction_id,
        project_id: projectId,
        document_id: doc?.id,
        payload: draft,
      });
      queryClient.invalidateQueries({ queryKey: ['BOMItem'] });
      queryClient.invalidateQueries({ queryKey: ['PurchaseOrder'] });
      queryClient.invalidateQueries({ queryKey: ['Vendor'] });
      queryClient.invalidateQueries({ queryKey: ['Expense'] });
      queryClient.invalidateQueries({ queryKey: ['Extraction'] });
      onApplied();
    } catch (err) {
      setApplying(false);
      alert(err?.response?.data?.error || err?.message || 'Apply failed.');
    }
  }

  async function cancel() {
    try {
      if (draft.extraction_id) {
        await base44.entities.Extraction.update(draft.extraction_id, { status: 'failed', summary: 'Cancelled by user' });
      }
    } catch (_) {}
    onClose();
  }

  async function reExtractWithVision() {
    setReExtracting(true);
    try {
      const res = await base44.functions.invoke('extractPODN', {
        file_url: doc?.file_url,
        project_id: projectId,
        doc_hint: doc?.category === 'po' ? 'po' : doc?.category === 'delivery_note' ? 'delivery_note' : 'auto',
        document_id: doc?.id,
        document_title: doc?.title,
        force_vision: true,
      });
      const r = res?.data;
      if (r?.extraction_id) {
        setDraft(buildInitialDraft(r));
        setStep(0);
      } else if (r?.error) {
        alert(r.error + (r.stage ? ` (stage: ${r.stage})` : ''));
      }
    } catch (err) {
      alert(err?.response?.data?.error || err?.message || 'Re-extraction failed.');
    } finally {
      setReExtracting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div>
            <h2 className="font-bold text-slate-800 text-lg flex items-center gap-2">
              {isPO ? <PackageCheck className="w-5 h-5 text-amber-500" /> : <Truck className="w-5 h-5 text-amber-500" />}
              Review &amp; Confirm — {isPO ? 'Purchase Order' : 'Delivery Note'} Extraction
            </h2>
            <p className="text-sm text-slate-500 mt-0.5 truncate max-w-xl">{doc?.title}</p>
          </div>
          <button onClick={cancel} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Left rail */}
          <nav className="w-44 shrink-0 border-r border-slate-200 bg-slate-50 p-3 space-y-1">
            {STEPS.map((label, i) => (
              <button key={label} onClick={() => setStep(i)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 ${step === i ? 'bg-amber-500 text-slate-900 font-semibold' : 'text-slate-600 hover:bg-slate-100'}`}>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] ${step === i ? 'bg-slate-900 text-amber-300' : 'bg-slate-200 text-slate-500'}`}>{i + 1}</span>
                {label}
              </button>
            ))}
          </nav>

          {/* Body */}
          <div className="flex-1 overflow-auto p-6 space-y-4">
            <DuplicateBanner duplicates={draft.duplicates} documentNumber={draft.document.number} projectId={projectId} />
            {step === 0 && <StepDocument draft={draft} setDraft={setDraft} doc={doc} />}
            {step === 1 && <StepVendor draft={draft} setDraft={setDraft} vendors={vendors} />}
            {step === 2 && <StepLines draft={draft} setDraft={setDraft} bomItems={bomItems} />}
            {step === 3 && <StepPurchaseOrder draft={draft} setDraft={setDraft} projectId={projectId} />}
            {step === 4 && <StepExpense draft={draft} setDraft={setDraft} projectId={projectId} />}
            {draft.secondary?.present && (
              <SecondaryDocumentPanel secondary={draft.secondary} lines={draft.lines} currency={draft.document.currency} />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0 bg-slate-50">
          <div className="text-xs text-slate-500 truncate">{summary}</div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={reExtractWithVision} disabled={reExtracting || applying}
              className="flex items-center gap-1.5 px-3 py-2 border border-blue-300 text-blue-700 text-sm rounded-lg hover:bg-blue-50 disabled:opacity-40">
              {reExtracting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanEye className="w-4 h-4" />}
              Re-extract with image reading
            </button>
            <button onClick={cancel} className="px-3 py-2 border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-slate-100">Cancel</button>
            <button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} className="px-3 py-2 border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-slate-100 disabled:opacity-40">Back</button>
            {step < 4 ? (
              <button onClick={() => setStep((s) => Math.min(4, s + 1))} className="px-4 py-2 bg-slate-200 text-slate-700 text-sm rounded-lg hover:bg-slate-300 font-medium">Next</button>
            ) : (
              <button onClick={apply} disabled={!canApply} className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded-lg disabled:opacity-40 flex items-center gap-1.5">
                {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageCheck className="w-4 h-4" />}
                Apply all selected
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}