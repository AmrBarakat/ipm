import { useCallback } from 'react';
import { formatDate } from '@/lib/constants';
import { Check, AlertTriangle, Clock } from 'lucide-react';

const CONF_BADGE = {
  low: 'bg-amber-100 text-amber-700 border-amber-200',
  medium: 'bg-slate-100 text-slate-600 border-slate-200',
  high: 'bg-emerald-100 text-emerald-700 border-emerald-200',
};

/**
 * Embeddable AI duration-estimation review table. Now PARENT-DRIVEN: rows are
 * passed in (from the single smartScheduleAnalysis response) and selection /
 * duration edits are reported back up so the parent can apply everything in one
 * atomic batch. No fetch, no apply button here.
 *
 * Props: rows, accepted (Set<wbs_id>), onToggle(wbsId), onUpdateDuration(wbsId, days), notice?
 */
export default function EstimateDurationsReview({ rows = [], accepted, onToggle, onUpdateDuration, notice }) {
  const updateDuration = useCallback((wbsId, newDur) => {
    const d = Math.max(1, Math.min(60, Math.round(Number(newDur) || 1)));
    onUpdateDuration?.(wbsId, d);
  }, [onUpdateDuration]);

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-slate-400">
        <Check className="w-8 h-8 mb-2 text-emerald-400" />
        <p className="text-sm">Every WBS activity already has a duration — nothing to estimate.</p>
      </div>
    );
  }

  const lowCount = rows.filter((r) => r.confidence === 'low').length;

  return (
    <div className="space-y-3">
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
              const isAcc = accepted.has(r.wbs_id);
              return (
                <tr key={r.wbs_id} className={`border-t border-slate-100 ${isLow ? 'bg-amber-50' : isAcc ? 'bg-amber-50/30' : 'bg-white'}`}>
                  <td className="px-2 py-2 text-center">
                    <input type="checkbox" checked={isAcc} onChange={() => onToggle?.(r.wbs_id)} className="w-3.5 h-3.5 accent-amber-500" />
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
                        type="number" min={1} max={60}
                        value={r.estimated_duration_days}
                        onChange={(e) => updateDuration(r.wbs_id, e.target.value)}
                        className="w-14 text-center border border-slate-200 rounded px-1 py-1 focus:outline-none focus:ring-1 focus:ring-amber-400"
                      />
                    )}
                  </td>
                  <td className={`px-2 py-2 max-w-[200px] ${isLow ? 'text-amber-700' : 'text-slate-500'}`}>{r.reason}</td>
                  <td className="px-2 py-2 text-center">
                    {r.is_rollup ? (
                      <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-indigo-50 text-indigo-600 border-indigo-200">rollup</span>
                    ) : (
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold border ${CONF_BADGE[r.confidence] || CONF_BADGE.medium}`}>{r.confidence}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-slate-500 px-1">
        <Clock className="w-3.5 h-3.5" />
        Low-confidence rows are amber — double-check those durations.
        <span className="text-slate-400">·</span>
        {lowCount} low confidence · {accepted.size} selected
      </div>
    </div>
  );
}