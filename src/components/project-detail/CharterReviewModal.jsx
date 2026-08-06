/**
 * CharterReviewModal — review + activate / revert a charter baseline extraction.
 *
 * Modeled on BOMExtractionPreviewModal + the PO/DN extraction lifecycle:
 *   - extractCharterBaseline creates Extraction (status "review") + CharterBaseline (draft)
 *   - This modal reads the result, user confirms → applyCharterBaseline flips
 *     Extraction to "completed" and activates the CharterBaseline.
 *   - Revert → revertCharterBaseline sets Extraction "reverted", CharterBaseline
 *     "superseded", clears Project.active_charter_baseline_id.
 *
 * UI contract:
 *   1. Integrity panel first and non-collapsible.
 *   2. Per-warning acknowledgement gating the Activate button.
 *   3. Identity field checkboxes — never overwrite a populated Project field with a blank.
 *   4. As-printed vs de-duplicated column pair.
 *   5. Reconciliation row.
 *   6. Editable expense_category dropdown.
 */
import { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { formatCurrency } from '@/lib/constants';
import {
  X, Loader2, CheckCircle2, AlertTriangle, ShieldCheck, FileText,
  Check, Save, RotateCcw, Lock,
} from 'lucide-react';
import { toast } from 'sonner';

const INP = 'border border-slate-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400 bg-white w-full';
const INP_NUM = 'border border-slate-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400 bg-white text-right w-full';

const STREAM_LABELS = { goods: 'Goods', services: 'Services', support: 'Support' };
const LINE_TYPE_LABELS = { revenue: 'Revenue', direct_cost: 'Direct Cost', indirect_cost: 'Indirect Cost' };
const EXPENSE_CATEGORIES = [
  { value: 'material', label: 'Material' },
  { value: 'labor', label: 'Labor' },
  { value: 'subcontract', label: 'Subcontract' },
  { value: 'travel', label: 'Travel' },
  { value: 'other', label: 'Other' },
];

const IDENTITY_FIELDS = [
  { identity: 'project_name', project: 'name', label: 'Project Name' },
  { identity: 'client', project: 'client', label: 'Client' },
  { identity: 'project_manager', project: 'project_manager', label: 'Project Manager' },
  { identity: 'currency', project: 'currency', label: 'Currency' },
];

function fmtAmt(v) {
  const n = Number(v ?? 0);
  if (!n && n !== 0) return '—';
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);
}

export default function CharterReviewModal({ document: doc, result, projectId, project, onClose, onApplied }) {
  const initialProposals = result?.proposals || [];
  const identity = result?.identity || {};
  const totals = result?.totals || {};
  const reconciliation = result?.reconciliation || {};
  const warnings = result?.warnings || [];

  const [proposals, setProposals] = useState(initialProposals.map(p => ({
    ...p,
    payload: p.payload || p,
  })));
  const [acknowledged, setAcknowledged] = useState(new Set());
  const [identityChecks, setIdentityChecks] = useState({});
  const [activating, setActivating] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const extraction_id = result?.extraction_id;
  const baseline_id = result?.baseline_id;

  // ── De-duplicated proposals: group by description + stream + line_type ─────
  const { dedupedGroups, asPrintedTotal, dedupedTotal } = useMemo(() => {
    const groups = {};
    for (const p of proposals) {
      const key = `${p.payload.stream || 'goods'}|${p.payload.line_type || 'revenue'}|${(p.payload.description || '').trim().toLowerCase()}`;
      if (!groups[key]) groups[key] = { key, stream: p.payload.stream, line_type: p.payload.line_type, description: p.payload.description, asPrintedRows: [], asPrintedSum: 0, dedupedAmount: 0, expense_category: p.payload.expense_category || 'material', sort_order: p.payload.sort_order || 0 };
      groups[key].asPrintedRows.push(p);
      groups[key].asPrintedSum += Number(p.payload.amount) || 0;
    }
    const arr = Object.values(groups).map(g => ({ ...g, dedupedAmount: g.asPrintedSum }));
    const apTotal = arr.reduce((s, g) => s + g.asPrintedSum, 0);
    const ddTotal = arr.reduce((s, g) => s + (Number(g.dedupedAmount) || 0), 0);
    return { dedupedGroups: arr.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)), asPrintedTotal: apTotal, dedupedTotal: ddTotal };
  }, [proposals]);

  const allAcknowledged = warnings.length === 0 || acknowledged.size === warnings.length;

  // ── Warning acknowledgement ───────────────────────────────────────────────
  function toggleWarning(idx) {
    setAcknowledged(prev => {
      const n = new Set(prev);
      n.has(idx) ? n.delete(idx) : n.add(idx);
      return n;
    });
  }

  function toggleIdentityCheck(field) {
    setIdentityChecks(prev => ({ ...prev, [field]: !prev[field] }));
  }

  // ── Inline edit on de-duplicated groups ───────────────────────────────────
  function updateDedupedGroup(key, field, value) {
    setProposals(prev => prev.map(p => {
      const pkey = `${p.payload.stream || 'goods'}|${p.payload.line_type || 'revenue'}|${(p.payload.description || '').trim().toLowerCase()}`;
      if (pkey !== key) return p;
      return { ...p, payload: { ...p.payload, [field]: value } };
    }));
  }

  // ── Activate ──────────────────────────────────────────────────────────────
  async function activate() {
    if (!allAcknowledged) return;
    setActivating(true);
    setError('');
    try {
      // Build proposals payload from the de-duplicated groups
      const proposalsPayload = dedupedGroups.map(g => ({
        payload: {
          stream: g.stream,
          line_type: g.line_type,
          description: g.description,
          amount: Number(g.dedupedAmount) || 0,
          currency: identity.currency || 'SAR',
          sort_order: g.sort_order,
          source_ref: '',
          expense_category: g.expense_category,
        },
        status: 'pending',
      }));

      const res = await base44.functions.invoke('applyCharterBaseline', {
        extraction_id,
        project_id: projectId,
        identity_updates: identityChecks,
        proposals: proposalsPayload,
      });
      if (res?.data?.error) throw new Error(res.data.error);
      setDone(true);
      toast.success(`Charter baseline activated — ${res?.data?.line_count ?? 0} line items`);
      setTimeout(() => { onApplied?.(); onClose?.(); }, 1500);
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Activation failed.');
    } finally {
      setActivating(false);
    }
  }

  // ── Revert ────────────────────────────────────────────────────────────────
  async function revert() {
    setReverting(true);
    setError('');
    try {
      const res = await base44.functions.invoke('revertCharterBaseline', { extraction_id });
      if (res?.data?.error) throw new Error(res.data.error);
      toast.success('Charter baseline reverted');
      onApplied?.();
      onClose?.();
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Revert failed.');
    } finally {
      setReverting(false);
    }
  }

  const reconStatus = reconciliation.status || 'unverified';
  const reconColor = reconStatus === 'ok' ? 'bg-emerald-100 text-emerald-700'
    : reconStatus === 'warning' ? 'bg-amber-100 text-amber-700'
    : reconStatus === 'error' ? 'bg-red-100 text-red-700'
    : 'bg-slate-100 text-slate-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[95vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div>
            <h2 className="font-bold text-slate-800 text-lg flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-500" /> Charter Baseline Review
            </h2>
            <p className="text-xs text-slate-400 mt-0.5 truncate max-w-xl">
              {doc?.title || result?.sheet || 'Charter'} · Rev {identity.revision_label || 'Rev 0'}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-6 space-y-5">

          {done ? (
            <div className="text-center py-20">
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
              <h3 className="font-semibold text-slate-700 text-lg">Charter baseline activated!</h3>
            </div>
          ) : (
            <>

              {/* ── 1. Integrity panel (non-collapsible, first) ─────────────── */}
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                  <ShieldCheck className="w-4 h-4 text-slate-500" />
                  <h3 className="font-semibold text-slate-700 text-sm">Integrity Checks</h3>
                  {warnings.length > 0 && (
                    <span className="text-xs bg-amber-100 text-amber-700 rounded-full px-2 py-0.5 font-semibold">{warnings.length} warning{warnings.length !== 1 ? 's' : ''}</span>
                  )}
                  {warnings.length === 0 && (
                    <span className="text-xs bg-emerald-100 text-emerald-700 rounded-full px-2 py-0.5 font-semibold">All checks passed</span>
                  )}
                </div>
                <div className="p-4 space-y-2">
                  {warnings.length === 0 ? (
                    <div className="flex items-center gap-2 text-sm text-emerald-600">
                      <CheckCircle2 className="w-4 h-4" /> No integrity warnings detected.
                    </div>
                  ) : (
                    warnings.map((w, idx) => (
                      <div key={idx} className={`flex items-start gap-3 rounded-lg p-3 ${acknowledged.has(idx) ? 'bg-emerald-50 border border-emerald-200' : 'bg-amber-50 border border-amber-200'}`}>
                        <button onClick={() => toggleWarning(idx)} className="mt-0.5 shrink-0">
                          <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${acknowledged.has(idx) ? 'bg-emerald-500 border-emerald-500' : 'border-amber-300'}`}>
                            {acknowledged.has(idx) && <Check className="w-3 h-3 text-white" />}
                          </div>
                        </button>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                            <span className="text-sm text-slate-700 font-medium">{w}</span>
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">Acknowledge this warning to proceed with activation.</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* ── 2. Identity fields with checkboxes ───────────────────────── */}
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                  <FileText className="w-4 h-4 text-slate-500" />
                  <h3 className="font-semibold text-slate-700 text-sm">Identity Block</h3>
                  <span className="text-xs text-slate-400">Check a field to update the Project — blanks are never written.</span>
                </div>
                <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                  {IDENTITY_FIELDS.map(({ identity: field, project: projField, label }) => {
                    const charterVal = identity[field];
                    const projectVal = project?.[projField];
                    const checked = !!identityChecks[field];
                    const isBlank = charterVal == null || String(charterVal).trim() === '';
                    return (
                      <div key={field} className={`flex items-center gap-3 rounded-lg p-2.5 border ${checked ? 'bg-blue-50 border-blue-200' : 'bg-white border-slate-100'}`}>
                        <button onClick={() => toggleIdentityCheck(field)} disabled={isBlank}
                          className="shrink-0">
                          <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${checked ? 'bg-blue-500 border-blue-500' : 'border-slate-300'} ${isBlank ? 'opacity-40 cursor-not-allowed' : ''}`}>
                            {checked && <Check className="w-3 h-3 text-white" />}
                          </div>
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-slate-400 uppercase tracking-wide">{label}</div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-slate-700 font-medium truncate">{charterVal || <span className="text-slate-300 italic">blank</span>}</span>
                            {projectVal && (
                              <span className="text-xs text-slate-400 truncate">→ current: {projectVal}</span>
                            )}
                          </div>
                        </div>
                        {isBlank && <Lock className="w-3 h-3 text-slate-300" title="Blank value — cannot overwrite Project field" />}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ── 3. Six totals grid ───────────────────────────────────────── */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {[
                  { label: 'Revenue — Goods', val: totals.revenue_goods },
                  { label: 'Revenue — Services', val: totals.revenue_services },
                  { label: 'Revenue — Support', val: totals.revenue_support },
                  { label: 'Direct Cost — Goods', val: totals.direct_cost_goods },
                  { label: 'Direct Cost — Services', val: totals.direct_cost_services },
                  { label: 'Direct Cost — Support', val: totals.direct_cost_support },
                ].map(t => (
                  <div key={t.label} className="bg-white border border-slate-200 rounded-lg p-3">
                    <div className="text-xs text-slate-400 uppercase tracking-wide">{t.label}</div>
                    <div className="text-lg font-semibold text-slate-800">{fmtAmt(t.val)}</div>
                  </div>
                ))}
              </div>

              {/* ── 4. Reconciliation row ────────────────────────────────────── */}
              <div className="flex items-center gap-4 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-sm">
                <span className={`text-xs px-2 py-0.5 rounded font-semibold uppercase ${reconColor}`}>{reconStatus}</span>
                <span className="text-slate-600">Source Total: <span className="font-semibold text-slate-800">{fmtAmt(reconciliation.source_total)}</span></span>
                <span className="text-slate-400">·</span>
                <span className="text-slate-600">Calculated: <span className="font-semibold text-slate-800">{fmtAmt(reconciliation.calculated_total)}</span></span>
                <span className="text-slate-400">·</span>
                <span className="text-slate-600">Variance: <span className={`font-semibold ${Math.abs(reconciliation.variance_pct || 0) > 0.05 ? 'text-red-600' : 'text-emerald-600'}`}>{fmtAmt(reconciliation.variance)} ({((reconciliation.variance_pct || 0) * 100).toFixed(1)}%)</span></span>
              </div>

              {error && <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded p-3">{error}</div>}

              {/* ── 5. Proposals table — as-printed vs de-duplicated ─────────── */}
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="overflow-auto max-h-[40vh]">
                  <table className="w-full text-xs min-w-[900px]">
                    <thead className="bg-slate-800 text-white sticky top-0 z-10">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">Description</th>
                        <th className="px-2 py-2 text-left font-semibold w-24">Stream</th>
                        <th className="px-2 py-2 text-left font-semibold w-28">Line Type</th>
                        <th className="px-2 py-2 text-right font-semibold w-28">As Printed</th>
                        <th className="px-2 py-2 text-right font-semibold w-28">De-duplicated</th>
                        <th className="px-2 py-2 text-left font-semibold w-32">Expense Category</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dedupedGroups.map((g) => (
                        <tr key={g.key} className="border-t border-slate-100 hover:bg-slate-50/60">
                          <td className="px-3 py-1.5">
                            <input value={g.description || ''} onChange={e => updateDedupedGroup(g.key, 'description', e.target.value)} className={INP + ' font-medium'} />
                          </td>
                          <td className="px-2 py-1.5">
                            <select value={g.stream || 'goods'} onChange={e => updateDedupedGroup(g.key, 'stream', e.target.value)} className={INP}>
                              {Object.entries(STREAM_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                          </td>
                          <td className="px-2 py-1.5">
                            <select value={g.line_type || 'revenue'} onChange={e => updateDedupedGroup(g.key, 'line_type', e.target.value)} className={INP}>
                              {Object.entries(LINE_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                          </td>
                          <td className="px-2 py-1.5 text-right text-slate-500">
                            {fmtAmt(g.asPrintedSum)}{g.asPrintedRows.length > 1 && <span className="text-[10px] text-slate-400"> ({g.asPrintedRows.length} rows)</span>}
                          </td>
                          <td className="px-2 py-1.5">
                            <input type="number" min="0" step="0.01" value={g.dedupedAmount}
                              onChange={e => {
                                const v = e.target.value === '' ? 0 : Number(e.target.value);
                                setProposals(prev => prev.map(p => {
                                  const pkey = `${p.payload.stream || 'goods'}|${p.payload.line_type || 'revenue'}|${(p.payload.description || '').trim().toLowerCase()}`;
                                  if (pkey !== g.key) return p;
                                  return { ...p, payload: { ...p.payload, amount: v } };
                                }));
                              }}
                              className={INP_NUM + ' font-semibold'} />
                          </td>
                          <td className="px-2 py-1.5">
                            <select value={g.expense_category || 'material'} onChange={e => updateDedupedGroup(g.key, 'expense_category', e.target.value)} className={INP}>
                              {EXPENSE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t-2 border-slate-300 bg-slate-50">
                      <tr>
                        <td colSpan={3} className="px-3 py-2 text-xs text-slate-500 font-semibold">Total ({dedupedGroups.length} de-duplicated groups)</td>
                        <td className="px-2 py-2 text-right text-xs font-semibold text-slate-600">{fmtAmt(asPrintedTotal)}</td>
                        <td className="px-2 py-2 text-right text-xs font-semibold text-slate-800">{fmtAmt(dedupedTotal)}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {dedupedGroups.length === 0 && (
                <div className="text-center py-8 text-slate-400">
                  <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No line items were parsed from this charter. You can still activate the baseline header.</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!done && (
          <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between shrink-0 bg-slate-50">
            <button onClick={onClose}
              className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-slate-100">
              Cancel
            </button>
            <div className="flex items-center gap-3">
              <button onClick={revert} disabled={reverting}
                className="flex items-center gap-2 px-4 py-2 border border-red-300 text-red-600 text-sm rounded-lg hover:bg-red-50 font-medium disabled:opacity-40">
                {reverting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                Revert
              </button>
              <button onClick={activate} disabled={!allAcknowledged || activating}
                className="flex items-center gap-2 px-6 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded-lg disabled:opacity-40 disabled:cursor-not-allowed">
                {activating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {allAcknowledged ? 'Activate Baseline' : 'Acknowledge warnings to activate'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}