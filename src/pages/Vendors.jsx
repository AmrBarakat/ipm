import { useState, useMemo } from 'react';
import { useEntityList, useEntityMutation } from '@/hooks/useEntity';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { BOM_CATEGORY_LABELS, BOM_CATEGORY_OPTIONS } from '@/lib/constants';
import { Building2, Plus, Search, Mail, Phone, Star, Trash2, Pencil } from 'lucide-react';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import VendorForm from '@/components/vendors/VendorForm';
import VendorDrawer from '@/components/vendors/VendorDrawer';
import { TYPE_LABELS, RATING_STYLES, RATINGS, ratingLabel } from '@/components/vendors/vendorConstants';

const selCls = 'border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400 bg-white';

export default function Vendors() {
  const queryClient = useQueryClient();
  const { data: vendors = [], isLoading } = useEntityList('Vendor', {}, '-updated_date', 500);
  const vendorMutation = useEntityMutation('Vendor');
  const confirmDialog = useConfirm();

  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterRating, setFilterRating] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState(null);

  const filtered = useMemo(() => vendors.filter(v => {
    const q = search.trim().toLowerCase();
    if (q && !`${v.name} ${v.contact_name || ''} ${v.email || ''} ${v.phone || ''} ${v.country || ''}`.toLowerCase().includes(q)) return false;
    if (filterType && v.type !== filterType) return false;
    if (filterRating && v.rating !== filterRating) return false;
    if (filterCategory && !(v.categories || []).includes(filterCategory)) return false;
    return true;
  }), [vendors, search, filterType, filterRating, filterCategory]);

  const counts = useMemo(() => ({
    total: vendors.length,
    preferred: vendors.filter(v => v.rating === 'preferred').length,
    approved: vendors.filter(v => v.rating === 'approved').length,
    conditional: vendors.filter(v => v.rating === 'conditional').length,
    blacklisted: vendors.filter(v => v.rating === 'blacklisted').length,
  }), [vendors]);

  async function createVendor(form) {
    await vendorMutation.mutateAsync({ action: 'create', data: { ...form, documents: [], rating_history: [] } });
    setAdding(false);
  }

  async function saveVendor(updated) {
    const saved = await base44.entities.Vendor.update(updated.id, updated);
    queryClient.invalidateQueries({ queryKey: ['Vendor'] });
    setSelected(saved || updated);
  }

  async function deleteVendor(vendor) {
    if (!(await confirmDialog({ title: 'Delete vendor', description: `Delete "${vendor.name}"? This cannot be undone.`, confirmText: 'Delete', destructive: true }))) return;
    await vendorMutation.mutateAsync({ action: 'delete', id: vendor.id });
    setSelected(null);
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2"><Building2 className="w-6 h-6 text-amber-500" /> Vendors</h1>
          <p className="text-sm text-slate-500">Central directory of suppliers — contacts, documents & performance ratings.</p>
        </div>
        <button onClick={() => setAdding(v => !v)} className="flex items-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded">
          <Plus className="w-4 h-4" /> Add Vendor
        </button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <KpiCard label="Total Vendors" value={counts.total} dot="bg-slate-400" />
        <KpiCard label="Preferred" value={counts.preferred} dot="bg-emerald-500" />
        <KpiCard label="Approved" value={counts.approved} dot="bg-blue-500" />
        <KpiCard label="Conditional" value={counts.conditional} dot="bg-amber-500" />
        <KpiCard label="Blacklisted" value={counts.blacklisted} dot="bg-red-500" />
      </div>

      {/* Add form */}
      {adding && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">New Vendor</h3>
          <VendorForm onSave={createVendor} onCancel={() => setAdding(false)} saving={vendorMutation.isPending} submitText="Create Vendor" />
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search vendors…"
            className="border border-slate-200 rounded pl-8 pr-3 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-400 w-56" />
        </div>
        <select value={filterType} onChange={e => setFilterType(e.target.value)} className={selCls}>
          <option value="">All Types</option>
          {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={filterRating} onChange={e => setFilterRating(e.target.value)} className={selCls}>
          <option value="">All Ratings</option>
          {RATINGS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className={selCls}>
          <option value="">All Categories</option>
          {BOM_CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {(search || filterType || filterRating || filterCategory) && (
          <button onClick={() => { setSearch(''); setFilterType(''); setFilterRating(''); setFilterCategory(''); }}
            className="text-xs text-slate-500 hover:text-red-500 underline">Clear</button>
        )}
        <span className="ml-auto text-xs text-slate-400">{filtered.length} of {vendors.length}</span>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 bg-slate-100 rounded-lg animate-pulse" />)}
        </div>
      ) : vendors.length === 0 ? (
        <EmptyState
          icon={<Building2 className="w-12 h-12 opacity-40" />}
          title="No vendors yet"
          message="Add suppliers to manage their contacts, link documents, and track performance ratings."
          actions={[{ label: 'Add Vendor', primary: true, icon: <Plus className="w-4 h-4" />, onClick: () => setAdding(true) }]}
        />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Search className="w-10 h-10 opacity-40" />} title="No matching vendors" message="Try adjusting your search or filters." />
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left">Vendor</th>
                <th className="px-4 py-3 text-left">Contact</th>
                <th className="px-4 py-3 text-left">Location</th>
                <th className="px-4 py-3 text-left">Categories</th>
                <th className="px-4 py-3 text-left">Rating</th>
                <th className="px-4 py-3 text-right">Docs</th>
                <th className="px-4 py-3 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(v => (
                <tr key={v.id} className="border-t border-slate-100 hover:bg-amber-50/40 cursor-pointer" onClick={() => setSelected(v)}>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-800">{v.name}</div>
                    <div className="text-xs text-slate-400">{TYPE_LABELS[v.type] || v.type}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-slate-700 text-sm">{v.contact_name || '—'}</div>
                    {v.email && <div className="text-xs text-blue-700 flex items-center gap-1"><Mail className="w-3 h-3" /> {v.email}</div>}
                    {v.phone && <div className="text-xs text-slate-500 flex items-center gap-1"><Phone className="w-3 h-3" /> {v.phone}</div>}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {v.country || '—'}
                    {v.address && <div className="text-xs text-slate-400 truncate max-w-[160px]">{v.address}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1 max-w-[200px]">
                      {(v.categories || []).slice(0, 3).map(c => (
                        <span key={c} className="px-1.5 py-0.5 rounded text-[11px] bg-slate-100 text-slate-600">{BOM_CATEGORY_LABELS[c] || c}</span>
                      ))}
                      {(v.categories || []).length > 3 && <span className="text-[11px] text-slate-400">+{(v.categories || []).length - 3}</span>}
                      {(v.categories || []).length === 0 && <span className="text-xs text-slate-300">—</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {v.rating && (
                      <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded ${RATING_STYLES[v.rating]}`}>
                        <Star className="w-3 h-3" /> {ratingLabel(v.rating)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-slate-500">{(v.documents || []).length || '—'}</td>
                  <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                    <button onClick={() => setSelected(v)} className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded" title="Open"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => deleteVendor(v)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded" title="Delete"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <VendorDrawer
          vendor={selected}
          onSave={saveVendor}
          onDelete={(v) => deleteVendor(v)}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function KpiCard({ label, value, dot }) {
  return (
    <div className="bg-white rounded-lg shadow-sm p-4">
      <div className="flex items-center gap-2 mb-1">
        <span className={`w-2.5 h-2.5 rounded-full ${dot}`} />
        <span className="text-xs text-slate-400 uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-bold text-slate-800">{value}</div>
    </div>
  );
}