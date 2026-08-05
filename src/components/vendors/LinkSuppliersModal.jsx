import { useState, useMemo } from 'react';
import { useEntityList } from '@/hooks/useEntity';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { formatCurrency } from '@/lib/constants';
import { suggestVendor, normalizeSupplier, TIER_META } from '@/lib/vendorMatch';
import { X, Link2, Loader2, CheckCircle2, AlertCircle, ChevronDown } from 'lucide-react';

const inp = 'border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400 bg-white w-full';

/**
 * Bulk supplier reconciliation modal. Lists every distinct unlinked supplier
 * string on the project, suggests a Vendor match (exact → alias → fuzzy ≥ 0.6),
 * and lets the user confirm, change, or skip each one. Applying writes
 * vendor_id + canonical supplier to every affected BOM item and records the
 * old string as a vendor alias.
 */
export default function LinkSuppliersModal({ projectId, bomItems, onClose }) {
  const queryClient = useQueryClient();
  const { data: vendors = [] } = useEntityList('Vendor', {}, '-created_date', 500);
  const [decisions, setDecisions] = useState({}); // { [supplierKey]: { vendorId, action: 'link'|'skip' } }
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState(null);

  // Distinct unlinked supplier strings with item counts
  const unlinked = useMemo(() => {
    const map = {};
    for (const item of bomItems) {
      if (item.vendor_id) continue;
      const sup = (item.supplier || '').trim();
      if (!sup) continue;
      const key = normalizeSupplier(sup);
      if (!map[key]) map[key] = { raw: sup, key, items: [] };
      map[key].items.push(item);
    }
    return Object.values(map).sort((a, b) => b.items.length - a.items.length);
  }, [bomItems]);

  // Compute suggestions for each unlinked string
  const suggestions = useMemo(() => {
    const out = {};
    for (const u of unlinked) {
      out[u.key] = suggestVendor(u.raw, vendors);
    }
    return out;
  }, [unlinked, vendors]);

  const linkedCount = Object.values(decisions).filter(d => d.action === 'link').length;
  const skippedCount = Object.values(decisions).filter(d => d.action === 'skip').length;
  const pendingCount = unlinked.length - linkedCount - skippedCount;

  function setDecision(key, vendorId, action) {
    setDecisions(prev => ({ ...prev, [key]: { vendorId, action } }));
  }

  async function apply() {
    setApplying(true);
    const updates = [];
    const vendorAliasPatches = {}; // vendorId → { oldString, vendor }

    for (const u of unlinked) {
      const dec = decisions[u.key];
      if (!dec || dec.action !== 'link' || !dec.vendorId) continue;

      const vendor = vendors.find(v => v.id === dec.vendorId);
      if (!vendor) continue;

      const oldSupplier = u.raw;
      for (const item of u.items) {
        updates.push({
          id: item.id,
          vendor_id: vendor.id,
          supplier: vendor.name,
        });
      }

      // Queue alias append
      if (!vendorAliasPatches[vendor.id]) {
        vendorAliasPatches[vendor.id] = { vendor, oldStrings: [] };
      }
      if (!vendor.aliases?.some(a => normalizeSupplier(a) === u.key)) {
        vendorAliasPatches[vendor.id].oldStrings.push(oldSupplier);
      }
    }

    let bomUpdated = 0;
    let vendorsUpdated = 0;

    try {
      if (updates.length > 0) {
        await base44.entities.BOMItem.bulkUpdate(updates);
        bomUpdated = updates.length;
      }

      // Append aliases to vendors
      for (const vid of Object.keys(vendorAliasPatches)) {
        const { vendor, oldStrings } = vendorAliasPatches[vid];
        const existingAliases = vendor.aliases || [];
        const newAliases = [...existingAliases];
        for (const s of oldStrings) {
          if (!newAliases.some(a => normalizeSupplier(a) === normalizeSupplier(s))) {
            newAliases.push(s);
          }
        }
        if (newAliases.length !== existingAliases.length) {
          await base44.entities.Vendor.update(vid, { aliases: newAliases });
          vendorsUpdated++;
        }
      }

      queryClient.invalidateQueries({ queryKey: ['BOMItem'] });
      queryClient.invalidateQueries({ queryKey: ['Vendor'] });

      const supplierCount = Object.keys(vendorAliasPatches).length;
      setResult({
        linked: bomUpdated,
        suppliers: supplierCount,
        unlinked: pendingCount,
        vendorsUpdated,
      });
    } catch (err) {
      setResult({ error: err?.message || 'Apply failed.' });
    } finally {
      setApplying(false);
    }
  }

  if (result) {
    const isError = !!result.error;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 text-center">
          {isError ? (
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-3" />
          ) : (
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
          )}
          <h3 className="font-bold text-slate-800 text-lg mb-1">
            {isError ? 'Reconciliation Failed' : 'Suppliers Linked'}
          </h3>
          {!isError ? (
            <p className="text-sm text-slate-600">
              Linked <strong>{result.linked}</strong> items across <strong>{result.suppliers}</strong> supplier{result.suppliers !== 1 ? 's' : ''},
              {result.unlinked > 0 ? ` ${result.unlinked} left unlinked.` : ' none left unlinked.'}
            </p>
          ) : (
            <p className="text-sm text-red-600">{result.error}</p>
          )}
          <button onClick={onClose}
            className="mt-4 px-5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded">
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full flex flex-col max-h-[90vh]" style={{ maxWidth: 'min(900px, 95vw)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 shrink-0">
          <div>
            <h2 className="font-bold text-slate-800 flex items-center gap-2">
              <Link2 className="w-5 h-5 text-amber-500" /> Link Suppliers
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {unlinked.length} unlinked supplier string{unlinked.length !== 1 ? 's' : ''} · {unlinked.reduce((s, u) => s + u.items.length, 0)} BOM item{unlinked.reduce((s, u) => s + u.items.length, 0) !== 1 ? 's' : ''}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-4">
          {unlinked.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
              <p className="text-sm text-slate-600">All BOM items are already linked to vendors.</p>
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left">Supplier String</th>
                  <th className="px-3 py-2 text-right">Items</th>
                  <th className="px-3 py-2 text-left">Suggested Match</th>
                  <th className="px-3 py-2 text-left">Tier</th>
                  <th className="px-3 py-2 text-left">Action</th>
                </tr>
              </thead>
              <tbody>
                {unlinked.map(u => {
                  const sug = suggestions[u.key];
                  const dec = decisions[u.key];
                  return (
                    <tr key={u.key} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-medium text-slate-700">{u.raw}</td>
                      <td className="px-3 py-2 text-right text-slate-500">{u.items.length}</td>
                      <td className="px-3 py-2">
                        {sug ? (
                          <span className="text-slate-700">{sug.vendor.name}</span>
                        ) : (
                          <span className="text-slate-400 italic">No match found</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {sug ? (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${TIER_META[sug.tier].cls}`}>
                            {TIER_META[sug.tier].label} {sug.confidence < 1 ? `${Math.round(sug.confidence * 100)}%` : ''}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <select
                            value={dec?.action === 'link' ? dec.vendorId : dec?.action === 'skip' ? '__skip' : ''}
                            onChange={e => {
                              const val = e.target.value;
                              if (val === '__skip') setDecision(u.key, null, 'skip');
                              else if (val === '') setDecision(u.key, null, 'pending');
                              else setDecision(u.key, val, 'link');
                            }}
                            className={inp + ' w-44'}
                          >
                            <option value="">— Pending —</option>
                            {sug && <option value={sug.vendor.id}>{sug.vendor.name} (suggested)</option>}
                            {vendors.filter(v => !sug || v.id !== sug.vendor.id).map(v => (
                              <option key={v.id} value={v.id}>{v.name}</option>
                            ))}
                            <option value="__skip">Skip</option>
                          </select>
                          {dec?.action === 'link' && (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                          )}
                          {dec?.action === 'skip' && (
                            <span className="text-[10px] text-slate-400">skipped</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-between gap-3 bg-slate-50 shrink-0">
          <div className="text-xs text-slate-500">
            {linkedCount > 0 && <span className="text-emerald-700 font-semibold">{linkedCount} to link</span>}
            {skippedCount > 0 && <span className="ml-2 text-slate-400">{skippedCount} skipped</span>}
            {pendingCount > 0 && <span className="ml-2 text-slate-400">{pendingCount} pending</span>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-2 border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-slate-100">Cancel</button>
            <button onClick={apply} disabled={applying || linkedCount === 0}
              className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded-lg disabled:opacity-40">
              {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
              Link {linkedCount > 0 ? `${linkedCount} item${linkedCount !== 1 ? 's' : ''}` : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}