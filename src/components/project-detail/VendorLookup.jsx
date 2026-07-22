import { useState, useMemo, useEffect } from 'react';
import { useEntityList } from '@/hooks/useEntity';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { formatCurrency, formatDate } from '@/lib/constants';
import {
  Building2, X, Mail, Phone, MapPin, Star, Plus, FileText,
  ExternalLink, Package, Save, AlertTriangle,
} from 'lucide-react';

/** Trim + collapse whitespace + lowercase. */
const norm = (s) => (s || '').trim().replace(/\s+/g, ' ').toLowerCase();

const RATING_STYLES = {
  preferred: 'bg-emerald-100 text-emerald-700',
  approved: 'bg-blue-100 text-blue-700',
  conditional: 'bg-amber-100 text-amber-700',
  blacklisted: 'bg-red-100 text-red-700',
};

const PO_STATUS_STYLES = {
  draft: 'bg-slate-100 text-slate-600',
  issued: 'bg-blue-100 text-blue-700',
  acknowledged: 'bg-purple-100 text-purple-700',
  in_transit: 'bg-amber-100 text-amber-800',
  partially_delivered: 'bg-orange-100 text-orange-700',
  delivered: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-slate-200 text-slate-500',
};
const PO_STATUS_LABELS = {
  draft: 'Draft', issued: 'Issued', acknowledged: 'Acknowledged',
  in_transit: 'In Transit', partially_delivered: 'Partial',
  delivered: 'Delivered', cancelled: 'Cancelled',
};
const CLOSED_PO = new Set(['delivered', 'cancelled']);

const inp = 'border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white w-full';

/**
 * VendorLookup — renders a clickable supplier affordance and, on click, opens a
 * right-side drawer showing the vendor's contact details and open purchase
 * orders. Read-lightweight: Vendors + project POs are fetched via react-query
 * (cached, no per-click fetch); all-projects POs are loaded lazily only when the
 * toggle is flipped.
 *
 * variant="link"  → shows the supplier name (read-only cells)
 * variant="icon"  → a compact Building2 icon (alongside an editable supplier input)
 */
export default function VendorLookup({ supplier, projectId, project, variant = 'link', className = '' }) {
  const [open, setOpen] = useState(false);

  if (!supplier || !supplier.trim()) {
    return variant === 'icon'
      ? null
      : <span className={className}>—</span>;
  }

  const trigger =
    variant === 'icon' ? (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className="p-1 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded shrink-0"
        title={`Vendor: ${supplier}`}
      >
        <Building2 className="w-3.5 h-3.5" />
      </button>
    ) : (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className={`inline-flex items-center gap-1 text-amber-700 hover:text-amber-800 hover:underline font-medium text-left ${className}`}
      >
        <span className="truncate max-w-[160px]">{supplier}</span>
        <ExternalLink className="w-3 h-3 shrink-0 opacity-70" />
      </button>
    );

  return (
    <>
      {trigger}
      {open && (
        <VendorDrawer
          supplier={supplier}
          projectId={projectId}
          project={project}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// ── Drawer ───────────────────────────────────────────────────────────────────

function VendorDrawer({ supplier, projectId, project, onClose }) {
  const queryClient = useQueryClient();
  const { data: vendors = [] } = useEntityList('Vendor', {}, '-created_date', 500);
  const { data: projectPOs = [] } = useEntityList('PurchaseOrder', { project_id: projectId }, '-created_date', 200);

  const [allProjects, setAllProjects] = useState(false);
  const [allPOs, setAllPOs] = useState(null);
  const [projectMap, setProjectMap] = useState({});
  const [showCreateVendor, setShowCreateVendor] = useState(false);
  const [showNewPO, setShowNewPO] = useState(false);
  const [saving, setSaving] = useState(false);

  // name → vendor record (first match wins)
  const vendorByName = useMemo(() => {
    const m = new Map();
    for (const v of vendors) {
      const k = norm(v.name);
      if (k && !m.has(k)) m.set(k, v);
    }
    return m;
  }, [vendors]);

  // name → purchase orders (project-scoped by default; all-projects when toggled)
  const poByName = useMemo(() => {
    const src = allProjects && allPOs ? allPOs : projectPOs;
    const m = new Map();
    for (const p of src) {
      const k = norm(p.vendor_name);
      if (!k) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(p);
    }
    return m;
  }, [projectPOs, allPOs, allProjects]);

  const vendor = vendorByName.get(norm(supplier));
  const openPOs = (poByName.get(norm(supplier)) || [])
    .filter(p => !CLOSED_PO.has(p.status))
    .sort((a, b) => (a.expected_delivery_date || '9999').localeCompare(b.expected_delivery_date || '9999'));

  // Lazy fetch all POs + project code map only when the toggle is flipped on.
  useEffect(() => {
    if (!allProjects || allPOs) return;
    (async () => {
      try {
        const [pos, projs] = await Promise.all([
          base44.entities.PurchaseOrder.list('-created_date', 500),
          base44.entities.Project.list('-created_date', 500),
        ]);
        const pm = {};
        for (const p of projs) pm[p.id] = p.code || p.name || '—';
        setProjectMap(pm);
        setAllPOs(pos);
      } catch (_) {
        setAllPOs([]);
      }
    })();
  }, [allProjects, allPOs]);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  function isOverdue(po) {
    if (!po.expected_delivery_date || CLOSED_PO.has(po.status)) return false;
    return new Date(po.expected_delivery_date) < today;
  }

  function projectCodeOf(po) {
    if (allProjects) return projectMap[po.project_id] || '—';
    return project?.code || '(this project)';
  }

  async function createVendor(form) {
    setSaving(true);
    try {
      await base44.entities.Vendor.create(form);
      queryClient.invalidateQueries({ queryKey: ['Vendor'] });
      setShowCreateVendor(false);
    } finally { setSaving(false); }
  }

  async function createPO(form) {
    setSaving(true);
    try {
      await base44.entities.PurchaseOrder.create({
        ...form,
        project_id: projectId,
        vendor_name: supplier,
        currency: form.currency || 'SAR',
        amount: Number(form.amount) || 0,
        delivery_notes: [],
        delay_days: 0,
        delay_alerted: false,
      });
      queryClient.invalidateQueries({ queryKey: ['PurchaseOrder'] });
      setShowNewPO(false);
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-md bg-white shadow-2xl flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 bg-slate-50 shrink-0">
          <Building2 className="w-4 h-4 text-amber-500 shrink-0" />
          <div className="min-w-0">
            <div className="text-xs text-slate-400 uppercase tracking-wide">Vendor</div>
            <div className="font-semibold text-slate-800 truncate">{supplier}</div>
          </div>
          <button onClick={onClose} className="ml-auto p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* Contact block */}
          {!vendor ? (
            <div className="border border-dashed border-slate-300 rounded-lg p-4 text-center">
              <p className="text-sm text-slate-500 mb-2">No vendor record found.</p>
              {showCreateVendor ? (
                <CreateVendorForm
                  prefilledName={supplier}
                  onSave={createVendor}
                  onCancel={() => setShowCreateVendor(false)}
                  saving={saving}
                />
              ) : (
                <button onClick={() => setShowCreateVendor(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-900 text-sm font-semibold rounded">
                  <Plus className="w-4 h-4" /> Create vendor
                </button>
              )}
            </div>
          ) : (
            <div className="border border-slate-200 rounded-lg p-4 space-y-2.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-slate-800">{vendor.name}</span>
                {vendor.rating && (
                  <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded ${RATING_STYLES[vendor.rating] || 'bg-slate-100 text-slate-600'}`}>
                    <Star className="w-3 h-3" /> {vendor.rating}
                  </span>
                )}
              </div>
              {vendor.contact_name && (
                <div className="text-sm text-slate-600">{vendor.contact_name}</div>
              )}
              {vendor.email && (
                <a href={`mailto:${vendor.email}`} className="flex items-center gap-2 text-sm text-blue-700 hover:underline">
                  <Mail className="w-3.5 h-3.5 shrink-0" /> {vendor.email}
                </a>
              )}
              {vendor.phone && (
                <a href={`tel:${vendor.phone}`} className="flex items-center gap-2 text-sm text-blue-700 hover:underline">
                  <Phone className="w-3.5 h-3.5 shrink-0" /> {vendor.phone}
                </a>
              )}
              {vendor.country && (
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <MapPin className="w-3.5 h-3.5 shrink-0" /> {vendor.country}{vendor.address ? ` · ${vendor.address}` : ''}
                </div>
              )}
              {vendor.notes && (
                <p className="text-xs text-slate-500 italic pt-1 border-t border-slate-100">{vendor.notes}</p>
              )}
            </div>
          )}

          {/* Open POs */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                <Package className="w-3.5 h-3.5" /> Open Purchase Orders
              </h4>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer">
                  <input type="checkbox" checked={allProjects} onChange={e => setAllProjects(e.target.checked)} className="accent-amber-500" />
                  All projects
                </label>
              </div>
            </div>

            {showNewPO && (
              <NewPOForm
                onSave={createPO}
                onCancel={() => setShowNewPO(false)}
                saving={saving}
                currency={project?.currency || 'SAR'}
              />
            )}

            {!showNewPO && (
              <button onClick={() => setShowNewPO(true)}
                className="mb-2 inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-amber-300 text-amber-700 hover:bg-amber-50 rounded font-semibold">
                <Plus className="w-3.5 h-3.5" /> New PO
              </button>
            )}

            {allProjects && !allPOs ? (
              <div className="text-xs text-slate-400 py-4 text-center">Loading POs…</div>
            ) : openPOs.length === 0 ? (
              <div className="text-xs text-slate-400 italic py-3">No open POs for this vendor.</div>
            ) : (
              <div className="space-y-2">
                {openPOs.map(po => {
                  const overdue = isOverdue(po);
                  return (
                    <div key={po.id} className={`border rounded-lg px-3 py-2 ${overdue ? 'border-red-300 bg-red-50/50' : 'border-slate-200'}`}>
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        {po.po_number && <span className="font-mono text-xs text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">{po.po_number}</span>}
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${PO_STATUS_STYLES[po.status] || 'bg-slate-100 text-slate-600'}`}>
                          {PO_STATUS_LABELS[po.status] || po.status}
                        </span>
                        {overdue && (
                          <span className="text-[10px] inline-flex items-center gap-0.5 text-red-700 font-bold">
                            <AlertTriangle className="w-3 h-3" /> overdue
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-600 truncate mb-1">{po.description || '—'}</div>
                      <div className="flex items-center gap-3 text-xs text-slate-500">
                        <span>Project: <strong className="text-slate-700">{projectCodeOf(po)}</strong></span>
                        {po.amount > 0 && <span>{formatCurrency(po.amount, po.currency)}</span>}
                        {po.expected_delivery_date && (
                          <span className={overdue ? 'text-red-600 font-semibold' : ''}>
                            Exp: {formatDate(po.expected_delivery_date)}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Inline forms ─────────────────────────────────────────────────────────────

function CreateVendorForm({ prefilledName, onSave, onCancel, saving }) {
  const [form, setForm] = useState({
    name: prefilledName || '', type: 'supplier', contact_name: '',
    email: '', phone: '', country: '', rating: 'approved', notes: '',
  });
  return (
    <div className="text-left space-y-2 mt-2">
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
          <Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save vendor'}
        </button>
        <button onClick={onCancel} className="px-3 py-1.5 border border-slate-200 text-slate-500 text-xs rounded hover:bg-slate-100">Cancel</button>
      </div>
    </div>
  );
}

function NewPOForm({ onSave, onCancel, saving, currency }) {
  const [form, setForm] = useState({
    po_number: '', description: '', amount: '', expected_delivery_date: '', status: 'draft',
  });
  return (
    <div className="border border-amber-200 bg-amber-50/50 rounded-lg p-3 space-y-2 mb-2">
      <input value={form.po_number} onChange={e => setForm(f => ({ ...f, po_number: e.target.value }))} placeholder="PO number" className={inp} />
      <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Description *" className={inp} required />
      <div className="grid grid-cols-2 gap-2">
        <input type="number" min="0" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="Amount" className={inp} />
        <input type="date" value={form.expected_delivery_date} onChange={e => setForm(f => ({ ...f, expected_delivery_date: e.target.value }))} className={inp} />
      </div>
      <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className={inp}>
        {Object.entries(PO_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <div className="flex gap-2">
        <button onClick={() => form.description.trim() && onSave(form)} disabled={saving || !form.description.trim()}
          className="inline-flex items-center gap-1 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-900 text-xs font-semibold rounded disabled:opacity-50">
          <FileText className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save PO'}
        </button>
        <button onClick={onCancel} className="px-3 py-1.5 border border-slate-200 text-slate-500 text-xs rounded hover:bg-slate-100">Cancel</button>
      </div>
    </div>
  );
}