import { useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { formatDate } from '@/lib/constants';
import { Sparkles, Loader2, Check, AlertTriangle, X, Clock } from 'lucide-react';

/** Add `n` working days to an ISO date string, skipping weekends. Returns ISO. */
function addWorkingDays(iso, n) {
  const d = new Date(iso);
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d.toISOString().slice(0, 10);
}

const CONF_BADGE = {
  low: 'bg-amber-100 text-amber-700 border-amber-200',
  medium: 'bg-slate-100 text-slate-600 border-slate-200',
  high: 'bg-emerald-100 text-emerald-700 border-emerald-200',
};

/**
 * Reviews AI-estimated durations for undated WBS items. The user can edit any
 * duration (re-deriving the end date), accept/skip rows, then Apply — which
 * writes planned_start/planned_end via bulkUpdate, logs an AuditLog entry,
 * and invalidates the WBS query so the Gantt + critical path recompute.
 */
export default function EstimateDurationsModal({ projectId, onClose }) {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rows, setRows] = useState([]);
  const [accepted, setAccepted] = useState(new Set());
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await base44.functions.invoke('estimateWBSDurations', { project_id: projectId });
        const data = res.data;
        if (data?.error) { setError(data.error); return; }
        const list = data?.estimates || [];
        if (alive) {
          setRows(list);
          setAccepted(new Set(list.map((r) => r.wbs_id)));
        }
      } catch (e) {
        if (alive) setError(e?.message || 'Failed to estimate durations');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [projectId]);

  const updateDuration = useCallback((wbsId, newDur) => {
    const d = Math.max(1, Math.min(60, Math.round(Number(newDur) || 1)));
    setRows((prev) => prev.map((r) => r.wbs_id === wbsId
      ? { ...r, estimated_duration_days: d, proposed_end: addWorkingDays(r.proposed_start, d) }
      : r));
  }, []);

  function toggle(wbsId) {
    setAccepted((prev) => {
      const next = new Set(prev);
      next.has(wbsId) ? next.delete(wbsId) : next.add(wbsId);
      return next;
    });
  }

  async function apply() {
    const picks = rows.filter((r) => accepted.has(r.wbs_id));
    if (picks.length === 0 || applying) return;
    setApplying(true);
    setError('');
    try {
      await base44.entities.WBSItem.bulkUpdate(
        picks.map((r) => ({ id: r.wbs_id, planned_start: r.proposed_start, planned_end: r.proposed_end }))
      );

      let actor = 'user';
      try { const me = await base44.auth.me(); if (me?.full_name) actor = me.full_name; } catch (_) {}

      await base44.entities.AuditLog.create({
        project_id: projectId,
        entity_type: 'WBSItem',
        entity_id: picks[0].wbs_id,
        action: 'updated',
        actor,
        summary: `AI-estimated durations applied to ${picks.length} WBS item(s)`,
        metadata: {
          source: 'ai_estimate_durations',
          changes: picks.map((r) => ({
            wbs_id: r.wbs_id,
            wbs_code: r.wbs_code,
            planned_start: r.proposed_start,
            planned_end: r.proposed_end,
            estimated_days: r.estimated_duration_days,
            confidence: r.confidence,
          })),
        },
      });

      queryClient.invalidateQueries({ queryKey: ['WBSItem'] });
      setApplied(true);
      setTimeout(onClose, 900);
    } catch (e) {
      setError(e?.message || 'Failed to apply');
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[88vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-200">
          <div className="w-8 h-8 bg-amber-50 rounded-lg flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-amber-500" />
          </div>
          <div className="flex-1">
            <div className="font-semibold text-slate-800 text-sm">AI: Estimate Durations</div>
            <div className="text-[11px] text-slate-400">Proposed working-day durations for undated activities — review before applying</div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin mb-3 text-amber-500" />
              <p className="text-sm">Analyzing the project's dated tasks to calibrate estimates…</p>
            </div>
          ) : error ? (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
              <Check className="w-10 h-10 mb-3 text-emerald-400" />
              <p className="text-sm">Every WBS activity already has a duration — nothing to estimate.</p>
            </div>
          ) : (
            <table className="w-full text-xs min-w-[820px]">
              <thead className="bg-slate-100 text-slate-500 uppercase">
                <tr>
                  <th className="px-2 py-2 w-8"></th>
                  <th className="px-2 py-2 text-left">WBS</th>
                  <th className="px-2 py-2 text-left">Activity</th>
                  <th className="px-2 py-2 text-left">Predecessors</th>
                  <th className="px-2 py-2 text-left">Proposed Start</th>
                  <th className="px-2 py-2 text-left">Proposed End</th>
                  <th className="px-2 py-2 text-center w-20">Days</th>
                  <th className="px-2 py-2 text-left">Reason</th>
                  <th className="px-2 py-2 text-center">Conf.</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isLow = r.confidence === 'low';
                  return (
                    <tr key={r.wbs_id} className={`border-t border-slate-100 ${accepted.has(r.wbs_id) ? 'bg-amber-50/50' : 'bg-white'}`}>
                      <td className="px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          disabled={applied}
                          checked={accepted.has(r.wbs_id)}
                          onChange={() => toggle(r.wbs_id)}
                          className="w-3.5 h-3.5 accent-amber-500"
                        />
                      </td>
                      <td className="px-2 py-2 font-mono text-slate-500 whitespace-nowrap">{r.wbs_code}</td>
                      <td className="px-2 py-2 text-slate-700 max-w-[180px] truncate" title={r.item_name}>{r.item_name}</td>
                      <td className="px-2 py-2 text-slate-500 max-w-[140px] truncate" title={r.predecessors}>{r.predecessors || '—'}</td>
                      <td className="px-2 py-2 text-slate-600 whitespace-nowrap">
                        {r.had_planned_start ? <span className="text-slate-400 italic">(kept)</span> : null} {formatDate(r.proposed_start)}
                      </td>
                      <td className="px-2 py-2 text-slate-800 font-medium whitespace-nowrap">{formatDate(r.proposed_end)}</td>
                      <td className="px-2 py-2 text-center">
                        <input
                          type="number"
                          min={1}
                          max={60}
                          disabled={applied}
                          value={r.estimated_duration_days}
                          onChange={(e) => updateDuration(r.wbs_id, e.target.value)}
                          className="w-14 text-center border border-slate-200 rounded px-1 py-1 focus:outline-none focus:ring-1 focus:ring-amber-400 disabled:bg-slate-50"
                        />
                      </td>
                      <td className={`px-2 py-2 max-w-[200px] ${isLow ? 'text-amber-700' : 'text-slate-500'}`}>{r.reason}</td>
                      <td className="px-2 py-2 text-center">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold border ${CONF_BADGE[r.confidence] || CONF_BADGE.medium}`}>
                          {r.confidence}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        {!loading && !error && rows.length > 0 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200 bg-slate-50">
            <div className="flex items-center gap-2 text-[11px] text-slate-500">
              <Clock className="w-3.5 h-3.5" />
              Low-confidence rows are amber — double-check those durations.
              <span className="text-slate-400">·</span>
              {rows.filter((r) => r.confidence === 'low').length} low confidence
            </div>
            {applied ? (
              <span className="flex items-center gap-1.5 text-sm font-semibold text-emerald-600">
                <Check className="w-4 h-4" /> Applied — Gantt updated
              </span>
            ) : (
              <button
                onClick={apply}
                disabled={applying || accepted.size === 0}
                className="flex items-center gap-1.5 px-5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 text-sm font-semibold rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {applying ? 'Applying…' : `Apply (${accepted.size})`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}