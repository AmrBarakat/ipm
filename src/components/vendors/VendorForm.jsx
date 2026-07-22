import { useState } from 'react';
import { BOM_CATEGORY_OPTIONS } from '@/lib/constants';
import { VENDOR_TYPES, RATINGS } from './vendorConstants';
import { Save } from 'lucide-react';

const inp = 'border border-slate-200 rounded px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white w-full';
const lbl = 'text-xs font-medium text-slate-500 mb-1 block';

/**
 * VendorForm — create/edit form for a vendor's contact details, type, rating,
 * supplied categories and notes. Controlled; calls onSave(formFields) on
 * submit. Reuse for both the page "Add Vendor" panel and the drawer edit
 * section (pass `initial` + `key` for edit mode).
 */
export default function VendorForm({ initial = {}, onSave, onCancel, saving, submitText = 'Save' }) {
  const [form, setForm] = useState(() => ({
    name: '', type: 'supplier', contact_name: '', email: '', phone: '',
    address: '', country: '', rating: 'approved', notes: '', categories: [],
    ...initial,
    categories: initial.categories || [],
  }));

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); }
  function toggleCategory(val) {
    setForm(f => {
      const cats = f.categories || [];
      return { ...f, categories: cats.includes(val) ? cats.filter(c => c !== val) : [...cats, val] };
    });
  }
  function submit(e) {
    e.preventDefault();
    if (!form.name?.trim()) return;
    onSave({ ...form, name: form.name.trim(), categories: form.categories || [] });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <label className={lbl}>Name *</label>
        <input value={form.name} onChange={e => set('name', e.target.value)} className={inp} required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={lbl}>Type</label>
          <select value={form.type} onChange={e => set('type', e.target.value)} className={inp}>
            {VENDOR_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>Rating</label>
          <select value={form.rating} onChange={e => set('rating', e.target.value)} className={inp}>
            {RATINGS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className={lbl}>Contact Name</label>
        <input value={form.contact_name} onChange={e => set('contact_name', e.target.value)} className={inp} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={lbl}>Email</label>
          <input type="email" value={form.email} onChange={e => set('email', e.target.value)} className={inp} />
        </div>
        <div>
          <label className={lbl}>Phone</label>
          <input value={form.phone} onChange={e => set('phone', e.target.value)} className={inp} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={lbl}>Country</label>
          <input value={form.country} onChange={e => set('country', e.target.value)} className={inp} />
        </div>
        <div>
          <label className={lbl}>Address</label>
          <input value={form.address} onChange={e => set('address', e.target.value)} className={inp} />
        </div>
      </div>
      <div>
        <label className={lbl}>Categories Supplied</label>
        <div className="flex flex-wrap gap-1.5">
          {BOM_CATEGORY_OPTIONS.map(o => {
            const on = (form.categories || []).includes(o.value);
            return (
              <button type="button" key={o.value} onClick={() => toggleCategory(o.value)}
                className={`px-2 py-1 rounded text-xs font-medium border transition ${on ? 'bg-amber-500 text-slate-900 border-amber-500' : 'bg-white text-slate-600 border-slate-200 hover:border-amber-300'}`}>
                {o.label}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <label className={lbl}>Notes</label>
        <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} className={inp} />
      </div>
      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={saving || !form.name?.trim()}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 text-sm font-semibold rounded disabled:opacity-50">
          <Save className="w-4 h-4" /> {saving ? 'Saving…' : submitText}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded hover:bg-slate-100">Cancel</button>
        )}
      </div>
    </form>
  );
}