import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { X, Loader2, CheckCircle, Wand2, AlertTriangle, Calendar, ArrowRight, Flag, Sparkles } from 'lucide-react';
import EstimateDurationsReview from './EstimateDurationsReview';

export default function ScheduleAssistantModal({ projectId, onClose, onApplied }) {
  const [step, setStep] = useState('idle'); // idle | analyzing | review | applying | done
  const [flow, setFlow] = useState(null); // null | 'optimize' | 'estimate'
  const [suggestions, setSuggestions] = useState([]);
  const [milestoneImpacts, setMilestoneImpacts] = useState([]);
  const [summary, setSummary] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [error, setError] = useState(null);

  async function analyze() {
    setStep('analyzing');
    setError(null);
    const res = await base44.functions.invoke('scheduleAssistant', { project_id: projectId });
    if (res.data?.error) {
      setError(`Analysis failed: ${res.data.error}`);
      setStep('idle');
      return;
    }
    const suggs = res.data?.suggestions || [];
    if (suggs.length === 0 && (res.data?.milestone_impacts || []).length === 0) {
      setError('No scheduling issues or improvements found. Your WBS schedule looks good!');
      setStep('idle');
      return;
    }
    setSuggestions(suggs);
    setMilestoneImpacts(res.data?.milestone_impacts || []);
    setSummary(res.data?.summary || '');
    setSelected(new Set(suggs.map(s => s.id)));
    setStep('review');
  }

  function toggleSelect(id) {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  async function applySelected() {
    setStep('applying');
    // Apply only selected WBS suggestions, always apply milestone impacts
    const toApply = suggestions.filter(s => selected.has(s.id));
    const wbsUpdates = toApply.map(s =>
      base44.entities.WBSItem.update(s.id, { planned_start: s.planned_start, planned_end: s.planned_end })
    );
    const msUpdates = milestoneImpacts.map(mi =>
      base44.entities.Milestone.update(mi.milestone_id, { planned_date: mi.suggested_date })
    );
    await Promise.all([...wbsUpdates, ...msUpdates]);
    setStep('done');
    setTimeout(() => { onApplied(); onClose(); }, 1400);
  }

  const delayDriven = suggestions.filter(s => !s.ai_suggested);
  const aiSuggested = suggestions.filter(s => s.ai_suggested);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-amber-50 rounded-lg flex items-center justify-center">
              <Wand2 className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <h2 className="font-bold text-slate-800 text-lg">Scheduling Assistant</h2>
              <p className="text-xs text-slate-500">AI-powered WBS date optimization & delay propagation</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-6">

          {step === 'idle' && !flow && (
            <div className="py-6">
              <div className="grid sm:grid-cols-2 gap-4 max-w-2xl mx-auto">
                <button onClick={() => { setFlow('optimize'); analyze(); }}
                  className="text-left p-5 border-2 border-slate-200 rounded-xl hover:border-amber-400 hover:bg-amber-50/40 transition">
                  <div className="w-10 h-10 bg-amber-50 rounded-lg flex items-center justify-center mb-3">
                    <Wand2 className="w-5 h-5 text-amber-500" />
                  </div>
                  <h3 className="font-semibold text-slate-800 text-sm mb-1">Optimize Schedule</h3>
                  <p className="text-xs text-slate-500 leading-relaxed">Detect delays, cascade date shifts through dependencies, suggest dates for unscheduled items, and adjust milestones.</p>
                </button>
                <button onClick={() => setFlow('estimate')}
                  className="text-left p-5 border-2 border-slate-200 rounded-xl hover:border-amber-400 hover:bg-amber-50/40 transition">
                  <div className="w-10 h-10 bg-amber-50 rounded-lg flex items-center justify-center mb-3">
                    <Sparkles className="w-5 h-5 text-amber-500" />
                  </div>
                  <h3 className="font-semibold text-slate-800 text-sm mb-1">AI: Estimate Durations</h3>
                  <p className="text-xs text-slate-500 leading-relaxed">Fill in undated activities with realistic, dependency-aware durations calibrated against your project's own dated tasks — review before applying.</p>
                </button>
              </div>
              {error && <p className="text-sm mt-6 text-center bg-slate-50 border border-slate-200 rounded p-3 text-slate-600 max-w-md mx-auto">{error}</p>}
            </div>
          )}

          {flow === 'estimate' && (
            <EstimateDurationsReview
              projectId={projectId}
              onApplied={() => { onApplied(); onClose(); }}
            />
          )}

          {step === 'analyzing' && (
            <div className="text-center py-16">
              <Loader2 className="w-10 h-10 animate-spin text-amber-500 mx-auto mb-4" />
              <h3 className="font-semibold text-slate-700 text-lg mb-1">Analyzing Schedule…</h3>
              <p className="text-slate-400 text-sm">Evaluating dependencies, detecting delays, and computing optimal dates.</p>
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
              <p className="text-slate-400 text-sm mt-1">{selected.size} WBS item(s) and {milestoneImpacts.length} milestone(s) adjusted.</p>
            </div>
          )}

          {step === 'review' && (
            <div className="space-y-5">
              {/* Summary banner */}
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-sm text-amber-800">{summary}</p>
              </div>

              {/* Delay-driven adjustments */}
              {delayDriven.length > 0 && (
                <div>
                  <h3 className="font-semibold text-slate-700 text-sm mb-2 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-500" />
                    Delay-Driven Adjustments ({delayDriven.length})
                    <span className="text-xs font-normal text-slate-400">— cascaded from actual delays detected</span>
                  </h3>
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-800 text-white">
                        <tr>
                          <th className="px-3 py-2 w-8"><input type="checkbox"
                            checked={delayDriven.every(s => selected.has(s.id))}
                            onChange={() => {
                              const ids = delayDriven.map(s => s.id);
                              const allSel = ids.every(id => selected.has(id));
                              setSelected(prev => { const n = new Set(prev); allSel ? ids.forEach(id => n.delete(id)) : ids.forEach(id => n.add(id)); return n; });
                            }} className="accent-amber-400" /></th>
                          <th className="px-3 py-2 text-left font-semibold">WBS Item</th>
                          <th className="px-3 py-2 text-center font-semibold">Original Dates</th>
                          <th className="px-3 py-2 text-center font-semibold w-6"></th>
                          <th className="px-3 py-2 text-center font-semibold">Suggested Dates</th>
                          <th className="px-3 py-2 text-left font-semibold">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {delayDriven.map(s => (
                          <tr key={s.id} className={`border-t border-slate-100 ${selected.has(s.id) ? 'bg-white' : 'bg-slate-50 opacity-50'}`}>
                            <td className="px-3 py-2 text-center">
                              <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleSelect(s.id)} className="accent-amber-500" />
                            </td>
                            <td className="px-3 py-2">
                              <span className="font-mono text-slate-400 mr-1">{s.wbs_code}</span>
                              <span className="font-medium text-slate-700">{s.name}</span>
                              {s.shift_days > 0 && <span className="ml-2 text-xs text-red-600 bg-red-50 px-1.5 py-0.5 rounded">+{s.shift_days}d</span>}
                            </td>
                            <td className="px-3 py-2 text-center text-slate-400">
                              {s.original_start ? `${s.original_start} → ${s.original_end || '?'}` : '—'}
                            </td>
                            <td className="px-3 py-2 text-center text-slate-300">
                              <ArrowRight className="w-3 h-3 inline" />
                            </td>
                            <td className="px-3 py-2 text-center font-semibold text-slate-800">
                              {s.planned_start} → {s.planned_end}
                            </td>
                            <td className="px-3 py-2 text-slate-500 max-w-xs truncate">{s.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* AI-suggested dates */}
              {aiSuggested.length > 0 && (
                <div>
                  <h3 className="font-semibold text-slate-700 text-sm mb-2 flex items-center gap-2">
                    <Wand2 className="w-4 h-4 text-blue-500" />
                    AI Date Suggestions ({aiSuggested.length})
                    <span className="text-xs font-normal text-slate-400">— for unscheduled items</span>
                  </h3>
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-700 text-white">
                        <tr>
                          <th className="px-3 py-2 w-8"><input type="checkbox"
                            checked={aiSuggested.every(s => selected.has(s.id))}
                            onChange={() => {
                              const ids = aiSuggested.map(s => s.id);
                              const allSel = ids.every(id => selected.has(id));
                              setSelected(prev => { const n = new Set(prev); allSel ? ids.forEach(id => n.delete(id)) : ids.forEach(id => n.add(id)); return n; });
                            }} className="accent-blue-400" /></th>
                          <th className="px-3 py-2 text-left font-semibold">WBS Item</th>
                          <th className="px-3 py-2 text-center font-semibold">Suggested Dates</th>
                          <th className="px-3 py-2 text-left font-semibold">AI Reasoning</th>
                        </tr>
                      </thead>
                      <tbody>
                        {aiSuggested.map(s => (
                          <tr key={s.id} className={`border-t border-slate-100 ${selected.has(s.id) ? 'bg-white' : 'bg-slate-50 opacity-50'}`}>
                            <td className="px-3 py-2 text-center">
                              <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleSelect(s.id)} className="accent-blue-500" />
                            </td>
                            <td className="px-3 py-2">
                              <span className="font-mono text-slate-400 mr-1">{s.wbs_code}</span>
                              <span className="font-medium text-slate-700">{s.name}</span>
                            </td>
                            <td className="px-3 py-2 text-center font-semibold text-slate-800">
                              {s.planned_start} → {s.planned_end}
                            </td>
                            <td className="px-3 py-2 text-slate-500">{s.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Milestone impacts */}
              {milestoneImpacts.length > 0 && (
                <div>
                  <h3 className="font-semibold text-slate-700 text-sm mb-2 flex items-center gap-2">
                    <Flag className="w-4 h-4 text-amber-500" />
                    Milestone Date Adjustments ({milestoneImpacts.length})
                    <span className="text-xs font-normal text-slate-400">— will be applied automatically with accepted WBS changes</span>
                  </h3>
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
                        {milestoneImpacts.map(mi => (
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
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 'review' && flow === 'optimize' && (
          <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between shrink-0 bg-slate-50">
            <p className="text-sm text-slate-500">
              {selected.size} WBS update{selected.size !== 1 ? 's' : ''} + {milestoneImpacts.length} milestone adjustment{milestoneImpacts.length !== 1 ? 's' : ''} will be applied
            </p>
            <div className="flex gap-3">
              <button onClick={onClose} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-slate-100">
                Cancel
              </button>
              <button onClick={applySelected} disabled={selected.size === 0 && milestoneImpacts.length === 0}
                className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded-lg disabled:opacity-40 flex items-center gap-2">
                <Wand2 className="w-4 h-4" /> Apply Schedule
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}