import { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useEntityList, useEntityMutation } from '@/hooks/useEntity';
import { formatDate } from '@/lib/constants';
import { Plus, ShieldAlert, Sparkles, Trash2, Pencil, Save, X, ChevronDown, ChevronRight, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';

const PROB_SCORE  = { low: 1, medium: 2, high: 3 };
const IMPACT_SCORE = { low: 1, medium: 2, high: 3, critical: 4 };

function riskScore(r) {
  return (PROB_SCORE[r.probability] || 1) * (IMPACT_SCORE[r.impact] || 1);
}

const SCORE_CONFIG = (score) => {
  if (score >= 9) return { label: 'Critical', cls: 'bg-red-100 text-red-700 border-red-300' };
  if (score >= 6) return { label: 'High',     cls: 'bg-amber-100 text-amber-700 border-amber-300' };
  if (score >= 3) return { label: 'Medium',   cls: 'bg-yellow-100 text-yellow-700 border-yellow-300' };
  return             { label: 'Low',      cls: 'bg-slate-100 text-slate-600 border-slate-200' };
};

const CATEGORY_LABELS = {
  technical: 'Technical', schedule: 'Schedule', cost: 'Cost',
  resource: 'Resource', vendor: 'Vendor', safety: 'Safety',
  scope: 'Scope', other: 'Other',
};

const STATUS_STYLES = {
  open:      'bg-red-100 text-red-700',
  mitigated: 'bg-emerald-100 text-emerald-700',
  accepted:  'bg-amber-100 text-amber-700',
  closed:    'bg-slate-100 text-slate-500',
};

const EMPTY_FORM = {
  title: '', description: '', category: 'other',
  probability: 'medium', impact: 'medium',
  status: 'open', owner: '', mitigation_plan: '', due_date: '',
};

const inp = 'border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white w-full';

export default function TabRisks({ projectId }) {
  const { data: risks = [], isLoading } = useEntityList('Risk', { project_id: projectId }, '-created_date', 200);
  const riskMutation = useEntityMutation('Risk');
  const taskMutation = useEntityMutation('Task');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [expanded, setExpanded] = useState({});
  const [suggesting, setSuggesting] = useState(null); // risk id or 'new'
  const [suggestions, setSuggestions] = useState({}); // id -> { mitigation_summary, suggested_tasks, contingency_plan, timeline }
  const [createdTasks, setCreatedTasks] = useState(new Set());
  const [creatingTask, setCreatingTask] = useState(null);
  const [filterStatus, setFilterStatus] = useState('');

  async function createRisk(e) {
    e.preventDefault();
    if (!form.title.trim()) return;
    const score = (PROB_SCORE[form.probability] || 1) * (IMPACT_SCORE[form.impact] || 1);
    await riskMutation.mutateAsync({ action: 'create', data: { ...form, project_id: projectId, risk_score: score } });
    setForm(EMPTY_FORM);
    setAdding(false);
  }

  function startEdit(r) {
    setEditingId(r.id);
    setEditForm({
      title: r.title, description: r.description || '', category: r.category,
      probability: r.probability, impact: r.impact, status: r.status,
      owner: r.owner || '', mitigation_plan: r.mitigation_plan || '', due_date: r.due_date || '',
    });
  }

  async function saveEdit(id) {
    const score = (PROB_SCORE[editForm.probability] || 1) * (IMPACT_SCORE[editForm.impact] || 1);
    await riskMutation.mutateAsync({ action: 'update', id, data: { ...editForm, risk_score: score } });
    setEditingId(null);
  }

  async function deleteRisk(id) {
    if (!confirm('Delete this risk?')) return;
    await riskMutation.mutateAsync({ action: 'delete', id });
  }

  async function getSuggestions(risk) {
    setSuggesting(risk.id);
    const res = await base44.functions.invoke('suggestRiskMitigation', {
      project_id: projectId,
      risk_title: risk.title,
      risk_description: risk.description,
      category: risk.category,
      probability: risk.probability,
      impact: risk.impact,
    });
    const data = res.data;
    setSuggestions(prev => ({ ...prev, [risk.id]: data }));
    setSuggesting(null);
    // Expand row to show suggestions
    setExpanded(prev => ({ ...prev, [risk.id]: true }));
  }

  async function applySuggestedTasks(risk, tasks) {
    // Save suggested tasks on the risk record
    await riskMutation.mutateAsync({ action: 'update', id: risk.id, data: { suggested_tasks: tasks } });
  }

  async function createTaskFromSuggestion(taskTitle) {
    if (createdTasks.has(taskTitle)) return;
    setCreatingTask(taskTitle);
    try {
      await taskMutation.mutateAsync({
        action: 'create',
        data: {
          project_id: projectId,
          title: taskTitle,
          priority: 'high',
          status: 'todo',
        },
      });
      setCreatedTasks(prev => new Set(prev).add(taskTitle));
    } finally {
      setCreatingTask(null);
    }
  }

  const sorted = useMemo(() =>
    [...risks]
      .filter(r => !filterStatus || r.status === filterStatus)
      .sort((a, b) => riskScore(b) - riskScore(a)),
    [risks, filterStatus]
  );

  const openCount   = risks.filter(r => r.status === 'open').length;
  const criticalCount = risks.filter(r => riskScore(r) >= 9).length;
  const mitigatedCount = risks.filter(r => r.status === 'mitigated').length;

  if (isLoading) return <Spinner />;

  return (
    <div className="space-y-5">
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi label="Total Risks" value={risks.length} color="border-slate-400" />
        <Kpi label="Open" value={openCount} color="border-red-400" />
        <Kpi label="Critical Score" value={criticalCount} color="border-red-600" sub="score ≥ 9" />
        <Kpi label="Mitigated" value={mitigatedCount} color="border-emerald-400" />
      </div>

      {/* Risk Matrix hint */}
      {risks.length > 0 && <RiskMatrix risks={risks} />}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            className="border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400 bg-white">
            <option value="">All Statuses</option>
            <option value="open">Open</option>
            <option value="mitigated">Mitigated</option>
            <option value="accepted">Accepted</option>
            <option value="closed">Closed</option>
          </select>
        </div>
        <button onClick={() => setAdding(v => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded">
          <Plus className="w-4 h-4" /> Add Risk
        </button>
      </div>

      {/* Add form */}
      {adding && (
        <form onSubmit={createRisk} className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
          <h3 className="font-semibold text-slate-700 text-sm flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-500" /> New Risk
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="Risk title *" className={inp + ' md:col-span-2'} required />
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Description" className={inp + ' resize-none md:col-span-2'} rows={2} />
            <div className="grid grid-cols-2 gap-2 md:col-span-1">
              <label className="text-xs text-slate-500">Category
                <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className={inp + ' mt-0.5'}>
                  {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label className="text-xs text-slate-500">Owner
                <input value={form.owner} onChange={e => setForm(f => ({ ...f, owner: e.target.value }))} placeholder="Name" className={inp + ' mt-0.5'} />
              </label>
            </div>
            <div className="grid grid-cols-3 gap-2 md:col-span-1">
              <label className="text-xs text-slate-500">Probability
                <select value={form.probability} onChange={e => setForm(f => ({ ...f, probability: e.target.value }))} className={inp + ' mt-0.5'}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>
              <label className="text-xs text-slate-500">Impact
                <select value={form.impact} onChange={e => setForm(f => ({ ...f, impact: e.target.value }))} className={inp + ' mt-0.5'}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </label>
              <label className="text-xs text-slate-500">Due Date
                <input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} className={inp + ' mt-0.5'} />
              </label>
            </div>
            <textarea value={form.mitigation_plan} onChange={e => setForm(f => ({ ...f, mitigation_plan: e.target.value }))}
              placeholder="Mitigation plan (optional)" className={inp + ' resize-none md:col-span-2'} rows={2} />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-2 bg-amber-500 text-slate-900 font-semibold text-sm rounded hover:bg-amber-400">Save Risk</button>
            <button type="button" onClick={() => setAdding(false)} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded hover:bg-slate-100">Cancel</button>
          </div>
        </form>
      )}

      {/* Risk List */}
      {sorted.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <ShieldAlert className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No risks logged yet. Click "Add Risk" to start.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map(risk => {
            const score = riskScore(risk);
            const scoreCfg = SCORE_CONFIG(score);
            const isExpanded = expanded[risk.id];
            const isEditing = editingId === risk.id;
            const sug = suggestions[risk.id];

            return (
              <div key={risk.id} className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                {/* Header row */}
                <div className="flex items-start gap-3 p-4">
                  <button onClick={() => setExpanded(p => ({ ...p, [risk.id]: !p[risk.id] }))}
                    className="text-slate-400 hover:text-slate-600 mt-0.5 shrink-0">
                    {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <div className="space-y-2">
                        <input value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} className={inp} />
                        <textarea value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                          className={inp + ' resize-none'} rows={2} placeholder="Description" />
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          <select value={editForm.category} onChange={e => setEditForm(f => ({ ...f, category: e.target.value }))} className={inp}>
                            {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </select>
                          <select value={editForm.probability} onChange={e => setEditForm(f => ({ ...f, probability: e.target.value }))} className={inp}>
                            <option value="low">Low Prob.</option><option value="medium">Med Prob.</option><option value="high">High Prob.</option>
                          </select>
                          <select value={editForm.impact} onChange={e => setEditForm(f => ({ ...f, impact: e.target.value }))} className={inp}>
                            <option value="low">Low Impact</option><option value="medium">Med Impact</option>
                            <option value="high">High Impact</option><option value="critical">Critical Impact</option>
                          </select>
                          <select value={editForm.status} onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))} className={inp}>
                            <option value="open">Open</option><option value="mitigated">Mitigated</option>
                            <option value="accepted">Accepted</option><option value="closed">Closed</option>
                          </select>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <input value={editForm.owner} onChange={e => setEditForm(f => ({ ...f, owner: e.target.value }))} className={inp} placeholder="Owner" />
                          <input type="date" value={editForm.due_date} onChange={e => setEditForm(f => ({ ...f, due_date: e.target.value }))} className={inp} />
                        </div>
                        <textarea value={editForm.mitigation_plan} onChange={e => setEditForm(f => ({ ...f, mitigation_plan: e.target.value }))}
                          className={inp + ' resize-none'} rows={2} placeholder="Mitigation plan" />
                        <div className="flex gap-2">
                          <button onClick={() => saveEdit(risk.id)} className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500 text-white rounded text-xs font-semibold hover:bg-emerald-400">
                            <Save className="w-3 h-3" /> Save
                          </button>
                          <button onClick={() => setEditingId(null)} className="px-3 py-1.5 border border-slate-200 rounded text-xs text-slate-500 hover:bg-slate-50">
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span className="font-semibold text-slate-800">{risk.title}</span>
                          <span className={`text-xs px-2 py-0.5 rounded border font-bold ${scoreCfg.cls}`}>
                            Score {score} · {scoreCfg.label}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded font-semibold ${STATUS_STYLES[risk.status]}`}>
                            {risk.status.charAt(0).toUpperCase() + risk.status.slice(1)}
                          </span>
                          <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                            {CATEGORY_LABELS[risk.category] || risk.category}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-3 text-xs text-slate-500 mt-1">
                          <span>Prob: <strong>{risk.probability}</strong></span>
                          <span>Impact: <strong>{risk.impact}</strong></span>
                          {risk.owner && <span>Owner: <strong>{risk.owner}</strong></span>}
                          {risk.due_date && <span>Due: <strong>{formatDate(risk.due_date)}</strong></span>}
                        </div>
                        {risk.description && <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">{risk.description}</p>}
                      </div>
                    )}
                  </div>

                  {/* Action buttons */}
                  {!isEditing && (
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => getSuggestions(risk)}
                        disabled={suggesting === risk.id}
                        className="flex items-center gap-1 px-2 py-1.5 text-xs bg-purple-50 hover:bg-purple-100 text-purple-700 rounded font-semibold border border-purple-200 disabled:opacity-50"
                        title="Get AI mitigation suggestions"
                      >
                        {suggesting === risk.id
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : <Sparkles className="w-3 h-3" />}
                        {suggesting === risk.id ? 'Thinking…' : 'Suggest Mitigation'}
                      </button>
                      <button onClick={() => startEdit(risk)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => deleteRisk(risk.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Expanded panel */}
                {isExpanded && !isEditing && (
                  <div className="border-t border-slate-100 px-4 py-3 space-y-3 bg-slate-50/50">
                    {/* Mitigation plan */}
                    {risk.mitigation_plan && (
                      <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Mitigation Plan</p>
                        <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">{risk.mitigation_plan}</p>
                      </div>
                    )}

                    {/* Saved suggested tasks */}
                    {risk.suggested_tasks?.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">AI-Suggested Mitigation Tasks</p>
                        <div className="space-y-1">
                          {risk.suggested_tasks.map((t, i) => (
                            <div key={i} className="flex items-center justify-between gap-2 bg-white border border-slate-200 rounded px-3 py-1.5">
                              <span className="text-xs text-slate-700">{t}</span>
                              <button
                                onClick={() => createTaskFromSuggestion(t)}
                                disabled={createdTasks.has(t) || creatingTask === t}
                                className="text-xs font-semibold shrink-0 disabled:opacity-60"
                              >
                                {createdTasks.has(t) ? (
                                  <span className="text-emerald-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Created</span>
                                ) : creatingTask === t ? (
                                  <span className="text-slate-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Creating…</span>
                                ) : (
                                  <span className="text-amber-600 hover:text-amber-800">+ Create Task</span>
                                )}
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Fresh AI suggestions (just fetched) */}
                    {sug && (
                      <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 space-y-3">
                        <p className="text-xs font-bold text-purple-700 flex items-center gap-1">
                          <Sparkles className="w-3.5 h-3.5" /> AI Mitigation Suggestions
                        </p>
                        {sug.mitigation_summary && (
                          <div>
                            <p className="text-[10px] font-semibold text-purple-500 uppercase tracking-wide mb-0.5">Mitigation Summary</p>
                            <p className="text-xs text-purple-800 leading-relaxed">{sug.mitigation_summary}</p>
                          </div>
                        )}
                        {sug.contingency_plan && (
                          <div>
                            <p className="text-[10px] font-semibold text-purple-500 uppercase tracking-wide mb-0.5">Contingency Plan</p>
                            <p className="text-xs text-purple-800 leading-relaxed">{sug.contingency_plan}</p>
                          </div>
                        )}
                        {sug.timeline && (
                          <div>
                            <p className="text-[10px] font-semibold text-purple-500 uppercase tracking-wide mb-0.5">Timeline</p>
                            <p className="text-xs text-purple-800 leading-relaxed">{sug.timeline}</p>
                          </div>
                        )}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-[10px] font-semibold text-purple-500 uppercase tracking-wide">Suggested Mitigation Tasks</p>
                            {(sug.suggested_tasks || []).length > 0 && (
                              <button
                                onClick={() => Promise.all((sug.suggested_tasks || []).map(t => createTaskFromSuggestion(t)))}
                                className="text-[10px] text-purple-700 hover:text-purple-900 font-semibold"
                              >
                                + Create all as Tasks
                              </button>
                            )}
                          </div>
                          <div className="space-y-1">
                            {(sug.suggested_tasks || []).map((t, i) => (
                              <div key={i} className="flex items-center justify-between gap-2 bg-white border border-purple-100 rounded px-3 py-1.5">
                                <span className="text-xs text-slate-700">{t}</span>
                                <button
                                  onClick={() => createTaskFromSuggestion(t)}
                                  disabled={createdTasks.has(t) || creatingTask === t}
                                  className="text-xs font-semibold shrink-0 disabled:opacity-60"
                                >
                                  {createdTasks.has(t) ? (
                                    <span className="text-emerald-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Created</span>
                                  ) : creatingTask === t ? (
                                    <span className="text-slate-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Creating…</span>
                                  ) : (
                                    <span className="text-amber-600 hover:text-amber-800">+ Create Task</span>
                                  )}
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                        <button
                          onClick={() => applySuggestedTasks(risk, sug.suggested_tasks)}
                          className="flex items-center gap-1 text-xs px-3 py-1.5 bg-purple-600 text-white rounded hover:bg-purple-500 font-semibold"
                        >
                          <CheckCircle2 className="w-3 h-3" /> Save to Risk Record
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Risk Matrix (3x4 heatmap) ──────────────────────────────────────────────
function RiskMatrix({ risks }) {
  const probs  = ['high', 'medium', 'low'];
  const impacts = ['low', 'medium', 'high', 'critical'];

  const cell = (prob, imp) => risks.filter(r => r.probability === prob && r.impact === imp);
  const score = (prob, imp) => (PROB_SCORE[prob] || 1) * (IMPACT_SCORE[imp] || 1);
  const cellBg = (s) =>
    s >= 9 ? 'bg-red-100 hover:bg-red-200'
    : s >= 6 ? 'bg-amber-100 hover:bg-amber-200'
    : s >= 3 ? 'bg-yellow-50 hover:bg-yellow-100'
    : 'bg-slate-50 hover:bg-slate-100';

  return (
    <div className="bg-white rounded-lg shadow-sm p-4">
      <h3 className="font-semibold text-slate-700 text-sm mb-3 flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-500" /> Risk Heatmap
      </h3>
      <div className="overflow-x-auto">
        <table className="text-xs w-full">
          <thead>
            <tr>
              <th className="text-left pb-1 text-slate-400 font-normal pr-2 w-16">Prob ↓ Impact →</th>
              {impacts.map(imp => (
                <th key={imp} className="pb-1 text-slate-500 capitalize font-semibold text-center px-2">{imp}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {probs.map(prob => (
              <tr key={prob}>
                <td className="py-1 pr-2 text-slate-500 capitalize font-semibold">{prob}</td>
                {impacts.map(imp => {
                  const items = cell(prob, imp);
                  const s = score(prob, imp);
                  return (
                    <td key={imp} className={`py-1 px-2 text-center rounded transition-colors ${cellBg(s)}`}>
                      {items.length > 0 ? (
                        <span className="font-bold text-slate-700">{items.length}</span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-3 mt-3 text-[10px]">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-200 inline-block" />Critical (≥9)</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-200 inline-block" />High (6–8)</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-100 inline-block" />Medium (3–5)</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-slate-100 inline-block" />Low (1–2)</span>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, color }) {
  return (
    <div className={`bg-white rounded-lg shadow-sm p-4 border-l-4 ${color}`}>
      <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">{label}</div>
      <div className="text-xl font-semibold text-slate-800">{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function Spinner() {
  return <div className="flex justify-center py-12"><div className="w-7 h-7 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;
}