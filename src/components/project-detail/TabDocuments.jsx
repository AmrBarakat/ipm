import { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { formatDate, formatBytes, CATEGORY_LABELS } from '@/lib/constants';
import {
  FileText, Upload, ExternalLink, Pencil, Trash2, Save, X,
  Cpu, Filter, FolderOpen, Link2, ChevronDown, ChevronRight, FileCheck
} from 'lucide-react';
import BOMExtractionPreviewModal from './BOMExtractionPreviewModal';

const CATEGORY_ICONS = {
  drawing: '📐',
  submittal: '📋',
  engineering: '⚙️',
  contract: '📜',
  po: '🛒',
  offer: '💼',
  delivery_note: '📦',
  charter: '🗂️',
  report: '📊',
  invoice: '🧾',
  other: '📄',
};

const EMPTY_FORM = {
  title: '', category: 'other', reference_number: '',
  document_date: '', version: '', description: '',
  linked_milestone_id: '', linked_task_id: '',
};

const inp = 'border border-slate-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white w-full';

export default function TabDocuments({ projectId }) {
  const [docs, setDocs] = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [file, setFile] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [bomPreviewDoc, setBomPreviewDoc] = useState(null);
  const [filterCategory, setFilterCategory] = useState('');
  const [collapsed, setCollapsed] = useState({});

  useEffect(() => { load(); }, [projectId]);

  async function load() {
    setLoading(true);
    const [d, m, t] = await Promise.all([
      base44.entities.Document.filter({ project_id: projectId }, '-created_date', 200),
      base44.entities.Milestone.filter({ project_id: projectId }, 'planned_date', 100),
      base44.entities.Task.filter({ project_id: projectId }, 'title', 200),
    ]);
    setDocs(d);
    setMilestones(m);
    setTasks(t);
    setLoading(false);
  }

  async function upload(e) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setUploading(true);
    let file_url = '', file_name = '', file_size = 0, content_type = '';
    if (file) {
      const res = await base44.integrations.Core.UploadFile({ file });
      file_url = res.file_url; file_name = file.name; file_size = file.size; content_type = file.type;
    }
    await base44.entities.Document.create({ ...form, project_id: projectId, file_url, file_name, file_size, content_type });
    setForm(EMPTY_FORM);
    setFile(null); setShowForm(false); setUploading(false);
    load();
  }

  function startEdit(doc) {
    setEditingId(doc.id);
    setEditForm({
      title: doc.title, category: doc.category,
      reference_number: doc.reference_number || '',
      document_date: doc.document_date || '',
      version: doc.version || '',
      description: doc.description || '',
      linked_milestone_id: doc.linked_milestone_id || '',
      linked_task_id: doc.linked_task_id || '',
    });
  }

  async function saveEdit(id) {
    await base44.entities.Document.update(id, editForm);
    setEditingId(null);
    load();
  }

  async function deleteDoc(id) {
    await base44.entities.Document.delete(id);
    load();
  }

  function toggleCollapse(cat) {
    setCollapsed(p => ({ ...p, [cat]: !p[cat] }));
  }

  const filtered = useMemo(() =>
    filterCategory ? docs.filter(d => d.category === filterCategory) : docs,
    [docs, filterCategory]
  );

  // Group by category
  const groups = useMemo(() => {
    const catOrder = Object.keys(CATEGORY_LABELS);
    const map = {};
    filtered.forEach(d => {
      const cat = d.category || 'other';
      if (!map[cat]) map[cat] = [];
      map[cat].push(d);
    });
    return catOrder.filter(c => map[c]).map(c => ({ cat: c, items: map[c] }));
  }, [filtered]);

  const milestoneById = Object.fromEntries(milestones.map(m => [m.id, m]));
  const taskById = Object.fromEntries(tasks.map(t => [t.id, t]));

  if (loading) return <Spinner />;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400" />
          <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
            className="text-sm border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white">
            <option value="">All Categories</option>
            {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <span className="text-xs text-slate-400">{filtered.length} document{filtered.length !== 1 ? 's' : ''}</span>
        </div>
        <button onClick={() => { setShowForm(v => !v); setForm(EMPTY_FORM); setFile(null); }}
          className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded">
          <Upload className="w-4 h-4" /> Upload Document
        </button>
      </div>

      {/* Upload Form */}
      {showForm && (
        <form onSubmit={upload} className="bg-amber-50 border border-amber-200 rounded-lg p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            placeholder="Document title *" className={inp} required />
          <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className={inp}>
            {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input value={form.reference_number} onChange={e => setForm(f => ({ ...f, reference_number: e.target.value }))}
            placeholder="Reference / Drawing No." className={inp} />
          <input value={form.version} onChange={e => setForm(f => ({ ...f, version: e.target.value }))}
            placeholder="Version (e.g. Rev.A)" className={inp} />
          <input type="date" value={form.document_date} onChange={e => setForm(f => ({ ...f, document_date: e.target.value }))} className={inp} />
          <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            placeholder="Description" className={inp} />
          {/* Link to milestone */}
          <select value={form.linked_milestone_id} onChange={e => setForm(f => ({ ...f, linked_milestone_id: e.target.value }))} className={inp}>
            <option value="">— Link to Milestone (optional) —</option>
            {milestones.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
          </select>
          {/* Link to task */}
          <select value={form.linked_task_id} onChange={e => setForm(f => ({ ...f, linked_task_id: e.target.value }))} className={inp}>
            <option value="">— Link to Task (optional) —</option>
            {tasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
          <div className="md:col-span-2">
            <label className="text-xs text-slate-500 block mb-1">File (PDF, DWG, Excel, Word, Image)</label>
            <input type="file" accept=".pdf,.dwg,.dxf,.xlsx,.xls,.csv,.doc,.docx,.png,.jpg,.jpeg"
              onChange={e => setFile(e.target.files[0])} className="text-sm text-slate-600" />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={uploading}
              className="px-4 py-2 bg-amber-500 text-slate-900 font-semibold text-sm rounded hover:bg-amber-400 disabled:opacity-60">
              {uploading ? 'Uploading…' : 'Save'}
            </button>
            <button type="button" onClick={() => setShowForm(false)}
              className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded hover:bg-slate-100">Cancel</button>
          </div>
        </form>
      )}

      {/* Documents grouped by category */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <FileText className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No documents yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map(({ cat, items }) => (
            <div key={cat} className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
              {/* Category header */}
              <button onClick={() => toggleCollapse(cat)}
                className="w-full flex items-center gap-3 px-4 py-2.5 bg-slate-50 border-b border-slate-200 hover:bg-slate-100 transition">
                <span className="text-base">{CATEGORY_ICONS[cat] || '📄'}</span>
                <span className="font-semibold text-slate-700 text-sm">{CATEGORY_LABELS[cat] || cat}</span>
                <span className="text-xs text-slate-400 bg-slate-200 rounded-full px-2 py-0.5 ml-1">{items.length}</span>
                <span className="ml-auto text-slate-400">
                  {collapsed[cat] ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </span>
              </button>

              {!collapsed[cat] && (
                <div className="divide-y divide-slate-100">
                  {items.map(doc => {
                    const isEditing = editingId === doc.id;
                    const linkedMilestone = doc.linked_milestone_id ? milestoneById[doc.linked_milestone_id] : null;
                    const linkedTask = doc.linked_task_id ? taskById[doc.linked_task_id] : null;
                    return (
                      <div key={doc.id} className="px-4 py-3">
                        {isEditing ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <input value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} placeholder="Title" className={inp} />
                            <select value={editForm.category} onChange={e => setEditForm(f => ({ ...f, category: e.target.value }))} className={inp}>
                              {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                            <input value={editForm.reference_number} onChange={e => setEditForm(f => ({ ...f, reference_number: e.target.value }))} placeholder="Reference / Drawing No." className={inp} />
                            <input value={editForm.version} onChange={e => setEditForm(f => ({ ...f, version: e.target.value }))} placeholder="Version" className={inp} />
                            <input type="date" value={editForm.document_date} onChange={e => setEditForm(f => ({ ...f, document_date: e.target.value }))} className={inp} />
                            <input value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} placeholder="Description" className={inp} />
                            <select value={editForm.linked_milestone_id} onChange={e => setEditForm(f => ({ ...f, linked_milestone_id: e.target.value }))} className={inp}>
                              <option value="">— Link to Milestone —</option>
                              {milestones.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
                            </select>
                            <select value={editForm.linked_task_id} onChange={e => setEditForm(f => ({ ...f, linked_task_id: e.target.value }))} className={inp}>
                              <option value="">— Link to Task —</option>
                              {tasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
                            </select>
                            <div className="md:col-span-2 flex gap-2 mt-1">
                              <button onClick={() => saveEdit(doc.id)} className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500 text-white text-sm rounded hover:bg-emerald-400 font-semibold">
                                <Save className="w-3.5 h-3.5" /> Save
                              </button>
                              <button onClick={() => setEditingId(null)} className="px-3 py-1.5 border border-slate-300 text-slate-600 text-sm rounded hover:bg-slate-100">Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-start gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold text-slate-800 text-sm">{doc.title}</span>
                                {doc.version && (
                                  <span className="text-xs bg-blue-50 text-blue-600 border border-blue-200 rounded px-1.5 py-0.5 font-mono">{doc.version}</span>
                                )}
                              </div>
                              <div className="text-xs text-slate-500 flex gap-2 flex-wrap mt-0.5">
                                {doc.reference_number && <span className="font-mono text-slate-600">#{doc.reference_number}</span>}
                                {doc.document_date && <span>· {formatDate(doc.document_date)}</span>}
                                {doc.file_name && <span>· {doc.file_name}</span>}
                                {doc.file_size > 0 && <span>· {formatBytes(doc.file_size)}</span>}
                              </div>
                              {doc.description && <div className="text-xs text-slate-400 mt-0.5">{doc.description}</div>}
                              {/* Links */}
                              <div className="flex flex-wrap gap-2 mt-1">
                                {linkedMilestone && (
                                  <span className="flex items-center gap-1 text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded px-2 py-0.5">
                                    <Link2 className="w-3 h-3" /> 🏁 {linkedMilestone.title}
                                  </span>
                                )}
                                {linkedTask && (
                                  <span className="flex items-center gap-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded px-2 py-0.5">
                                    <Link2 className="w-3 h-3" /> ✅ {linkedTask.title}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                              {doc.file_url && (
                                <>
                                  <a href={doc.file_url} target="_blank" rel="noopener noreferrer"
                                    className="flex items-center gap-1 px-2.5 py-1 text-xs border border-slate-300 rounded hover:bg-slate-100 text-slate-600">
                                    <ExternalLink className="w-3 h-3" /> Open
                                  </a>
                                  {['engineering', 'drawing', 'submittal', 'other'].includes(doc.category) && (
                                    <button onClick={() => setBomPreviewDoc(doc)}
                                      className="flex items-center gap-1 px-2.5 py-1 text-xs border border-amber-300 rounded hover:bg-amber-50 text-amber-700 font-medium">
                                      <Cpu className="w-3 h-3" /> Extract BOM
                                    </button>
                                  )}
                                </>
                              )}
                              <button onClick={() => startEdit(doc)} className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded">
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button onClick={() => deleteDoc(doc.id)} className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {bomPreviewDoc && (
        <BOMExtractionPreviewModal
          document={bomPreviewDoc}
          projectId={projectId}
          onClose={() => setBomPreviewDoc(null)}
          onImported={() => setBomPreviewDoc(null)} />
      )}
    </div>
  );
}

function Spinner() {
  return <div className="flex justify-center py-12"><div className="w-7 h-7 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;
}