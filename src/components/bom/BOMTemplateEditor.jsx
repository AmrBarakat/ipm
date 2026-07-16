import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { BOM_CATEGORY_LABELS, BOM_CATEGORY_OPTIONS } from '@/lib/constants';
import { X, Save, Plus, Trash2, Star, StarOff, FileText } from 'lucide-react';
import { useConfirm } from '@/components/ui/ConfirmDialog';

const inp = 'border border-slate-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white w-full';
const CURRENCIES = ['SAR', 'AED', 'USD', 'EUR', 'GBP'];

const EMPTY_TEMPLATE = {
  name: '',
  description: '',
  column_mappings: {
    part_no: '',
    description: '',
    qty: '',
    unit: '',
    unit_cost: '',
    total_cost: '',
    unit_selling: '',
    total_selling: '',
    supplier: '',
    manufacturer: '',
  },
  default_category: '',
  default_supplier: '',
  default_currency: 'SAR',
  panel_keyword: 'Panel',
  skip_rows: 0,
  aggregate_duplicates: true,
  extra_instructions: '',
  is_default: false,
};

const COLUMN_FIELDS = [
  { key: 'part_no', label: 'Part No. Column' },
  { key: 'description', label: 'Description Column' },
  { key: 'qty', label: 'Quantity Column' },
  { key: 'unit', label: 'Unit Column' },
  { key: 'unit_cost', label: 'Unit Cost Column' },
  { key: 'total_cost', label: 'Total Cost Column' },
  { key: 'unit_selling', label: 'Unit Selling Column' },
  { key: 'total_selling', label: 'Total Selling Column' },
  { key: 'supplier', label: 'Supplier Column' },
  { key: 'manufacturer', label: 'Manufacturer Column' },
];

export default function BOMTemplateEditor({ onClose, onTemplateSelected }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null = list view, 'new' or template object = edit view
  const [form, setForm] = useState(EMPTY_TEMPLATE);
  const [saving, setSaving] = useState(false);
  const confirmDialog = useConfirm();

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const data = await base44.entities.BOMTemplate.list('-created_date', 50);
    setTemplates(data);
    setLoading(false);
  }

  function startNew() {
    setForm({ ...EMPTY_TEMPLATE });
    setEditing('new');
  }

  function startEdit(tpl) {
    setForm({
      ...EMPTY_TEMPLATE,
      ...tpl,
      column_mappings: { ...EMPTY_TEMPLATE.column_mappings, ...(tpl.column_mappings || {}) },
    });
    setEditing(tpl);
  }

  async function save() {
    if (!form.name.trim()) return;
    setSaving(true);
    // If setting as default, unset others
    if (form.is_default) {
      const others = templates.filter(t => t.is_default && t.id !== (editing?.id));
      await Promise.all(others.map(t => base44.entities.BOMTemplate.update(t.id, { is_default: false })));
    }
    if (editing === 'new') {
      await base44.entities.BOMTemplate.create(form);
    } else {
      await base44.entities.BOMTemplate.update(editing.id, form);
    }
    setSaving(false);
    setEditing(null);
    load();
  }

  async function deleteTemplate(id) {
    if (!(await confirmDialog({ title: 'Delete template', description: 'Delete this template?', confirmText: 'Delete', destructive: true }))) return;
    await base44.entities.BOMTemplate.delete(id);
    load();
  }

  async function setDefault(tpl) {
    await Promise.all(templates.filter(t => t.is_default).map(t => base44.entities.BOMTemplate.update(t.id, { is_default: false })));
    await base44.entities.BOMTemplate.update(tpl.id, { is_default: true });
    load();
  }

  function updateMapping(key, value) {
    setForm(f => ({ ...f, column_mappings: { ...f.column_mappings, [key]: value } }));
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <h2 className="font-bold text-slate-800 text-lg flex items-center gap-2">
            <FileText className="w-5 h-5 text-amber-500" />
            {editing ? (editing === 'new' ? 'New BOM Template' : `Edit: ${editing.name}`) : 'BOM Extraction Templates'}
          </h2>
          <button onClick={editing ? () => setEditing(null) : onClose} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500">
            {editing ? <span className="text-sm text-slate-500">← Back</span> : <X className="w-5 h-5" />}
          </button>
        </div>

        <div className="flex-1 overflow-auto p-6">

          {/* LIST VIEW */}
          {!editing && (
            <div className="space-y-3">
              {loading ? (
                <div className="text-center py-8 text-slate-400 text-sm">Loading…</div>
              ) : templates.length === 0 ? (
                <div className="text-center py-10 text-slate-400">
                  <FileText className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No templates yet. Create your first one.</p>
                </div>
              ) : (
                templates.map(tpl => (
                  <div key={tpl.id} className={`flex items-center gap-3 p-4 rounded-lg border transition ${tpl.is_default ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-800 text-sm">{tpl.name}</span>
                        {tpl.is_default && <span className="text-xs bg-amber-400 text-slate-900 px-1.5 py-0.5 rounded font-semibold">Default</span>}
                      </div>
                      {tpl.description && <p className="text-xs text-slate-500 mt-0.5 truncate">{tpl.description}</p>}
                      <p className="text-xs text-slate-400 mt-0.5">
                        Currency: {tpl.default_currency || 'SAR'}
                        {tpl.default_supplier ? ` · Supplier: ${tpl.default_supplier}` : ''}
                        {tpl.aggregate_duplicates ? ' · Dedup ON' : ''}
                      </p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {onTemplateSelected && (
                        <button onClick={() => { onTemplateSelected(tpl); onClose(); }}
                          className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-xs rounded">
                          Use
                        </button>
                      )}
                      <button onClick={() => tpl.is_default ? null : setDefault(tpl)}
                        title={tpl.is_default ? 'Already default' : 'Set as default'}
                        className={`p-1.5 rounded hover:bg-slate-100 ${tpl.is_default ? 'text-amber-500' : 'text-slate-300 hover:text-amber-400'}`}>
                        {tpl.is_default ? <Star className="w-4 h-4 fill-current" /> : <StarOff className="w-4 h-4" />}
                      </button>
                      <button onClick={() => startEdit(tpl)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                      </button>
                      <button onClick={() => deleteTemplate(tpl.id)} className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* EDIT / NEW VIEW */}
          {editing && (
            <div className="space-y-5">

              {/* Basic info */}
              <section>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Template Info</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">Template Name *</label>
                    <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Standard BOM, Siemens Format" className={inp} />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">Description</label>
                    <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional description" className={inp} />
                  </div>
                </div>
              </section>

              {/* Defaults */}
              <section>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Extraction Defaults</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">Default Category</label>
                    <select value={form.default_category} onChange={e => setForm(f => ({ ...f, default_category: e.target.value }))} className={inp}>
                      <option value="">Auto-detect</option>
                      {BOM_CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">Default Supplier</label>
                    <input value={form.default_supplier} onChange={e => setForm(f => ({ ...f, default_supplier: e.target.value }))} placeholder="e.g. Siemens, ABB" className={inp} />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">Currency</label>
                    <select value={form.default_currency} onChange={e => setForm(f => ({ ...f, default_currency: e.target.value }))} className={inp}>
                      {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">Panel Keyword</label>
                    <input value={form.panel_keyword} onChange={e => setForm(f => ({ ...f, panel_keyword: e.target.value }))} placeholder="Panel" className={inp} />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">Skip Header Rows</label>
                    <input type="number" min="0" value={form.skip_rows} onChange={e => setForm(f => ({ ...f, skip_rows: Number(e.target.value) }))} className={inp} />
                  </div>
                  <div className="flex items-center gap-2 mt-4">
                    <input type="checkbox" id="agg_dup" checked={form.aggregate_duplicates} onChange={e => setForm(f => ({ ...f, aggregate_duplicates: e.target.checked }))} className="w-4 h-4 accent-amber-500" />
                    <label htmlFor="agg_dup" className="text-sm text-slate-700">Aggregate duplicate part numbers</label>
                  </div>
                  <div className="flex items-center gap-2 mt-4">
                    <input type="checkbox" id="is_default" checked={form.is_default} onChange={e => setForm(f => ({ ...f, is_default: e.target.checked }))} className="w-4 h-4 accent-amber-500" />
                    <label htmlFor="is_default" className="text-sm text-slate-700">Set as default template</label>
                  </div>
                </div>
              </section>

              {/* Column mappings */}
              <section>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Column Name Hints</h3>
                <p className="text-xs text-slate-400 mb-3">Tell the AI what your column headers are called. Leave blank to auto-detect.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {COLUMN_FIELDS.map(({ key, label }) => (
                    <div key={key}>
                      <label className="text-xs text-slate-500 block mb-1">{label}</label>
                      <input value={form.column_mappings[key] || ''} onChange={e => updateMapping(key, e.target.value)} placeholder="e.g. Part Number, P/N" className={inp} />
                    </div>
                  ))}
                </div>
              </section>

              {/* Extra AI instructions */}
              <section>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Extra AI Instructions</h3>
                <p className="text-xs text-slate-400 mb-2">Additional context or rules for the AI extractor.</p>
                <textarea
                  value={form.extra_instructions}
                  onChange={e => setForm(f => ({ ...f, extra_instructions: e.target.value }))}
                  placeholder="e.g. All prices are in SAR. Column F is always the supplier. Skip rows that contain 'SPARE'."
                  className={inp + ' resize-none h-20'}
                />
              </section>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between shrink-0 bg-slate-50">
          {!editing ? (
            <>
              <button onClick={onClose} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-slate-100">Close</button>
              <button onClick={startNew} className="flex items-center gap-2 px-5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded-lg">
                <Plus className="w-4 h-4" /> New Template
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setEditing(null)} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-slate-100">Cancel</button>
              <button onClick={save} disabled={saving || !form.name.trim()}
                className="flex items-center gap-2 px-5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded-lg disabled:opacity-40">
                <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save Template'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}