import { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import {
  X, Loader2, CheckCircle2, FileSearch, AlertTriangle,
  ChevronDown, ChevronUp, Check
} from 'lucide-react';

const CATEGORY_COLORS = {
  plc: 'bg-blue-100 text-blue-700',
  hmi: 'bg-purple-100 text-purple-700',
  drive: 'bg-indigo-100 text-indigo-700',
  sensor: 'bg-cyan-100 text-cyan-700',
  meter: 'bg-teal-100 text-teal-700',
  panel: 'bg-orange-100 text-orange-700',
  cable: 'bg-yellow-100 text-yellow-700',
  network: 'bg-green-100 text-green-700',
  software: 'bg-pink-100 text-pink-700',
  service: 'bg-slate-100 text-slate-600',
  other: 'bg-slate-100 text-slate-500',
};

function money(val) {
  const n = Number(val || 0);
  if (!n) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);
}

export default function BOMExtractionPreviewModal({ document, projectId, onClose, onImported }) {
  const [step, setStep] = useState('idle'); // idle | loading | review | importing | done
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);

  const selectedItems = useMemo(() => items.filter(i => selectedIds.has(i.preview_id)), [items, selectedIds]);
  const allSelected = items.length > 0 && selectedIds.size === items.length;

  function toggleItem(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(items.map(i => i.preview_id)));
  }

  async function runPreview() {
    setStep('loading');
    setError('');
    try {
      const res = await base44.functions.invoke('bomExtractionPreview', {
        file_url: document.file_url,
        project_id: projectId,
        document_id: document.id,
      });
      const previewItems = res?.data?.items || [];
      setSummary(res?.data?.summary || null);
      setItems(previewItems);
      // Auto-select items that don't need review
      setSelectedIds(new Set(previewItems.filter(i => !i.review_required).map(i => i.preview_id)));
      setStep('review');
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Extraction failed.');
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

  const totalCost = useMemo(() =>
    selectedItems.reduce((s, i) => s + (Number(i.total_cost_sar) || 0), 0),
    [selectedItems]
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col">

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

          {/* IDLE */}
          {step === 'idle' && (
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <FileSearch className="w-8 h-8 text-amber-500" />
              </div>
              <h3 className="font-semibold text-slate-700 text-lg mb-2">Auto-Detect BOM Items</h3>
              <p className="text-slate-500 text-sm max-w-md mx-auto mb-6">
                AI will scan this document and extract all equipment, materials, and services with part numbers, quantities, and pricing — then let you review and select what to import.
              </p>
              {error && (
                <div className="text-red-600 text-sm mb-4 bg-red-50 border border-red-200 rounded p-3 max-w-md mx-auto">{error}</div>
              )}
              <button onClick={runPreview}
                className="px-6 py-3 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold rounded-lg text-sm">
                Start BOM Extraction
              </button>
            </div>
          )}

          {/* LOADING */}
          {step === 'loading' && (
            <div className="text-center py-20">
              <Loader2 className="w-10 h-10 animate-spin text-amber-500 mx-auto mb-4" />
              <h3 className="font-semibold text-slate-700 text-lg mb-1">Analyzing Document…</h3>
              <p className="text-slate-400 text-sm">Detecting BOM items, quantities, and pricing. This may take 20–40 seconds.</p>
            </div>
          )}

          {/* IMPORTING */}
          {step === 'importing' && (
            <div className="text-center py-20">
              <Loader2 className="w-10 h-10 animate-spin text-blue-500 mx-auto mb-4" />
              <h3 className="font-semibold text-slate-700 text-lg">Importing {selectedItems.length} items…</h3>
            </div>
          )}

          {/* DONE */}
          {step === 'done' && (
            <div className="text-center py-20">
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
              <h3 className="font-semibold text-slate-700 text-lg">{selectedItems.length} BOM items imported successfully!</h3>
            </div>
          )}

          {/* REVIEW */}
          {step === 'review' && (
            <div className="space-y-4">
              {/* Summary bar */}
              {summary && (
                <div className="flex flex-wrap gap-4 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-sm">
                  <span><span className="font-semibold text-slate-700">{summary.total}</span> <span className="text-slate-500">items found</span></span>
                  <span><span className="font-semibold text-emerald-600">{summary.auto_selected}</span> <span className="text-slate-500">auto-selected</span></span>
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

              {error && (
                <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded p-3">{error}</div>
              )}

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
                        <th className="px-3 py-2.5 text-left font-semibold">Description</th>
                        <th className="px-3 py-2.5 text-left font-semibold">Category</th>
                        <th className="px-3 py-2.5 text-left font-semibold">Manufacturer</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Qty</th>
                        <th className="px-3 py-2.5 text-left font-semibold">Unit</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Unit Cost (SAR)</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Total Cost (SAR)</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Unit Sell (SAR)</th>
                        <th className="px-3 py-2.5 text-center font-semibold">Conf.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayItems.map((item, i) => {
                        const isSelected = selectedIds.has(item.preview_id);
                        const needsReview = item.review_required;
                        return (
                          <tr
                            key={item.preview_id}
                            onClick={() => toggleItem(item.preview_id)}
                            className={`border-t border-slate-100 cursor-pointer transition ${
                              isSelected ? 'bg-amber-50' : i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'
                            } hover:bg-amber-50/60`}
                          >
                            <td className="px-3 py-2 w-8">
                              <div className={`w-4 h-4 rounded border-2 flex items-center justify-center mx-auto ${isSelected ? 'bg-amber-400 border-amber-400' : 'border-slate-300'}`}>
                                {isSelected && <Check className="w-2.5 h-2.5 text-slate-900" />}
                              </div>
                            </td>
                            <td className="px-3 py-2 font-mono text-slate-500 whitespace-nowrap">{item.part_no || '—'}</td>
                            <td className="px-3 py-2 text-slate-800 max-w-[220px]">
                              <div className="truncate font-medium">{item.description}</div>
                              {item.section && <div className="text-slate-400 text-[10px] truncate">{item.section}</div>}
                            </td>
                            <td className="px-3 py-2">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${CATEGORY_COLORS[item.category] || 'bg-slate-100 text-slate-500'}`}>
                                {item.category}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-slate-600 truncate max-w-[100px]">{item.manufacturer || '—'}</td>
                            <td className="px-3 py-2 text-right font-semibold text-slate-700">{item.qty}</td>
                            <td className="px-3 py-2 text-slate-500">{item.unit}</td>
                            <td className="px-3 py-2 text-right text-slate-700">{money(item.unit_cost_sar)}</td>
                            <td className="px-3 py-2 text-right font-semibold text-slate-800">{money(item.total_cost_sar)}</td>
                            <td className="px-3 py-2 text-right text-slate-600">{money(item.unit_selling_sar)}</td>
                            <td className="px-3 py-2 text-center">
                              {needsReview ? (
                                <span className="flex items-center justify-center gap-0.5 text-amber-600">
                                  <AlertTriangle className="w-3 h-3" />
                                  <span>{item.confidence_score}%</span>
                                </span>
                              ) : (
                                <span className="text-emerald-600 font-semibold">{item.confidence_score}%</span>
                              )}
                            </td>
                          </tr>
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

              {/* Selection summary */}
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