import { useState } from 'react';
import { useEntityList } from '@/hooks/useEntity';
import { ENTITY_QUERY } from '@/lib/entityQueryDefaults';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { X, CheckCircle, AlertCircle, PackageCheck, Truck, Loader2, Link2 } from 'lucide-react';

const inp = 'border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white w-full';

/** Small amber "verify" badge for low-confidence quantities. */
function VerifyBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-semibold uppercase tracking-wide"
      title="OCR uncertainty — please verify this quantity">
      <AlertCircle className="w-2.5 h-2.5" /> verify
    </span>
  );
}

function statusColor(s) {
  if (s === 'Ordered' || s === 'Received' || s === 'Delivered') return 'text-emerald-600 font-semibold';
  if (s === 'Partially Received') return 'text-amber-600 font-semibold';
  if (s === 'Unmatched') return 'text-amber-700 font-semibold';
  if (s === 'Already Received' || s === 'Already Delivered') return 'text-slate-400';
  return 'text-slate-500';
}

export default function PODNExtractionPanel({ document: doc, result, projectId, onClose, onApplied }) {
  const { data: bomItems = [], isLoading: bomLoading } = useEntityList('BOMItem', { project_id: projectId }, ENTITY_QUERY.BOMItem.sort, ENTITY_QUERY.BOMItem.limit);
  const [rows, setRows] = useState(result.rows || []);
  const [assigning, setAssigning] = useState(null);
  const queryClient = useQueryClient();

  const isPO = result.document_type === 'po';
  const appliedCount = result.applied_count ?? rows.filter(r => r.matched).length;
  const unmatchedCount = result.unmatched_count ?? rows.filter(r => !r.matched).length;
  const uncertainCount = result.uncertain_count ?? rows.filter(r => r.ocr_uncertain).length;

  async function assignRow(rowIndex, bomItemId) {
    if (!bomItemId) return;
    setAssigning(rowIndex);
    try {
      const res = await base44.functions.invoke('applyPODNLine', {
        note_id: result.note_id,
        row_index: rowIndex,
        bom_item_id: bomItemId,
      });
      if (res.data?.error) { alert(res.data.error); return; }
      const updated = res.data?.row;
      if (updated) setRows(prev => prev.map((r, i) => (i === rowIndex ? updated : r)));
      queryClient.invalidateQueries({ queryKey: ['BOMItem'] });
      queryClient.invalidateQueries({ queryKey: ['AuditLog'] });
      queryClient.invalidateQueries({ queryKey: ['Note'] });
    } catch (err) {
      alert(err?.response?.data?.error || err?.message || 'Assignment failed.');
    } finally {
      setAssigning(null);
    }
  }

  const bannerVerb = isPO ? 'Ordered' : 'Received';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div>
            <h2 className="font-bold text-slate-800 text-lg flex items-center gap-2">
              {isPO ? <PackageCheck className="w-5 h-5 text-amber-500" /> : <Truck className="w-5 h-5 text-amber-500" />}
              {isPO ? 'Purchase Order' : 'Packing Slip / Delivery Note'} — Extraction Result
            </h2>
            <p className="text-sm text-slate-500 mt-0.5 truncate max-w-xl">{doc.title}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-auto p-6 space-y-4">
          {/* Document summary */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
            {result.document_number && (
              <span><span className="text-slate-500">{isPO ? 'PO' : 'Slip'} No:</span> <span className="font-mono font-semibold">{result.document_number}</span></span>
            )}
            {result.document_date && <span><span className="text-slate-500">Date:</span> {result.document_date}</span>}
            {result.vendor_name && <span><span className="text-slate-500">Vendor:</span> {result.vendor_name}</span>}
          </div>

          {/* Result banner */}
          <div className="flex items-start gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm text-emerald-800">
            <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              <span className="font-semibold">{appliedCount} item{appliedCount !== 1 ? 's' : ''} updated to {bannerVerb}</span>
              {unmatchedCount > 0 && <>, <span className="text-amber-700 font-semibold">{unmatchedCount} unmatched</span></>}
              {uncertainCount > 0 && <>, <span className="text-amber-700 font-semibold">{uncertainCount} need{uncertainCount === 1 ? 's' : ''} verification</span></>}.
              {unmatchedCount > 0 && <span className="block text-xs text-slate-500 mt-0.5">Assign unmatched lines to a BOM row with the dropdown — it applies immediately.</span>}
            </span>
          </div>

          {/* Extracted table */}
          {rows.length === 0 ? (
            <div className="text-center py-10 text-slate-500 text-sm">No line items detected in this document.</div>
          ) : (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-100 text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left">Part #</th>
                      <th className="px-3 py-2 text-left">Description</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2 text-left">Matched BOM Row</th>
                      <th className="px-3 py-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const bom = r.bom_item_id ? bomItems.find(b => b.id === r.bom_item_id) : null;
                      return (
                        <tr key={i} className={`border-t border-slate-100 ${!r.matched ? 'bg-amber-50' : ''}`}>
                          <td className="px-3 py-2 font-mono text-slate-600 align-top">{r.part_number || '—'}</td>
                          <td className="px-3 py-2 text-slate-700 align-top max-w-[260px]"><div className="truncate" title={r.description}>{r.description || '—'}</div></td>
                          <td className="px-3 py-2 text-right align-top">
                            <span className="inline-flex items-center gap-1 justify-end">
                              {r.qty ?? '—'}
                              {r.ocr_uncertain && <VerifyBadge />}
                            </span>
                          </td>
                          <td className="px-3 py-2 align-top min-w-[220px]">
                            {r.matched ? (
              <span className="text-slate-700">
                <span className="font-mono text-slate-600">{bom?.manufacturer_part_number || bom?.item_code || '—'}</span>
                <span className="block text-slate-400 truncate" title={bom?.description}>{(bom?.description || '').slice(0, 40)}</span>
              </span>
                            ) : bomLoading ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
                            ) : (
                              <select
                                value=""
                                onChange={e => assignRow(i, e.target.value)}
                                disabled={assigning === i}
                                className={inp + ' text-slate-600'}
                              >
                                <option value="">{assigning === i ? 'Applying…' : '— Assign BOM row —'}</option>
                                {bomItems.map(b => (
                                  <option key={b.id} value={b.id}>
                                    {(b.manufacturer_part_number || b.item_code || '?')} — {(b.description || '').slice(0, 50)}
                                  </option>
                                ))}
                              </select>
                            )}
                          </td>
                          <td className="px-3 py-2 align-top"><span className={statusColor(r.applied_status)}>{r.applied_status}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0 bg-slate-50">
          <button onClick={onApplied}
            className="flex items-center gap-1.5 text-sm text-amber-700 hover:text-amber-800 font-medium">
            <Link2 className="w-4 h-4" /> Open summary note in Notes tab
          </button>
          <button onClick={onClose}
            className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded-lg">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}