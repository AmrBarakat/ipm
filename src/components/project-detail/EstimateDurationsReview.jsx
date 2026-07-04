import { useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { formatDate } from '@/lib/constants';
import { Loader2, Check, AlertTriangle, Clock } from 'lucide-react';

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
 * Embeddable AI duration-estimation review. Fetches estimates for undated WBS
 * items, lets the user edit any duration (re-deriving the end date), accept/skip
 * rows, then Apply — which writes planned_start/planned_end via bulkUpdate,
 * logs an AuditLog entry, invalidates the WBS query, and calls onApplied.
 */
export default function EstimateDurationsReview({ projectId, onApplied }) {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rows, setRows] = useState([]);
  const [accepted, setAccepted] = useState(new Set());
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [notice, setNotice] = useState('');

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
          setNotice(data?.notice || '');
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
      setTimeout(() => onApplied?.(), 800);
    } catch (e) {
      setError(e?.message || 'Failed to apply');
    } finally {
      setApplying(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-400">
        <Loader2 className="w-8 h-8 animate-spin mb-3 text-amber-500" />
        <p className="text-sm">Analyzing the project's dated tasks to calibrate estimates…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-400">
        <Check className="w-10 h-10 mb-3 text-emerald-400" />
        <p className="text-sm">Every WBS activity already has a duration — nothing to estimate.</p>
      </div>
    );
  }

  const lowCount = rows.filter((r) => r.confidence === 'low').length;

  return (
    <div className="space-y-4">
      {notice && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-300 rounded-lg px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {notice}
        </div>
      )}
      <div className="overflow-x-auto">
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
                <tr key={r.wbs_id} className={`border-t border-slate-100 ${isLow ? 'bg-amber-50' : accepted.has(r.wbs_id) ? 'bg-amber-50/30' : 'bg-white'}`}>
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
                    {r.is_rollup ? (
                      <span className="text-slate-500 text-xs">{r.estimated_duration_days}</span>
                    ) : (
                      <input
                        type="number"
                        min={1}
                        max={60}
                        disabled={applied}
                        value={r.estimated_duration_days}
                        onChange={(e) => updateDuration(r.wbs_id, e.target.value)}
                        className="w-14 text-center border border-slate-200 rounded px-1 py-1 focus:outline-none focus:ring-1 focus:ring-amber-400 disabled:bg-slate-50"
                      />
                    )}
                  </td>
                  <td className={`px-2 py-2 max-w-[200px] ${isLow ? 'text-amber-700' : 'text-slate-500'}`}>{r.reason}</td>
                  <td className="px-2 py-2 text-center">
                    {r.is_rollup ? (
                      <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-indigo-50 text-indigo-600 border-indigo-200">
                        rollup
                      </span>
                    ) : (
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold border ${CONF_BADGE[r.confidence] || CONF_BADGE.medium}`}>
                        {r.confidence}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          <Clock className="w-3.5 h-3.5" />
          Low-confidence rows are amber — double-check those durations.
          <span className="text-slate-400">·</span>
          {lowCount} low confidence
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
    </div>
  );
}