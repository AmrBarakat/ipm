import { useState, useEffect, useMemo } from 'react';
import { useEntityList, useEntityMutation } from '@/hooks/useEntity';
import { ENTITY_QUERY } from '@/lib/entityQueryDefaults';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { X, Loader2, CheckCircle, Save, AlertCircle, PackageCheck, Truck } from 'lucide-react';

const inp = 'border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white w-full';

function normalize(s) {
  return (s || '').toString().toLowerCase().trim().replace(/\s+/g, ' ');
}

/** Strip leading TQ. / ES. prefixes repeatedly, uppercase, trim. e.g. ES.TQ.PAS600 -> PAS600 */
function normalizePartNo(s) {
  let code = (s || '').toString().toUpperCase().trim();
  code = code.replace(/^(?:TQ\.|ES\.)+/i, '');
  return code;
}

/** Extract the bracketed code from a description, e.g. "[TQ.TWDFCW30K] 3M CABLE" -> "TWDFCW30K" */
function extractBracketCode(desc) {
  const m = (desc || '').toString().match(/\[([^\]]+)\]/);
  if (!m) return '';
  return normalizePartNo(m[1]);
}

/** Match a line item to a BOM row: bracket code first; description fallback only when no bracket code. */
function matchLineItem(li, bomItems) {
  const bracket = extractBracketCode(li.description) || normalizePartNo(li.part_number);
  if (bracket) {
    const byCode = bomItems.find(b => {
      const bp = normalizePartNo(b.manufacturer_part_number) || normalizePartNo(b.item_code);
      return bp && bp === bracket;
    });
    if (byCode) return byCode.id;
  }
  if (!bracket) {
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
  }
  return '';
}

function computeStatus(deliveredQty, totalQty) {
  if (deliveredQty <= 0) return 'not_delivered';
  if (totalQty > 0 && deliveredQty < totalQty) return 'partially_delivered';
  return 'delivered';
}

function statusLabel(s) {
  return s === 'delivered' ? 'Delivered' : s === 'partially_delivered' ? 'Partially Delivered' : 'Not Delivered';
}
function statusColor(s) {
  if (s === 'delivered') return 'text-emerald-600 font-semibold';
  if (s === 'partially_delivered') return 'text-amber-600 font-semibold';
  return 'text-slate-400';
}

export default function PODNExtractionPanel({ document: doc, result, projectId, onClose, onApplied }) {
  const [docType, setDocType] = useState(result.document_type === 'po' ? 'po' : 'delivery_note');
  const { data: bomItems = [], isLoading: bomLoading } = useEntityList('BOMItem', { project_id: projectId }, ENTITY_QUERY.BOMItem.sort, ENTITY_QUERY.BOMItem.limit);
  const bomMutation = useEntityMutation('BOMItem');
  const noteMutation = useEntityMutation('Note');
  const auditMutation = useEntityMutation('AuditLog');
  const queryClient = useQueryClient();

  const [user, setUser] = useState(null);
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState(false);
  const [matches, setMatches] = useState([]);

  const isPO = docType === 'po';
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

  useEffect(() => { base44.auth.me().then(u => setUser(u)).catch(() => {}); }, []);

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

  // Per-row delivery preview (cumulative delivered, remaining, resulting status)
  function rowPreview(i) {
    const li = lineItems[i];
    const m = matches[i];
    const bom = m && m.bomId ? bomById[m.bomId] : null;
    const slipDelivered = Number(li?.delivered_qty) || 0;
    const existing = Number(bom?.delivered_qty) || 0;
    const total = Number(bom?.quantity) || 0;
    const cumulative = existing + slipDelivered;
    const remaining = Math.max(0, total - cumulative);
    const status = computeStatus(cumulative, total);
    return { slipDelivered, existing, cumulative, remaining, status, total };
  }

  async function confirm() {
    setApplying(true);
    const actor = user?.full_name || user?.email || 'system';
    const today = new Date().toISOString().slice(0, 10);
    const ref = docNumber || (isPO ? 'PO' : 'Packing slip');
    const refDate = docDate || today;
    const rows = [];

    for (let i = 0; i < lineItems.length; i++) {
      const li = lineItems[i];
      const m = matches[i];
      if (!m || m.skipped || !m.bomId) {
        rows.push({
          bom_item_id: '', bom_description: li.description || '',
          part_number: extractBracketCode(li.description) || li.part_number || '',
          ordered_qty: Number(li.ordered_qty) || Number(li.quantity) || 0,
          delivered_this_slip: Number(li.delivered_qty) || 0, cumulative_delivered: 0,
          remaining: 0, action: 'Skipped', source_ref: ref, source_date: refDate,
        });
        continue;
      }
      const bom = bomById[m.bomId];
      if (!bom) {
        rows.push({ bom_item_id: m.bomId, bom_description: li.description || '', part_number: li.part_number || '', ordered_qty: 0, delivered_this_slip: 0, cumulative_delivered: 0, remaining: 0, action: 'Skipped', source_ref: ref, source_date: refDate });
        continue;
      }

      if (isPO) {
        const oldStatus = bom.order_status || 'not_ordered';
        await bomMutation.mutateAsync({ action: 'update', id: m.bomId, data: { ordered: true, order_status: 'ordered', po_number: ref, po_date: refDate } });
        await auditMutation.mutateAsync({ action: 'create', data: {
          project_id: projectId, entity_type: 'BOMItem', entity_id: m.bomId, action: 'updated', actor,
          summary: `Marked ordered per ${ref}`,
          metadata: { field: 'order_status', old: oldStatus, new: 'ordered', source_document: ref, source_date: refDate },
        }});
        rows.push({
          bom_item_id: m.bomId, bom_description: bom.description || '',
          part_number: bom.manufacturer_part_number || bom.item_code || '',
          ordered_qty: Number(li.ordered_qty) || Number(li.quantity) || Number(bom.quantity) || 0,
          delivered_this_slip: 0, cumulative_delivered: Number(bom.delivered_qty) || 0,
          remaining: Math.max(0, (Number(bom.quantity) || 0) - (Number(bom.delivered_qty) || 0)),
          action: 'Ordered', source_ref: ref, source_date: refDate,
        });
      } else {
        const slipDelivered = Number(li.delivered_qty) || 0;
        const existingDelivered = Number(bom.delivered_qty) || 0;
        const totalQty = Number(bom.quantity) || 0;
        const newDelivered = existingDelivered + slipDelivered;
        const newRemaining = Math.max(0, totalQty - newDelivered);
        const newStatus = computeStatus(newDelivered, totalQty);
        const oldStatus = bom.delivery_status || 'not_delivered';
        const dnNote = `Delivered per ${ref} on ${refDate} (+${slipDelivered})`;
        const existingNotes = bom.notes ? bom.notes + '\n' : '';
        await bomMutation.mutateAsync({ action: 'update', id: m.bomId, data: {
          delivered_qty: newDelivered, remaining_qty: newRemaining, delivery_status: newStatus,
          actual_delivery_date: refDate, notes: existingNotes + dnNote,
        }});
        await auditMutation.mutateAsync({ action: 'create', data: {
          project_id: projectId, entity_type: 'BOMItem', entity_id: m.bomId, action: 'updated', actor,
          summary: `Marked ${statusLabel(newStatus)} per ${ref} (+${slipDelivered})`,
          metadata: { field: 'delivery_status', old: oldStatus, new: newStatus, delivered_qty: newDelivered, remaining_qty: newRemaining, source_document: ref, source_date: refDate, slip_delivered: slipDelivered },
        }});
        rows.push({
          bom_item_id: m.bomId, bom_description: bom.description || '',
          part_number: bom.manufacturer_part_number || bom.item_code || '',
          ordered_qty: totalQty, delivered_this_slip: slipDelivered,
          cumulative_delivered: newDelivered, remaining: newRemaining,
          action: statusLabel(newStatus), source_ref: ref, source_date: refDate,
        });
      }
    }

    // Summary Note
    if (isPO) {
      const appliedCount = rows.filter(r => r.action === 'Ordered').length;
      const title = `${ref} — ${appliedCount} item${appliedCount !== 1 ? 's' : ''} marked Ordered`;
      await noteMutation.mutateAsync({ action: 'create', data: {
        project_id: projectId, author: actor, body: title, note_type: 'po_summary',
        table_data: { document_type: 'po', document_number: ref, document_date: refDate, rows },
      }});
    } else {
      const deliveredCount = rows.filter(r => r.action === 'Delivered').length;
      const partialCount = rows.filter(r => r.action === 'Partially Delivered').length;
      const title = `${ref} — ${deliveredCount} delivered, ${partialCount} partial`;
      await noteMutation.mutateAsync({ action: 'create', data: {
        project_id: projectId, author: actor, body: title, note_type: 'dn_summary',
        table_data: { document_type: 'delivery_note', document_number: ref, document_date: refDate, rows },
      }});
    }

    setApplying(false);
    setDone(true);
    queryClient.invalidateQueries({ queryKey: ['BOMItem'] });
    queryClient.invalidateQueries({ queryKey: ['Note'] });
    queryClient.invalidateQueries({ queryKey: ['AuditLog'] });
    setTimeout(() => { onApplied(); }, 1200);
  }

  if (applying) return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl p-8 text-center">
        <Loader2 className="w-10 h-10 animate-spin text-amber-500 mx-auto mb-4" />
        <h3 className="font-semibold text-slate-700 text-lg">Updating BOM & writing audit trail…</h3>
      </div>
    </div>
  );
  if (done) return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl p-8 text-center">
        <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
        <h3 className="font-semibold text-slate-700 text-lg">BOM updated & summary note created</h3>
      </div>
    </div>
  );

  const willApplyCount = matches.filter(m => m.bomId && !m.skipped).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div>
            <h2 className="font-bold text-slate-800 text-lg flex items-center gap-2">
              {isPO ? <PackageCheck className="w-5 h-5 text-amber-500" /> : <Truck className="w-5 h-5 text-amber-500" />}
              {isPO ? 'Purchase Order' : 'Packing Slip / Delivery Note'} → BOM Update
            </h2>
            <p className="text-sm text-slate-500 mt-0.5 truncate max-w-xl">{doc.title}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-auto p-6 space-y-4">
          {/* Detection + type override */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-sm">
            <span><span className="text-slate-500">Detected:</span> <span className="font-bold text-amber-600">{result.document_type === 'po' ? 'Purchase Order' : result.document_type === 'delivery_note' ? 'Packing Slip / Delivery Note' : result.document_type}</span></span>
            <span className="text-xs text-slate-500">Confidence: <span className={`font-bold ${conf >= 70 ? 'text-emerald-600' : conf >= 40 ? 'text-amber-600' : 'text-red-500'}`}>{conf}%</span></span>
            <span className="ml-auto flex items-center gap-2">
              <span className="text-xs text-slate-500">Treat as:</span>
              <select value={docType} onChange={e => setDocType(e.target.value)} className="text-xs border border-slate-300 rounded px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400">
                <option value="delivery_note">Packing Slip / Delivery Note</option>
                <option value="po">Purchase Order</option>
              </select>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
            {docNumber && <span><span className="text-slate-500">{isPO ? 'PO' : 'Slip'} Ref:</span> <span className="font-mono font-semibold">{docNumber}</span></span>}
            {docDate && <span><span className="text-slate-500">Date:</span> {docDate}</span>}
            {specific.vendor_name && <span><span className="text-slate-500">Vendor:</span> {specific.vendor_name}</span>}
          </div>

          {conf < 40 && (
            <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-3">
              <AlertCircle className="w-4 h-4 shrink-0" />
              Low confidence — review the matches carefully before confirming. You can override the document type above.
            </div>
          )}

          {bomLoading ? (
            <div className="text-center py-10"><Loader2 className="w-8 h-8 animate-spin text-amber-500 mx-auto" /></div>
          ) : bomItems.length === 0 ? (
            <div className="text-center py-10 text-slate-500 text-sm">No BOM items on this project — nothing to update.</div>
          ) : lineItems.length === 0 ? (
            <div className="text-center py-10 text-slate-500 text-sm">No line items detected in this document. Nothing to process.</div>
          ) : (
            <>
              <p className="text-xs text-slate-500">
                Line items are auto-matched by the bracketed part code in the description (e.g. <span className="font-mono">[TQ.TWDFCW30K]</span> → <span className="font-mono">TWDFCW30K</span>).
                Correct any wrong match with the dropdown, or skip a line. Nothing is written until you click <span className="font-semibold">Confirm</span>.
              </p>
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-100 text-slate-500">
                      <tr>
                        <th className="px-3 py-2 text-left">Extracted Item</th>
                        <th className="px-3 py-2 text-left">Matched BOM Row</th>
                        {isPO ? (
                          <>
                            <th className="px-3 py-2 text-right">Qty</th>
                            <th className="px-3 py-2 text-left">Action</th>
                          </>
                        ) : (
                          <>
                            <th className="px-3 py-2 text-right">Slip Qty</th>
                            <th className="px-3 py-2 text-right">Cumulative</th>
                            <th className="px-3 py-2 text-right">Remaining</th>
                            <th className="px-3 py-2 text-left">Resulting Status</th>
                          </>
                        )}
                        <th className="px-3 py-2 text-center">Skip</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lineItems.map((li, i) => {
                        const m = matches[i] || { bomId: '', skipped: false };
                        const code = extractBracketCode(li.description) || li.part_number || '';
                        const bom = m.bomId ? bomById[m.bomId] : null;
                        const p = isPO ? null : rowPreview(i);
                        return (
                          <tr key={i} className={`border-t border-slate-100 ${m.skipped ? 'opacity-50' : ''}`}>
                            <td className="px-3 py-2">
                              <div className="font-medium text-slate-700">{li.description || '—'}</div>
                              <div className="font-mono text-slate-400">{code || li.item_number || ''}</div>
                            </td>
                            <td className="px-3 py-2">
                              <select value={m.bomId} onChange={e => setMatchBom(i, e.target.value)} className={inp} disabled={m.skipped}>
                                <option value="">— No match / Skip —</option>
                                {bomItems.map(b => (
                                  <option key={b.id} value={b.id}>
                                    {(b.manufacturer_part_number || b.item_code || '?')} — {(b.description || '').slice(0, 50)}
                                  </option>
                                ))}
                              </select>
                            </td>
                            {isPO ? (
                              <>
                                <td className="px-3 py-2 text-right">{Number(li.ordered_qty) || Number(li.quantity) || '—'}</td>
                                <td className="px-3 py-2"><span className="text-blue-600 font-semibold">Ordered</span></td>
                              </>
                            ) : (
                              <>
                                <td className="px-3 py-2 text-right">{p.slipDelivered || '—'}</td>
                                <td className="px-3 py-2 text-right font-medium">{m.bomId ? p.cumulative : '—'}</td>
                                <td className="px-3 py-2 text-right">{m.bomId ? p.remaining : '—'}</td>
                                <td className="px-3 py-2"><span className={m.bomId ? statusColor(p.status) : 'text-slate-400'}>{m.bomId ? statusLabel(p.status) : '—'}</span></td>
                              </>
                            )}
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