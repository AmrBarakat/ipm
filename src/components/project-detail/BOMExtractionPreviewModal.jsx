import { useState, useMemo, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import * as XLSX from 'xlsx';
import {
  X, Loader2, CheckCircle2, FileSearch, AlertTriangle,
  ChevronDown, ChevronUp, Check, Pencil, Layers, FileText, Settings, GripVertical
} from 'lucide-react';
import { BOM_CATEGORY_LABELS } from '@/lib/constants';
import BOMTemplateEditor from '@/components/bom/BOMTemplateEditor';

async function convertFileToPlainText(fileUrl) {
  const response = await fetch(fileUrl);
  const arrayBuffer = await response.arrayBuffer();
  const url = fileUrl.toLowerCase().split('?')[0];
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

const CATEGORY_COLORS = {
  plc: 'bg-blue-100 text-blue-700', hmi: 'bg-purple-100 text-purple-700',
  drive: 'bg-indigo-100 text-indigo-700', sensor: 'bg-cyan-100 text-cyan-700',
  meter: 'bg-teal-100 text-teal-700', panel: 'bg-orange-100 text-orange-700',
  cable: 'bg-yellow-100 text-yellow-700', network: 'bg-green-100 text-green-700',
  software: 'bg-pink-100 text-pink-700', service: 'bg-slate-100 text-slate-600',
  other: 'bg-slate-100 text-slate-500',
};

function money(val) {
  const n = Number(val || 0);
  if (!n) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);
}

const selInp = 'border border-slate-200 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400 bg-white';

export default function BOMExtractionPreviewModal({ document, projectId, onClose, onImported }) {
  const [step, setStep] = useState('idle');
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [showTemplateEditor, setShowTemplateEditor] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState(null);
  // Bulk edit state for preview
  const [bulkCategory, setBulkCategory] = useState('');
  const [bulkSupplier, setBulkSupplier] = useState('');
  // Expanded panel rows
  const [expandedPanels, setExpandedPanels] = useState(new Set());
  // Drag state for child item re-assignment
  const dragChildRef = useRef(null); // { fromPanelId, childId }
  const [dragOverPanel, setDragOverPanel] = useState(null);

  // Load default template on mount
  useEffect(() => {
    base44.entities.BOMTemplate.filter({ is_default: true }, '-created_date', 1)
      .then(results => { if (results[0]) setActiveTemplate(results[0]); });
  }, []);

  const selectedItems = useMemo(() => items.filter(i => selectedIds.has(i.preview_id)), [items, selectedIds]);
  const allSelected = items.length > 0 && selectedIds.size === items.length;

  function toggleItem(id) {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(items.map(i => i.preview_id)));
  }

  // Inline edit for a single item field
  function updateItemField(preview_id, field, value) {
    setItems(prev => prev.map(i => i.preview_id === preview_id ? { ...i, [field]: value } : i));
  }

  // Apply bulk category/supplier to all selected
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
  }

  function togglePanelExpand(panelId) {
    setExpandedPanels(prev => {
      const n = new Set(prev);
      n.has(panelId) ? n.delete(panelId) : n.add(panelId);
      return n;
    });
  }

  // Recalculate panel aggregate totals from its current child_items
  function recalcPanel(panel) {
    const children = panel.child_items || [];
    const totalCost = children.reduce((s, c) => s + (Number(c.total_cost_sar) || 0), 0);
    const totalSell = children.reduce((s, c) => s + (Number(c.total_selling_sar) || 0), 0);
    const gp = totalSell > 0 ? totalSell - totalCost : null;
    const margin = gp != null && totalSell > 0 ? gp / totalSell : null;
    return {
      ...panel,
      unit_cost_sar: totalCost || null,
      total_cost_sar: totalCost || null,
      unit_selling_sar: totalSell || null,
      total_selling_sar: totalSell || null,
      gross_profit: gp,
      margin_pct: margin,
      panel_item_count: children.length,
      child_items: children,
    };
  }

  // Drag handlers for child item re-assignment between panels
  function onChildDragStart(fromPanelId, childId) {
    dragChildRef.current = { fromPanelId, childId };
  }

  function onPanelDragOver(e, toPanelId) {
    if (!dragChildRef.current || dragChildRef.current.fromPanelId === toPanelId) return;
    e.preventDefault();
    setDragOverPanel(toPanelId);
  }

  function onPanelDrop(e, toPanelId) {
    e.preventDefault();
    setDragOverPanel(null);
    const drag = dragChildRef.current;
    dragChildRef.current = null;
    if (!drag || drag.fromPanelId === toPanelId) return;

    setItems(prev => {
      return prev.map(item => {
        if (!item.is_panel_aggregate) return item;
        if (item.preview_id === drag.fromPanelId) {
          // Remove child from source panel
          const updated = { ...item, child_items: (item.child_items || []).filter(c => c.child_id !== drag.childId) };
          return recalcPanel(updated);
        }
        if (item.preview_id === toPanelId) {
          // Find child in items state (source panel)
          const sourcePanel = prev.find(p => p.preview_id === drag.fromPanelId);
          const child = (sourcePanel?.child_items || []).find(c => c.child_id === drag.childId);
          if (!child) return item;
          const updated = { ...item, child_items: [...(item.child_items || []), child] };
          return recalcPanel(updated);
        }
        return item;
      });
    });
  }

  function onPanelDragLeave() {
    setDragOverPanel(null);
  }

  async function runPreview() {
    setStep('loading');
    setError('');
    try {
      const plainText = await convertFileToPlainText(document.file_url);
      if (!plainText || plainText.trim().length < 20) throw new Error('Could not read content from this file.');
      const res = await base44.functions.invoke('bomExtractionPreview', {
        plain_text: plainText.slice(0, 80000),
        project_id: projectId,
        document_id: document.id,
        file_name: document.file_name || document.title,
        template: activeTemplate || undefined,
      });
      const previewItems = res?.data?.items || [];
      setSummary(res?.data?.summary || null);
      setItems(previewItems);
      setSelectedIds(new Set(previewItems.filter(i => !i.review_required).map(i => i.preview_id)));
      setStep('review');
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || 'Extraction failed.';
      setError(msg.toLowerCase().includes('unauthorized') || msg.toLowerCase().includes('authentication')
        ? 'You must be logged in to use this feature. Please refresh the page and log in.'
        : msg);
      setStep('idle');
    }
  }

  async function importSelected() {
    setStep('importing');
    setError('');
    try {
      await base44.functions.invoke('bomImportSelected', {
        project_id: projectId,
        document_id: document.id,
        selected_items: selectedItems,
      });
      setStep('done');
      setTimeout(() => { onImported(); onClose(); }, 1500);
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Import failed.');
      setStep('review');
    }
  }

  const displayItems = showAll ? items : items.slice(0, 50);
  const totalCost = useMemo(() => selectedItems.reduce((s, i) => s + (Number(i.total_cost_sar) || 0), 0), [selectedItems]);

  const hasBulkSelection = selectedIds.size > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div>
            <h2 className="font-bold text-slate-800 text-lg flex items-center gap-2">
              <FileSearch className="w-5 h-5 text-amber-500" /> BOM Extraction Preview
            </h2>
            <p className="text-sm text-slate-500 mt-0.5 truncate max-w-xl">{document.title}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-6">

          {step === 'idle' && (
            <div className="text-center py-10">
              <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <FileSearch className="w-8 h-8 text-amber-500" />
              </div>
              <h3 className="font-semibold text-slate-700 text-lg mb-2">Auto-Detect BOM Items</h3>
              <p className="text-slate-500 text-sm max-w-md mx-auto mb-2">
                AI will scan this document and extract all equipment, materials, and services. Sections with "Panel" in their header will be automatically aggregated into a single panel item.
              </p>
              <p className="text-slate-400 text-xs max-w-md mx-auto mb-5">
                After extraction you can edit categories and suppliers inline before importing.
              </p>

              {/* Active template indicator */}
              <div className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg mb-5 text-sm">
                <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                {activeTemplate ? (
                  <span className="text-slate-700">
                    Template: <span className="font-semibold text-amber-600">{activeTemplate.name}</span>
                    {activeTemplate.default_supplier && <span className="text-slate-400 ml-1">· {activeTemplate.default_supplier}</span>}
                  </span>
                ) : (
                  <span className="text-slate-400">No template selected — using defaults</span>
                )}
                <button onClick={() => setShowTemplateEditor(true)}
                  className="ml-2 flex items-center gap-1 text-xs text-slate-500 hover:text-amber-600 border border-slate-200 rounded px-2 py-0.5 hover:border-amber-300 transition">
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

          {step === 'loading' && (
            <div className="text-center py-20">
              <Loader2 className="w-10 h-10 animate-spin text-amber-500 mx-auto mb-4" />
              <h3 className="font-semibold text-slate-700 text-lg mb-1">Analyzing Document…</h3>
              <p className="text-slate-400 text-sm">Detecting BOM items, quantities, and pricing. Panel sections will be aggregated. This may take 20–40 seconds.</p>
            </div>
          )}

          {step === 'importing' && (
            <div className="text-center py-20">
              <Loader2 className="w-10 h-10 animate-spin text-blue-500 mx-auto mb-4" />
              <h3 className="font-semibold text-slate-700 text-lg">Importing {selectedItems.length} items…</h3>
            </div>
          )}

          {step === 'done' && (
            <div className="text-center py-20">
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
              <h3 className="font-semibold text-slate-700 text-lg">{selectedItems.length} BOM items imported successfully!</h3>
            </div>
          )}

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
                  {summary.sheet_name && <span className="text-slate-400">Sheet: {summary.sheet_name}</span>}
                  <span className="ml-auto font-semibold text-slate-700">{selectedIds.size} selected</span>
                </div>
              )}

              {/* Bulk edit bar — shown when items are selected */}
              {hasBulkSelection && (
                <div className="flex flex-wrap items-center gap-3 bg-slate-800 text-white rounded-lg px-4 py-2.5 text-xs">
                  <span className="font-semibold text-amber-400">{selectedIds.size} selected</span>
                  <span className="text-slate-400">·</span>
                  <span className="text-slate-300">Bulk edit:</span>
                  <select
                    value={bulkCategory}
                    onChange={e => setBulkCategory(e.target.value)}
                    className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white focus:outline-none focus:border-amber-400"
                  >
                    <option value="">Set Category…</option>
                    {Object.entries(BOM_CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <input
                    value={bulkSupplier}
                    onChange={e => setBulkSupplier(e.target.value)}
                    placeholder="Set Supplier…"
                    className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white placeholder-slate-400 focus:outline-none focus:border-amber-400 w-32"
                  />
                  {(bulkCategory || bulkSupplier) && (
                    <button onClick={applyBulkEdit}
                      className="flex items-center gap-1 px-3 py-1 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold rounded">
                      <Check className="w-3 h-3" /> Apply
                    </button>
                  )}
                  <button onClick={() => { setBulkCategory(''); setBulkSupplier(''); }}
                    className="ml-auto p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {error && <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded p-3">{error}</div>}

              {/* Table */}
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-800 text-white">
                      <tr>
                        <th className="px-3 py-2.5 w-8">
                          <button onClick={toggleAll} className="flex items-center justify-center">
                            <div className={`w-4 h-4 rounded border-2 flex items-center justify-center ${allSelected ? 'bg-amber-400 border-amber-400' : 'border-slate-400'}`}>
                              {allSelected && <Check className="w-2.5 h-2.5 text-slate-900" />}
                            </div>
                          </button>
                        </th>
                        <th className="px-3 py-2.5 text-left font-semibold">Part No.</th>
                        <th className="px-3 py-2.5 text-left font-semibold">Description / Section</th>
                        <th className="px-3 py-2.5 text-left font-semibold w-36">Category <Pencil className="w-2.5 h-2.5 inline ml-0.5 opacity-60" /></th>
                        <th className="px-3 py-2.5 text-left font-semibold w-32">Supplier <Pencil className="w-2.5 h-2.5 inline ml-0.5 opacity-60" /></th>
                        <th className="px-3 py-2.5 text-right font-semibold">Qty</th>
                        <th className="px-3 py-2.5 text-left font-semibold">Unit</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Unit Cost</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Total Cost</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Total Sell</th>
                        <th className="px-3 py-2.5 text-right font-semibold">GP%</th>
                        <th className="px-3 py-2.5 text-center font-semibold">Conf.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayItems.map((item, i) => {
                        const isSelected = selectedIds.has(item.preview_id);
                        const isPanelAgg = item.is_panel_aggregate;
                        const isExpanded = expandedPanels.has(item.preview_id);
                        const isDragTarget = dragOverPanel === item.preview_id;
                        return (
                          <>
                          <tr
                            key={item.preview_id}
                            className={`border-t border-slate-100 transition ${
                              isPanelAgg && isDragTarget ? 'bg-orange-200 ring-2 ring-orange-400' :
                              isPanelAgg ? 'bg-orange-50' :
                              isSelected ? 'bg-amber-50' : i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'
                            } hover:bg-amber-50/60`}
                            onDragOver={isPanelAgg ? e => onPanelDragOver(e, item.preview_id) : undefined}
                            onDrop={isPanelAgg ? e => onPanelDrop(e, item.preview_id) : undefined}
                            onDragLeave={isPanelAgg ? onPanelDragLeave : undefined}
                          >
                            {/* Checkbox */}
                            <td className="px-3 py-2 w-8">
                              <button onClick={() => toggleItem(item.preview_id)} className="flex items-center justify-center">
                                <div className={`w-4 h-4 rounded border-2 flex items-center justify-center mx-auto ${isSelected ? 'bg-amber-400 border-amber-400' : 'border-slate-300'}`}>
                                  {isSelected && <Check className="w-2.5 h-2.5 text-slate-900" />}
                                </div>
                              </button>
                            </td>
                            <td className="px-3 py-2 font-mono text-slate-500 whitespace-nowrap">{item.part_no || '—'}</td>
                            <td className="px-3 py-2 text-slate-800 max-w-[200px]">
                              <div className="flex items-center gap-1.5">
                                {isPanelAgg && (
                                  <button onClick={() => togglePanelExpand(item.preview_id)}
                                    className="shrink-0 p-0.5 hover:bg-orange-200 rounded text-orange-600">
                                    {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                  </button>
                                )}
                                {isPanelAgg && <Layers className="w-3 h-3 text-orange-500 shrink-0" />}
                                <div className="truncate font-medium">{item.description}</div>
                              </div>
                              {item.section && !isPanelAgg && <div className="text-slate-400 text-[10px] truncate">📁 {item.section}</div>}
                              {isPanelAgg && <div className="text-orange-600 text-[10px] truncate">📦 {item.panel_item_count} items · click to expand</div>}
                              {item.review_notes && <div className="text-amber-600 text-[10px] truncate">⚠ {item.review_notes}</div>}
                            </td>

                            {/* Editable Category */}
                            <td className="px-2 py-1.5" onClick={e => e.stopPropagation()}>
                              <select
                                value={item.category || 'other'}
                                onChange={e => updateItemField(item.preview_id, 'category', e.target.value)}
                                className={selInp + ' w-full'}
                              >
                                {Object.entries(BOM_CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                              </select>
                            </td>

                            {/* Editable Supplier */}
                            <td className="px-2 py-1.5" onClick={e => e.stopPropagation()}>
                              <input
                                value={item.supplier || ''}
                                onChange={e => updateItemField(item.preview_id, 'supplier', e.target.value)}
                                placeholder="Supplier"
                                className={selInp + ' w-full'}
                              />
                            </td>

                            <td className="px-3 py-2 text-right font-semibold text-slate-700">{item.qty}</td>
                            <td className="px-3 py-2 text-slate-500">{item.unit}</td>
                            <td className="px-3 py-2 text-right text-slate-700">{money(item.unit_cost_sar)}</td>
                            <td className="px-3 py-2 text-right font-semibold text-slate-800">{money(item.total_cost_sar)}</td>
                            <td className="px-3 py-2 text-right text-slate-600">{money(item.total_selling_sar)}</td>
                            <td className="px-3 py-2 text-right">
                              {item.margin_pct != null ? (
                                <span className={`font-semibold ${item.margin_pct < 0 ? 'text-red-600' : item.margin_pct < 0.1 ? 'text-amber-600' : 'text-emerald-600'}`}>
                                  {(item.margin_pct * 100).toFixed(1)}%
                                </span>
                              ) : '—'}
                            </td>
                            <td className="px-3 py-2 text-center">
                              {item.review_required ? (
                                <span className="flex items-center justify-center gap-0.5 text-amber-600">
                                  <AlertTriangle className="w-3 h-3" />
                                  <span>{item.confidence_score}%</span>
                                </span>
                              ) : (
                                <span className="text-emerald-600 font-semibold">{item.confidence_score}%</span>
                              )}
                            </td>
                          </tr>

                          {/* Expandable child items sub-table */}
                          {isPanelAgg && isExpanded && (item.child_items || []).length > 0 && (
                            <tr key={`${item.preview_id}_children`} className="border-t border-orange-200">
                              <td colSpan={12} className="p-0 bg-orange-50/60">
                                <div className="border-l-4 border-orange-300 ml-8 mr-2 my-1 rounded overflow-hidden">
                                  <table className="w-full text-xs">
                                    <thead className="bg-orange-100 text-orange-800">
                                      <tr>
                                        <th className="px-3 py-1.5 w-6"></th>
                                        <th className="px-3 py-1.5 text-left font-semibold">Description</th>
                                        <th className="px-3 py-1.5 text-right font-semibold">Qty</th>
                                        <th className="px-3 py-1.5 text-right font-semibold">Unit Cost SAR</th>
                                        <th className="px-3 py-1.5 text-right font-semibold">Total Cost SAR</th>
                                        <th className="px-3 py-1.5 text-right font-semibold">Unit Sell SAR</th>
                                        <th className="px-3 py-1.5 text-right font-semibold">Total Sell SAR</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {(item.child_items || []).map(child => (
                                        <tr key={child.child_id}
                                          draggable
                                          onDragStart={() => onChildDragStart(item.preview_id, child.child_id)}
                                          className="border-t border-orange-100 hover:bg-orange-100/60 cursor-grab active:cursor-grabbing"
                                        >
                                          <td className="px-2 py-1.5 text-orange-400">
                                            <GripVertical className="w-3 h-3" />
                                          </td>
                                          <td className="px-3 py-1.5 text-slate-700 font-medium">{child.description || '—'}</td>
                                          <td className="px-3 py-1.5 text-right text-slate-600">{child.qty}</td>
                                          <td className="px-3 py-1.5 text-right text-slate-600">{money(child.unit_cost_sar)}</td>
                                          <td className="px-3 py-1.5 text-right font-semibold text-slate-700">{money(child.total_cost_sar)}</td>
                                          <td className="px-3 py-1.5 text-right text-slate-600">{money(child.unit_selling_sar)}</td>
                                          <td className="px-3 py-1.5 text-right text-slate-600">{money(child.total_selling_sar)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                  <div className="px-3 py-1.5 text-[10px] text-orange-500 italic">
                                    Drag any row above and drop it onto another panel row to re-assign it.
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                          </>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {items.length > 50 && (
                  <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50 text-center">
                    <button onClick={() => setShowAll(v => !v)}
                      className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1 mx-auto">
                      {showAll ? <><ChevronUp className="w-3 h-3" /> Show less</> : <><ChevronDown className="w-3 h-3" /> Show all {items.length} items</>}
                    </button>
                  </div>
                )}
              </div>

              {selectedIds.size > 0 && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5 flex items-center gap-4 text-sm">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span className="text-emerald-700">
                    <span className="font-semibold">{selectedIds.size}</span> items selected
                    {totalCost > 0 && <> · Total cost: <span className="font-semibold">SAR {money(totalCost)}</span></>}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 'review' && (
          <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between shrink-0 bg-slate-50">
            <button onClick={onClose} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-slate-100">
              Cancel
            </button>
            <button
              onClick={importSelected}
              disabled={selectedIds.size === 0}
              className="px-6 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Import {selectedIds.size} Item{selectedIds.size !== 1 ? 's' : ''} to BOM
            </button>
          </div>
        )}
      </div>
    </div>
  );
}