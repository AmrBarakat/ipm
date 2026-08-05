import { useState, useMemo } from 'react';
import { useEntityList } from '@/hooks/useEntity';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import {
  Building2, X, ExternalLink, Plus, Save, CheckCircle2, AlertCircle,
} from 'lucide-react';

const norm = (s) => (s || '').trim().replace(/\s+/g, ' ').toLowerCase();

const inp = 'border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white w-full';

/**
 * VendorLookup — a real vendor picker for BOM items.
 *
 * When vendor_id is set: shows the canonical vendor name as a link to the
 * VendorDrawer.
 * When vendor_id is not set: shows the raw supplier text with an amber
 * "unlinked" dot, a dropdown to pick a Vendor, and a "Create vendor" option.
 *
 * Props:
 *   vendorId  — the BOM item's vendor_id (or null)
 *   supplier  — the BOM item's supplier display text
 *   projectId, project
 *   variant   — "link" (inline text) or "icon" (compact, beside an input)
 *   onLink    — async callback(vendorId, vendorName) called after the BOM
 *               item is updated and the vendor alias is appended.
 */
export default function VendorLookup({ vendorId, supplier, projectId, project, variant = 'link', onLink, className = '' }) {
  const queryClient = useQueryClient();
  const { data: vendors = [] } = useEntityList('Vendor', {}, '-created_date', 500);
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);

  const vendor = useMemo(() => vendors.find(v => v.id === vendorId), [vendors, vendorId]);

  // ── Linked state ────────────────────────────────────────────────────────
  if (vendorId && vendor) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className={`inline-flex items-center gap-1 text-emerald-700 hover:text-emerald-800 hover:underline font-medium text-left ${className}`}
      >
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
        <span className="truncate max-w-[160px]">{vendor.name}</span>
        {open && (
          <VendorDrawerLite vendor={vendor} projectId={projectId} project={project} onClose={() => setOpen(false)} />
        )}
      </button>
    );
  }

  // ── Unlinked state ──────────────────────────────────────────────────────
  if (!supplier || !supplier.trim()) {
    return variant === 'icon' ? (
      <span className="inline-flex items-center" title="No supplier">
        <span className="w-2 h-2 rounded-full bg-slate-300" />
      </span>
    ) : (
      <span className={`inline-flex items-center gap-1 text-slate-400 ${className}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
        <span className="italic">No supplier</span>
      </span>
    );
  }

  async function selectVendor(v) {
    if (!onLink) { setOpen(false); return; }
    setSaving(true);
    try {
      const existingAliases = v.aliases || [];
      if (!existingAliases.some(a => norm(a) === norm(supplier))) {
        await base44.entities.Vendor.update(v.id, { aliases: [...existingAliases, supplier] });
        queryClient.invalidateQueries({ queryKey: ['Vendor'] });
      }
      await onLink(v.id, v.name);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  async function createVendor(form) {
    setSaving(true);
    try {
      const created = await base44.entities.Vendor.create({
        ...form,
        aliases: supplier ? [supplier] : [],
        type: form.type || 'supplier',
        rating: form.rating || 'approved',
      });
      queryClient.invalidateQueries({ queryKey: ['Vendor'] });
      await selectVendor(created);
      setShowCreate(false);
    } finally {
      setSaving(false);
    }
  }

  const trigger = variant === 'icon' ? (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      className="p-1 text-amber-500 hover:text-amber-700 hover:bg-amber-50 rounded shrink-0"
      title={`Unlinked: ${supplier}`}
    >
      <Building2 className="w-3.5 h-3.5" />
    </button>
  ) : (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      className={`inline-flex items-center gap-1 text-amber-700 hover:text-amber-800 hover:underline font-medium text-left ${className}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
      <span className="truncate max-w-[160px]">{supplier}</span>
      <ExternalLink className="w-3 h-3 shrink-0 opacity-70" />
    </button>
  );

  return (
    <>
      {trigger}
      {open && !showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
                <Building2 className="w-4 h-4 text-amber-500" /> Link Vendor
              </h3>
              <button onClick={() => setOpen(false)} className="p-1 text-slate-400 hover:bg-slate-100 rounded">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-3">
              Linking <strong className="text-slate-700">"{supplier}"</strong> to a vendor record. The text will be saved as an alias.
            </p>
            <div className="space-y-1 max-h-72 overflow-auto">
              {vendors.map(v => (
                <button key={v.id} onClick={() => selectVendor(v)} disabled={saving}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-amber-50 border border-slate-100 disabled:opacity-40">
                  <div className="font-medium text-slate-700 text-sm">{v.name}</div>
                  {v.country && <div className="text-xs text-slate-400">{v.country}</div>}
                  {(v.aliases || []).length > 0 && (
                    <div className="text-[10px] text-slate-400 mt-0.5">Aliases: {v.aliases.slice(0, 3).join(', ')}{v.aliases.length > 3 ? '…' : ''}</div>
                  )}
                </button>
              ))}
            </div>
            <button onClick={() => setShowCreate(true)}
              className="mt-3 w-full flex items-center justify-center gap-1.5 px-3 py-2 border border-amber-300 text-amber-700 hover:bg-amber-50 rounded-lg text-sm font-semibold">
              <Plus className="w-4 h-4" /> Create vendor from "{supplier}"
            </button>
          </div>
        </div>
      )}
      {open && showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <CreateVendorForm
              prefilledName={supplier}
              onSave={createVendor}
              onCancel={() => setShowCreate(false)}
              saving={saving}
            />
          </div>
        </div>
      )}
    </>
  );
}

// ── Inline vendor drawer (read-only contact summary) ──────────────────────
function VendorDrawerLite({ vendor, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-sm bg-white shadow-2xl flex flex-col h-full overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 bg-slate-50">
          <Building2 className="w-4 h-4 text-amber-500" />
          <div className="font-semibold text-slate-800 truncate">{vendor.name}</div>
          <button onClick={onClose} className="ml-auto p-1.5 text-slate-400 hover:bg-slate-200 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {vendor.contact_name && <div className="text-sm text-slate-600">{vendor.contact_name}</div>}
          {vendor.email && <div className="text-sm text-blue-700">{vendor.email}</div>}
          {vendor.phone && <div className="text-sm text-slate-600">{vendor.phone}</div>}
          {vendor.country && <div className="text-sm text-slate-600">{vendor.country}</div>}
          {(vendor.aliases || []).length > 0 && (
            <div className="pt-2 border-t border-slate-100">
              <div className="text-xs text-slate-400 uppercase mb-1">Aliases</div>
              <div className="flex flex-wrap gap-1">
                {vendor.aliases.map((a, i) => <span key={i} className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 text-slate-600">{a}</span>)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CreateVendorForm({ prefilledName, onSave, onCancel, saving }) {
  const [form, setForm] = useState({
    name: prefilledName || '', contact_name: '',
    email: '', phone: '', country: '', rating: 'approved',
  });
  return (
    <div className="text-left space-y-2">
      <h3 className="font-semibold text-slate-800 text-sm flex items-center gap-2 mb-2">
        <Plus className="w-4 h-4 text-amber-500" /> Create Vendor
      </h3>
      <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Name *" className={inp} required />
      <input value={form.contact_name} onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))} placeholder="Contact name" className={inp} />
      <input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="Email" className={inp} />
      <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="Phone" className={inp} />
      <input value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))} placeholder="Country" className={inp} />
      <select value={form.rating} onChange={e => setForm(f => ({ ...f, rating: e.target.value }))} className={inp}>
        <option value="preferred">Preferred</option>
        <option value="approved">Approved</option>
        <option value="conditional">Conditional</option>
        <option value="blacklisted">Blacklisted</option>
      </select>
      <div className="flex gap-2 pt-1">
        <button onClick={() => form.name.trim() && onSave(form)} disabled={saving || !form.name.trim()}
          className="inline-flex items-center gap-1 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-900 text-xs font-semibold rounded disabled:opacity-50">
          <Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save & Link'}
        </button>
        <button onClick={onCancel} className="px-3 py-1.5 border border-slate-200 text-slate-500 text-xs rounded hover:bg-slate-100">Cancel</button>
      </div>
    </div>
  );
}