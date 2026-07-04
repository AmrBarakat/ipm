import { useState, useEffect, useMemo } from 'react';
import { useEntityList, useEntityMutation } from '@/hooks/useEntity';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { X, Loader2, CheckCircle, Save, AlertCircle, PackageCheck, Truck } from 'lucide-react';

const inp = 'border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white w-full';

function normalize(s) {
  return (s || '').toString().toLowerCase().trim().replace(/\s+/g, ' ');
}

/** Match an extracted line item to a BOM row: part number first, then normalized description. */
function matchLineItem(li, bomItems) {
  const pn = normalize(li.part_number);
  if (pn) {
    const byPn = bomItems.find(b =>
      normalize(b.manufacturer_part_number) === pn || normalize(b.item_code) === pn
    );
    if (byPn) return byPn.id;
  }
  const desc = normalize(li.description);
  if (desc) {
    const exact = bomItems.find(b => normalize(b.description) === desc);
    if (exact) return exact.id;
    const contains = bomItems.find(b => {
      const bd = normalize(b.description);
      return bd && (bd.includes(desc) || desc.includes(bd));
    });
    if (contains) return contains.id;
  }
  return '';
}

function actionLabel(m, li, bomById, isPO) {
  if (!m || m.skipped || !m.bomId) return 'Skipped';
  if (isPO) return 'Ordered';
  const bom = bomById[m.bomId];
  const deliveredQty = Number(li.quantity) || 0;
  const orderedQty = Number(bom?.quantity) || 0;
  return (orderedQty > 0 && deliveredQty < orderedQty) ? 'Partially Delivered' : 'Delivered';
}

function actionColor(action) {
  if (action === 'Ordered') return 'text-blue-600 font-semibold';
  if (action === 'Delivered') return 'text-emerald-600 font-semibold';
  if (action === 'Partially Delivered') return 'text-amber-600 font-semibold';
  return 'text-slate-400';
}

export default function PODNExtractionPanel({ document: doc, result, projectId, onClose, onApplied }) {
  const isPO = result.document_type === 'po';
  const { data: bomItems = [], isLoading: bomLoading } = useEntityList('BOMItem', { project_id: projectId }, '-created_date', 2000);
  const bomMutation = useEntityMutation('BOMItem');
  const noteMutation = useEntityMutation('Note');
  const auditMutation = useEntityMutation('AuditLog');
  const queryClient = useQueryClient();

  const [user, setUser] = useState(null);
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState(false);
  const [matches, setMatches] = useState([]);

  const general = result.general || {};
  const specific = result.specific || {};
  const docNumber = isPO
    ? specific.po_number || general.reference_number || doc.reference_number || ''
    : specific.dn_number || general.reference_number || doc.reference_number || '';
  const docDate = isPO
    ? specific.issue_date || general.document_date || doc.document_date || ''
    : specific.received_date || general.document_date || doc.document_date || '';

  const bomById = useMemo(() => Object.fromEntries(bomItems.map(b => [b.id, b])), [bomItems]);
  const lineItems = result.line_items || [];
  const conf = Math.round((result.confidence || 0) * 100);

  useEffect(() => {
    base44.auth.me().then(u => setUser(u)).catch(() => {});
  }, []);

  // Auto-match each line item to a BOM row once the BOM list is available
  useEffect(() => {
    if (bomLoading || bomItems.length === 0) return;
    setMatches(lineItems.map(li => ({ bomId: matchLineItem(li, bomItems), skipped: false })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bomLoading, bomItems.length]);

  function setMatchBom(i, bomId) {
    setMatches(prev => prev.map((m, idx) => idx === i ? { ...m, bomId, skipped: bomId === '' } : m));
  }
  function toggleSkip(i) {
    setMatches(prev => prev.map((m, idx) =>
      idx === i ? { ...m, skipped: !m.skipped, bomId: m.skipped ? m.bomId : '' } : m
    ));
  }

  async function confirm() {
    setApplying(true);
    const actor = user?.full_name || user?.email || 'system';
    const today = new Date().toISOString().slice(0, 10);
    const ref = docNumber || (isPO ? 'PO' : 'DN');
    const refDate = docDate || today;
    const rows = [];

    for (let i = 0; i < lineItems.length; i++) {
      const li = lineItems[i];
      const m = matches[i];

      // Skipped / no match → record as Skipped, do not touch the BOM
      if (!m || m.skipped || !m.bomId) {
        rows.push({
          bom_item_id: '', bom_description: li.description || '',
          part_number: li.part_number || '', quantity: li.quantity ?? '',
          action: 'Skipped', source_ref: ref, source_date: refDate,
        });
        continue;
      }
      const bom = bomById[m.bomId];
      if (!bom) {
        rows.push({
          bom_item_id: m.bomId, bom_description: li.description || '',
          part_number: li.part_number || '', quantity: li.quantity ?? '',
          action: 'Skipped', source_ref: ref, source_date: refDate,
        });
        continue;
      }

      if (isPO) {
        const oldStatus = bom.order_status || 'not_ordered';
        await bomMutation.mutateAsync({
          action: 'update', id: m.bomId,
          data: { ordered: true, order_status: 'ordered', po_number: ref, po_date: refDate },
        });
        await auditMutation.mutateAsync({
          action: 'create',
          data: {
            project_id: projectId, entity_type: 'BOMItem', entity_id: m.bomId, action: 'updated',
            actor, summary: `Marked ordered per ${ref}`,
            metadata: { field: 'order_status', old: oldStatus, new: 'ordered', source_document: ref, source_date: refDate },
          },
        });
        rows.push({
          bom_item_id: m.bomId, bom_description: bom.description || '',
          part_number: bom.manufacturer_part_number || bom.item_code || '',
          quantity: li.quantity ?? bom.quantity ?? '', action: 'Ordered',
          source_ref: ref, source_date: refDate,
        });
      } else {
        const deliveredQty = Number(li.quantity) || 0;
        const orderedQty = Number(bom.quantity) || 0;
        const isPartial = orderedQty > 0 && deliveredQty < orderedQty;
        const newStatus = isPartial ? 'partially_received' : 'received';
        const oldStatus = bom.delivery_status || 'pending';
        const dnNote = `Delivered per ${ref} on ${refDate}`;
        const existingNotes = bom.notes ? bom.notes + '\n' : '';
        await bomMutation.mutateAsync({
          action: 'update', id: m.bomId,
          data: { delivery_status: newStatus, actual_delivery_date: refDate, notes: existingNotes + dnNote },
        });
        await auditMutation.mutateAsync({
          action: 'create',
          data: {
            project_id: projectId, entity_type: 'BOMItem', entity_id: m.bomId, action: 'updated',
            actor, summary: `Marked ${isPartial ? 'partially delivered' : 'delivered'} per ${ref}`,
            metadata: { field: 'delivery_status', old: oldStatus, new: newStatus, source_document: ref, source_date: refDate, delivered_qty: deliveredQty, ordered_qty: orderedQty },
          },
        });
        rows.push({
          bom_item_id: m.bomId, bom_description: bom.description || '',
          part_number: bom.manufacturer_part_number || bom.item_code || '',
          quantity: deliveredQty,
          action: isPartial ? 'Partially Delivered' : 'Delivered',
          source_ref: ref, source_date: refDate,
        });
      }
    }

    // Write the audit-trail Note
    const appliedCount = rows.filter(r => r.action !== 'Skipped').length;
    const actionWord = isPO ? 'Ordered' : 'Delivered';
    const title = `${ref} — ${appliedCount} item${appliedCount !== 1 ? 's' : ''} marked ${actionWord}`;
    await noteMutation.mutateAsync({
      action: 'create',
      data: {
        project_id: projectId, author: actor, body: title,
        note_type: isPO ? 'po_summary' : 'dn_summary',
        table_data: {
          document_type: isPO ? 'po' : 'delivery_note',
          document_number: ref, document_date: refDate, rows,
        },
      },
    });

    setApplying(false);
    setDone(true);
    queryClient.invalidateQueries({ queryKey: ['BOMItem'] });
    queryClient.invalidateQueries({ queryKey: ['Note'] });
    queryClient.invalidateQueries({ queryKey: ['AuditLog'] });
    setTimeout(() => { onApplied(); }, 1200);
  }

  if (applying) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl p-8 text-center">
          <Loader2 className="w-10 h-10 animate-spin text-amber-500 mx-auto mb-4" />
          <h3 className="font-semibold text-slate-700 text-lg">Updating BOM & writing audit trail…</h3>
        </div>
      </div>
    );
  }
  if (done) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl p-8 text-center">
          <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
          <h3 className="font-semibold text-slate-700 text-lg">BOM updated & summary note created</h3>
        </div>
      </div>
    );
  }

  const willApplyCount = matches.filter(m => m.bomId && !m.skipped).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div>
            <h2 className="font-bold text-slate-800 text-lg flex items-center gap-2">
              {isPO ? <PackageCheck className="w-5 h-5 text-amber-500" /> : <Truck className="w-5 h-5 text-amber-500" />}
              {isPO ? 'Purchase Order' : 'Delivery Note'} → BOM Update
            </h2>
            <p className="text-sm text-slate-500 mt-0.5 truncate max-w-xl">{doc.title}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500"><X className="w-5 h-5" /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-6 space-y-4">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-sm">
            <span><span className="text-slate-500">Type:</span> <span className="font-bold text-amber-600">{isPO ? 'Purchase Order' : 'Delivery Note'}</span></span>
            {docNumber && <span><span className="text-slate-500">Ref:</span> <span className="font-mono font-semibold">{docNumber}</span></span>}
            {docDate && <span><span className="text-slate-500">Date:</span> {docDate}</span>}
            {specific.vendor_name && <span><span className="text-slate-500">Vendor:</span> {specific.vendor_name}</span>}
            <span className="ml-auto text-xs text-slate-500">Confidence: <span className={`font-bold ${conf >= 70 ? 'text-emerald-600' : conf >= 40 ? 'text-amber-600' : 'text-red-500'}`}>{conf}%</span></span>
          </div>

          {conf < 40 && (
            <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-3">
              <AlertCircle className="w-4 h-4 shrink-0" />
              Low confidence — review the matches carefully before confirming.
            </div>
          )}

          {bomLoading ? (
            <div className="text-center py-10"><Loader2 className="w-8 h-8 animate-spin text-amber-500 mx-auto" /></div>
          ) : bomItems.length === 0 ? (
            <div className="text-center py-10 text-slate-500 text-sm">No BOM items on this project — nothing to update.</div>
          ) : lineItems.length === 0 ? (
            <div className="text-center py-10 text-slate-500 text-sm">No line items detected in this document.</div>
          ) : (
            <>
              <p className="text-xs text-slate-500">
                Review the auto-matched BOM rows below. Correct any wrong match with the dropdown, or skip a line.
                Nothing is written until you click <span className="font-semibold">Confirm & Update BOM</span>.
              </p>
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-100 text-slate-500">
                      <tr>
                        <th className="px-3 py-2 text-left">Extracted Item</th>
                        <th className="px-3 py-2 text-right">Qty</th>
                        <th className="px-3 py-2 text-left">Matched BOM Row</th>
                        <th className="px-3 py-2 text-left">Action</th>
                        <th className="px-3 py-2 text-center">Skip</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lineItems.map((li, i) => {
                        const m = matches[i] || { bomId: '', skipped: false };
                        const bom = m.bomId ? bomById[m.bomId] : null;
                        const action = actionLabel(m, li, bomById, isPO);
                        return (
                          <tr key={i} className={`border-t border-slate-100 ${m.skipped ? 'opacity-50' : ''}`}>
                            <td className="px-3 py-2">
                              <div className="font-medium text-slate-700">{li.description || '—'}</div>
                              {li.part_number && <div className="font-mono text-slate-400">{li.part_number}</div>}
                            </td>
                            <td className="px-3 py-2 text-right">{li.quantity ?? '—'}</td>
                            <td className="px-3 py-2">
                              <select value={m.bomId} onChange={e => setMatchBom(i, e.target.value)} className={inp} disabled={m.skipped}>
                                <option value="">— No match / Skip —</option>
                                {bomItems.map(b => (
                                  <option key={b.id} value={b.id}>
                                    {(b.item_code || b.manufacturer_part_number || '?')} — {(b.description || '').slice(0, 50)}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-2">
                              <span className={actionColor(action)}>{action}</span>
                              {bom && !isPO && bom.quantity > 0 && (
                                <span className="block text-slate-400">ordered: {bom.quantity}</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <button onClick={() => toggleSkip(i)}
                                className={`px-2 py-1 rounded text-xs ${m.skipped ? 'bg-slate-200 text-slate-600' : 'border border-slate-300 text-slate-500 hover:bg-slate-50'}`}>
                                {m.skipped ? 'Unskip' : 'Skip'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {lineItems.length > 0 && bomItems.length > 0 && (
          <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0 bg-slate-50">
            <p className="text-xs text-slate-500">{willApplyCount} of {lineItems.length} will be updated</p>
            <div className="flex gap-2">
              <button onClick={onClose} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-slate-100">Cancel</button>
              <button onClick={confirm} disabled={willApplyCount === 0}
                className="flex items-center gap-1.5 px-5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded-lg disabled:opacity-40">
                <Save className="w-4 h-4" /> Confirm & Update BOM
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}