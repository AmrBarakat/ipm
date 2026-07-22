import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { formatDate } from '@/lib/constants';
import { Check, Loader2, CalendarClock, ArrowRight, AlertTriangle, Sparkles } from 'lucide-react';

/**
 * Renders proposed schedule changes from a scheduleChat assistant reply as a
 * review table. The user ticks rows and clicks "Apply selected" — nothing is
 * written until then. On apply, writes planned_start/planned_end to the chosen
 * WBS items, logs an AuditLog entry, and invalidates the WBS query so the Gantt
 * and WBS tab refresh.
 */
const CONF_STYLE = {
  high: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  medium: 'bg-amber-100 text-amber-700 border-amber-200',
  low: 'bg-slate-100 text-slate-500 border-slate-200',
};

export default function ScheduleProposedChanges({ proposedChanges, impact, conflictsFound, conflictsResolved, rejected, projectId }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState(new Set(proposedChanges.map((c) => c.wbs_item_id)));
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState('');

  if (!proposedChanges || proposedChanges.length === 0) return null;

  // Guard: never allow apply if any proposed row has end < start (should not
  // happen after server validation, but guard anyway).
  const hasInvalidDates = proposedChanges.some((c) => c.proposed_end && c.proposed_start && c.proposed_end < c.proposed_start);
  const rejectedList = Array.isArray(rejected) ? rejected : [];

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function applySelected() {
    const picks = proposedChanges.filter((c) => selected.has(c.wbs_item_id));
    if (picks.length === 0 || applying) return;
    setApplying(true);
    setError('');
    try {
      await base44.entities.WBSItem.bulkUpdate(
        picks.map((c) => ({
          id: c.wbs_item_id,
          planned_start: c.proposed_start,
          planned_end: c.proposed_end,
        }))
      );

      let actor = 'user';
      try { const me = await base44.auth.me(); if (me?.full_name) actor = me.full_name; } catch (_) {}

      await base44.entities.AuditLog.create({
        project_id: projectId,
        entity_type: 'WBSItem',
        entity_id: picks[0].wbs_item_id,
        action: 'updated',
        actor,
        summary: `Applied ${picks.length} schedule change(s) via assistant`,
        metadata: {
          changes: picks.map((c) => ({
            wbs_item_id: c.wbs_item_id,
            wbs_code: c.wbs_code,
            from: `${c.current_start} → ${c.current_end}`,
            to: `${c.proposed_start} → ${c.proposed_end}`,
            reason: c.reason,
          })),
        },
      });

      queryClient.invalidateQueries({ queryKey: ['WBSItem'] });
      setApplied(true);
    } catch (e) {
      setError(e?.message || 'Failed to apply changes');
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="mt-3 border border-amber-200 rounded-xl overflow-hidden bg-amber-50/40">
      <div className="flex items-center gap-2 px-3 py-2 bg-amber-100/70 border-b border-amber-200">
        <Sparkles className="w-4 h-4 text-amber-600" />
        <span className="text-xs font-semibold text-amber-800">
          Proposed schedule changes ({proposedChanges.length})
        </span>
        {rejectedList.length > 0 && (
          <span
            className="ml-auto text-[10px] text-slate-500 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5 cursor-help"
            title={rejectedList.map((r) => `${r.wbs_code || r.wbs_item_id || '?'}: ${r.reason}`).join('\n')}
          >
            {rejectedList.length} filtered for consistency
          </span>
        )}
        {conflictsFound > 0 && (
          <span className={`text-[10px] text-amber-700 ${rejectedList.length === 0 ? 'ml-auto' : ''}`}>
            {conflictsResolved}/{conflictsFound} conflicts resolved
          </span>
        )}
      </div>

      {impact?.projected_finish && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-3 py-2 bg-white border-b border-amber-100 text-xs">
          <span className="flex items-center gap-1.5 text-slate-600">
            <CalendarClock className="w-3.5 h-3.5 text-slate-400" />
            Projected finish: <b className="text-slate-800">{formatDate(impact.projected_finish)}</b>
          </span>
          {impact.days_delta ? (
            <span className={`flex items-center gap-1 font-semibold ${impact.days_delta <= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {impact.days_delta <= 0 ? 'Saves' : 'Adds'} {Math.abs(impact.days_delta)} day{Math.abs(impact.days_delta) === 1 ? '' : 's'}
            </span>
          ) : null}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[640px]">
          <thead className="bg-amber-50 text-amber-700 uppercase">
            <tr>
              <th className="px-2 py-1.5 w-8"></th>
              <th className="px-2 py-1.5 text-left">WBS</th>
              <th className="px-2 py-1.5 text-left">Task</th>
              <th className="px-2 py-1.5 text-left">Current</th>
              <th className="px-2 py-1.5 text-left"></th>
              <th className="px-2 py-1.5 text-left">Proposed</th>
              <th className="px-2 py-1.5 text-left">Conf.</th>
              <th className="px-2 py-1.5 text-left">Reason</th>
            </tr>
          </thead>
          <tbody>
            {proposedChanges.map((c) => (
              <tr key={c.wbs_item_id} className="border-t border-amber-100 bg-white">
                <td className="px-2 py-1.5 text-center">
                  <input
                    type="checkbox"
                    disabled={applied}
                    checked={selected.has(c.wbs_item_id)}
                    onChange={() => toggle(c.wbs_item_id)}
                    className="w-3.5 h-3.5 accent-amber-500"
                  />
                </td>
                <td className="px-2 py-1.5 font-mono text-slate-500">{c.wbs_code}</td>
                <td className="px-2 py-1.5 text-slate-700 max-w-[160px] truncate" title={c.item_name}>{c.item_name}</td>
                <td className="px-2 py-1.5 text-slate-500 whitespace-nowrap">{formatDate(c.current_start)} → {formatDate(c.current_end)}</td>
                <td className="px-2 py-1.5 text-center text-slate-300"><ArrowRight className="w-3.5 h-3.5 inline" /></td>
                <td className="px-2 py-1.5 text-slate-800 font-medium whitespace-nowrap">{formatDate(c.proposed_start)} → {formatDate(c.proposed_end)}</td>
                <td className="px-2 py-1.5">
                  {c.confidence ? (
                    <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded border ${CONF_STYLE[c.confidence] || CONF_STYLE.low}`}>
                      {c.confidence}
                    </span>
                  ) : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-2 py-1.5 text-slate-500 max-w-[220px]">{c.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && (
        <div className="flex items-center gap-1.5 px-3 py-2 text-xs text-red-600 bg-red-50 border-t border-red-100">
          <AlertTriangle className="w-3.5 h-3.5" /> {error}
        </div>
      )}

      <div className="flex items-center justify-between px-3 py-2 bg-white border-t border-amber-100">
        <span className="text-[11px] text-slate-400">Nothing is saved until you apply.</span>
        {applied ? (
          <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
            <Check className="w-4 h-4" /> Applied — Gantt updated
          </span>
        ) : (
          <button
            onClick={applySelected}
            disabled={applying || selected.size === 0 || hasInvalidDates}
            title={hasInvalidDates ? 'A proposed change has end before start' : undefined}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-900 text-xs font-semibold rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {applying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            {applying ? 'Applying…' : `Apply selected (${selected.size})`}
          </button>
        )}
      </div>
    </div>
  );
}