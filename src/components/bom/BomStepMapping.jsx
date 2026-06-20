/**
 * Step 2 — Confirm Field Mapping
 * Shows each logical field → detected column, confidence, sample values.
 * User can override via dropdown.
 */
import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { CheckCircle2, AlertTriangle, ChevronDown, Info, Loader2 } from 'lucide-react';

const LOGICAL_FIELDS = [
  { key: 'description', label: 'Description', required: true },
  { key: 'part_no', label: 'Part No.', required: true },
  { key: 'supplier', label: 'Supplier / Manufacturer', required: false },
  { key: 'qty', label: 'Quantity', required: true },
  { key: 'unit', label: 'Unit', required: false },
  { key: 'unit_cost', label: 'Unit Cost (planned)', required: false },
  { key: 'total_cost', label: 'Total Cost', required: false },
  { key: 'unit_sell', label: 'Unit Selling Price', required: false },
  { key: 'total_sell', label: 'Total Selling', required: false },
  { key: 'markup_pct', label: 'Markup %', required: false },
  { key: 'lead_time', label: 'Lead Time', required: false },
];

const LAYER_LABELS = { 1: 'Header name', 2: 'Position heuristic', 3: 'Content shape', 4: 'Manual' };
const LAYER_COLORS = { 1: 'text-emerald-600', 2: 'text-amber-600', 3: 'text-orange-600', 4: 'text-blue-600' };

function ConfidencePill({ value }) {
  const pct = Math.round((value || 0) * 100);
  const color = pct >= 80 ? 'bg-emerald-100 text-emerald-700' : pct >= 60 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700';
  return <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${color}`}>{pct}%</span>;
}

export default function BomStepMapping({ profile, sheetNames, templateMatch, fileUrl, onConfirm, onBack }) {
  const [fieldMap, setFieldMap] = useState(() => ({ ...(profile?.field_map || {}) }));
  const [loading, setLoading] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const allColumns = profile?.all_columns || [];

  const missingRequired = LOGICAL_FIELDS.filter(f => f.required && !fieldMap[f.key]);
  const canProceed = missingRequired.length === 0;

  function overrideField(fieldKey, colIdx) {
    const col = allColumns.find(c => c.col_idx === Number(colIdx));
    if (!col) {
      // Unmap
      setFieldMap(prev => { const n = { ...prev }; delete n[fieldKey]; return n; });
      return;
    }
    const samples = (profile?._raw_rows || [])
      .slice(profile?.data_start_row || 1)
      .map(r => r[col.col_idx])
      .filter(v => v != null && v !== '')
      .slice(0, 3);
    setFieldMap(prev => ({
      ...prev,
      [fieldKey]: { col_idx: col.col_idx, raw: col.raw, confidence: 0.99, layer: 4, _samples: samples },
    }));
  }

  function getSamples(fieldKey) {
    const info = fieldMap[fieldKey];
    if (!info) return [];
    if (info._samples) return info._samples;
    return profile?.sample_values?.[fieldKey] || [];
  }

  function handleConfirm() {
    onConfirm({ ...profile, field_map: fieldMap });
  }

  return (
    <div className="p-6 space-y-5">
      {/* Template match banner */}
      {templateMatch && (
        <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm">
          <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-blue-800">Template auto-applied:</span>
            <span className="text-blue-700 ml-1">"{templateMatch.template?.name}"</span>
            <span className="text-blue-500 ml-2 text-xs">({Math.round(templateMatch.similarity * 100)}% header similarity)</span>
            <p className="text-blue-600 text-xs mt-0.5">Review the mapping below and adjust if needed.</p>
          </div>
        </div>
      )}

      {/* Missing required fields warning */}
      {missingRequired.length > 0 && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm">
          <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-red-700">Required fields not mapped:</span>
            <span className="text-red-600 ml-2">{missingRequired.map(f => f.label).join(', ')}</span>
            <p className="text-red-500 text-xs mt-0.5">Please assign these from the dropdowns below before continuing.</p>
          </div>
        </div>
      )}

      {/* Detection log */}
      <details className="border border-slate-200 rounded-lg">
        <summary className="px-4 py-3 text-xs font-semibold text-slate-500 cursor-pointer hover:bg-slate-50 flex items-center gap-2">
          <Info className="w-3.5 h-3.5" /> Import details — detection layer log
        </summary>
        <div className="px-4 pb-4 space-y-1 text-xs">
          {LOGICAL_FIELDS.map(f => {
            const info = fieldMap[f.key];
            if (!info) return (
              <div key={f.key} className="flex items-center gap-2 text-slate-400">
                <span className="w-28 shrink-0">{f.label}</span>
                <span className="text-red-400">{f.required ? '⚠ unmapped (required)' : 'not mapped'}</span>
              </div>
            );
            return (
              <div key={f.key} className="flex items-center gap-2">
                <span className="w-28 shrink-0 text-slate-600">{f.label}</span>
                <span className="font-mono text-slate-700">col {info.col_idx} ({info.raw})</span>
                <span className={`text-[10px] ${LAYER_COLORS[info.layer] || ''}`}>via {LAYER_LABELS[info.layer] || `layer ${info.layer}`}</span>
                <ConfidencePill value={info.confidence} />
              </div>
            );
          })}
        </div>
      </details>

      {/* Field mapping table */}
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-800 text-white">
            <tr>
              <th className="px-4 py-2.5 text-left font-semibold text-xs w-40">Logical Field</th>
              <th className="px-4 py-2.5 text-left font-semibold text-xs">Detected Column</th>
              <th className="px-4 py-2.5 text-left font-semibold text-xs w-24">Confidence</th>
              <th className="px-4 py-2.5 text-left font-semibold text-xs">Sample Values</th>
              <th className="px-4 py-2.5 text-left font-semibold text-xs w-48">Override</th>
            </tr>
          </thead>
          <tbody>
            {LOGICAL_FIELDS.map((f, i) => {
              const info = fieldMap[f.key];
              const samples = getSamples(f.key);
              const isMissing = !info;
              const isLowConf = info && info.confidence < 0.65;

              return (
                <tr key={f.key} className={`border-t border-slate-100 ${isMissing && f.required ? 'bg-red-50' : isLowConf ? 'bg-amber-50' : i % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}>
                  <td className="px-4 py-2.5">
                    <span className="font-medium text-slate-700">{f.label}</span>
                    {f.required && <span className="text-red-500 ml-1 text-xs">*</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    {info ? (
                      <span className="font-mono text-slate-600 text-xs bg-slate-100 px-2 py-0.5 rounded">
                        col {info.col_idx}: {info.raw}
                      </span>
                    ) : (
                      <span className="text-slate-400 text-xs italic">not detected</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {info ? <ConfidencePill value={info.confidence} /> : '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    {samples.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {samples.map((s, si) => (
                          <span key={si} className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono max-w-[120px] truncate" title={String(s)}>
                            {String(s)}
                          </span>
                        ))}
                      </div>
                    ) : <span className="text-slate-300 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <select
                      value={info?.col_idx ?? ''}
                      onChange={e => overrideField(f.key, e.target.value)}
                      className="text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-amber-400 bg-white w-full"
                    >
                      <option value="">— not used —</option>
                      {allColumns.map(col => (
                        <option key={col.col_idx} value={col.col_idx}>
                          col {col.col_idx}: {col.raw || '(blank)'}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-2">
        <button onClick={onBack} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-slate-100">
          ← Back
        </button>
        <button onClick={handleConfirm} disabled={!canProceed}
          className="px-6 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded-lg disabled:opacity-40 disabled:cursor-not-allowed">
          Looks good, continue →
        </button>
      </div>
    </div>
  );
}