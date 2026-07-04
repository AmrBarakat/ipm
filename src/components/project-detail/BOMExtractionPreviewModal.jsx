/**
 * BOM Extraction Preview Modal
 * Spec: BOM_Base44_Complete_Specification_v2.md — Parts L, M, N, O
 */
import { useState, useMemo, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import * as XLSX from 'xlsx';
import {
  X, Loader2, CheckCircle2, FileSearch, AlertTriangle,
  ChevronDown, ChevronRight, Check, Settings, Layers,
  GripVertical, FileText, Save, Trash2
} from 'lucide-react';
import BOMTemplateEditor from '@/components/bom/BOMTemplateEditor';
import { toast } from 'sonner';

// ─── Constants ────────────────────────────────────────────────────────────────

// E2. Category sort order
const CATEGORY_SORT_ORDER = [
  'plc','hmi','drive_vfd','sensor_instrument','meter','panel_enclosure',
  'cable_wiring','network_comms','software_license','service_labor','it_hardware','other',
];

const ALL_CATEGORIES = {
  plc: 'PLC', hmi: 'HMI', drive_vfd: 'Drive / VFD',
  sensor_instrument: 'Sensor / Instrument', meter: 'Meter',
  panel_enclosure: 'Panel / Enclosure', cable_wiring: 'Cable / Wiring',
  network_comms: 'Network / Comms', software_license: 'Software / License',
  service_labor: 'Service / Labor', it_hardware: 'IT Hardware', other: 'Other',
  // Legacy values from existing BOM items
  drive: 'Drive', sensor: 'Sensor / Instrument', panel: 'Panel / Enclosure',
  cable: 'Cable / Wiring', network: 'Network / Comms', software: 'Software / License',
  service: 'Service / Labor',
};

const CATEGORY_COLORS = {
  plc: 'bg-blue-100 text-blue-700', hmi: 'bg-purple-100 text-purple-700',
  drive_vfd: 'bg-indigo-100 text-indigo-700', sensor_instrument: 'bg-cyan-100 text-cyan-700',
  meter: 'bg-teal-100 text-teal-700', panel_enclosure: 'bg-orange-100 text-orange-700',
  cable_wiring: 'bg-yellow-100 text-yellow-700', network_comms: 'bg-green-100 text-green-700',
  software_license: 'bg-pink-100 text-pink-700', service_labor: 'bg-slate-100 text-slate-600',
  it_hardware: 'bg-rose-100 text-rose-700', other: 'bg-slate-100 text-slate-500',
  // legacy
  panel: 'bg-orange-100 text-orange-700', drive: 'bg-indigo-100 text-indigo-700',
  sensor: 'bg-cyan-100 text-cyan-700', cable: 'bg-yellow-100 text-yellow-700',
  network: 'bg-green-100 text-green-700', software: 'bg-pink-100 text-pink-700',
  service: 'bg-slate-100 text-slate-600',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function convertFileToPlainText(fileUrl) {
  const response = await fetch(fileUrl);
  const arrayBuffer = await response.arrayBuffer();
  const url = fileUrl.toLowerCase().split('?')[0];
  const ext = url.match(/\.[^.]+$/)?.[0] || '';
  if (ext === '.csv' || ext === '.txt') {
    return new TextDecoder().decode(arrayBuffer);
  }
  // Excel — read all visible sheets
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellFormula: false, cellHTML: false });
  const allText = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    if (csv.trim().length > 10) allText.push(`=== SHEET: ${sheetName} ===\n${csv}`);
  }
  return allText.join('\n\n');
}

function fmt(val, decimals = 0) {
  const n = Number(val ?? 0);
  if (!n && n !== 0) return '—';
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);
}

function fmtSAR(val) {
  const n = Number(val ?? 0);
  if (!n) return '—';
  return `SAR ${fmt(n)}`;
}

const INP = 'border border-slate-200 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400 bg-white w-full';
const INP_NUM = 'border border-slate-200 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400 bg-white text-right w-full';

// ─── Dual-line cost cell (L2) ─────────────────────────────────────────────────
function DualCostCell({ unit, total }) {
  if (unit == null && total == null) return <span className="text-slate-300">—</span>;
  return (
    <div className="text-right leading-tight">
      <div className="font-medium text-slate-800">{fmt(unit)}</div>
      {total != null && <div className="text-[10px] text-slate-400">= SAR {fmt(total)}</div>}
    </div>
  );
}

// ─── Panel child row (M2) with drag handle ───────────────────────────────────
function PanelChildRow({ child, panelId, onDragStart }) {
  return (
    <tr
      className="border-t border-orange-100 bg-orange-50/40 hover:bg-orange-50 cursor-grab text-xs"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', JSON.stringify({ childId: child.child_id, sourcePanel: panelId }));
        e.dataTransfer.effectAllowed = 'move';
        onDragStart(child.child_id);
      }}
    >
      <td className="pl-8 pr-2 py-1.5 w-6">
        <GripVertical className="w-3 h-3 text-slate-300" />
      </td>
      <td className="px-2 py-1.5 font-mono text-slate-400 whitespace-nowrap">{child.part_no || '—'}</td>
      <td className="px-2 py-1.5 text-slate-700 max-w-[200px] truncate">{child.description}</td>
      <td className="px-2 py-1.5">
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${CATEGORY_COLORS[child.category] || 'bg-slate-100 text-slate-500'}`}>
          {ALL_CATEGORIES[child.category] || child.category}
        </span>
      </td>
      <td className="px-2 py-1.5 text-slate-500">{child.manufacturer || '—'}</td>
      <td className="px-2 py-1.5 text-right font-semibold">{child.qty}</td>
      <td className="px-2 py-1.5 text-slate-400">{child.unit}</td>
      <td className="px-2 py-1.5 text-right">{fmt(child.unit_cost_sar)}</td>
      <td className="px-2 py-1.5 text-right font-semibold">{fmt(child.total_cost_sar)}</td>
      <td className="px-2 py-1.5 text-right">{fmt(child.unit_selling_sar)}</td>
      <td className="px-2 py-1.5 text-right">{fmt(child.total_selling_sar)}</td>
      <td className="px-2 py-1.5 text-right">
        {child.gross_profit != null && child.total_selling_sar > 0 ? (
          <span className={`font-semibold text-[10px] ${(child.gross_profit / child.total_selling_sar) < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
            {((child.gross_profit / child.total_selling_sar) * 100).toFixed(1)}%
          </span>
        ) : '—'}
      </td>
    </tr>
  );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

export default function BOMExtractionPreviewModal({ document, projectId, onClose, onImported }) {
  const [step, setStep] = useState('idle');
  const [items, setItems] = useState([]);       // main item list
  const [panelChildren, setPanelChildren] = useState({}); // panelId → children[]
  const [expandedPanels, setExpandedPanels] = useState({}); // panelId → bool
  const [summary, setSummary] = useState(null);
  const [totals, setTotals] = useState(null);
  const [meta, setMeta] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [error, setError] = useState('');
  const [showTemplateEditor, setShowTemplateEditor] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState(null);
  const [bulkCategory, setBulkCategory] = useState('');
  const [bulkSupplier, setBulkSupplier] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [draggingChildId, setDraggingChildId] = useState(null);
  const [dropTargetPanel, setDropTargetPanel] = useState(null);
  const undoTimerRef = useRef(null);

  useEffect(() => {
    base44.entities.BOMTemplate.filter({ is_default: true }, '-created_date', 1)
      .then(res => { if (res[0]) setActiveTemplate(res[0]); });
  }, []);

  // ── Derived ────────────────────────────────────────────────────────────────
  const selectedItems = useMemo(() => items.filter(i => selectedIds.has(i.preview_id)), [items, selectedIds]);
  const allSelected = items.length > 0 && selectedIds.size === items.length;

  const totalSelectedCost = useMemo(() =>
    selectedItems.reduce((s, i) => s + (Number(i.total_cost_sar) || 0), 0),
    [selectedItems]
  );

  // Group non-panel items by category for section headers (L3)
  const groupedItems = useMemo(() => {
    const groups = {};
    for (const item of items) {
      const cat = item.category || 'other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
    }
    return groups;
  }, [items]);

  const sortedCategories = useMemo(() => {
    const cats = Object.keys(groupedItems);
    return cats.sort((a, b) => {
      const ai = CATEGORY_SORT_ORDER.indexOf(a);
      const bi = CATEGORY_SORT_ORDER.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  }, [groupedItems]);

  // ── Selection ──────────────────────────────────────────────────────────────
  function toggleItem(id) {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(items.map(i => i.preview_id)));
  }

  // ── Inline edit ────────────────────────────────────────────────────────────
  function updateItemField(previewId, fields, value) {
    // Accept either a single field string or an object of {field: value} pairs
    const updates = typeof fields === 'string' ? { [fields]: value } : fields;
    setItems(prev => prev.map(i => {
      if (i.preview_id !== previewId) return i;
      const updated = { ...i, ...updates };
      // Recompute order_qty when qty or stock changes
      if ('qty' in updates || 'stock' in updates) {
        updated.order_qty = Math.max(0, (Number(updated.qty) || 0) - (Number(updated.stock) || 0));
      }
      return updated;
    }));
    setHasUnsavedChanges(true);
  }

  function applyBulkEdit() {
    setItems(prev => prev.map(i => {
      if (!selectedIds.has(i.preview_id)) return i;
      const updated = { ...i };
      if (bulkCategory) updated.category = bulkCategory;
      if (bulkSupplier) updated.supplier = bulkSupplier;
      return updated;
    }));
    setBulkCategory('');
    setBulkSupplier('');
    setHasUnsavedChanges(true);
  }

  function deleteItem(previewId) {
    setItems(prev => prev.filter(i => i.preview_id !== previewId));
    setSelectedIds(prev => { const n = new Set(prev); n.delete(previewId); return n; });
    setHasUnsavedChanges(true);
  }

  // ── Panel expand/collapse (M1) ─────────────────────────────────────────────
  function togglePanel(panelId) {
    setExpandedPanels(prev => ({ ...prev, [panelId]: !prev[panelId] }));
  }

  // ── N4. Drag & drop child re-assignment ────────────────────────────────────
  function moveChildItem(childId, sourcePanelId, targetPanelId) {
    if (sourcePanelId === targetPanelId) return;

    setPanelChildren(prev => {
      const src = [...(prev[sourcePanelId] || [])];
      const idx = src.findIndex(c => c.child_id === childId);
      if (idx === -1) return prev;
      const [child] = src.splice(idx, 1);
      const movedChild = { ...child, parent_panel_id: targetPanelId };
      const tgt = [...(prev[targetPanelId] || []), movedChild];

      // N5. Recalculate panel totals
      const recalc = (children) => {
        const totalCost = children.reduce((s, c) => s + (c.total_cost_sar ?? 0), 0);
        const totalSell = children.reduce((s, c) => s + (c.total_selling_sar ?? 0), 0);
        const gp     = totalSell > 0 ? totalSell - totalCost : null;
        const margin = (gp != null && totalSell > 0) ? gp / totalSell : null;
        return { totalCost, totalSell, gp, margin };
      };

      const srcTotals = recalc(src);
      const tgtTotals = recalc(tgt);

      setItems(items => items.map(item => {
        if (item.preview_id === sourcePanelId) {
          return {
            ...item,
            total_cost_sar:    srcTotals.totalCost > 0 ? srcTotals.totalCost : null,
            unit_cost_sar:     srcTotals.totalCost > 0 ? srcTotals.totalCost : null,
            total_selling_sar: srcTotals.totalSell > 0 ? srcTotals.totalSell : null,
            unit_selling_sar:  srcTotals.totalSell > 0 ? srcTotals.totalSell : null,
            gross_profit_sar:  srcTotals.gp,
            margin_pct:        srcTotals.margin,
            panel_item_count:  src.length,
          };
        }
        if (item.preview_id === targetPanelId) {
          return {
            ...item,
            total_cost_sar:    tgtTotals.totalCost > 0 ? tgtTotals.totalCost : null,
            unit_cost_sar:     tgtTotals.totalCost > 0 ? tgtTotals.totalCost : null,
            total_selling_sar: tgtTotals.totalSell > 0 ? tgtTotals.totalSell : null,
            unit_selling_sar:  tgtTotals.totalSell > 0 ? tgtTotals.totalSell : null,
            gross_profit_sar:  tgtTotals.gp,
            margin_pct:        tgtTotals.margin,
            panel_item_count:  tgt.length,
          };
        }
        return item;
      }));

      // N7. Undo toast
      const srcName = items.find(i => i.preview_id === sourcePanelId)?.description || sourcePanelId;
      const tgtName = items.find(i => i.preview_id === targetPanelId)?.description || targetPanelId;
      toast(`"${child.description}" moved to ${tgtName}`, {
        duration: 5000,
        action: {
          label: 'Undo',
          onClick: () => moveChildItem(childId, targetPanelId, sourcePanelId),
        },
      });

      setHasUnsavedChanges(true);
      return { ...prev, [sourcePanelId]: src, [targetPanelId]: tgt };
    });
  }

  // ── Run extraction ─────────────────────────────────────────────────────────
  async function runPreview() {
    setStep('loading');
    setError('');
    setHasUnsavedChanges(false);
    try {
      const plainText = await convertFileToPlainText(document.file_url);
      if (!plainText || plainText.trim().length < 20)
        throw new Error('Could not read content from this file.');

      const res = await base44.functions.invoke('bomExtractionPreview', {
        plain_text: plainText.slice(0, 120000),
        project_id: projectId,
        document_id: document.id,
        file_name: document.file_name || document.title,
        template: activeTemplate || undefined,
      });

      const previewItems = res?.data?.items || [];
      const respSummary  = res?.data?.summary || null;
      const respTotals   = res?.data?.totals || null;
      const respMeta     = res?.data?.meta || null;

      // N1. Initialize panelChildrenState from panel aggregates
      const initChildren = {};
      previewItems.forEach(item => {
        if (item.is_panel_aggregate && Array.isArray(item.children)) {
          initChildren[item.preview_id] = item.children;
        }
      });

      setSummary(respSummary);
      setTotals(respTotals);
      setMeta(respMeta);
      setItems(previewItems);
      setPanelChildren(initChildren);
      setExpandedPanels({});
      setSelectedIds(new Set(previewItems.filter(i => !i.review_required).map(i => i.preview_id)));
      setStep('review');
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || 'Extraction failed.';
      setError(msg);
      setStep('idle');
    }
  }

  // ── Import selected ────────────────────────────────────────────────────────
  async function importSelected() {
    setStep('importing');
    setError('');
    try {
      // Attach updated children to panel items before sending
      const itemsToSend = selectedItems.map(item => {
        if (item.is_panel_aggregate && panelChildren[item.preview_id]) {
          return { ...item, children: panelChildren[item.preview_id] };
        }
        return item;
      });

      await base44.functions.invoke('bomImportSelected', {
        project_id: projectId,
        document_id: document.id,
        selected_items: itemsToSend,
      });
      setStep('done');
      setHasUnsavedChanges(false);
      setTimeout(() => { onImported(); onClose(); }, 1500);
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Import failed.');
      setStep('review');
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-7xl max-h-[95vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div>
            <h2 className="font-bold text-slate-800 text-lg flex items-center gap-2">
              <FileSearch className="w-5 h-5 text-amber-500" /> BOM Extraction Preview
            </h2>
            <p className="text-xs text-slate-400 mt-0.5 truncate max-w-xl">{document.title}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-6">

          {/* ── IDLE ── */}
          {step === 'idle' && (
            <div className="text-center py-10">
              <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <FileSearch className="w-8 h-8 text-amber-500" />
              </div>
              <h3 className="font-semibold text-slate-700 text-lg mb-2">Auto-Detect BOM Items</h3>
              <p className="text-slate-500 text-sm max-w-md mx-auto mb-5">
                AI will parse this workbook using the column structure from the file. Panel sections are automatically aggregated. All items are validated before review.
              </p>
              <div className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg mb-5 text-sm">
                <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                {activeTemplate ? (
                  <span className="text-slate-700">
                    Template: <span className="font-semibold text-amber-600">{activeTemplate.name}</span>
                    {activeTemplate.default_supplier && <span className="text-slate-400 ml-1">· {activeTemplate.default_supplier}</span>}
                  </span>
                ) : (
                  <span className="text-slate-400">No template — using defaults</span>
                )}
                <button onClick={() => setShowTemplateEditor(true)}
                  className="ml-2 flex items-center gap-1 text-xs text-slate-500 hover:text-amber-600 border border-slate-200 rounded px-2 py-0.5 transition">
                  <Settings className="w-3 h-3" /> Manage
                </button>
              </div>
              {error && <div className="text-red-600 text-sm mb-4 bg-red-50 border border-red-200 rounded p-3 max-w-md mx-auto">{error}</div>}
              <div>
                <button onClick={runPreview} className="px-6 py-3 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold rounded-lg text-sm">
                  Start BOM Extraction
                </button>
              </div>
            </div>
          )}

          {showTemplateEditor && (
            <BOMTemplateEditor
              onClose={() => setShowTemplateEditor(false)}
              onTemplateSelected={(tpl) => { setActiveTemplate(tpl); setShowTemplateEditor(false); }}
            />
          )}

          {/* ── LOADING ── */}
          {step === 'loading' && (
            <div className="text-center py-20">
              <Loader2 className="w-10 h-10 animate-spin text-amber-500 mx-auto mb-4" />
              <h3 className="font-semibold text-slate-700 text-lg mb-1">Parsing Workbook…</h3>
              <p className="text-slate-400 text-sm">Detecting columns, classifying rows, aggregating panels. This may take 15–30 seconds.</p>
            </div>
          )}

          {/* ── IMPORTING ── */}
          {step === 'importing' && (
            <div className="text-center py-20">
              <Loader2 className="w-10 h-10 animate-spin text-blue-500 mx-auto mb-4" />
              <h3 className="font-semibold text-slate-700 text-lg">Importing {selectedItems.length} items…</h3>
            </div>
          )}

          {/* ── DONE ── */}
          {step === 'done' && (
            <div className="text-center py-20">
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
              <h3 className="font-semibold text-slate-700 text-lg">{selectedItems.length} BOM items imported successfully!</h3>
            </div>
          )}

          {/* ── REVIEW ── */}
          {step === 'review' && (
            <div className="space-y-4">

              {/* Summary bar */}
              {summary && (
                <div className="flex flex-wrap gap-4 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-sm">
                  <span><span className="font-semibold text-slate-700">{summary.total}</span> <span className="text-slate-500">items found</span></span>
                  <span><span className="font-semibold text-emerald-600">{summary.auto_selected}</span> <span className="text-slate-500">auto-selected</span></span>
                  {items.some(i => i.is_panel_aggregate) && (
                    <span className="flex items-center gap-1">
                      <Layers className="w-3.5 h-3.5 text-orange-500" />
                      <span className="font-semibold text-orange-600">{items.filter(i => i.is_panel_aggregate).length}</span>
                      <span className="text-slate-500">panel aggregate(s)</span>
                    </span>
                  )}
                  {summary.review_required > 0 && (
                    <span className="flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                      <span className="font-semibold text-amber-600">{summary.review_required}</span>
                      <span className="text-slate-500">need review</span>
                    </span>
                  )}
                  {totals && totals.total_planned_cost_sar > 0 && (
                    <span className="ml-auto text-slate-600">
                      Total Cost: <span className="font-semibold text-slate-800">{fmtSAR(totals.total_planned_cost_sar)}</span>
                      {totals.total_sell_value_sar > 0 && <> · Sell: <span className="font-semibold">{fmtSAR(totals.total_sell_value_sar)}</span></>}
                      {totals.total_margin_pct > 0 && <> · <span className="text-emerald-600 font-semibold">{(totals.total_margin_pct * 100).toFixed(1)}% GM</span></>}
                    </span>
                  )}
                  {meta?.reconciliation_status && meta.reconciliation_status !== 'UNVERIFIED' && (
                    <span className={`text-xs px-2 py-0.5 rounded font-semibold ${meta.reconciliation_status === 'OK' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                      {meta.reconciliation_status}
                    </span>
                  )}
                </div>
              )}

              {/* L4 notice */}
              <div className="text-xs text-slate-400">
                {items.length} of {items.length} items · Click any cell to edit · Check rows for bulk edit
              </div>

              {/* Unsaved changes banner (O2) */}
              {hasUnsavedChanges && (
                <div className="flex items-center gap-3 bg-amber-50 border border-amber-300 rounded-lg px-4 py-2.5 text-sm">
                  <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                  <span className="text-amber-700 flex-1">You have unsaved changes.</span>
                  <button onClick={() => { runPreview(); }} className="text-xs text-slate-500 hover:text-slate-700 border border-slate-300 rounded px-2 py-1">Discard</button>
                </div>
              )}

              {/* Bulk edit bar */}
              {selectedIds.size > 0 && (
                <div className="flex flex-wrap items-center gap-3 bg-slate-800 text-white rounded-lg px-4 py-2.5 text-xs">
                  <span className="font-semibold text-amber-400">{selectedIds.size} selected</span>
                  <span className="text-slate-400">·</span>
                  <span className="text-slate-300">Bulk edit:</span>
                  <select value={bulkCategory} onChange={e => setBulkCategory(e.target.value)}
                    className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white focus:outline-none focus:border-amber-400">
                    <option value="">Set Category…</option>
                    {Object.entries(ALL_CATEGORIES).filter(([k]) => CATEGORY_SORT_ORDER.includes(k)).map(([v, l]) =>
                      <option key={v} value={v}>{l}</option>
                    )}
                  </select>
                  <input value={bulkSupplier} onChange={e => setBulkSupplier(e.target.value)}
                    placeholder="Set Supplier…"
                    className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white placeholder-slate-400 focus:outline-none focus:border-amber-400 w-32" />
                  {(bulkCategory || bulkSupplier) && (
                    <button onClick={applyBulkEdit}
                      className="flex items-center gap-1 px-3 py-1 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold rounded">
                      <Check className="w-3 h-3" /> Apply
                    </button>
                  )}
                </div>
              )}

              {error && <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded p-3">{error}</div>}

              {/* ── Main table — grouped by category (L3 section headers) ── */}
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="overflow-auto max-h-[55vh]">
                  <table className="w-full text-xs min-w-[1400px]">
                    {/* L1. Column headers — sticky within the scrollable container */}
                    <thead className="bg-slate-800 text-white sticky top-0 z-20">
                      <tr>
                        <th className="px-3 py-2.5 w-8">
                          <button onClick={toggleAll} className="flex items-center justify-center">
                            <div className={`w-4 h-4 rounded border-2 flex items-center justify-center ${allSelected ? 'bg-amber-400 border-amber-400' : 'border-slate-400'}`}>
                              {allSelected && <Check className="w-2.5 h-2.5 text-slate-900" />}
                            </div>
                          </button>
                        </th>
                        <th className="px-1 py-2.5 w-5"></th>{/* expand arrow for panels */}
                        <th className="px-2 py-2.5 text-left font-semibold min-w-[180px]">DESCRIPTION</th>
                        <th className="px-2 py-2.5 text-left font-semibold w-28">PART NO.</th>
                        <th className="px-2 py-2.5 text-left font-semibold w-28">MANUFACTURER</th>
                        <th className="px-2 py-2.5 text-left font-semibold w-32">CATEGORY</th>
                        <th className="px-2 py-2.5 text-left font-semibold w-24">SUPPLIER</th>
                        <th className="px-2 py-2.5 text-right font-semibold w-16">QTY</th>
                        <th className="px-2 py-2.5 text-right font-semibold w-16">STOCK</th>
                        <th className="px-2 py-2.5 text-right font-semibold w-16">ORD QTY</th>
                        <th className="px-2 py-2.5 text-right font-semibold w-24">UNIT COST</th>
                        <th className="px-2 py-2.5 text-right font-semibold w-24">TOTAL COST</th>
                        <th className="px-2 py-2.5 text-right font-semibold w-24">UNIT SELL</th>
                        <th className="px-2 py-2.5 text-right font-semibold w-24">TOTAL SELL</th>
                        <th className="px-2 py-2.5 text-center font-semibold w-24">ORDER</th>
                        <th className="px-2 py-2.5 text-center font-semibold w-24">DELIVERY</th>
                        <th className="px-2 py-2.5 text-center font-semibold w-28">EXP. DELIVERY</th>
                        <th className="px-2 py-2.5 text-center font-semibold w-10">GP%</th>
                        <th className="px-1 py-2.5 w-7"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedCategories.map(cat => {
                        const catItems = groupedItems[cat] || [];
                        // L3 totals for this category
                        const catCost   = catItems.reduce((s, i) => s + (Number(i.total_cost_sar) || 0), 0);
                        const catActual = catItems.reduce((s, i) => s + (Number(i.actual_cost_sar) || 0), 0);
                        const catSell   = catItems.reduce((s, i) => s + (Number(i.total_selling_sar) || 0), 0);

                        return [
                          // L3 Section header bar
                          <tr key={`hdr_${cat}`} className="bg-slate-100 border-t-2 border-slate-300">
                            <td colSpan={19} className="px-4 py-2">
                              <div className="flex items-center gap-4 flex-wrap">
                                <span className="font-bold text-slate-700 text-xs uppercase tracking-wide">
                                  {ALL_CATEGORIES[cat] || cat} · {catItems.length} items
                                </span>
                                {catCost > 0 && <span className="text-xs text-slate-500">Planned: <span className="font-semibold text-slate-700">{fmtSAR(catCost)}</span></span>}
                                {catActual > 0 && <span className="text-xs text-slate-500">Actual: <span className="font-semibold text-slate-700">{fmtSAR(catActual)}</span></span>}
                                {catSell > 0 && <span className="text-xs text-slate-500">Sell: <span className="font-semibold text-emerald-700">{fmtSAR(catSell)}</span></span>}
                              </div>
                            </td>
                          </tr>,

                          // Item rows
                          ...catItems.map((item) => {
                            const isSelected     = selectedIds.has(item.preview_id);
                            const isPanelAgg     = item.is_panel_aggregate;
                            const isExpanded     = expandedPanels[item.preview_id];
                            const children       = panelChildren[item.preview_id] || [];
                            const isDropTarget   = dropTargetPanel === item.preview_id;
                            const orderQty       = Math.max(0, (Number(item.qty) || 0) - (Number(item.stock) || 0));
                            const marginDisplay  = item.margin_pct != null
                              ? (item.margin_pct * 100).toFixed(1) + '%'
                              : (item.gross_profit_sar != null && item.total_selling_sar > 0)
                                ? ((item.gross_profit_sar / item.total_selling_sar) * 100).toFixed(1) + '%'
                                : '—';

                            return [
                              <tr
                                key={item.preview_id}
                                className={`border-t border-slate-100 transition ${
                                  isPanelAgg
                                    ? isDropTarget
                                      ? 'bg-amber-100 outline outline-2 outline-dashed outline-amber-400'
                                      : 'bg-orange-50'
                                    : isSelected ? 'bg-amber-50' : 'bg-white hover:bg-slate-50/60'
                                }`}
                                onDragOver={isPanelAgg ? (e) => { e.preventDefault(); setDropTargetPanel(item.preview_id); } : undefined}
                                onDragLeave={isPanelAgg ? () => setDropTargetPanel(null) : undefined}
                                onDrop={isPanelAgg ? (e) => {
                                  e.preventDefault();
                                  setDropTargetPanel(null);
                                  try {
                                    const { childId, sourcePanel } = JSON.parse(e.dataTransfer.getData('text/plain'));
                                    moveChildItem(childId, sourcePanel, item.preview_id);
                                  } catch (_) {}
                                } : undefined}
                              >
                                {/* Checkbox */}
                                <td className="px-3 py-2 w-8">
                                  <button onClick={() => toggleItem(item.preview_id)} className="flex items-center justify-center">
                                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center mx-auto ${isSelected ? 'bg-amber-400 border-amber-400' : 'border-slate-300'}`}>
                                      {isSelected && <Check className="w-2.5 h-2.5 text-slate-900" />}
                                    </div>
                                  </button>
                                </td>

                                {/* Expand toggle (M1) */}
                                <td className="px-1 py-2 w-6">
                                  {isPanelAgg ? (
                                    <button onClick={() => togglePanel(item.preview_id)}
                                      className="p-0.5 hover:bg-orange-100 rounded text-orange-600">
                                      {isExpanded
                                        ? <ChevronDown className="w-3.5 h-3.5" />
                                        : <ChevronRight className="w-3.5 h-3.5" />}
                                    </button>
                                  ) : null}
                                </td>

                                {/* Description */}
                                <td className="px-2 py-1.5">
                                  <div className="flex items-center gap-1.5">
                                    {isPanelAgg && <Layers className="w-3 h-3 text-orange-500 shrink-0" />}
                                    <div className="min-w-0 w-full">
                                      <input
                                        value={item.description}
                                        onChange={e => updateItemField(item.preview_id, 'description', e.target.value)}
                                        className={INP + ' font-medium'}
                                      />
                                      {item.review_notes && (
                                        <div className="text-[10px] text-amber-600 truncate mt-0.5">⚠ {item.review_notes}</div>
                                      )}
                                      {isPanelAgg && (
                                        <div className="text-[10px] text-orange-600 mt-0.5">{children.length} items · click ▶ to expand</div>
                                      )}
                                    </div>
                                  </div>
                                </td>

                                {/* Part No */}
                                <td className="px-2 py-1.5">
                                  <input value={item.part_no || ''} placeholder="Part no."
                                    onChange={e => updateItemField(item.preview_id, 'part_no', e.target.value)}
                                    className={INP + ' font-mono'} />
                                </td>

                                {/* Manufacturer */}
                                <td className="px-2 py-1.5">
                                  <input value={item.manufacturer || ''} placeholder="Manufacturer"
                                    onChange={e => updateItemField(item.preview_id, 'manufacturer', e.target.value)}
                                    className={INP} />
                                </td>

                                {/* Category */}
                                <td className="px-2 py-1.5" onClick={e => e.stopPropagation()}>
                                  <select value={item.category || 'other'}
                                    onChange={e => updateItemField(item.preview_id, 'category', e.target.value)}
                                    className={INP}>
                                    {Object.entries(ALL_CATEGORIES).filter(([k]) => CATEGORY_SORT_ORDER.includes(k)).map(([v, l]) =>
                                      <option key={v} value={v}>{l}</option>
                                    )}
                                  </select>
                                </td>

                                {/* Supplier */}
                                <td className="px-2 py-1.5">
                                  <input value={item.supplier || ''} placeholder="Supplier"
                                    onChange={e => updateItemField(item.preview_id, 'supplier', e.target.value)}
                                    className={INP} />
                                </td>

                                {/* QTY */}
                                <td className="px-1 py-1.5 w-16">
                                  <input type="number" min="0" value={item.qty}
                                    onChange={e => updateItemField(item.preview_id, 'qty', Number(e.target.value))}
                                    className={INP_NUM} />
                                </td>

                                {/* STOCK */}
                                <td className="px-1 py-1.5 w-16">
                                  <input type="number" min="0" value={item.stock ?? 0}
                                    onChange={e => updateItemField(item.preview_id, 'stock', Number(e.target.value))}
                                    className={INP_NUM} />
                                </td>

                                {/* ORDER QTY — orange if > 0 */}
                                <td className="px-2 py-2 text-right w-16">
                                  <span className={`font-semibold ${orderQty > 0 ? 'text-orange-600' : 'text-slate-400'}`}>
                                    {orderQty}
                                  </span>
                                </td>

                                {/* UNIT COST — editable; auto-computes total */}
                                <td className="px-1 py-1.5 w-24">
                                  <input type="number" min="0" step="0.01"
                                    value={item.unit_cost_sar ?? ''}
                                    placeholder="0"
                                    onChange={e => {
                                      const v = e.target.value === '' ? null : Number(e.target.value);
                                      const qty = Number(item.qty) || 1;
                                      updateItemField(item.preview_id, { unit_cost_sar: v, total_cost_sar: v != null ? v * qty : null, actual_cost_sar: v != null ? v * qty : null });
                                    }}
                                    className={INP_NUM} />
                                </td>

                                {/* TOTAL COST — editable */}
                                <td className="px-1 py-1.5 w-24">
                                  <input type="number" min="0" step="0.01"
                                    value={item.total_cost_sar ?? ''}
                                    placeholder="0"
                                    onChange={e => {
                                      const v = e.target.value === '' ? null : Number(e.target.value);
                                      updateItemField(item.preview_id, { total_cost_sar: v, actual_cost_sar: v });
                                    }}
                                    className={INP_NUM + ' font-semibold'} />
                                </td>

                                {/* UNIT SELL — editable; auto-computes total */}
                                <td className="px-1 py-1.5 w-24">
                                  <input type="number" min="0" step="0.01"
                                    value={item.unit_selling_sar ?? ''}
                                    placeholder="0"
                                    onChange={e => {
                                      const v = e.target.value === '' ? null : Number(e.target.value);
                                      const qty = Number(item.qty) || 1;
                                      updateItemField(item.preview_id, { unit_selling_sar: v, total_selling_sar: v != null ? v * qty : null });
                                    }}
                                    className={INP_NUM} />
                                </td>

                                {/* TOTAL SELL — editable */}
                                <td className="px-1 py-1.5 w-24">
                                  <input type="number" min="0" step="0.01"
                                    value={item.total_selling_sar ?? ''}
                                    placeholder="0"
                                    onChange={e => {
                                      const v = e.target.value === '' ? null : Number(e.target.value);
                                      updateItemField(item.preview_id, { total_selling_sar: v });
                                    }}
                                    className={INP_NUM + ' font-semibold text-emerald-700'} />
                                </td>

                                {/* ORDER STATUS */}
                                <td className="px-1 py-1.5 w-24">
                                  <select value={item.order_status || 'Not Ordered'}
                                    onChange={e => updateItemField(item.preview_id, 'order_status', e.target.value)}
                                    className={INP}>
                                    <option>Not Ordered</option>
                                    <option>Ordered</option>
                                    <option>Delivered</option>
                                  </select>
                                </td>

                                {/* DELIVERY STATUS */}
                                <td className="px-1 py-1.5 w-24">
                                  <select value={item.delivery_status || 'not_delivered'}
                                    onChange={e => updateItemField(item.preview_id, 'delivery_status', e.target.value)}
                                    className={INP}>
                                    <option value="not_delivered">Not Delivered</option>
                                    <option value="partially_delivered">Partially Delivered</option>
                                    <option value="delivered">Delivered</option>
                                  </select>
                                </td>

                                {/* EXPECTED DELIVERY DATE */}
                                <td className="px-1 py-1.5 w-28">
                                  <input type="date" value={item.expected_delivery_date || ''}
                                    onChange={e => updateItemField(item.preview_id, 'expected_delivery_date', e.target.value)}
                                    className={INP} />
                                </td>

                                {/* GP% */}
                                <td className="px-2 py-2 text-right w-10">
                                  <span className={`font-semibold text-[10px] ${parseFloat(marginDisplay) < 0 ? 'text-red-500' : parseFloat(marginDisplay) >= 10 ? 'text-emerald-600' : 'text-amber-600'}`}>
                                    {marginDisplay}
                                  </span>
                                </td>

                                {/* Delete */}
                                <td className="px-1 py-1.5 text-center w-7">
                                  <button onClick={() => deleteItem(item.preview_id)}
                                    className="p-1 text-slate-200 hover:text-red-500 hover:bg-red-50 rounded">
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </td>
                              </tr>,

                              // M2. Expanded children sub-table
                              isExpanded && isPanelAgg && children.length > 0 && (
                               <tr key={`${item.preview_id}_children`}>
                                 <td colSpan={19} className="p-0">
                                    <div className="bg-orange-50/60 border-t border-orange-100 pl-6">
                                      <table className="w-full text-xs">
                                        <thead className="bg-orange-100 text-orange-800">
                                          <tr>
                                            <th className="pl-8 pr-2 py-1.5 w-6 text-left">⠿</th>
                                            <th className="px-2 py-1.5 text-left">Part No</th>
                                            <th className="px-2 py-1.5 text-left">Description</th>
                                            <th className="px-2 py-1.5 text-left">Category</th>
                                            <th className="px-2 py-1.5 text-left">Manufacturer</th>
                                            <th className="px-2 py-1.5 text-right">Qty</th>
                                            <th className="px-2 py-1.5 text-left">Unit</th>
                                            <th className="px-2 py-1.5 text-right">Unit Cost</th>
                                            <th className="px-2 py-1.5 text-right">Total Cost</th>
                                            <th className="px-2 py-1.5 text-right">Unit Sell</th>
                                            <th className="px-2 py-1.5 text-right">Total Sell</th>
                                            <th className="px-2 py-1.5 text-right">GP%</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {children.map(child => (
                                            <PanelChildRow
                                              key={child.child_id}
                                              child={child}
                                              panelId={item.preview_id}
                                              onDragStart={setDraggingChildId}
                                            />
                                          ))}
                                        </tbody>
                                        {/* M4. Sub-table footer */}
                                        <tfoot>
                                          <tr className="border-t border-orange-200 bg-orange-100/60">
                                            <td colSpan={7} className="pl-8 pr-2 py-1.5 text-orange-700 font-semibold text-[10px]">
                                              Items: {children.length}
                                            </td>
                                            <td colSpan={2} className="px-2 py-1.5 text-right font-semibold text-orange-800 text-[10px]">
                                              {fmtSAR(children.reduce((s, c) => s + (c.total_cost_sar ?? 0), 0))}
                                            </td>
                                            <td colSpan={3} className="px-2 py-1.5 text-right font-semibold text-emerald-700 text-[10px]">
                                              {fmtSAR(children.reduce((s, c) => s + (c.total_selling_sar ?? 0), 0))}
                                            </td>
                                          </tr>
                                        </tfoot>
                                      </table>
                                    </div>
                                  </td>
                                </tr>
                              ),
                            ];
                          }),

                          // L5. Subtotal row
                          <tr key={`sub_${cat}`} className="border-t border-slate-200 bg-slate-50">
                           <td colSpan={10} className="px-4 py-1.5 text-xs text-slate-500 font-semibold">
                             Subtotal ({catItems.length})
                           </td>
                           <td className="px-2 py-1.5 text-right text-xs font-semibold text-slate-700">{fmtSAR(catCost)}</td>
                           <td className="px-2 py-1.5"></td>
                           <td className="px-2 py-1.5 text-right text-xs font-semibold text-emerald-700">{fmtSAR(catSell)}</td>
                           <td colSpan={6}></td>
                          </tr>,
                        ];
                      })}

                      {/* Grand Total — panel aggregates already include their children, so sum top-level only */}
                      {items.length > 0 && (() => {
                        const grandCost = items.reduce((s, i) => s + (Number(i.total_cost_sar) || 0), 0);
                        const grandSell = items.reduce((s, i) => s + (Number(i.total_selling_sar) || 0), 0);
                        const grandGP   = grandSell > 0 ? grandSell - grandCost : 0;
                        const grandGM   = grandSell > 0 ? ((grandGP / grandSell) * 100).toFixed(1) : null;
                        return (
                          <tr className="border-t-2 border-slate-400 bg-slate-800 text-white">
                            <td colSpan={10} className="px-4 py-2 text-sm font-bold">GRAND TOTAL · {items.length} line items</td>
                            <td className="px-2 py-2 text-right font-bold text-amber-300">{fmtSAR(grandCost)}</td>
                            <td className="px-2 py-2"></td>
                            <td className="px-2 py-2 text-right font-bold text-emerald-300">{fmtSAR(grandSell)}</td>
                            <td className="px-2 py-2 text-right font-bold text-emerald-300">
                              {grandGM != null ? `${grandGM}% GM` : '—'}
                            </td>
                            <td colSpan={5}></td>
                          </tr>
                        );
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Selection summary */}
              {selectedIds.size > 0 && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5 flex items-center gap-4 text-sm">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span className="text-emerald-700">
                    <span className="font-semibold">{selectedIds.size}</span> items selected
                    {totalSelectedCost > 0 && <> · Total cost: <span className="font-semibold">SAR {fmt(totalSelectedCost)}</span></>}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 'review' && (
          <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between shrink-0 bg-slate-50">
            <button onClick={onClose}
              className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-slate-100">
              Cancel
            </button>
            <button onClick={importSelected} disabled={selectedIds.size === 0}
              className="flex items-center gap-2 px-6 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded-lg disabled:opacity-40 disabled:cursor-not-allowed">
              <Save className="w-4 h-4" />
              Import {selectedIds.size} Item{selectedIds.size !== 1 ? 's' : ''} to BOM
            </button>
          </div>
        )}
      </div>
    </div>
  );
}