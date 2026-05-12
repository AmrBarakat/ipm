import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { X, Loader2, CheckCircle2, AlertTriangle, FileSpreadsheet, ChevronDown, ChevronUp } from 'lucide-react';

/**
 * Extracts WBS items and Milestones from a Project Plan Excel/CSV document
 * via AI and lets the user review & apply them.
 */
export default function ProjectPlanExtractModal({ document, projectId, project, onClose, onApplied }) {
  const [step, setStep] = useState('idle'); // idle | extracting | review | applying | done | error
  const [error, setError] = useState('');
  const [extracted, setExtracted] = useState(null); // { milestones: [], wbs_items: [] }
  const [selected, setSelected] = useState({ milestones: {}, wbs_items: {} });
  const [showMilestones, setShowMilestones] = useState(true);
  const [showWBS, setShowWBS] = useState(true);
  const [applyResult, setApplyResult] = useState(null);

  async function runExtraction() {
    setStep('extracting');
    setError('');
    try {
      const fileRes = await fetch(document.file_url);
      const blob = await fileRes.blob();

      // Use ExtractDataFromUploadedFile via UploadFile first, then InvokeLLM for structured extraction
      const uploadRes = await base44.integrations.Core.UploadFile({ file: blob });
      const fileUrl = uploadRes.file_url;

      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a project management assistant. Extract all WBS (Work Breakdown Structure) items and Milestones from this project plan file.

For each WBS item extract:
- wbs_code (e.g. "1", "1.1", "1.2.3")
- name
- assignee (if present)
- planned_start (ISO date YYYY-MM-DD, if present)
- planned_end (ISO date YYYY-MM-DD, if present)
- duration_days (number, if present)
- weight (percentage weight 0-100, if present)
- parent_code (wbs_code of parent, if hierarchical)
- status (not_started, in_progress, completed, blocked — default not_started)

For each Milestone extract:
- title
- planned_date (ISO date YYYY-MM-DD, if present)
- weight (percentage weight 0-100, if present)
- description (if present)

Return ONLY valid JSON with keys "milestones" (array) and "wbs_items" (array).
If a field is missing, omit it from the object.`,
        file_urls: [fileUrl],
        response_json_schema: {
          type: 'object',
          properties: {
            milestones: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  planned_date: { type: 'string' },
                  weight: { type: 'number' },
                  description: { type: 'string' },
                },
              },
            },
            wbs_items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  wbs_code: { type: 'string' },
                  name: { type: 'string' },
                  assignee: { type: 'string' },
                  planned_start: { type: 'string' },
                  planned_end: { type: 'string' },
                  duration_days: { type: 'number' },
                  weight: { type: 'number' },
                  parent_code: { type: 'string' },
                  status: { type: 'string' },
                },
              },
            },
          },
        },
      });

      const milestones = (result.milestones || []).filter(m => m.title);
      const wbs_items = (result.wbs_items || []).filter(w => w.name);

      setExtracted({ milestones, wbs_items });

      // Pre-select all
      const ms = {};
      milestones.forEach((_, i) => { ms[i] = true; });
      const ws = {};
      wbs_items.forEach((_, i) => { ws[i] = true; });
      setSelected({ milestones: ms, wbs_items: ws });

      setStep('review');
    } catch (e) {
      setError(e.message || 'Extraction failed');
      setStep('error');
    }
  }

  async function applySelected() {
    setStep('applying');
    let msCreated = 0, wbsCreated = 0;

    // Build milestone title->id map after creation (for WBS linking)
    const msTitleToId = {};

    // Create milestones
    const selectedMs = (extracted.milestones || []).filter((_, i) => selected.milestones[i]);
    for (const ms of selectedMs) {
      const record = await base44.entities.Milestone.create({
        project_id: projectId,
        title: ms.title,
        planned_date: ms.planned_date || undefined,
        weight: ms.weight || 0,
        description: ms.description || '',
        status: 'pending',
        progress: 0,
      });
      msTitleToId[ms.title] = record.id;
      msCreated++;
    }

    // Create WBS items (first pass — no parent_id yet)
    const selectedWBS = (extracted.wbs_items || []).filter((_, i) => selected.wbs_items[i]);
    const wbsCodeToId = {};
    for (const w of selectedWBS) {
      const record = await base44.entities.WBSItem.create({
        project_id: projectId,
        wbs_code: w.wbs_code || '',
        name: w.name,
        assignee: w.assignee || '',
        planned_start: w.planned_start || undefined,
        planned_end: w.planned_end || undefined,
        weight: w.weight || 0,
        status: w.status || 'not_started',
        progress: 0,
      });
      wbsCodeToId[w.wbs_code] = record.id;
      wbsCreated++;
    }

    // Second pass — patch parent_id links
    for (const w of selectedWBS) {
      if (w.parent_code && wbsCodeToId[w.parent_code] && wbsCodeToId[w.wbs_code]) {
        await base44.entities.WBSItem.update(wbsCodeToId[w.wbs_code], {
          parent_id: wbsCodeToId[w.parent_code],
        });
      }
    }

    setApplyResult({ msCreated, wbsCreated });
    setStep('done');
  }

  function toggleAll(type, value) {
    const keys = Object.keys((type === 'milestones' ? extracted.milestones : extracted.wbs_items).reduce((a, _, i) => ({ ...a, [i]: true }), {}));
    const newSel = {};
    keys.forEach(k => { newSel[k] = value; });
    setSelected(prev => ({ ...prev, [type]: newSel }));
  }

  const msCount = Object.values(selected.milestones).filter(Boolean).length;
  const wbsCount = Object.values(selected.wbs_items).filter(Boolean).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-blue-600" />
            <div>
              <h2 className="font-semibold text-slate-800 text-base">Extract Project Plan</h2>
              <p className="text-xs text-slate-500 mt-0.5">{document.title}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded text-slate-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">

          {/* Idle */}
          {step === 'idle' && (
            <div className="text-center py-10 space-y-4">
              <FileSpreadsheet className="w-14 h-14 mx-auto text-blue-300" />
              <p className="text-slate-600 text-sm max-w-sm mx-auto">
                AI will read the uploaded Excel / CSV file and extract <strong>WBS items</strong> and <strong>Milestones</strong> for review before importing.
              </p>
              <button onClick={runExtraction}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm rounded-lg">
                Start Extraction
              </button>
            </div>
          )}

          {/* Extracting */}
          {step === 'extracting' && (
            <div className="text-center py-14 space-y-3">
              <Loader2 className="w-10 h-10 mx-auto text-blue-500 animate-spin" />
              <p className="text-slate-600 text-sm">Analyzing file with AI…</p>
            </div>
          )}

          {/* Error */}
          {step === 'error' && (
            <div className="text-center py-10 space-y-3">
              <AlertTriangle className="w-10 h-10 mx-auto text-red-400" />
              <p className="text-red-600 font-medium text-sm">{error}</p>
              <button onClick={runExtraction}
                className="px-4 py-2 border border-slate-300 rounded text-sm hover:bg-slate-50">Retry</button>
            </div>
          )}

          {/* Review */}
          {step === 'review' && extracted && (
            <div className="space-y-4">
              <p className="text-sm text-slate-500">Review extracted items. Uncheck any you don't want to import.</p>

              {/* Milestones */}
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <button onClick={() => setShowMilestones(v => !v)}
                  className="w-full flex items-center justify-between px-4 py-2.5 bg-amber-50 hover:bg-amber-100 text-amber-800 font-semibold text-sm">
                  <span>🏁 Milestones ({extracted.milestones.length})</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-normal text-amber-600">{msCount} selected</span>
                    <button onClick={e => { e.stopPropagation(); toggleAll('milestones', true); }} className="text-xs text-blue-600 hover:underline">All</button>
                    <button onClick={e => { e.stopPropagation(); toggleAll('milestones', false); }} className="text-xs text-slate-500 hover:underline">None</button>
                    {showMilestones ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </div>
                </button>
                {showMilestones && (
                  <div className="divide-y divide-slate-100">
                    {extracted.milestones.length === 0 && (
                      <p className="px-4 py-3 text-xs text-slate-400">No milestones found.</p>
                    )}
                    {extracted.milestones.map((m, i) => (
                      <label key={i} className="flex items-start gap-3 px-4 py-2.5 hover:bg-slate-50 cursor-pointer">
                        <input type="checkbox" checked={!!selected.milestones[i]}
                          onChange={e => setSelected(prev => ({ ...prev, milestones: { ...prev.milestones, [i]: e.target.checked } }))}
                          className="mt-0.5 accent-amber-500" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-slate-800">{m.title}</div>
                          <div className="text-xs text-slate-400 flex gap-3 mt-0.5">
                            {m.planned_date && <span>📅 {m.planned_date}</span>}
                            {m.weight != null && <span>⚖️ {m.weight}%</span>}
                            {m.description && <span className="truncate">{m.description}</span>}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* WBS Items */}
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <button onClick={() => setShowWBS(v => !v)}
                  className="w-full flex items-center justify-between px-4 py-2.5 bg-purple-50 hover:bg-purple-100 text-purple-800 font-semibold text-sm">
                  <span>🗂 WBS Items ({extracted.wbs_items.length})</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-normal text-purple-600">{wbsCount} selected</span>
                    <button onClick={e => { e.stopPropagation(); toggleAll('wbs_items', true); }} className="text-xs text-blue-600 hover:underline">All</button>
                    <button onClick={e => { e.stopPropagation(); toggleAll('wbs_items', false); }} className="text-xs text-slate-500 hover:underline">None</button>
                    {showWBS ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </div>
                </button>
                {showWBS && (
                  <div className="divide-y divide-slate-100">
                    {extracted.wbs_items.length === 0 && (
                      <p className="px-4 py-3 text-xs text-slate-400">No WBS items found.</p>
                    )}
                    {extracted.wbs_items.map((w, i) => (
                      <label key={i} className="flex items-start gap-3 px-4 py-2.5 hover:bg-slate-50 cursor-pointer">
                        <input type="checkbox" checked={!!selected.wbs_items[i]}
                          onChange={e => setSelected(prev => ({ ...prev, wbs_items: { ...prev.wbs_items, [i]: e.target.checked } }))}
                          className="mt-0.5 accent-purple-500" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-slate-800">
                            <span className="font-mono text-slate-400 mr-1.5">{w.wbs_code}</span>{w.name}
                          </div>
                          <div className="text-xs text-slate-400 flex gap-3 mt-0.5 flex-wrap">
                            {w.assignee && <span>👤 {w.assignee}</span>}
                            {w.planned_start && <span>▶ {w.planned_start}</span>}
                            {w.planned_end && <span>⏹ {w.planned_end}</span>}
                            {w.weight != null && <span>⚖️ {w.weight}%</span>}
                            {w.parent_code && <span className="text-purple-400">↳ {w.parent_code}</span>}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Applying */}
          {step === 'applying' && (
            <div className="text-center py-14 space-y-3">
              <Loader2 className="w-10 h-10 mx-auto text-purple-500 animate-spin" />
              <p className="text-slate-600 text-sm">Creating records…</p>
            </div>
          )}

          {/* Done */}
          {step === 'done' && applyResult && (
            <div className="text-center py-10 space-y-3">
              <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-500" />
              <p className="text-slate-700 font-semibold">Import Complete!</p>
              <div className="text-sm text-slate-500 space-y-1">
                <p>🏁 {applyResult.msCreated} milestone{applyResult.msCreated !== 1 ? 's' : ''} created</p>
                <p>🗂 {applyResult.wbsCreated} WBS item{applyResult.wbsCreated !== 1 ? 's' : ''} created</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 flex justify-between items-center">
          {step === 'done' ? (
            <>
              <span />
              <button onClick={onApplied}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm rounded-lg">
                Done
              </button>
            </>
          ) : (
            <>
              <button onClick={onClose} className="px-4 py-2 border border-slate-300 rounded text-sm hover:bg-slate-50 text-slate-600">
                Cancel
              </button>
              {step === 'review' && (
                <button onClick={applySelected} disabled={msCount + wbsCount === 0}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm rounded-lg disabled:opacity-50">
                  Import {msCount + wbsCount} item{msCount + wbsCount !== 1 ? 's' : ''}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}