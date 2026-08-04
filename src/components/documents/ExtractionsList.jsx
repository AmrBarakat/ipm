import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Layers, RotateCcw, RefreshCw, Eye, Loader2, ChevronRight, FileText } from 'lucide-react';
import { useConfirm } from '@/components/ui/ConfirmDialog';

const STATUS_STYLES = {
  pending: 'bg-slate-100 text-slate-600',
  processing: 'bg-blue-100 text-blue-700',
  review: 'bg-amber-100 text-amber-700',
  completed: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700',
  reverted: 'bg-purple-100 text-purple-700',
};
const STATUS_LABELS = {
  pending: 'Pending', processing: 'Processing', review: 'In review',
  completed: 'Completed', failed: 'Failed', reverted: 'Reverted',
};
const KIND_LABELS = { po: 'Purchase Order', delivery_note: 'Delivery Note', other: 'Other' };

function summarizeRefs(refs) {
  const counts = {};
  for (const r of refs || []) counts[r.entity_type] = (counts[r.entity_type] || 0) + 1;
  return {
    vendor: counts.Vendor || 0,
    po: counts.PurchaseOrder || 0,
    expense: counts.Expense || 0,
    bom: counts.BOMItem || 0,
    note: counts.Note || 0,
  };
}

/**
 * Extractions section for the Documents tab. Lists this project's Extraction
 * records with status-aware actions: resume review (review), revert (completed),
 * re-apply (reverted).
 */
export default function ExtractionsList({ extractions = [], docsById = {}, onReApply, onRevert }) {
  const [busy, setBusy] = useState(null);
  const [skipReport, setSkipReport] = useState(null);
  const confirmDialog = useConfirm();
  const queryClient = useQueryClient();

  const sorted = useMemo(() => [...extractions].sort((a, b) => (b.created_date || '').localeCompare(a.created_date || '')), [extractions]);

  async function doRevert(ext) {
    const doc = docsById[ext.document_id];
    const c = summarizeRefs(ext.created_entity_refs);
    const lines = [
      c.vendor ? `delete ${c.vendor} vendor` : '',
      c.po ? `delete ${c.po} purchase order` : '',
      c.expense ? `delete ${c.expense} expense` : '',
      c.bom ? `restore ${c.bom} BOM row(s) to pre-apply values` : '',
      c.note ? `mark ${c.note} summary note reverted` : '',
    ].filter(Boolean);
    const ok = await confirmDialog({
      title: 'Revert this extraction?',
      description: `This will ${lines.join(', ')}. The extraction will be marked "reverted" so you can correct and re-apply it. This cannot be undone.`,
      confirmText: 'Revert',
      destructive: true,
    });
    if (!ok) return;
    setBusy(ext.id);
    try {
      const res = await base44.functions.invoke('revertPODNExtraction', { extraction_id: ext.id });
      const data = res.data || res;
      if (data?.error) { alert(data.error); return; }
      if (data?.skipped?.length) {
        setSkipReport({ extractionId: ext.id, skipped: data.skipped, reverted: data.reverted || [] });
      }
      queryClient.invalidateQueries({ queryKey: ['Extraction'] });
      queryClient.invalidateQueries({ queryKey: ['PurchaseOrder'] });
      queryClient.invalidateQueries({ queryKey: ['Vendor'] });
      queryClient.invalidateQueries({ queryKey: ['Expense'] });
      queryClient.invalidateQueries({ queryKey: ['BOMItem'] });
      queryClient.invalidateQueries({ queryKey: ['Note'] });
    } catch (err) {
      alert(err?.response?.data?.error || err?.message || 'Revert failed.');
    } finally { setBusy(null); }
  }

  if (sorted.length === 0) return null;

  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-200">
        <Layers className="w-4 h-4 text-amber-500" />
        <span className="font-semibold text-slate-700 text-sm">Extractions</span>
        <span className="text-xs text-slate-400">{sorted.length} record{sorted.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="divide-y divide-slate-100">
        {sorted.map((ext) => {
          const doc = docsById[ext.document_id];
          const c = summarizeRefs(ext.created_entity_refs);
          const isReview = ext.status === 'review';
          const isCompleted = ext.status === 'completed';
          const isReverted = ext.status === 'reverted';
          const appliedDate = ext.applied_at ? new Date(ext.applied_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '';
          const createdDate = ext.created_date ? new Date(ext.created_date).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '';
          const countsLine = [c.po ? `${c.po} PO` : '', c.expense ? `${c.expense} expense` : '', c.bom ? `${c.bom} BOM rows` : '', c.vendor ? `${c.vendor} vendor` : ''].filter(Boolean).join(', ');
          return (
            <div key={ext.id} className="px-4 py-3 flex flex-wrap items-center gap-3">
              <FileText className="w-4 h-4 text-slate-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-slate-800 text-sm truncate">{ext.document_title || 'Untitled'}</span>
                  <span className={`text-xs px-2 py-0.5 rounded font-semibold ${STATUS_STYLES[ext.status] || 'bg-slate-100 text-slate-600'}`}>{STATUS_LABELS[ext.status] || ext.status}</span>
                  <span className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">{KIND_LABELS[ext.extraction_kind] || ext.extraction_kind || '—'}</span>
                </div>
                <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap gap-3">
                  {isCompleted && countsLine && <span>Created: {countsLine}</span>}
                  {!isCompleted && ext.summary && <span>{ext.summary}</span>}
                  <span>{isCompleted ? `Applied ${appliedDate}` : `Created ${createdDate}`}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {isReview && (
                  <button onClick={() => onReApply(ext)} disabled={busy === ext.id}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs border border-amber-300 rounded hover:bg-amber-50 text-amber-700 font-medium disabled:opacity-50">
                    <Eye className="w-3 h-3" /> Resume review
                  </button>
                )}
                {isCompleted && (
                  <button onClick={() => doRevert(ext)} disabled={busy === ext.id}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs border border-red-300 rounded hover:bg-red-50 text-red-700 font-medium disabled:opacity-50">
                    {busy === ext.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />} Revert
                  </button>
                )}
                {isReverted && (
                  <button onClick={() => onReApply(ext)} disabled={busy === ext.id || !doc}
                    title={!doc ? 'Source document no longer exists' : 'Re-extract from the source document'}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs border border-emerald-300 rounded hover:bg-emerald-50 text-emerald-700 font-medium disabled:opacity-50">
                    <RefreshCw className="w-3 h-3" /> Re-apply
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {skipReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setSkipReport(null)}>
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <ChevronRight className="w-5 h-5 text-amber-500" />
              <h3 className="font-semibold text-slate-800">Revert complete — some items skipped</h3>
            </div>
            <p className="text-sm text-slate-600">The extraction was marked "reverted". The following items were left untouched because they were edited by hand after the apply:</p>
            <ul className="text-xs space-y-1 max-h-60 overflow-auto">
              {skipReport.skipped.map((s, i) => (
                <li key={i} className="bg-amber-50 border border-amber-200 rounded px-2 py-1.5 text-amber-800">
                  <strong>{s.entity_type} {s.entity_id?.slice(-6)}</strong> — {s.reason}
                </li>
              ))}
            </ul>
            <div className="text-xs text-slate-500">Reverted: {skipReport.reverted.length} item(s).</div>
            <button onClick={() => setSkipReport(null)} className="px-3 py-1.5 bg-amber-500 text-slate-900 text-sm rounded font-semibold">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}