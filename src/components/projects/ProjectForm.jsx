import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { CURRENCIES } from '@/lib/constants';
import { Save, X } from 'lucide-react';

const STATUSES = ['planning', 'in_progress', 'commissioning', 'completed', 'closed', 'on_hold'];
const TYPES = ['automation', 'energy', 'both'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];

export default function ProjectForm({ project, onSaved }) {
  const navigate = useNavigate();
  const isEdit = !!project?.id;

  const [form, setForm] = useState({
    code: '',
    name: '',
    client: '',
    location: '',
    project_type: 'automation',
    status: 'planning',
    priority: 'medium',
    project_manager: '',
    contract_value: '',
    currency: 'SAR',
    progress: 0,
    start_date: '',
    target_completion_date: '',
    description: '',
    scope: '',
    ...(project || {}),
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.code.trim() || !form.name.trim()) {
      setError('Project code and name are required.');
      return;
    }
    setSaving(true);
    setError('');
    const payload = {
      ...form,
      contract_value: form.contract_value !== '' ? Number(form.contract_value) : null,
      progress: form.progress !== '' ? Number(form.progress) : 0,
    };
    if (isEdit) {
      await base44.entities.Project.update(project.id, payload);
    } else {
      await base44.entities.Project.create(payload);
    }
    setSaving(false);
    if (onSaved) onSaved();
    else navigate('/projects');
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded px-4 py-2 text-sm">{error}</div>
      )}

      {/* Basic Info */}
      <section className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="font-semibold text-slate-700 mb-4 text-base">Basic Information</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Project Code *" hint="e.g. AUT-2025-001">
            <input value={form.code} onChange={e => set('code', e.target.value)}
              className={input} placeholder="AUT-2025-001" required />
          </Field>
          <Field label="Project Name *">
            <input value={form.name} onChange={e => set('name', e.target.value)}
              className={input} placeholder="PLC Upgrade – Plant A" required />
          </Field>
          <Field label="Client">
            <input value={form.client} onChange={e => set('client', e.target.value)}
              className={input} placeholder="Saudi Aramco" />
          </Field>
          <Field label="Location">
            <input value={form.location} onChange={e => set('location', e.target.value)}
              className={input} placeholder="Riyadh, KSA" />
          </Field>
          <Field label="Project Manager">
            <input value={form.project_manager} onChange={e => set('project_manager', e.target.value)}
              className={input} placeholder="Name" />
          </Field>
          <Field label="Project Type">
            <select value={form.project_type} onChange={e => set('project_type', e.target.value)} className={input}>
              {TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
            </select>
          </Field>
        </div>
      </section>

      {/* Status & Scheduling */}
      <section className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="font-semibold text-slate-700 mb-4 text-base">Status & Schedule</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Status">
            <select value={form.status} onChange={e => set('status', e.target.value)} className={input}>
              {STATUSES.map(s => (
                <option key={s} value={s}>{s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
              ))}
            </select>
          </Field>
          <Field label="Priority">
            <select value={form.priority} onChange={e => set('priority', e.target.value)} className={input}>
              {PRIORITIES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
            </select>
          </Field>
          <Field label={`Progress (${form.progress}%)`}>
            <input type="range" min="0" max="100" value={form.progress}
              onChange={e => set('progress', e.target.value)}
              className="w-full mt-2" />
          </Field>
          <Field label="Start Date">
            <input type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)} className={input} />
          </Field>
          <Field label="Target Completion Date">
            <input type="date" value={form.target_completion_date} onChange={e => set('target_completion_date', e.target.value)} className={input} />
          </Field>
        </div>
      </section>

      {/* Financial */}
      <section className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="font-semibold text-slate-700 mb-4 text-base">Financial</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Contract Value">
            <input type="number" min="0" value={form.contract_value} onChange={e => set('contract_value', e.target.value)}
              className={input} placeholder="0" />
          </Field>
          <Field label="Currency">
            <select value={form.currency} onChange={e => set('currency', e.target.value)} className={input}>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        </div>
      </section>

      {/* Description & Scope */}
      <section className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="font-semibold text-slate-700 mb-4 text-base">Description & Scope</h2>
        <div className="space-y-4">
          <Field label="Description">
            <textarea value={form.description} onChange={e => set('description', e.target.value)}
              className={`${input} h-24 resize-y`} placeholder="Brief project overview..." />
          </Field>
          <Field label="Scope of Work">
            <textarea value={form.scope} onChange={e => set('scope', e.target.value)}
              className={`${input} h-24 resize-y`} placeholder="Detailed scope of work..." />
          </Field>
        </div>
      </section>

      {/* Actions */}
      <div className="flex items-center gap-3 justify-end">
        <button type="button" onClick={() => navigate(-1)}
          className="px-4 py-2 rounded border border-slate-300 text-slate-700 hover:bg-slate-100 text-sm flex items-center gap-1">
          <X className="w-4 h-4" /> Cancel
        </button>
        <button type="submit" disabled={saving}
          className="px-6 py-2 rounded bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm flex items-center gap-2 disabled:opacity-60">
          <Save className="w-4 h-4" /> {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Project'}
        </button>
      </div>
    </form>
  );
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">{label}</label>
      {hint && <p className="text-xs text-slate-400 mb-1">{hint}</p>}
      {children}
    </div>
  );
}

const input = 'w-full border border-slate-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white';