import { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useTranslation } from '@/hooks/useTranslation';
import {
  X, Loader2, CheckCircle, Wand2, AlertTriangle, ArrowRight, Flag,
  Users, Package, FileText, CalendarX, DollarSign, ShieldCheck, Activity,
} from 'lucide-react';
import EstimateDurationsReview from './EstimateDurationsReview';

const CAT_ICON = {
  critical_path: AlertTriangle,
  delay_cascade: AlertTriangle,
  resource_conflict: Users,
  procurement_gate: Package,
  milestone_risk: Flag,
  scope_change: FileText,
  undated_work: CalendarX,
  cost_schedule: DollarSign,
};
const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
const SEV_BORDER = {
  critical: 'border-red-300 bg-red-50/60',
  high: 'border-orange-300 bg-orange-50/60',
  medium: 'border-amber-300 bg-amber-50/60',
  low: 'border-slate-200 bg-slate-50/60',
};
const SEV_DOT = { critical: 'bg-red-500', high: 'bg-orange-500', medium: 'bg-amber-500', low: 'bg-slate-400' };

/** Colored health-score ring (green ≥80, amber 50–79, red <50). */
function HealthRing({ score }) {
  const r = 26, c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score || 0));
  const offset = c - (pct / 100) * c;
  const color = pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444';
  return (
    <div className="relative w-16 h-16 shrink-0">
      <svg viewBox="0 0 64 64" className="w-16 h-16 -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="#e2e8f0" strokeWidth="6" />
        <circle cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={offset} className="transition-all duration-500" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-base font-bold" style={{ color }}>{Math.round(pct)}</span>
      </div>
    </div>
  );
}

export default function ScheduleAssistantModal({ projectId, onClose, onApplied }) {
  const { t } = useTranslation();
  const [step, setStep] = useState('analyzing'); // analyzing | review | applying | done | error
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  // Synthesis
  const [summary, setSummary] = useState('');
  const [health, setHealth] = useState(null);
  const [projectedFinish, setProjectedFinish] = useState('');
  const [plannedFinish, setPlannedFinish] = useState('');
  const [insights, setInsights] = useState([]);

  // Apply-table state
  const [suggestions, setSuggestions] = useState([]); // delay-driven wbs_date_suggestions
  const [selected, setSelected] = useState(new Set()); // suggestion ids
  const [milestoneImpacts, setMilestoneImpacts] = useState([]);
  const [durationRows, setDurationRows] = useState([]);
  const [durAccepted, setDurAccepted] = useState(new Set()); // wbs_ids

  useEffect(() => { analyze(); /* eslint-disable-next-line */ }, []);

  async function analyze() {
    setStep('analyzing');
    setError(null);
    try {
      const res = await base44.functions.invoke('smartScheduleAnalysis', { project_id: projectId });
      const data = res.data;
      if (data?.error) { setError(`Analysis failed: ${data.error}`); setStep('error'); return; }
      setSummary(data?.executive_summary || '');
      setHealth(typeof data?.health_score === 'number' ? data.health_score : null);
      setProjectedFinish(data?.projected_finish || '');
      setPlannedFinish(data?.planned_finish || '');
      setInsights(Array.isArray(data?.insights) ? data.insights : []);
      setNotice(data?.notice || null);
      const suggs = data?.wbs_date_suggestions || [];
      setSuggestions(suggs);
      setSelected(new Set(suggs.map((s) => s.id)));
      setMilestoneImpacts(data?.milestone_impacts || []);
      const ests = data?.duration_estimates || [];
      setDurationRows(ests);
      setDurAccepted(new Set(ests.map((r) => r.wbs_id)));
      setStep('review');
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Analysis failed.');
      setStep('error');
    }
  }

  function toggleSelect(id) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleDur(wbsId) {
    setDurAccepted((prev) => { const n = new Set(prev); n.has(wbsId) ? n.delete(wbsId) : n.add(wbsId); return n; });
  }
  function updateDuration(wbsId, days) {
    setDurationRows((prev) => prev.map((r) => r.wbs_id === wbsId
      ? { ...r, estimated_duration_days: days, proposed_end: addWorkingDays(r.proposed_start, days) }
      : r));
  }

  const sortedInsights = useMemo(() =>
    [...insights].sort((a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9)),
  [insights]);

  const delayDriven = suggestions.filter((s) => !s.ai_suggested);
  const aiSuggested = suggestions.filter((s) => s.ai_suggested);

  const totalApplyCount = useMemo(() => {
    const suggIds = new Set(suggestions.filter((s) => selected.has(s.id)).map((s) => s.id));
    const durIds = new Set(durationRows.filter((r) => durAccepted.has(r.wbs_id)).map((r) => r.wbs_id));
    const wbsCount = new Set([...suggIds, ...durIds]).size;
    return wbsCount + milestoneImpacts.length;
  }, [suggestions, selected, durationRows, durAccepted, milestoneImpacts]);

  async function applySelected() {
    setStep('applying');
    setError(null);
    const suggUpdates = suggestions.filter((s) => selected.has(s.id))
      .map((s) => ({ id: s.id, planned_start: s.planned_start, planned_end: s.planned_end }));
    const durUpdates = durationRows.filter((r) => durAccepted.has(r.wbs_id))
      .map((r) => ({ id: r.wbs_id, planned_start: r.proposed_start, planned_end: r.proposed_end }));
    // Merge by id (delay-driven and durations shouldn't overlap; if they do, duration wins).
    const byId = {};
    [...suggUpdates, ...durUpdates].forEach((u) => { byId[u.id] = u; });
    const wbs_updates = Object.values(byId);
    const milestone_updates = milestoneImpacts.map((mi) => ({ id: mi.milestone_id, planned_date: mi.suggested_date }));
    if (wbs_updates.length === 0 && milestone_updates.length === 0) { setStep('review'); return; }
    try {
      // Dates + durations + milestone shifts land as one atomic batch — a mid-apply
      // failure rolls the whole schedule edit back instead of leaving it half-changed.
      await base44.functions.invoke('applyWBSBatch', { wbs_updates, milestone_updates });
      setStep('done');
      setTimeout(() => { onApplied(); onClose(); }, 1200);
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to apply — no changes were saved.');
      setStep('review');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-amber-50 rounded-lg flex items-center justify-center">
              <Wand2 className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <h2 className="font-bold text-slate-800 text-lg">{t('scheduleAssistant.headerTitle')}</h2>
              <p className="text-xs text-slate-500">{t('scheduleAssistant.headerSubtitle')}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-6 space-y-5">

          {step === 'analyzing' && (
            <div className="text-center py-16">
              <Loader2 className="w-10 h-10 animate-spin text-amber-500 mx-auto mb-4" />
              <h3 className="font-semibold text-slate-700 text-lg mb-1">Running Smart Analysis…</h3>
              <p className="text-slate-400 text-sm">{t('scheduleAssistant.analyzing')}</p>
            </div>
          )}

          {step === 'applying' && (
            <div className="text-center py-16">
              <Loader2 className="w-10 h-10 animate-spin text-blue-500 mx-auto mb-4" />
              <h3 className="font-semibold text-slate-700 text-lg">Applying Schedule Updates…</h3>
            </div>
          )}

          {step === 'done' && (
            <div className="text-center py-16">
              <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
              <h3 className="font-semibold text-slate-700 text-lg">Schedule Updated Successfully!</h3>
              <p className="text-slate-400 text-sm mt-1">{totalApplyCount} change(s) applied atomically.</p>
            </div>
          )}

          {step === 'error' && (
            <div className="text-center py-12">
              <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
              <p className="text-sm text-slate-600 max-w-md mx-auto bg-slate-50 border border-slate-200 rounded p-3 mb-4">{error}</p>
              <button onClick={analyze} className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded-lg flex items-center gap-2 mx-auto">
                <Wand2 className="w-4 h-4" /> {t('scheduleAssistant.runAnalysis')}
              </button>
            </div>
          )}

          {step === 'review' && (
            <>
              {notice && (
                <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-sm text-amber-800">{notice}</p>
                </div>
              )}

              {/* Executive summary + health header card */}
              <div className="border border-slate-200 rounded-xl p-5 flex items-start gap-5 bg-gradient-to-br from-slate-50 to-white">
                <HealthRing score={health ?? 0} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Activity className="w-4 h-4 text-amber-500" />
                    <h3 className="font-semibold text-slate-800 text-sm">Executive Summary</h3>
                  </div>
                  <p className="text-sm text-slate-600 leading-relaxed mb-3">{summary}</p>
                  <div className="flex flex-wrap gap-4 text-xs">
                    <div>
                      <span className="text-slate-400">Projected finish: </span>
                      <span className="font-semibold text-slate-800">{projectedFinish || '—'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Planned finish: </span>
                      <span className="font-semibold text-slate-800">{plannedFinish || '—'}</span>
                    </div>
                    {projectedFinish && plannedFinish && (
                      <div>
                        <span className="text-slate-400">Variance: </span>
                        <span className={`font-semibold ${projectedFinish > plannedFinish ? 'text-red-600' : 'text-emerald-600'}`}>
                          {projectedFinish > plannedFinish ? '+' : ''}{daysBetweenLocal(plannedFinish, projectedFinish)}d
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Insight cards */}
              {sortedInsights.length > 0 && (
                <div>
                  <h3 className="font-semibold text-slate-700 text-sm mb-2 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-amber-500" />
                    {t('scheduleAssistant.insights')} ({sortedInsights.length})
                    <span className="text-xs font-normal text-slate-400">— ranked by severity, read-only guidance</span>
                  </h3>
                  <div className="space-y-2.5">
                    {sortedInsights.map((ins, idx) => {
                      const Icon = CAT_ICON[ins.category] || AlertTriangle;
                      return (
                        <div key={ins.id || idx} className={`border rounded-lg p-3.5 ${SEV_BORDER[ins.severity] || SEV_BORDER.low}`}>
                          <div className="flex items-start gap-3">
                            <div className="flex items-center gap-2 shrink-0 mt-0.5">
                              <span className={`w-2 h-2 rounded-full ${SEV_DOT[ins.severity] || SEV_DOT.low}`} />
                              <Icon className="w-4 h-4 text-slate-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <h4 className="font-semibold text-slate-800 text-sm">{ins.title}</h4>
                                <span className="text-[10px] uppercase tracking-wide font-bold text-slate-500 bg-white/70 border border-slate-200 px-1.5 py-0.5 rounded">{ins.category.replace(/_/g, ' ')}</span>
                              </div>
                              <p className="text-xs text-slate-600 leading-relaxed mb-1.5">{ins.detail}</p>
                              <p className="text-xs text-slate-800"><span className="font-bold">Action: </span>{ins.recommended_action}</p>
                              <div className="flex items-center gap-2 flex-wrap mt-1.5">
                                {ins.quantified_impact && (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 bg-amber-100 border border-amber-200 px-2 py-0.5 rounded-full">
                                    <Activity className="w-3 h-3" /> {ins.quantified_impact}
                                  </span>
                                )}
                                {(ins.affected_wbs_codes || []).map((c) => (
                                  <span key={c} className="font-mono text-[10px] text-slate-600 bg-white/70 border border-slate-200 px-1.5 py-0.5 rounded">{c}</span>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Apply tables */}
              <div>
                <h3 className="font-semibold text-slate-700 text-sm mb-2 flex items-center gap-2">
                  <Wand2 className="w-4 h-4 text-amber-500" />
                  {t('scheduleAssistant.applyTables')}
                </h3>

                {/* Delay-driven adjustments */}
                {delayDriven.length > 0 && (
                  <div className="mb-4">
                    <h4 className="font-medium text-slate-600 text-xs mb-2 flex items-center gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                      Delay-Driven Adjustments ({delayDriven.length})
                    </h4>
                    <div className="border border-slate-200 rounded-lg overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-800 text-white">
                          <tr>
                            <th className="px-3 py-2 w-8"><input type="checkbox"
                              checked={delayDriven.every((s) => selected.has(s.id))}
                              onChange={() => {
                                const ids = delayDriven.map((s) => s.id);
                                const allSel = ids.every((id) => selected.has(id));
                                setSelected((prev) => { const n = new Set(prev); allSel ? ids.forEach((id) => n.delete(id)) : ids.forEach((id) => n.add(id)); return n; });
                              }} className="accent-amber-400" /></th>
                            <th className="px-3 py-2 text-left font-semibold">WBS Item</th>
                            <th className="px-3 py-2 text-center font-semibold">Original Dates</th>
                            <th className="px-3 py-2 text-center font-semibold w-6"></th>
                            <th className="px-3 py-2 text-center font-semibold">Suggested Dates</th>
                            <th className="px-3 py-2 text-left font-semibold">Reason</th>
                          </tr>
                        </thead>
                        <tbody>
                          {delayDriven.map((s) => (
                            <tr key={s.id} className={`border-t border-slate-100 ${selected.has(s.id) ? 'bg-white' : 'bg-slate-50 opacity-50'}`}>
                              <td className="px-3 py-2 text-center"><input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleSelect(s.id)} className="accent-amber-500" /></td>
                              <td className="px-3 py-2">
                                <span className="font-mono text-slate-400 mr-1">{s.wbs_code}</span>
                                <span className="font-medium text-slate-700">{s.name}</span>
                                {s.shift_days > 0 && <span className="ml-2 text-xs text-red-600 bg-red-50 px-1.5 py-0.5 rounded">+{s.shift_days}d</span>}
                              </td>
                              <td className="px-3 py-2 text-center text-slate-400">{s.original_start ? `${s.original_start} → ${s.original_end || '?'}` : '—'}</td>
                              <td className="px-3 py-2 text-center text-slate-300"><ArrowRight className="w-3 h-3 inline" /></td>
                              <td className="px-3 py-2 text-center font-semibold text-slate-800">{s.planned_start} → {s.planned_end}</td>
                              <td className="px-3 py-2 text-slate-500 max-w-xs truncate">{s.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* AI-suggested dates (undated items not covered by duration table) */}
                {aiSuggested.length > 0 && (
                  <div className="mb-4">
                    <h4 className="font-medium text-slate-600 text-xs mb-2 flex items-center gap-2">
                      <Wand2 className="w-3.5 h-3.5 text-blue-500" />
                      AI Date Suggestions ({aiSuggested.length})
                    </h4>
                    <div className="border border-slate-200 rounded-lg overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-700 text-white">
                          <tr>
                            <th className="px-3 py-2 w-8"><input type="checkbox"
                              checked={aiSuggested.every((s) => selected.has(s.id))}
                              onChange={() => {
                                const ids = aiSuggested.map((s) => s.id);
                                const allSel = ids.every((id) => selected.has(id));
                                setSelected((prev) => { const n = new Set(prev); allSel ? ids.forEach((id) => n.delete(id)) : ids.forEach((id) => n.add(id)); return n; });
                              }} className="accent-blue-400" /></th>
                            <th className="px-3 py-2 text-left font-semibold">WBS Item</th>
                            <th className="px-3 py-2 text-center font-semibold">Suggested Dates</th>
                            <th className="px-3 py-2 text-left font-semibold">AI Reasoning</th>
                          </tr>
                        </thead>
                        <tbody>
                          {aiSuggested.map((s) => (
                            <tr key={s.id} className={`border-t border-slate-100 ${selected.has(s.id) ? 'bg-white' : 'bg-slate-50 opacity-50'}`}>
                              <td className="px-3 py-2 text-center"><input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleSelect(s.id)} className="accent-blue-500" /></td>
                              <td className="px-3 py-2">
                                <span className="font-mono text-slate-400 mr-1">{s.wbs_code}</span>
                                <span className="font-medium text-slate-700">{s.name}</span>
                              </td>
                              <td className="px-3 py-2 text-center font-semibold text-slate-800">{s.planned_start} → {s.planned_end}</td>
                              <td className="px-3 py-2 text-slate-500">{s.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Duration estimates (parent-driven, no own apply) */}
                {durationRows.length > 0 && (
                  <div className="mb-4">
                    <h4 className="font-medium text-slate-600 text-xs mb-2 flex items-center gap-2">
                      <CalendarX className="w-3.5 h-3.5 text-indigo-500" />
                      Duration Estimates ({durationRows.length})
                      <span className="text-xs font-normal text-slate-400">— undated activities & parent rollups</span>
                    </h4>
                    <EstimateDurationsReview
                      rows={durationRows}
                      accepted={durAccepted}
                      onToggle={toggleDur}
                      onUpdateDuration={updateDuration}
                    />
                  </div>
                )}

                {/* Milestone impacts */}
                {milestoneImpacts.length > 0 && (
                  <div>
                    <h4 className="font-medium text-slate-600 text-xs mb-2 flex items-center gap-2">
                      <Flag className="w-3.5 h-3.5 text-amber-500" />
                      Milestone Date Adjustments ({milestoneImpacts.length})
                      <span className="text-xs font-normal text-slate-400">— applied automatically with accepted WBS changes</span>
                    </h4>
                    <div className="border border-amber-200 bg-amber-50 rounded-lg overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-amber-100 text-amber-900">
                          <tr>
                            <th className="px-3 py-2 text-left font-semibold">Milestone</th>
                            <th className="px-3 py-2 text-center font-semibold">Current Date</th>
                            <th className="px-3 py-2 text-center w-6"></th>
                            <th className="px-3 py-2 text-center font-semibold">Suggested Date</th>
                            <th className="px-3 py-2 text-center font-semibold">Shift</th>
                          </tr>
                        </thead>
                        <tbody>
                          {milestoneImpacts.map((mi) => (
                            <tr key={mi.milestone_id} className="border-t border-amber-200">
                              <td className="px-3 py-2 font-medium text-amber-900">{mi.milestone_title}</td>
                              <td className="px-3 py-2 text-center text-amber-700">{mi.original_date}</td>
                              <td className="px-3 py-2 text-center text-amber-400"><ArrowRight className="w-3 h-3 inline" /></td>
                              <td className="px-3 py-2 text-center font-semibold text-amber-900">{mi.suggested_date}</td>
                              <td className="px-3 py-2 text-center text-red-600 font-semibold">+{mi.shift_days}d</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {delayDriven.length === 0 && durationRows.length === 0 && milestoneImpacts.length === 0 && (
                  <div className="text-center py-8 text-slate-400 text-sm">No applyable changes — the schedule is clean. See the insights above for guidance.</div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {step === 'review' && (
          <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between shrink-0 bg-slate-50">
            <p className="text-sm text-slate-500">
              {totalApplyCount} change(s) will be applied atomically
            </p>
            <div className="flex gap-3">
              <button onClick={onClose} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-slate-100">Cancel</button>
              <button onClick={applySelected} disabled={totalApplyCount === 0}
                className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded-lg disabled:opacity-40 flex items-center gap-2">
                <Wand2 className="w-4 h-4" /> {t('scheduleAssistant.applySchedule')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Working-day-agnostic calendar-day delta for display only. */
function daysBetweenLocal(a, b) {
  if (!a || !b) return 0;
  const da = new Date(a); da.setHours(0, 0, 0, 0);
  const db = new Date(b); db.setHours(0, 0, 0, 0);
  return Math.round((db - da) / 86400000);
}

/** Local addWorkingDays mirror for duration edits in the parent. */
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