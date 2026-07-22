/**
 * Step 3 — Preview & Edit
 * Editable grid of classified/aggregated rows before committing to BOM.
 */
import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Loader2, AlertTriangle, ChevronRight, ChevronDown, Trash2, Layers } from 'lucide-react';

const CATEGORY_LABELS = {
  plc: 'Equipment / PLC', hmi: 'HMI', drive: 'Drive', sensor: 'Sensor',
  meter: 'Meter', panel: 'Panel / Enclosure', network: 'Network / Comms',
  software_license: 'Software / License', service: 'Service', it_hardware: 'IT Hardware', other: 'Other',
};
const CATEGORY_OPTIONS = Object.entries(CATEGORY_LABELS);

const INP = 'border border-slate-200 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400 bg-white w-full';
const INP_NUM = INP + ' text-right';

function fmt(n) {
  if (n == null || n === '') return '—';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function BomStepPreview({ fileUrl, profile, onPreviewReady, previewRows, warnings, summary, onBack, onProceed }) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState(previewRows || []);
  const [expanded, setExpanded] = useState({});
  const [error, setError] = useState('');

  useEffect(() => {
    if (previewRows && previewRows.length > 0) {
      setRows(previewRows);
      return;
    }
    extractPreview();
  }, []);

  async function extractPreview() {
    setLoading(true);
    setError('');
    try {
      const res = await base44.functions.invoke('bomSkillExtract', {
        file_url: fileUrl,
        profile,
      });
      const data = res.data;
      setRows(data.preview_rows || []);
      onPreviewReady({ preview_rows: data.preview_rows, warnings: data.warnings, summary: data.summary });
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Extraction failed.');
    } finally {
      setLoading(false);
    }
  }

  function updateRow(preview_id, field, value) {
    setRows(prev => prev.map(r => r.preview_id === preview_id ? { ...r, [field]: value } : r));
    onPreviewReady({ preview_rows: rows, warnings, summary });
  }

  function deleteRow(preview_id) {
    setRows(prev => {
      const row = prev.find(r => r.preview_id === preview_id);
      let filtered = prev.filter(r => r.preview_id !== preview_id);
      if (row?.is_panel) filtered = filtered.filter(r => r._parent_preview_id !== preview_id);
      return filtered;
    });
  }

  const topLevel = rows.filter(r => !r.is_child);
  const childrenOf = (pid) => rows.filter(r => r.is_child && r._parent_preview_id === pid);

  // Group by category
  const groups = {};
  for (const r of topLevel) {
    const cat = r.category || 'other';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(r);
  }

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
      <p className="text-slate-500 text-sm">Classifying and aggregating rows…</p>
    </div>
  );

  if (error) return (
    <div className="p-8 text-center">
      <AlertTriangle className="w-10 h-10 text-red-400 mx-auto mb-3" />
      <p className="text-red-600 font-semibold">{error}</p>
      <button onClick={extractPreview} className="mt-4 px-4 py-2 bg-amber-500 text-slate-900 text-sm font-semibold rounded-lg">Retry</button>
    </div>
  );

  const grandCost = topLevel.reduce((s, r) => s + ((r.planned_cost_price ?? 0) * (r.quantity ?? 1)), 0);
  const grandSell = topLevel.reduce((s, r) => s + ((r.selling_price ?? 0) * (r.quantity ?? 1)), 0);

  return (
    <div className="p-4 space-y-4">
      {/* Summary bar */}
      {summary && (
        <div className="flex flex-wrap gap-4 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-sm">
          <span><b className="text-slate-800">{summary.total_rows}</b> <span className="text-slate-500">top-level items</span></span>
          {summary.panel_count > 0 && <span><b className="text-orange-600">{summary.panel_count}</b> <span className="text-slate-500">panels</span></span>}
          {summary.child_count > 0 && <span><b className="text-slate-500">{summary.child_count}</b> <span className="text-slate-400">panel children</span></span>}
          <span className="ml-auto text-slate-600">
            Planned: <b className="text-slate-800">SAR {fmt(grandCost)}</b>
            {grandSell > 0 && <> · Sell: <b className="text-emerald-700">SAR {fmt(grandSell)}</b></>}
          </span>
        </div>
      )}

      {/* Warnings */}
      {warnings && warnings.length > 0 && (
        <details className="border border-amber-200 bg-amber-50 rounded-lg">
          <summary className="px-4 py-2.5 text-xs font-semibold text-amber-700 cursor-pointer flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5" /> {warnings.length} import warning{warnings.length !== 1 ? 's' : ''}
          </summary>
          <ul className="px-4 pb-3 space-y-1 text-xs text-amber-700">
            {warnings.map((w, i) => <li key={i}>• {w}</li>)}
          </ul>
        </details>
      )}

      {/* Table */}
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-auto max-h-[50vh]">
          <table className="w-full text-xs min-w-[1100px]">
            <thead className="bg-slate-800 text-white sticky top-0 z-10">
              <tr>
                <th className="px-2 py-2.5 text-left w-5"></th>
                <th className="px-2 py-2.5 text-left min-w-[180px]">DESCRIPTION</th>
                <th className="px-2 py-2.5 text-left w-24">PART NO.</th>
                <th className="px-2 py-2.5 text-left w-24">SUPPLIER</th>
                <th className="px-2 py-2.5 text-left w-28">CATEGORY</th>
                <th className="px-2 py-2.5 text-right w-14">QTY</th>
                <th className="px-2 py-2.5 text-right w-14">STOCK</th>
                <th className="px-2 py-2.5 text-right w-14">ORD QTY</th>
                <th className="px-2 py-2.5 text-right w-24">UNIT COST</th>
                <th className="px-2 py-2.5 text-right w-24">TOTAL PLANNED</th>
                <th className="px-2 py-2.5 text-right w-24">UNIT SELL</th>
                <th className="px-2 py-2.5 text-right w-24">TOTAL SELL</th>
                <th className="px-1 py-2.5 w-7"></th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(groups).map(([cat, catRows]) => {
                const catCost = catRows.reduce((s, r) => s + ((r.planned_cost_price ?? 0) * (r.quantity ?? 1)), 0);
                const catSell = catRows.reduce((s, r) => s + ((r.selling_price ?? 0) * (r.quantity ?? 1)), 0);
                return [
                  <tr key={`hdr_${cat}`} className="bg-slate-100 border-t-2 border-slate-300">
                    <td colSpan={13} className="px-4 py-1.5">
                      <div className="flex items-center gap-4 flex-wrap">
                        <span className="font-bold text-slate-700 text-xs uppercase tracking-wide">{CATEGORY_LABELS[cat] || cat} · {catRows.length} items</span>
                        {catCost > 0 && <span className="text-xs text-slate-500">Planned: <b className="text-slate-700">SAR {fmt(catCost)}</b></span>}
                        {catSell > 0 && <span className="text-xs text-slate-500">Sell: <b className="text-emerald-700">SAR {fmt(catSell)}</b></span>}
                      </div>
                    </td>
                  </tr>,
                  ...catRows.map(row => {
                    const orderQty = Math.max(0, (row.quantity ?? 0) - (row.stock_qty ?? 0));
                    const totalPlanned = (row.planned_cost_price ?? 0) * (row.quantity ?? 1);
                    const totalSell = (row.selling_price ?? 0) * (row.quantity ?? 1);
                    const children = childrenOf(row.preview_id);
                    const isExpanded = expanded[row.preview_id];

                    return [
                      <tr key={row.preview_id} className={`border-t border-slate-100 ${row.is_panel ? 'bg-orange-50' : 'bg-white hover:bg-slate-50'}`}>
                        <td className="px-2 py-1.5">
                          {row.is_panel && (
                            <button onClick={() => setExpanded(p => ({ ...p, [row.preview_id]: !isExpanded }))}
                              className="text-orange-500 hover:text-orange-700">
                              {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                            </button>
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex items-center gap-1">
                            {row.is_panel && <Layers className="w-3 h-3 text-orange-400 shrink-0" />}
                            <input value={row.description} onChange={e => updateRow(row.preview_id, 'description', e.target.value)} className={INP + ' font-medium'} />
                          </div>
                        </td>
                        <td className="px-2 py-1.5"><input value={row.manufacturer_part_number || ''} onChange={e => updateRow(row.preview_id, 'manufacturer_part_number', e.target.value)} className={INP + ' font-mono'} /></td>
                        <td className="px-2 py-1.5"><input value={row.supplier || ''} onChange={e => updateRow(row.preview_id, 'supplier', e.target.value)} className={INP} /></td>
                        <td className="px-2 py-1.5">
                          <select value={row.category || 'other'} onChange={e => updateRow(row.preview_id, 'category', e.target.value)} className={INP}>
                            {CATEGORY_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </select>
                        </td>
                        <td className="px-1 py-1.5"><input type="number" min="0" value={row.quantity ?? ''} onChange={e => updateRow(row.preview_id, 'quantity', Number(e.target.value))} className={INP_NUM} /></td>
                        <td className="px-1 py-1.5"><input type="number" min="0" value={row.stock_qty ?? 0} onChange={e => updateRow(row.preview_id, 'stock_qty', Number(e.target.value))} className={INP_NUM} /></td>
                        <td className="px-2 py-2 text-right font-semibold text-orange-600">{orderQty}</td>
                        <td className="px-1 py-1.5"><input type="number" step="0.01" value={row.planned_cost_price ?? ''} onChange={e => updateRow(row.preview_id, 'planned_cost_price', Number(e.target.value))} className={INP_NUM} /></td>
                        <td className="px-2 py-2 text-right font-semibold text-slate-700">{fmt(totalPlanned)}</td>
                        <td className="px-1 py-1.5"><input type="number" step="0.01" value={row.selling_price ?? ''} onChange={e => updateRow(row.preview_id, 'selling_price', Number(e.target.value))} className={INP_NUM} /></td>
                        <td className="px-2 py-2 text-right font-semibold text-emerald-700">{fmt(totalSell)}</td>
                        <td className="px-1 py-1.5 text-center">
                          <button onClick={() => deleteRow(row.preview_id)} className="p-1 text-slate-200 hover:text-red-500 hover:bg-red-50 rounded">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>,
                      // Expanded panel children
                      isExpanded && children.length > 0 && (
                        <tr key={`${row.preview_id}_children`}>
                          <td colSpan={13} className="p-0">
                            <table className="w-full text-xs bg-orange-50/60 border-t border-orange-100">
                              <thead className="bg-orange-100 text-orange-800">
                                <tr>
                                  <th className="px-6 py-1.5 text-left">S.No</th>
                                  <th className="px-2 py-1.5 text-left">Part No.</th>
                                  <th className="px-2 py-1.5 text-left">Description</th>
                                  <th className="px-2 py-1.5 text-right">Qty</th>
                                  <th className="px-2 py-1.5 text-right">Unit Cost</th>
                                  <th className="px-2 py-1.5 text-right">Total</th>
                                </tr>
                              </thead>
                              <tbody>
                                {children.map((c, ci) => (
                                  <tr key={c.preview_id} className="border-t border-orange-100">
                                    <td className="px-6 py-1.5 text-slate-400">{c._seq || ci + 1}</td>
                                    <td className="px-2 py-1.5 font-mono text-slate-500">{c.manufacturer_part_number || '—'}</td>
                                    <td className="px-2 py-1.5 text-slate-700">{c.description}</td>
                                    <td className="px-2 py-1.5 text-right">{c.quantity}</td>
                                    <td className="px-2 py-1.5 text-right">{fmt(c.planned_cost_price)}</td>
                                    <td className="px-2 py-1.5 text-right font-semibold">{fmt((c.planned_cost_price ?? 0) * (c.quantity ?? 1))}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      ),
                    ];
                  }),
                  // Subtotal row
                  <tr key={`sub_${cat}`} className="border-t border-slate-200 bg-slate-50">
                    <td colSpan={9} className="px-4 py-1.5 text-xs text-slate-500 font-semibold">Subtotal ({catRows.length})</td>
                    <td className="px-2 py-1.5 text-right text-xs font-semibold text-slate-700">{fmt(catCost)}</td>
                    <td className="px-2 py-1.5"></td>
                    <td className="px-2 py-1.5 text-right text-xs font-semibold text-emerald-700">{fmt(catSell)}</td>
                    <td></td>
                  </tr>,
                ];
              })}

              {/* Grand total */}
              <tr className="border-t-2 border-slate-400 bg-slate-800 text-white">
                <td colSpan={9} className="px-4 py-2 text-sm font-bold">GRAND TOTAL · {topLevel.length} items</td>
                <td className="px-2 py-2 text-right font-bold text-amber-300">{fmt(grandCost)}</td>
                <td className="px-2 py-2"></td>
                <td className="px-2 py-2 text-right font-bold text-emerald-300">{fmt(grandSell)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-2">
        <button onClick={onBack} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-slate-100">← Back</button>
        <button onClick={() => { onPreviewReady({ preview_rows: rows, warnings, summary }); onProceed(); }}
          className="px-6 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded-lg">
          Save to BOM →
        </button>
      </div>
    </div>
  );
}