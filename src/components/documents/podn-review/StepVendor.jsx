import { useEffect, useMemo } from 'react';
import { matchVendor, vendorDiffFields } from './helpers';
import { AlertTriangle } from 'lucide-react';

const inp = 'border border-slate-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white w-full';

const MODES = [
  { id: 'update', label: 'Update existing', desc: 'fills only empty fields (tick to overwrite individual fields)' },
  { id: 'overwrite', label: 'Overwrite existing', desc: 'replaces every field present in the document' },
  { id: 'keep_both', label: 'Keep both', desc: 'creates a second Vendor record (genuine duplicate)' },
  { id: 'skip', label: 'Skip', desc: 'link the PO to the existing vendor and change nothing' },
];

/** Step 2 — Vendor match/merge/create. */
export default function StepVendor({ draft, setDraft, vendors }) {
  const v = draft.vendor;
  const match = useMemo(() => matchVendor(vendors, v), [vendors, v]);

  // When a match is found, default to "update existing" and link the vendor id.
  useEffect(() => {
    if (match && v.mode === 'create' && v.createToggle) {
      const diffs = {};
      for (const f of vendorDiffFields()) {
        const existing = match[f] || '';
        const incoming = v[f] || '';
        if (f === 'name') continue;
        if (String(existing).trim() && String(incoming).trim() && String(existing) !== String(incoming)) {
          diffs[f] = false;
        }
      }
      setDraft((prev) => ({
        ...prev,
        vendor: { ...prev.vendor, mode: 'update', createToggle: false, existingVendorId: match.id, fieldOverwrites: diffs },
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match?.id]);

  function setV(patch) {
    setDraft((prev) => ({ ...prev, vendor: { ...prev.vendor, ...patch } }));
  }

  function setField(field, value) {
    setDraft((prev) => ({ ...prev, vendor: { ...prev.vendor, [field]: value } }));
  }

  if (!match) {
    // No match — create flow, editable fields, toggle ON.
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
          No existing vendor matched this document. Review the extracted details and create it.
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={v.createToggle} onChange={(e) => setV({ createToggle: e.target.checked })} className="w-4 h-4 accent-amber-500" />
          Create this vendor
        </label>
        <VendorFields v={v} setField={setField} />
      </div>
    );
  }

  // Match found — four-way choice + diff.
  const fields = vendorDiffFields();
  const aliased = (match.aliases || []).some((a) => a.toLowerCase().trim() === (v.name || '').toLowerCase().trim());

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-800">
        Matched existing vendor: <span className="font-semibold">{match.name}</span>
        {match.supplier_code && <span className="ml-2 font-mono text-xs">({match.supplier_code})</span>}
        {!aliased && <span className="block text-xs mt-1 text-blue-600">The document name "{v.name}" will be added to this vendor's aliases.</span>}
      </div>

      <div className="grid grid-cols-1 gap-2">
        {MODES.map((m) => (
          <label key={m.id} className={`flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer text-sm ${v.mode === m.id ? 'border-amber-400 bg-amber-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
            <input type="radio" name="vendor-mode" checked={v.mode === m.id} onChange={() => setV({ mode: m.id, createToggle: m.id === 'keep_both' })} className="mt-0.5 w-4 h-4 accent-amber-500" />
            <span>
              <span className="font-semibold text-slate-800">{m.label}</span>
              <span className="block text-xs text-slate-500">{m.desc}</span>
            </span>
          </label>
        ))}
      </div>

      {v.mode === 'keep_both' && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>This is a genuine duplicate. Future POs will split across the two vendor records, splitting your vendor history.</span>
        </div>
      )}

      {/* Diff table */}
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <div className="grid grid-cols-3 text-xs font-semibold text-slate-500 bg-slate-100 px-3 py-2">
          <span>Field</span><span>Existing vendor</span><span>From this document</span>
        </div>
        <div className="max-h-72 overflow-auto divide-y divide-slate-100">
          {fields.map((f) => {
            const existing = f === 'name' ? match.name : match[f] || '';
            const incoming = v[f] || '';
            const differs = String(existing).trim() !== String(incoming).trim() && (String(existing).trim() || String(incoming).trim());
            return (
              <div key={f} className={`grid grid-cols-3 px-3 py-1.5 text-xs items-center ${differs ? 'bg-amber-50' : ''}`}>
                <span className="text-slate-500 capitalize">{f.replace(/_/g, ' ')}</span>
                <span className="text-slate-700 break-words">{existing || <span className="text-slate-300">—</span>}</span>
                <span className="flex items-center gap-1.5">
                  <span className={differs ? 'text-amber-700 font-medium break-words' : 'text-slate-700 break-words'}>{incoming || <span className="text-slate-300">—</span>}</span>
                  {v.mode === 'update' && differs && (
                    <input type="checkbox" checked={!!v.fieldOverwrites[f]} onChange={(e) => setV({ fieldOverwrites: { ...v.fieldOverwrites, [f]: e.target.checked } })} className="w-3.5 h-3.5 accent-amber-500" title="Overwrite this field" />
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {v.mode === 'keep_both' && <VendorFields v={v} setField={setField} />}
    </div>
  );
}

function VendorFields({ v, setField }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {[
        ['name', 'Vendor name *', 'text'],
        ['type', 'Type', 'select'],
        ['contact_name', 'Contact name', 'text'],
        ['email', 'Email', 'text'],
        ['phone', 'Phone', 'text'],
        ['address', 'Address', 'text'],
        ['country', 'Country', 'text'],
        ['supplier_code', 'Supplier code', 'text'],
        ['tax_number', 'Tax / TRN number', 'text'],
        ['payment_terms', 'Payment terms', 'text'],
      ].map(([f, label, kind]) => (
        <div key={f}>
          <label className="text-xs text-slate-500 mb-1 block">{label}</label>
          {kind === 'select' ? (
            <select value={v[f] || 'supplier'} onChange={(e) => setField(f, e.target.value)} className={inp}>
              {['supplier', 'subcontractor', 'logistics', 'other'].map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <input value={v[f] || ''} onChange={(e) => setField(f, e.target.value)} className={inp} />
          )}
        </div>
      ))}
    </div>
  );
}