import { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';
import { X, Loader2, Wand2, Link2, AlertTriangle, Check } from 'lucide-react';

const inp = 'border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white w-full';

/**
 * Auto-link review UI. Calls suggestMilestoneLinks to score every unlinked leaf
 * WBS item against the project's milestones, shows a coverage panel (orphans +
 * empty milestones) and a review table with override + include, then bulk-applies
 * the selected links and re-runs the WBS→milestone rollup.
 */
export default function MilestoneLinkModal({ projectId, onClose, onApplied }) {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [milestones, setMilestones] = useState([]);
  const [sel, setSel] = useState({}); // wbs_id -> { include, milestone_id }
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const [linkRes, msList] = await Promise.all([
          base44.functions.invoke('suggestMilestoneLinks', { project_id: projectId }),
          base44.entities.Milestone.filter({ project_id: projectId }, 'planned_date', 1000),
        ]);
        if (cancelled) return;
        const payload = linkRes?.data ?? linkRes;
        setData(payload);
        setMilestones(msList || []);
        const init = {};
        (payload?.suggestions || []).forEach((s) => {
          init[s.wbs_id] = { include: !!s.auto, milestone_id: s.best?.milestone_id || '' };
        });
        setSel(init);
      } catch (e) {
        setError(e?.response?.data?.error || e?.message || 'Failed to load suggestions');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  const sortedSuggestions = useMemo(
    () => [...(data?.suggestions || [])].sort((a, b) => (b.best?.score || 0) - (a.best?.score || 0)),
    [data]
  );

  function setInclude(id, val) { setSel((p) => ({ ...p, [id]: { ...p[id], include: val } })); }
  function setMilestone(id, mid) { setSel((p) => ({ ...p, [id]: { ...p[id], milestone_id: mid } })); }

  async function applyChecked() {
    const toApply = Object.entries(sel)
      .filter(([, v]) => v.include && v.milestone_id)
      .map(([id, v]) => ({ id, milestone_id: v.milestone_id }));
    if (toApply.length === 0) return;
    setApplying(true);
    try {
      await base44.entities.WBSItem.bulkUpdate(toApply);
      await base44.functions.invoke('syncWBSProgress', { project_id: projectId }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: ['WBSItem'] });
      queryClient.invalidateQueries({ queryKey: ['Milestone'] });
      onApplied?.();
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Apply failed');
    } finally {
      setApplying(false);
    }
  }

  const checkedCount = Object.values(sel).filter((v) => v.include && v.milestone_id).length;
  const cov = data?.coverage;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
            <Wand2 className="w-4 h-4 text-amber-500" /> Auto-link WBS items to Milestones
          </h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded"><X className="w-4 h-4" /></button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-amber-500" /></div>
        ) : error ? (
          <div className="flex-1 p-5 text-sm text-red-600 flex items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0" /> {error}</div>
        ) : (
          <>
            {cov && (
              <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="font-semibold text-slate-700 text-xs uppercase tracking-wide mb-1">
                    {cov.orphan_count} WBS item{cov.orphan_count !== 1 ? 's' : ''} unlinked
                  </div>
                  {cov.orphans?.length > 0 ? (
                    <ul className="text-xs text-slate-500 max-h-24 overflow-auto space-y-0.5">
                      {cov.orphans.map((o) => <li key={o.wbs_id} className="font-mono">{o.wbs_code} — {o.name}</li>)}
                    </ul>
                  ) : <span className="text-xs text-emerald-600">All leaf items have a confident link.</span>}
                </div>
                <div>
                  <div className="font-semibold text-slate-700 text-xs uppercase tracking-wide mb-1">
                    {cov.empty_milestones} milestone{cov.empty_milestones !== 1 ? 's' : ''} with no items
                  </div>
                  {cov.empty_milestone_list?.length > 0 ? (
                    <ul className="text-xs text-slate-500 max-h-24 overflow-auto space-y-0.5">
                      {cov.empty_milestone_list.map((m) => (
                        <li key={m.milestone_id} className="flex items-center gap-1"><Link2 className="w-3 h-3 shrink-0" /> {m.title} {m.planned_date && <span className="text-slate-400">· {m.planned_date}</span>}</li>
                      ))}
                    </ul>
                  ) : <span className="text-xs text-emerald-600">Every milestone has linked items.</span>}
                </div>
              </div>
            )}

            <div className="flex-1 overflow-auto px-5 py-3">
              {sortedSuggestions.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">No unlinked leaf WBS items — everything is already linked.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-xs text-slate-400 uppercase border-b border-slate-200 sticky top-0 bg-white">
                    <tr>
                      <th className="text-left py-2 w-8"></th>
                      <th className="text-left py-2">WBS Item</th>
                      <th className="text-left py-2">Suggested Milestone</th>
                      <th className="text-left py-2 w-40">Confidence</th>
                      <th className="text-left py-2 w-48">Override</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedSuggestions.map((s) => {
                      const st = sel[s.wbs_id] || { include: false, milestone_id: '' };
                      const score = s.best?.score || 0;
                      const barColor = s.auto ? 'bg-emerald-500' : score >= 50 ? 'bg-amber-500' : 'bg-slate-300';
                      return (
                        <tr key={s.wbs_id} className="border-b border-slate-100">
                          <td className="py-2">
                            <button onClick={() => setInclude(s.wbs_id, !st.include)} className="flex items-center justify-center">
                              <div className={`w-4 h-4 rounded border-2 flex items-center justify-center ${st.include ? 'bg-amber-400 border-amber-400' : 'border-slate-300 hover:border-amber-400'}`}>
                                {st.include && <Check className="w-2.5 h-2.5 text-slate-900" />}
                              </div>
                            </button>
                          </td>
                          <td className="py-2">
                            <div className="font-mono text-xs text-slate-400">{s.wbs_code}</div>
                            <div className="text-slate-700">{s.name}</div>
                          </td>
                          <td className="py-2 text-slate-700">{s.best?.title || <span className="text-slate-400">—</span>}</td>
                          <td className="py-2">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden min-w-[60px]"><div className={`h-2 rounded-full ${barColor}`} style={{ width: `${score}%` }} /></div>
                              <span className="text-xs font-semibold text-slate-600 w-8">{score}</span>
                              {s.auto && <span className="text-xs text-emerald-600 font-semibold">auto</span>}
                            </div>
                          </td>
                          <td className="py-2">
                            <select value={st.milestone_id} onChange={(e) => setMilestone(s.wbs_id, e.target.value)} className={inp}>
                              <option value="">— None —</option>
                              {milestones.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200">
              <span className="text-xs text-slate-500">{checkedCount} selected to link</span>
              <div className="flex gap-2">
                <button onClick={onClose} className="px-3 py-1.5 border border-slate-300 text-slate-600 text-sm rounded hover:bg-slate-100">Cancel</button>
                <button onClick={applyChecked} disabled={!checkedCount || applying}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded disabled:opacity-50">
                  {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />} Apply checked ({checkedCount})
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}