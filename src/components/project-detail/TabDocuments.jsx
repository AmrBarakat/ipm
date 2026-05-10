import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { formatDate, formatBytes, CATEGORY_LABELS } from '@/lib/constants';
import { FileText, Upload, ExternalLink, Pencil, Trash2, Save, X, Cpu } from 'lucide-react';
import BOMExtractionModal from './BOMExtractionModal';

export default function TabDocuments({ projectId }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({ title: '', category: 'other', reference_number: '', document_date: '', description: '' });
  const [file, setFile] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [extractingDoc, setExtractingDoc] = useState(null);

  useEffect(() => { load(); }, [projectId]);

  async function load() {
    setLoading(true);
    const d = await base44.entities.Document.filter({ project_id: projectId }, '-created_date', 100);
    setDocs(d);
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
    setForm({ title: '', category: 'other', reference_number: '', document_date: '', description: '' });
    setFile(null); setShowForm(false); setUploading(false);
    load();
  }

  function startEdit(doc) {
    setEditingId(doc.id);
    setEditForm({ title: doc.title, category: doc.category, reference_number: doc.reference_number || '', document_date: doc.document_date || '', description: doc.description || '' });
  }

  async function saveEdit(id) {
    await base44.entities.Document.update(id, editForm);
    setEditingId(null);
    load();
  }

  async function deleteDoc(id) {
    if (!confirm('Delete this document?')) return;
    await base44.entities.Document.delete(id);
    load();
  }

  if (loading) return <Spinner />;

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-slate-500">{docs.length} document{docs.length !== 1 ? 's' : ''}</p>
        <button onClick={() => setShowForm(v => !v)} className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded">
          <Upload className="w-4 h-4" /> Upload Document
        </button>
      </div>

      {showForm && (
        <form onSubmit={upload} className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Document title *" className={inp} required />
          <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className={inp}>
            {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input value={form.reference_number} onChange={e => setForm(f => ({ ...f, reference_number: e.target.value }))} placeholder="Reference number" className={inp} />
          <input type="date" value={form.document_date} onChange={e => setForm(f => ({ ...f, document_date: e.target.value }))} className={inp} />
          <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Description" className={inp + ' md:col-span-2'} />
          <div className="md:col-span-2">
            <input type="file" onChange={e => setFile(e.target.files[0])} className="text-sm text-slate-600" />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={uploading} className="px-4 py-2 bg-amber-500 text-slate-900 font-semibold text-sm rounded hover:bg-amber-400 disabled:opacity-60">
              {uploading ? 'Uploading…' : 'Save'}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded hover:bg-slate-100">Cancel</button>
          </div>
        </form>
      )}

      {docs.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <FileText className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No documents yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {docs.map(doc => {
            const isEditing = editingId === doc.id;
            return (
              <div key={doc.id} className="bg-white rounded-lg shadow-sm px-4 py-3 flex flex-wrap items-start gap-4">
                <FileText className="w-5 h-5 text-amber-500 shrink-0 mt-1" />
                <div className="flex-1 min-w-0">
                  {isEditing ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <input value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} placeholder="Title" className={inp} />
                      <select value={editForm.category} onChange={e => setEditForm(f => ({ ...f, category: e.target.value }))} className={inp}>
                        {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                      <input value={editForm.reference_number} onChange={e => setEditForm(f => ({ ...f, reference_number: e.target.value }))} placeholder="Reference number" className={inp} />
                      <input type="date" value={editForm.document_date} onChange={e => setEditForm(f => ({ ...f, document_date: e.target.value }))} className={inp} />
                      <input value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} placeholder="Description" className={inp + ' md:col-span-2'} />
                    </div>
                  ) : (
                    <>
                      <div className="font-semibold text-slate-800 text-sm">{doc.title}</div>
                      <div className="text-xs text-slate-500 flex gap-2 flex-wrap mt-0.5">
                        <span>{CATEGORY_LABELS[doc.category] || doc.category}</span>
                        {doc.reference_number && <span>· {doc.reference_number}</span>}
                        {doc.document_date && <span>· {formatDate(doc.document_date)}</span>}
                        {doc.file_size > 0 && <span>· {formatBytes(doc.file_size)}</span>}
                      </div>
                      {doc.description && <div className="text-xs text-slate-400 mt-0.5">{doc.description}</div>}
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {!isEditing && doc.file_url && (
                    <>
                      <a href={doc.file_url} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 px-3 py-1 text-xs border border-slate-300 rounded hover:bg-slate-100 text-slate-600">
                        <ExternalLink className="w-3 h-3" /> Open
                      </a>
                      <button onClick={() => setExtractingDoc(doc)}
                        className="flex items-center gap-1 px-3 py-1 text-xs border border-amber-300 rounded hover:bg-amber-50 text-amber-700 font-medium">
                        <Cpu className="w-3 h-3" /> Extract BOM
                      </button>
                    </>
                  )}
                  {isEditing ? (
                    <>
                      <button onClick={() => saveEdit(doc.id)} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"><Save className="w-4 h-4" /></button>
                      <button onClick={() => setEditingId(null)} className="p-1 text-slate-400 hover:bg-slate-100 rounded"><X className="w-4 h-4" /></button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => startEdit(doc)} className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded"><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => deleteDoc(doc.id)} className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 className="w-4 h-4" /></button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {extractingDoc && (
        <BOMExtractionModal
          document={extractingDoc}
          projectId={projectId}
          onClose={() => setExtractingDoc(null)}
          onApplied={() => setExtractingDoc(null)}
        />
      )}
    </div>
  );
}

const inp = 'border border-slate-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white w-full';
function Spinner() {
  return <div className="flex justify-center py-12"><div className="w-7 h-7 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;
}