/**
 * Step 4 — Save to BOM
 * Conflict detection, per-row resolution, template save option.
 */
import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Loader2, CheckCircle2, AlertTriangle, Save } from 'lucide-react';

const CATEGORY_LABELS = {
  plc: 'Equipment / PLC', hmi: 'HMI', drive: 'Drive', sensor: 'Sensor',
  meter: 'Meter', panel: 'Panel / Enclosure', network: 'Network / Comms',
  software_license: 'Software / License', service: 'Service', it_hardware: 'IT Hardware', other: 'Other',
};

function fmt(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function BomStepSave({ projectId, previewRows, profile, warnings, summary, onSaved, onBack }) {
  const [existing, setExisting] = useState([]);
  const [conflicts, setConflicts] = useState([]);
  const [resolutions, setResolutions] = useState({});
  const [saveTemplate, setSaveTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadConflicts();
  }, []);

  async function loadConflicts() {
    setLoading(true);
    try {
      const items = await base44.entities.BOMItem.filter({ project_id: projectId });
      setExisting(items);

      const existingByPartNo = {};
      for (const item of items) {
        if (item.manufacturer_part_number) {
          existingByPartNo[item.manufacturer_part_number.toLowerCase()] = item;
        }
      }

      const found = previewRows
        .filter(r => !r.is_child && r.manufacturer_part_number)
        .filter(r => existingByPartNo[r.manufacturer_part_number.toLowerCase()])
        .map(r => ({
          preview_id: r.preview_id,
          description: r.description,
          part_no: r.manufacturer_part_number,
          new_qty: r.quantity,
          existing_qty: existingByPartNo[r.manufacturer_part_number.toLowerCase()].quantity,
        }));

      setConflicts(found);
      // Default: skip conflicts
      const defaultRes = {};
      found.forEach(c => { defaultRes[c.preview_id] = 'skip'; });
      setResolutions(defaultRes);
    } catch (err) {
      setError('Could not check for conflicts: ' + (err.message || ''));
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const res = await base44.functions.invoke('bomSkillSave', {
        project_id: projectId,
        preview_rows: previewRows,
        conflict_resolutions: resolutions,
        save_template: saveTemplate && templateName.trim() ? true : false,
        template_name: templateName.trim() || null,
        profile: profile,
      });
      setResult(res.data);
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  if (result) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <CheckCircle2 className="w-14 h-14 text-emerald-500" />
        <h3 className="font-bold text-slate-800 text-xl">BOM Import Complete!</h3>
        <div className="flex gap-6 text-sm text-slate-600">
          <span><b className="text-emerald-700">{result.created}</b> created</span>
          {result.skipped > 0 && <span><b className="text-slate-500">{result.skipped}</b> skipped</span>}
          {result.merged > 0 && <span><b className="text-amber-600">{result.merged}</b> merged</span>}
          {result.template_id && <span><b className="text-blue-600">Template saved</b></span>}
        </div>
        <button onClick={onSaved} className="mt-4 px-6 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold rounded-lg">
          Done
        </button>
      </div>
    );
  }

  const topLevel = previewRows.filter(r => !r.is_child);
  const totalPlanned = topLevel.reduce((s, r) => s + ((r.planned_cost_price ?? 0) * (r.quantity ?? 1)), 0);
  const totalSell = topLevel.reduce((s, r) => s + ((r.selling_price ?? 0) * (r.quantity ?? 1)), 0);

  return (
    <div className="p-6 space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Items to import', value: topLevel.length, color: 'text-slate-800' },
          { label: 'Total Planned Cost', value: `SAR ${fmt(totalPlanned)}`, color: 'text-slate-700' },
          { label: 'Total Sell Value', value: `SAR ${fmt(totalSell)}`, color: 'text-emerald-700' },
        ].map(k => (
          <div key={k.label} className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-center">
            <div className={`font-bold text-lg ${k.color}`}>{k.value}</div>
            <div className="text-xs text-slate-500 mt-0.5">{k.label}</div>
          </div>
        ))}
      </div>

      {/* Conflicts */}
      {loading && <div className="text-slate-400 text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Checking for conflicts…</div>}

      {!loading && conflicts.length > 0 && (
        <div className="border border-amber-200 rounded-lg overflow-hidden">
          <div className="bg-amber-50 px-4 py-2.5 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <span className="text-sm font-semibold text-amber-700">{conflicts.length} Part No. conflict{conflicts.length !== 1 ? 's' : ''} — choose how to handle each:</span>
          </div>
          <table className="w-full text-xs">
            <thead className="bg-amber-100">
              <tr>
                <th className="px-4 py-2 text-left">Part No.</th>
                <th className="px-4 py-2 text-left">Description</th>
                <th className="px-4 py-2 text-right">Existing Qty</th>
                <th className="px-4 py-2 text-right">New Qty</th>
                <th className="px-4 py-2 text-center w-40">Action</th>
              </tr>
            </thead>
            <tbody>
              {conflicts.map(c => (
                <tr key={c.preview_id} className="border-t border-amber-100 bg-white">
                  <td className="px-4 py-2 font-mono text-slate-600">{c.part_no}</td>
                  <td className="px-4 py-2 text-slate-700">{c.description}</td>
                  <td className="px-4 py-2 text-right">{c.existing_qty}</td>
                  <td className="px-4 py-2 text-right font-semibold text-amber-700">{c.new_qty}</td>
                  <td className="px-4 py-2 text-center">
                    <select value={resolutions[c.preview_id] || 'skip'}
                      onChange={e => setResolutions(p => ({ ...p, [c.preview_id]: e.target.value }))}
                      className="text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-amber-400">
                      <option value="skip">Skip (keep existing)</option>
                      <option value="merge">Merge (add qty)</option>
                      <option value="create">Create duplicate</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Template save */}
      <div className="border border-slate-200 rounded-lg px-4 py-4 space-y-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={saveTemplate} onChange={e => setSaveTemplate(e.target.checked)}
            className="w-4 h-4 accent-amber-500" />
          <span className="text-sm text-slate-700 font-medium">Save this column mapping as a reusable template</span>
        </label>
        {saveTemplate && (
          <input
            value={templateName}
            onChange={e => setTemplateName(e.target.value)}
            placeholder="Template name (e.g. Schneider Standard BOM, EPC Vendor Format…)"
            className="border border-slate-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 w-full"
          />
        )}
        <p className="text-xs text-slate-400">Saved templates auto-apply on the next import of a file with a similar header structure.</p>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {/* Warnings passthrough */}
      {warnings && warnings.length > 0 && (
        <details className="border border-amber-100 bg-amber-50 rounded-lg">
          <summary className="px-4 py-2 text-xs font-semibold text-amber-600 cursor-pointer">{warnings.length} import warning{warnings.length !== 1 ? 's' : ''}</summary>
          <ul className="px-4 pb-3 space-y-1 text-xs text-amber-700">{warnings.map((w, i) => <li key={i}>• {w}</li>)}</ul>
        </details>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-2">
        <button onClick={onBack} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-slate-100">← Back</button>
        <button onClick={handleSave} disabled={saving || loading}
          className="flex items-center gap-2 px-6 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded-lg disabled:opacity-40">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving…' : `Import ${topLevel.length} items to BOM`}
        </button>
      </div>
    </div>
  );
}