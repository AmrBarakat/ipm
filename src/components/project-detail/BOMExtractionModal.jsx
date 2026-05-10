import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { X, Loader2, CheckCircle, Trash2, ChevronDown } from 'lucide-react';

const CATEGORIES = ['plc', 'hmi', 'drive', 'sensor', 'meter', 'panel', 'cable', 'network', 'software', 'service', 'other'];

export default function BOMExtractionModal({ document, projectId, onClose, onApplied }) {
  const [step, setStep] = useState('idle'); // idle | extracting | review | applying | done
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [error, setError] = useState(null);

  async function startExtraction() {
    setStep('extracting');
    setError(null);
    const res = await base44.functions.invoke('extractBOMFromDocument', {
      file_url: document.file_url,
      project_id: projectId,
    });
    const extracted = res.data?.items || [];
    if (extracted.length === 0) {
      setError('No BOM items could be extracted from this document. Make sure it contains equipment lists or materials.');
      setStep('idle');
      return;
    }
    setItems(extracted.map((item, i) => ({ ...item, _id: i })));
    setSelected(new Set(extracted.map((_, i) => i)));
    setStep('review');
  }

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map(i => i._id)));
  }

  function updateItem(id, field, value) {
    setItems(prev => prev.map(item => item._id === id ? { ...item, [field]: value } : item));
  }

  function removeItem(id) {
    setItems(prev => prev.filter(i => i._id !== id));
    setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
  }

  async function applySelected() {
    const toCreate = items.filter(i => selected.has(i._id)).map(({ _id, ...rest }) => ({
      ...rest,
      project_id: projectId,
      quantity: Number(rest.quantity) || 1,
      cost_price: Number(rest.cost_price) || 0,
      selling_price: Number(rest.selling_price) || 0,
      stock_status: 'non_stock',
      order_status: 'not_ordered',
      delivery_status: 'pending',
    }));
    setStep('applying');
    await base44.entities.BOMItem.bulkCreate(toCreate);
    setStep('done');
    setTimeout(() => { onApplied(); onClose(); }, 1200);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div>
            <h2 className="font-bold text-slate-800 text-lg">Extract BOM from Document</h2>
            <p className="text-sm text-slate-500 mt-0.5 truncate max-w-lg">{document.title}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-6">
          {step === 'idle' && (
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-3xl">🤖</span>
              </div>
              <h3 className="font-semibold text-slate-700 text-lg mb-2">AI-Powered BOM Extraction</h3>
              <p className="text-slate-500 text-sm max-w-md mx-auto mb-6">
                The AI will analyze your document and identify all equipment, materials, hardware, software, and services — then present them for your review before saving.
              </p>
              {error && <p className="text-red-600 text-sm mb-4 bg-red-50 border border-red-200 rounded p-3">{error}</p>}
              <button onClick={startExtraction}
                className="px-6 py-3 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold rounded-lg text-sm">
                Start Extraction
              </button>
            </div>
          )}

          {step === 'extracting' && (
            <div className="text-center py-16">
              <Loader2 className="w-10 h-10 animate-spin text-amber-500 mx-auto mb-4" />
              <h3 className="font-semibold text-slate-700 text-lg mb-1">Analyzing Document…</h3>
              <p className="text-slate-400 text-sm">The AI is reading through your document and extracting BOM items. This may take 15–30 seconds.</p>
            </div>
          )}

          {step === 'applying' && (
            <div className="text-center py-16">
              <Loader2 className="w-10 h-10 animate-spin text-blue-500 mx-auto mb-4" />
              <h3 className="font-semibold text-slate-700 text-lg">Saving BOM Items…</h3>
            </div>
          )}

          {step === 'done' && (
            <div className="text-center py-16">
              <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
              <h3 className="font-semibold text-slate-700 text-lg">BOM Items Added Successfully!</h3>
            </div>
          )}

          {step === 'review' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <p className="text-sm text-slate-600 font-medium">{items.length} items extracted — {selected.size} selected to import</p>
                  <button onClick={toggleAll} className="text-xs text-amber-600 hover:underline">
                    {selected.size === items.length ? 'Deselect all' : 'Select all'}
                  </button>
                </div>
                <p className="text-xs text-slate-400">Edit any field before saving</p>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs min-w-[900px]">
                    <thead className="bg-slate-800 text-white">
                      <tr>
                        <th className="px-3 py-2 w-8">
                          <input type="checkbox" checked={selected.size === items.length} onChange={toggleAll}
                            className="accent-amber-400" />
                        </th>
                        <th className="px-3 py-2 text-left font-semibold">Description</th>
                        <th className="px-3 py-2 text-left font-semibold w-24">Item Code</th>
                        <th className="px-3 py-2 text-left font-semibold w-28">Category</th>
                        <th className="px-3 py-2 text-left font-semibold w-28">Manufacturer</th>
                        <th className="px-3 py-2 text-left font-semibold w-24">Part No.</th>
                        <th className="px-3 py-2 text-right font-semibold w-16">Qty</th>
                        <th className="px-3 py-2 text-left font-semibold w-14">Unit</th>
                        <th className="px-3 py-2 text-right font-semibold w-24">Cost Price</th>
                        <th className="px-3 py-2 text-right font-semibold w-24">Sell Price</th>
                        <th className="px-3 py-2 w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(item => {
                        const isSel = selected.has(item._id);
                        return (
                          <tr key={item._id} className={`border-t border-slate-100 ${isSel ? 'bg-white' : 'bg-slate-50 opacity-50'}`}>
                            <td className="px-3 py-2 text-center">
                              <input type="checkbox" checked={isSel} onChange={() => toggleSelect(item._id)}
                                className="accent-amber-500" />
                            </td>
                            <td className="px-3 py-2">
                              <input value={item.description} onChange={e => updateItem(item._id, 'description', e.target.value)}
                                className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400" />
                            </td>
                            <td className="px-3 py-2">
                              <input value={item.item_code || ''} onChange={e => updateItem(item._id, 'item_code', e.target.value)}
                                className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400" />
                            </td>
                            <td className="px-3 py-2">
                              <select value={item.category || 'other'} onChange={e => updateItem(item._id, 'category', e.target.value)}
                                className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400 bg-white">
                                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                              </select>
                            </td>
                            <td className="px-3 py-2">
                              <input value={item.manufacturer || ''} onChange={e => updateItem(item._id, 'manufacturer', e.target.value)}
                                className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400" />
                            </td>
                            <td className="px-3 py-2">
                              <input value={item.manufacturer_part_number || ''} onChange={e => updateItem(item._id, 'manufacturer_part_number', e.target.value)}
                                className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400" />
                            </td>
                            <td className="px-3 py-2">
                              <input type="number" value={item.quantity} min="0" onChange={e => updateItem(item._id, 'quantity', e.target.value)}
                                className="w-full border border-slate-200 rounded px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-amber-400" />
                            </td>
                            <td className="px-3 py-2">
                              <input value={item.unit || 'pcs'} onChange={e => updateItem(item._id, 'unit', e.target.value)}
                                className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400" />
                            </td>
                            <td className="px-3 py-2">
                              <input type="number" value={item.cost_price || 0} min="0" onChange={e => updateItem(item._id, 'cost_price', e.target.value)}
                                className="w-full border border-slate-200 rounded px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-amber-400" />
                            </td>
                            <td className="px-3 py-2">
                              <input type="number" value={item.selling_price || 0} min="0" onChange={e => updateItem(item._id, 'selling_price', e.target.value)}
                                className="w-full border border-slate-200 rounded px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-amber-400" />
                            </td>
                            <td className="px-3 py-2">
                              <button onClick={() => removeItem(item._id)} className="p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 'review' && (
          <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between shrink-0 bg-slate-50">
            <p className="text-sm text-slate-500">
              {selected.size} of {items.length} items will be added to the BOM
            </p>
            <div className="flex gap-3">
              <button onClick={onClose} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-slate-100">
                Cancel
              </button>
              <button onClick={applySelected} disabled={selected.size === 0}
                className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded-lg disabled:opacity-40">
                Add {selected.size} Item{selected.size !== 1 ? 's' : ''} to BOM
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}