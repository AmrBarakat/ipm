import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { X, Loader2, CheckCircle2, AlertTriangle, FileSpreadsheet, ChevronDown, ChevronUp, Info, Download } from 'lucide-react';
import * as XLSX from 'xlsx';

function downloadTemplate() {
  const wb = XLSX.utils.book_new();

  // ── Sheet 1: WBS Items ──────────────────────────────────────────────────────
  const wbsHeaders = [
    'WBS', 'Activity Name', 'Task Mode', 'Duration (Days)',
    'Start Date', 'Finish Date', 'Predecessor',
    'Responsible', 'Status', 'Weight (%)', 'EV Method', 'Deliverable / Remarks'
  ];
  const wbsSamples = [
    ['1',     'INITIATION',                 'Summary',  '',  '2025-01-01', '2025-01-10', '',  '',          'not_started', '',   '',                  ''],
    ['1.1',   'Project Kickoff Meeting',    'Task',      2,  '2025-01-01', '2025-01-02', '',  'PM',        'not_started', '',   '50/50',             'Kickoff minutes'],
    ['1.2',   'Project Charter Approved',   'Milestone', 0,  '2025-01-10', '2025-01-10', '1.1','PM',      'not_started', '',   '0/100',             'Signed charter'],
    ['2',     'ENGINEERING',                'Summary',  '',  '2025-01-11', '2025-02-28', '',  '',          'not_started', '',   '',                  ''],
    ['2.1',   'Electrical Design',          'Task',     20,  '2025-01-11', '2025-01-31', '1.2','Engineer', 'not_started', '',   '% Complete',        'Drawings set'],
    ['2.2',   'PLC Programming',            'Task',     30,  '2025-02-01', '2025-02-28', '2.1','Engineer', 'not_started', '',   'Weighted Milestone','Program files'],
    ['2.3',   'Engineering Complete',       'Milestone', 0,  '2025-02-28', '2025-02-28', '2.2','',        'not_started', '',   '0/100',             ''],
    ['3',     'PROCUREMENT',                'Summary',  '',  '2025-01-15', '2025-03-15', '',  '',          'not_started', '',   '',                  ''],
    ['3.1',   'PLC Hardware Ordered',       'Task',      5,  '2025-01-15', '2025-01-20', '1.2','PM',       'not_started', '',   '0/100',             'PO issued'],
    ['3.2',   'Hardware Received',          'Milestone', 0,  '2025-03-15', '2025-03-15', '3.1','',        'not_started', '',   '0/100',             ''],
    ['4',     'T&C ACTIVITIES',             'Summary',  '',  '2025-03-16', '2025-04-30', '',  '',          'not_started', '',   '',                  ''],
    ['4.1',   'Signal Testing',             'Task',     14,  '2025-03-16', '2025-03-30', '3.2','Engineer', 'not_started', '',   '% Complete',        'Test sheets'],
    ['4.2',   'FAT',                        'Task',      5,  '2025-04-01', '2025-04-05', '4.1','PM',       'not_started', '',   'Weighted Milestone','FAT report'],
    ['4.3',   'SAT',                        'Task',      5,  '2025-04-10', '2025-04-15', '4.2','Engineer', 'not_started', '',   'Weighted Milestone','SAT report'],
    ['4.4',   'Commissioning Complete',     'Milestone', 0,  '2025-04-30', '2025-04-30', '4.3','',        'not_started', '',   '0/100',             ''],
    ['5',     'HANDOVER',                   'Summary',  '',  '2025-05-01', '2025-05-15', '',  '',          'not_started', '',   '',                  ''],
    ['5.1',   'As-Built Documentation',     'Task',      7,  '2025-05-01', '2025-05-07', '4.4','Engineer', 'not_started', '',   '0/100',             'As-built docs'],
    ['5.2',   'Project Handover Sign-off',  'Milestone', 0,  '2025-05-15', '2025-05-15', '5.1','PM',      'not_started', '',   '0/100',             'Signed handover'],
  ];
  const wbsWs = XLSX.utils.aoa_to_sheet([wbsHeaders, ...wbsSamples]);
  // Column widths
  wbsWs['!cols'] = [8,32,12,8,12,12,10,12,12,8,16,24].map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, wbsWs, 'WBS Items');

  // ── Sheet 2: Milestones ─────────────────────────────────────────────────────
  const msHeaders = ['Title', 'Planned Date', 'Weight (%)', 'Description'];
  const msSamples = [
    ['PROJECT KICKOFF',          '2025-01-02', 10, 'Project officially started'],
    ['ENGINEERING COMPLETE',     '2025-02-28', 20, 'All drawings approved'],
    ['HARDWARE RECEIVED',        '2025-03-15', 15, 'All equipment on site'],
    ['FAT COMPLETE',             '2025-04-05', 20, 'Factory acceptance passed'],
    ['SAT COMPLETE',             '2025-04-15', 20, 'Site acceptance passed'],
    ['PROJECT HANDOVER',         '2025-05-15', 15, 'Final handover signed off'],
  ];
  const msWs = XLSX.utils.aoa_to_sheet([msHeaders, ...msSamples]);
  msWs['!cols'] = [30, 14, 10, 36].map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, msWs, 'Milestones');

  // ── Sheet 3: Instructions ───────────────────────────────────────────────────
  const instrData = [
    ['FIELD',          'REQUIRED?', 'ACCEPTED VALUES / FORMAT',                           'NOTES'],
    ['WBS',            'Auto',      '1 / 1.1 / 1.1.1  (dot-notation, max 3 levels)',      'Leave blank — AI will auto-number from hierarchy'],
    ['Activity Name',  'YES',       'Any text',                                            'Use ALL CAPS for Phase headers (e.g. INITIATION)'],
    ['Task Mode',      'Optional',  'Summary | Task | Milestone',                          'Blank → AI auto-detects from WBS depth & duration'],
    ['Duration (Days)','Optional',  'Number (integer)',                                    '0 or blank on a phase header → treated as Milestone'],
    ['Start Date',     'Optional',  'YYYY-MM-DD',                                          ''],
    ['Finish Date',    'Optional',  'YYYY-MM-DD',                                          ''],
    ['Predecessor',    'Optional',  'WBS code of predecessor task (e.g. 2.1)',             'Leave blank if none'],
    ['Responsible',    'Optional',  'Name or role',                                        ''],
    ['Status',         'Optional',  'not_started | in_progress | completed | blocked',     'Default: not_started'],
    ['Weight (%)',     'Optional',  '0–100 (leaf tasks should sum to 100)',                'Leave blank → AI calculates from duration'],
    ['EV Method',      'Optional',  '0/100 | 50/50 | % Complete | Weighted Milestone',    'Leave blank → AI assigns based on task type'],
    ['Deliverable',    'Optional',  'Any text',                                            'Document or output description'],
    ['','','',''],
    ['TIPS','','',''],
    ['1. Phase headers (Level 1) should be ALL CAPS with no duration — they become Summary rows.','','',''],
    ['2. Milestones should have Duration = 0 OR end with keywords: Kickoff, Completion, Handover, Sign-off, Approved, FAT, SAT.','','',''],
    ['3. Parent–child relationships are derived from WBS dot-notation depth (1 → 1.1 → 1.1.1).','','',''],
    ['4. Keep the column headers exactly as shown (or use recognised aliases listed above).','','',''],
    ['5. Dates must be YYYY-MM-DD format for reliable parsing.','','',''],
  ];
  const instrWs = XLSX.utils.aoa_to_sheet(instrData);
  instrWs['!cols'] = [22, 10, 44, 40].map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, instrWs, 'Instructions');

  XLSX.writeFile(wb, 'ProjectPlan_Template.xlsx');
}

/**
 * Extracts WBS items and Milestones from a Project Plan Excel/CSV document
 * using the Auto-Detection specification (v1.0):
 *  - Smart column mapping with fuzzy aliases
 *  - WBS hierarchy from WBS column, indentation, or keyword detection
 *  - Milestone auto-creation (duration=0, keyword endings, phase headers)
 *  - EV method auto-assignment
 *  - Weight auto-calculation (duration-adjusted, normalised to 100%)
 *  - AI-generated milestone insertion for phases with no open/close milestone
 */
async function convertFileToPlainText(fileUrl) {
  const response = await fetch(fileUrl);
  const arrayBuffer = await response.arrayBuffer();
  const url = (fileUrl || '').toLowerCase().split('?')[0];
  const ext = url.match(/\.[^.]+$/)?.[0] || '';
  if (ext === '.csv' || ext === '.txt') {
    return new TextDecoder().decode(arrayBuffer);
  }
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellFormula: false, cellHTML: false });
  const allText = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    if (csv.trim().length > 10) allText.push(`=== SHEET: ${sheetName} ===\n${csv}`);
  }
  return allText.join('\n\n');
}

export default function ProjectPlanExtractModal({ document, projectId, project, onClose, onApplied }) {
  const [step, setStep] = useState('idle');
  const [error, setError] = useState('');
  const [extracted, setExtracted] = useState(null);
  const [selected, setSelected] = useState({ milestones: {}, wbs_items: {} });
  const [showMilestones, setShowMilestones] = useState(true);
  const [showWBS, setShowWBS] = useState(true);
  const [applyResult, setApplyResult] = useState(null);

  async function runExtraction() {
    setStep('extracting');
    setError('');
    try {
      // Convert Excel/CSV to plain text on the frontend (same as BOM extraction)
      const plainText = await convertFileToPlainText(document.file_url);
      if (!plainText || plainText.trim().length < 20) throw new Error('Could not read content from this file. Please ensure it is a valid Excel or CSV file.');

      // Send plain text to backend
      const res = await base44.functions.invoke('extractProjectPlan', {
        plain_text: plainText.slice(0, 80000),
        file_name: document.file_name,
        project_name: project?.name,
        project_type: project?.project_type,
        start_date: project?.start_date,
      });

      const { milestones = [], wbs_items = [], project_name } = res.data;

      setExtracted({ milestones, wbs_items, project_name });

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

    const msTitleToId = {};

    // Create milestones
    const selectedMs = (extracted.milestones || []).filter((_, i) => selected.milestones[i]);
    for (const ms of selectedMs) {
      const record = await base44.entities.Milestone.create({
        project_id: projectId,
        title: ms.title,
        planned_date: ms.planned_date || undefined,
        weight: ms.weight || 0,
        description: [ms.description, ms.is_ai_generated ? '[AI-Generated]' : ''].filter(Boolean).join(' ') || '',
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
        description: [w.deliverable, w.remarks, w.is_ai_generated ? '[AI-Generated]' : ''].filter(Boolean).join(' | ') || undefined,
        planned_hours: w.duration_days ? w.duration_days * 8 : undefined,
      });
      wbsCodeToId[w.wbs_code] = record.id;
      wbsCreated++;
    }

    // Second pass — patch parent_id, milestone_id, and predecessor_ids links
    for (const w of selectedWBS) {
      const patches = {};

      // Link parent
      if (w.parent_code && wbsCodeToId[w.parent_code] && wbsCodeToId[w.wbs_code]) {
        patches.parent_id = wbsCodeToId[w.parent_code];
      }

      // Link milestone: match by exact title or case-insensitive prefix
      if (w.milestone_title || w.ev_method === '0/100') {
        const targetTitle = (w.milestone_title || '').trim().toUpperCase();
        const matched = Object.entries(msTitleToId).find(([title]) =>
          title.toUpperCase() === targetTitle ||
          title.toUpperCase().includes(targetTitle) ||
          targetTitle.includes(title.toUpperCase())
        );
        if (matched) patches.milestone_id = matched[1];
      }

      // Link predecessors: map wbs_code strings to actual IDs
      if (w.predecessor) {
        const predCodes = String(w.predecessor).split(/[,;]+/).map(s => s.trim()).filter(Boolean);
        const predIds = predCodes.map(code => wbsCodeToId[code]).filter(Boolean);
        if (predIds.length > 0) patches.predecessor_ids = predIds;
      }

      if (Object.keys(patches).length > 0 && wbsCodeToId[w.wbs_code]) {
        await base44.entities.WBSItem.update(wbsCodeToId[w.wbs_code], patches);
      }
    }

    setApplyResult({ msCreated, wbsCreated });
    setStep('done');
  }

  function toggleAll(type, value) {
    const list = type === 'milestones' ? extracted.milestones : extracted.wbs_items;
    const newSel = {};
    list.forEach((_, i) => { newSel[i] = value; });
    setSelected(prev => ({ ...prev, [type]: newSel }));
  }

  const msCount = Object.values(selected.milestones).filter(Boolean).length;
  const wbsCount = Object.values(selected.wbs_items).filter(Boolean).length;

  const taskModeColor = {
    milestone: 'bg-amber-100 text-amber-700',
    summary:   'bg-blue-100 text-blue-700',
    task:      'bg-slate-100 text-slate-600',
  };

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
            <div className="py-6 space-y-5">
              <div className="text-center space-y-3">
                <FileSpreadsheet className="w-12 h-12 mx-auto text-blue-300" />
                <p className="text-slate-600 text-sm max-w-md mx-auto">
                  AI will read the file and extract <strong>WBS items</strong> and <strong>Milestones</strong> using smart auto-detection:
                  column mapping, hierarchy recognition, milestone triggers, EV method assignment, and weight normalization.
                </p>
              </div>

              {/* Template download card */}
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3 max-w-lg mx-auto">
                <Download className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-amber-800">For best results, use the standard template</p>
                  <p className="text-xs text-amber-700 mt-0.5 mb-2">
                    Download the Excel template with sample data, correct column names, and instructions sheet. Fill it in and re-upload as a <em>Project Plan</em> document.
                  </p>
                  <button onClick={downloadTemplate}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-white text-xs font-semibold rounded">
                    <Download className="w-3.5 h-3.5" /> Download Template (.xlsx)
                  </button>
                </div>
              </div>

              <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 max-w-lg mx-auto">
                <Info className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                <p className="text-xs text-blue-700">Uses Claude Sonnet for high-quality extraction. This may take 15–30 seconds.</p>
              </div>

              <div className="text-center">
                <button onClick={runExtraction}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm rounded-lg">
                  Start Extraction
                </button>
              </div>
            </div>
          )}

          {/* Extracting */}
          {step === 'extracting' && (
            <div className="text-center py-14 space-y-3">
              <Loader2 className="w-10 h-10 mx-auto text-blue-500 animate-spin" />
              <p className="text-slate-600 text-sm">Analyzing file structure, detecting hierarchy and milestones…</p>
              <p className="text-xs text-slate-400">This may take up to 30 seconds</p>
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
              {extracted.project_name && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 flex items-center gap-2 text-sm">
                  <span className="text-slate-400 text-xs">Detected project name:</span>
                  <span className="font-semibold text-slate-700">{extracted.project_name}</span>
                </div>
              )}
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
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-slate-800">{m.title}</span>
                            {m.is_ai_generated && (
                              <span className="text-xs bg-purple-100 text-purple-600 rounded px-1.5 py-0.5 font-medium">AI-Generated</span>
                            )}
                            {m.ev_method && (
                              <span className="text-xs bg-green-50 text-green-700 border border-green-200 rounded px-1.5 py-0.5">{m.ev_method}</span>
                            )}
                          </div>
                          <div className="text-xs text-slate-400 flex gap-3 mt-0.5 flex-wrap">
                            {m.planned_date && <span>📅 {m.planned_date}</span>}
                            {m.weight != null && <span>⚖️ {m.weight}%</span>}
                            {m.description && <span className="truncate max-w-xs">{m.description}</span>}
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
                    {extracted.wbs_items.map((w, i) => {
                      const depth = (w.wbs_code || '').split('.').length - 1;
                      return (
                        <label key={i} className={`flex items-start gap-3 px-4 py-2.5 hover:bg-slate-50 cursor-pointer ${w.task_mode === 'summary' ? 'bg-blue-50/40' : ''}`}>
                          <input type="checkbox" checked={!!selected.wbs_items[i]}
                            onChange={e => setSelected(prev => ({ ...prev, wbs_items: { ...prev.wbs_items, [i]: e.target.checked } }))}
                            className="mt-0.5 accent-purple-500" />
                          <div className="flex-1 min-w-0" style={{ paddingLeft: depth * 12 }}>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-slate-400 text-xs shrink-0">{w.wbs_code}</span>
                              <span className={`text-sm font-medium ${w.task_mode === 'summary' ? 'text-blue-800 font-semibold' : 'text-slate-800'}`}>{w.name}</span>
                              {w.task_mode && (
                                <span className={`text-xs rounded px-1.5 py-0.5 font-medium ${taskModeColor[w.task_mode] || 'bg-slate-100 text-slate-500'}`}>
                                  {w.task_mode}
                                </span>
                              )}
                              {w.is_ai_generated && (
                                <span className="text-xs bg-purple-100 text-purple-600 rounded px-1.5 py-0.5">AI-Generated</span>
                              )}
                            </div>
                            <div className="text-xs text-slate-400 flex gap-3 mt-0.5 flex-wrap">
                              {w.duration_days != null && <span>⏱ {w.duration_days}d</span>}
                              {w.assignee && <span>👤 {w.assignee}</span>}
                              {w.planned_start && <span>▶ {w.planned_start}</span>}
                              {w.planned_end && <span>⏹ {w.planned_end}</span>}
                              {w.weight != null && <span>⚖️ {w.weight}%</span>}
                              {w.ev_method && <span className="text-green-600 font-medium">{w.ev_method}</span>}
                              {w.parent_code && <span className="text-purple-400">↳ {w.parent_code}</span>}
                              {w.predecessor && <span className="text-orange-500">⟵ {w.predecessor}</span>}
                            </div>
                            {(w.remarks || w.deliverable) && (
                              <div className="text-xs text-slate-400 mt-0.5 italic truncate max-w-sm">
                                {[w.deliverable, w.remarks].filter(Boolean).join(' · ')}
                              </div>
                            )}
                          </div>
                        </label>
                      );
                    })}
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