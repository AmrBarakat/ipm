import { useState, useEffect } from 'react';
import { Building2, X, Mail, Phone, Star, Trash2 } from 'lucide-react';
import { BOM_CATEGORY_LABELS } from '@/lib/constants';
import { TYPE_LABELS, RATING_STYLES, ratingLabel } from './vendorConstants';
import VendorForm from './VendorForm';
import VendorDocuments from './VendorDocuments';
import VendorRatingHistory from './VendorRatingHistory';

/**
 * VendorDrawer — right-side detail panel for a single vendor. Edits contact
 * details (via VendorForm), manages linked documents, and records performance
 * rating history. Every change is persisted through onSave(updatedVendor).
 */
export default function VendorDrawer({ vendor, onSave, onDelete, onClose }) {
  const [draft, setDraft] = useState(() => ({
    ...vendor,
    documents: vendor.documents || [],
    rating_history: vendor.rating_history || [],
  }));

  // Re-sync when the parent hands us a refreshed vendor after a save.
  useEffect(() => {
    setDraft({
      ...vendor,
      documents: vendor.documents || [],
      rating_history: vendor.rating_history || [],
    });
  }, [vendor]);

  async function persist(patch) {
    const updated = { ...draft, ...patch };
    setDraft(updated);
    await onSave(updated);
  }

  const cats = draft.categories || [];

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-lg bg-white shadow-2xl flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 bg-slate-50 shrink-0">
          <Building2 className="w-5 h-5 text-amber-500 shrink-0" />
          <div className="min-w-0">
            <div className="text-xs text-slate-400 uppercase tracking-wide">Vendor</div>
            <div className="font-semibold text-slate-800 truncate flex items-center gap-2">
              <span className="truncate">{vendor.name}</span>
              {vendor.rating && (
                <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded ${RATING_STYLES[vendor.rating]}`}>
                  <Star className="w-3 h-3" /> {ratingLabel(vendor.rating)}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="ml-auto p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Quick contact summary */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            <div className="text-slate-500">Type: <span className="font-medium text-slate-700">{TYPE_LABELS[vendor.type] || vendor.type}</span></div>
            <div className="text-slate-500">Country: <span className="font-medium text-slate-700">{vendor.country || '—'}</span></div>
            {vendor.email && <a href={`mailto:${vendor.email}`} className="flex items-center gap-1.5 text-blue-700 hover:underline"><Mail className="w-3.5 h-3.5" /> {vendor.email}</a>}
            {vendor.phone && <a href={`tel:${vendor.phone}`} className="flex items-center gap-1.5 text-blue-700 hover:underline"><Phone className="w-3.5 h-3.5" /> {vendor.phone}</a>}
          </div>

          {/* Edit details */}
          <section>
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Edit Details</h4>
            <VendorForm key={vendor.id} initial={draft} onSave={persist} submitText="Save Changes" />
          </section>

          {/* Categories */}
          {cats.length > 0 && (
            <section>
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Categories Supplied</h4>
              <div className="flex flex-wrap gap-1.5">
                {cats.map(c => (
                  <span key={c} className="px-2 py-1 rounded text-xs bg-slate-100 text-slate-600">{BOM_CATEGORY_LABELS[c] || c}</span>
                ))}
              </div>
            </section>
          )}

          {/* Documents */}
          <section>
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Linked Documents</h4>
            <VendorDocuments documents={draft.documents} onChange={(docs) => persist({ documents: docs })} />
          </section>

          {/* Rating history */}
          <section>
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Performance Rating History</h4>
            <VendorRatingHistory
              history={draft.rating_history}
              currentRating={draft.rating}
              onAdd={(entry) => persist({ rating_history: [...(draft.rating_history || []), entry], rating: entry.rating })}
            />
          </section>

          {/* Delete */}
          <section className="pt-2 border-t border-slate-100">
            <button onClick={() => onDelete(vendor)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-red-600 hover:bg-red-50 text-xs font-semibold rounded border border-red-200">
              <Trash2 className="w-3.5 h-3.5" /> Delete vendor
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}