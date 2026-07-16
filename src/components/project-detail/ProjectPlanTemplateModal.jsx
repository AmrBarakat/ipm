import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { X, Plus, Trash2, Save, Wand2, ChevronDown, ChevronRight, Flag, Layers, Check } from 'lucide-react';
import { toLocalDate } from '@/lib/utils';
import { useConfirm } from '@/components/ui/ConfirmDialog';

const inp = 'border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white w-full';

const EMPTY_TEMPLATE = {
  name: '',
  description: '',
  project_type: '',
  milestones: [],
  wbs_items: [],
};

const EMPTY_MS = { title: '', offset_days: 0, weight: 0 };
const EMPTY_WBS = { wbs_code: '', name: '', parent_code: '', milestone_title: '', assignee: '', duration_days: 5, offset_days: 0, weight: 0, planned_hours: '' };

export default function ProjectPlanTemplateModal({ projectId, project, onClose, onApplied }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('list'); // 'list' | 'create' | 'apply'
  const [form, setForm] = useState(EMPTY_TEMPLATE);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [applying, setApplying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [applyResult, setApplyResult] = useState(null);
  const [msExpanded, setMsExpanded] = useState(true);
  const [wbsExpanded, setWbsExpanded] = useState(true);
  const confirmDialog = useConfirm();

  useEffect(() => { loadTemplates(); }, []);

  async function loadTemplates() {
    setLoading(true);
    const t = await base44.entities.ProjectPlanTemplate.list('-created_date', 100);
    setTemplates(t);
    setLoading(false);
  }

  async function saveTemplate(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    if (form.id) {
      await base44.entities.ProjectPlanTemplate.update(form.id, form);
    } else {
      await base44.entities.ProjectPlanTemplate.create(form);
    }
    setSaving(false);
    await loadTemplates();
    setView('list');
    setForm(EMPTY_TEMPLATE);
  }

  async function deleteTemplate(id) {
    if (!(await confirmDialog({ title: 'Delete template', description: 'Delete this template?', confirmText: 'Delete', destructive: true }))) return;
    await base44.entities.ProjectPlanTemplate.delete(id);
    loadTemplates();
  }

  async function applyTemplate(template) {
    if (!(await confirmDialog({ title: 'Apply template', description: `Apply "${template.name}" to project "${project?.name}"? This will ADD items without deleting existing ones.`, confirmText: 'Continue', destructive: false }))) return;
    setApplying(true);
    setApplyResult(null);

    const startDate = project?.start_date ? new Date(project.start_date) : new Date();

    function addDays(d, n) {
      const r = new Date(d);
      r.setDate(r.getDate() + n);
      return toLocalDate(r);
    }

    // Create milestones first
    const msMap = {}; // title -> created id
    let msCreated = 0;
    for (const ms of (template.milestones || [])) {
      const created = await base44.entities.Milestone.create({
        project_id: projectId,
        title: ms.title,
        planned_date: addDays(startDate, ms.offset_days || 0),
        weight: ms.weight || 0,
        status: 'pending',
      });
      msMap[ms.title] = created.id;
      msCreated++;
    }

    // Create WBS items (two passes: roots first, then children)
    const wbsItems = template.wbs_items || [];
    const codeToId = {}; // wbs_code -> created id
    let wbsCreated = 0;

    // Sort: items without parent_code first
    const sorted = [
      ...wbsItems.filter(w => !w.parent_code),
      ...wbsItems.filter(w => !!w.parent_code),
    ];

    for (const w of sorted) {
      const parentId = w.parent_code ? codeToId[w.parent_code] : null;
      const milestoneId = w.milestone_title ? msMap[w.milestone_title] : null;
      const planned_start = addDays(startDate, w.offset_days || 0);
      const planned_end = addDays(startDate, (w.offset_days || 0) + (w.duration_days || 5));

      const created = await base44.entities.WBSItem.create({
        project_id: projectId,
        wbs_code: w.wbs_code,
        name: w.name,
        parent_id: parentId || null,
        milestone_id: milestoneId || null,
        assignee: w.assignee || '',
        planned_start,
        planned_end,
        weight: w.weight || 0,
        planned_hours: w.planned_hours || null,
        status: 'not_started',
        progress: 0,
      });
      codeToId[w.wbs_code] = created.id;
      wbsCreated++;
    }

    setApplying(false);
    setApplyResult({ msCreated, wbsCreated });
    onApplied?.();
  }

  // ── Template Editor Helpers ──────────────────────────────────────────────────

  function addMs() { setForm(f => ({ ...f, milestones: [...(f.milestones || []), { ...EMPTY_MS }] })); }
  function removeMs(i) { setForm(f => ({ ...f, milestones: f.milestones.filter((_, idx) => idx !== i) })); }
  function updateMs(i, field, val) {
    setForm(f => { const ms = [...f.milestones]; ms[i] = { ...ms[i], [field]: val }; return { ...f, milestones: ms }; });
  }

  function addWbs() { setForm(f => ({ ...f, wbs_items: [...(f.wbs_items || []), { ...EMPTY_WBS }] })); }
  function removeWbs(i) { setForm(f => ({ ...f, wbs_items: f.wbs_items.filter((_, idx) => idx !== i) })); }
  function updateWbs(i, field, val) {
    setForm(f => { const w = [...f.wbs_items]; w[i] = { ...w[i], [field]: val }; return { ...f, wbs_items: w }; });
  }

  function editTemplate(t) {
    setForm({ ...t });
    setView('create');
  }

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-amber-500" />
            <h2 className="font-bold text-slate-800 text-base">Project Plan Templates</h2>
          </div>
          <div className="flex items-center gap-2">
            {view === 'list' && (
              <button onClick={() => { setForm(EMPTY_TEMPLATE); setView('create'); }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded">
                <Plus className="w-4 h-4" /> New Template
              </button>
            )}
            {view !== 'list' && (
              <button onClick={() => { setView('list'); setForm(EMPTY_TEMPLATE); setApplyResult(null); }}
                className="px-3 py-1.5 border border-slate-200 text-slate-600 text-sm rounded hover:bg-slate-100">
                ← Back
              </button>
            )}
            <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded text-slate-400">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">

          {/* ── LIST VIEW ── */}
          {view === 'list' && (
            <div className="space-y-3">
              {loading && <div className="flex justify-center py-8"><div className="w-6 h-6 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>}
              {!loading && templates.length === 0 && (
                <div className="text-center py-14 text-slate-400">
                  <Layers className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No templates yet. Create one to get started.</p>
                </div>
              )}
              {templates.map(t => (
                <div key={t.id} className="bg-white border border-slate-200 rounded-lg px-4 py-3 flex items-start gap-3 hover:shadow-sm transition">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-slate-800 text-sm">{t.name}</div>
                    {t.description && <div className="text-xs text-slate-400 mt-0.5">{t.description}</div>}
                    <div className="flex gap-3 mt-1.5 text-xs text-slate-500">
                      <span className="flex items-center gap-1"><Flag className="w-3 h-3 text-amber-500" /> {(t.milestones || []).length} milestones</span>
                      <span className="flex items-center gap-1"><Layers className="w-3 h-3 text-purple-500" /> {(t.wbs_items || []).length} WBS items</span>
                      {t.project_type && <span className="bg-slate-100 px-2 py-0.5 rounded">{t.project_type}</span>}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => editTemplate(t)}
                      className="px-2.5 py-1.5 border border-slate-200 text-xs text-slate-600 rounded hover:bg-slate-100">Edit</button>
                    <button onClick={() => applyTemplate(t)} disabled={applying}
                      className="flex items-center gap-1 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs rounded disabled:opacity-50">
                      <Wand2 className="w-3.5 h-3.5" /> Apply to Project
                    </button>
                    <button onClick={() => deleteTemplate(t.id)}
                      className="p-1.5 border border-slate-200 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}

              {applyResult && (
                <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm text-emerald-800">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                  Template applied! Created <strong>{applyResult.msCreated}</strong> milestones and <strong>{applyResult.wbsCreated}</strong> WBS items.
                </div>
              )}
            </div>
          )}

          {/* ── CREATE / EDIT VIEW ── */}
          {view === 'create' && (
            <form onSubmit={saveTemplate} className="space-y-5">
              {/* Basic info */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Template name *" className={inp + ' text-sm'} required />
                <select value={form.project_type} onChange={e => setForm(f => ({ ...f, project_type: e.target.value }))} className={inp + ' text-sm'}>
                  <option value="">All project types</option>
                  {['plc', 'plc_scada', 'pme', 'service', 'other'].map(t => <option key={t} value={t}>{t.replace(/_/g, ' ').toUpperCase()}</option>)}
                </select>
                <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Description (optional)" className={inp + ' text-sm'} />
              </div>

              {/* Milestones section */}
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <button type="button" onClick={() => setMsExpanded(v => !v)}
                  className="w-full flex items-center gap-2 px-4 py-2.5 bg-amber-50 border-b border-amber-100 hover:bg-amber-100 text-left">
                  <Flag className="w-4 h-4 text-amber-500" />
                  <span className="font-semibold text-amber-800 text-sm">Milestones ({(form.milestones || []).length})</span>
                  {msExpanded ? <ChevronDown className="w-4 h-4 ml-auto text-amber-500" /> : <ChevronRight className="w-4 h-4 ml-auto text-amber-500" />}
                </button>
                {msExpanded && (
                  <div className="p-3 space-y-2">
                    <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-slate-400 uppercase px-1">
                      <div className="col-span-5">Title</div>
                      <div className="col-span-3">Offset from Start (days)</div>
                      <div className="col-span-3">Weight %</div>
                      <div className="col-span-1" />
                    </div>
                    {(form.milestones || []).map((ms, i) => (
                      <div key={i} className="grid grid-cols-12 gap-2 items-center">
                        <input value={ms.title} onChange={e => updateMs(i, 'title', e.target.value)}
                          placeholder="Milestone title" className={inp + ' col-span-5'} required />
                        <input type="number" value={ms.offset_days} onChange={e => updateMs(i, 'offset_days', Number(e.target.value))}
                          className={inp + ' col-span-3'} min="0" />
                        <input type="number" value={ms.weight} onChange={e => updateMs(i, 'weight', Number(e.target.value))}
                          className={inp + ' col-span-3'} min="0" max="100" />
                        <button type="button" onClick={() => removeMs(i)} className="col-span-1 flex justify-center p-1 text-slate-300 hover:text-red-500">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    <button type="button" onClick={addMs}
                      className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 font-medium mt-1">
                      <Plus className="w-3.5 h-3.5" /> Add Milestone
                    </button>
                  </div>
                )}
              </div>

              {/* WBS Items section */}
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <button type="button" onClick={() => setWbsExpanded(v => !v)}
                  className="w-full flex items-center gap-2 px-4 py-2.5 bg-purple-50 border-b border-purple-100 hover:bg-purple-100 text-left">
                  <Layers className="w-4 h-4 text-purple-500" />
                  <span className="font-semibold text-purple-800 text-sm">WBS Items ({(form.wbs_items || []).length})</span>
                  {wbsExpanded ? <ChevronDown className="w-4 h-4 ml-auto text-purple-500" /> : <ChevronRight className="w-4 h-4 ml-auto text-purple-500" />}
                </button>
                {wbsExpanded && (
                  <div className="p-3 space-y-2">
                    <div className="grid grid-cols-12 gap-1.5 text-xs font-semibold text-slate-400 uppercase px-1">
                      <div className="col-span-1">Code</div>
                      <div className="col-span-3">Name</div>
                      <div className="col-span-1">Parent Code</div>
                      <div className="col-span-2">Milestone</div>
                      <div className="col-span-1">Assignee</div>
                      <div className="col-span-1">Offset (d)</div>
                      <div className="col-span-1">Duration (d)</div>
                      <div className="col-span-1">Hrs</div>
                      <div className="col-span-1">Wt%</div>
                      <div className="col-span-1" />
                    </div>
                    {(form.wbs_items || []).map((w, i) => (
                      <div key={i} className="grid grid-cols-12 gap-1.5 items-center">
                        <input value={w.wbs_code} onChange={e => updateWbs(i, 'wbs_code', e.target.value)}
                          placeholder="1.1" className={inp + ' col-span-1'} required />
                        <input value={w.name} onChange={e => updateWbs(i, 'name', e.target.value)}
                          placeholder="Task name" className={inp + ' col-span-3'} required />
                        <input value={w.parent_code} onChange={e => updateWbs(i, 'parent_code', e.target.value)}
                          placeholder="e.g. 1" className={inp + ' col-span-1'} />
                        <input value={w.milestone_title} onChange={e => updateWbs(i, 'milestone_title', e.target.value)}
                          placeholder="Milestone title" className={inp + ' col-span-2'} list={`ms-list-${i}`} />
                        <datalist id={`ms-list-${i}`}>
                          {(form.milestones || []).map((m, mi) => <option key={mi} value={m.title} />)}
                        </datalist>
                        <input value={w.assignee} onChange={e => updateWbs(i, 'assignee', e.target.value)}
                          placeholder="Name" className={inp + ' col-span-1'} />
                        <input type="number" value={w.offset_days} onChange={e => updateWbs(i, 'offset_days', Number(e.target.value))}
                          className={inp + ' col-span-1'} min="0" />
                        <input type="number" value={w.duration_days} onChange={e => updateWbs(i, 'duration_days', Number(e.target.value))}
                          className={inp + ' col-span-1'} min="1" />
                        <input type="number" value={w.planned_hours} onChange={e => updateWbs(i, 'planned_hours', e.target.value)}
                          className={inp + ' col-span-1'} min="0" placeholder="—" />
                        <input type="number" value={w.weight} onChange={e => updateWbs(i, 'weight', Number(e.target.value))}
                          className={inp + ' col-span-1'} min="0" max="100" />
                        <button type="button" onClick={() => removeWbs(i)} className="col-span-1 flex justify-center p-1 text-slate-300 hover:text-red-500">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    <button type="button" onClick={addWbs}
                      className="flex items-center gap-1 text-xs text-purple-600 hover:text-purple-700 font-medium mt-1">
                      <Plus className="w-3.5 h-3.5" /> Add WBS Item
                    </button>
                  </div>
                )}
              </div>

              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => { setView('list'); setForm(EMPTY_TEMPLATE); }}
                  className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded hover:bg-slate-100">Cancel</button>
                <button type="submit" disabled={saving}
                  className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded disabled:opacity-50">
                  <Save className="w-4 h-4" /> {saving ? 'Saving…' : form.id ? 'Update Template' : 'Save Template'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}