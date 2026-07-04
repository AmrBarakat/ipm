import { useState, useEffect } from 'react';
import { useEntityList, useEntityMutation } from '@/hooks/useEntity';
import { base44 } from '@/api/base44Client';
import { Plus, Trash2, StickyNote, Pencil, Save, X } from 'lucide-react';
import SummaryNoteTable from '@/components/documents/SummaryNoteTable';

export default function TabNotes({ projectId }) {
  const { data: notes = [], isLoading } = useEntityList('Note', { project_id: projectId }, '-created_date', 200);
  const mutation = useEntityMutation('Note');
  const [adding, setAdding] = useState(false);
  const [body, setBody] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editBody, setEditBody] = useState('');
  const [user, setUser] = useState(null);

  useEffect(() => {
    base44.auth.me().then(u => setUser(u)).catch(() => {});
  }, []);

  async function createNote(e) {
    e.preventDefault();
    if (!body.trim()) return;
    await mutation.mutateAsync({
      action: 'create',
      data: {
        project_id: projectId,
        body: body.trim(),
        author: user?.full_name || user?.email || 'Unknown',
      },
    });
    setBody('');
    setAdding(false);
  }

  function startEdit(note) {
    setEditingId(note.id);
    setEditBody(note.body);
  }

  async function saveEdit(id) {
    await mutation.mutateAsync({ action: 'update', id, data: { body: editBody.trim() } });
    setEditingId(null);
  }

  async function deleteNote(id) {
    if (!confirm('Delete this note?')) return;
    await mutation.mutateAsync({ action: 'delete', id });
  }

  if (isLoading) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-slate-500">{notes.length} note{notes.length !== 1 ? 's' : ''}</p>
        <button onClick={() => setAdding(v => !v)}
          className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded">
          <Plus className="w-4 h-4" /> Add Note
        </button>
      </div>

      {adding && (
        <form onSubmit={createNote} className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Write your note here…"
            rows={4}
            className="w-full border border-slate-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white resize-y"
            autoFocus
          />
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-2 bg-amber-500 text-slate-900 font-semibold text-sm rounded hover:bg-amber-400">Save Note</button>
            <button type="button" onClick={() => { setAdding(false); setBody(''); }}
              className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded hover:bg-slate-100">Cancel</button>
          </div>
        </form>
      )}

      {notes.length === 0 && !adding ? (
        <div className="text-center py-16 text-slate-400">
          <StickyNote className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No notes yet. Add one to keep track of important information.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {notes.map(note => {
            const isEditing = editingId === note.id;
            const date = note.created_date ? new Date(note.created_date).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '';
            return (
              <div key={note.id} className="bg-white rounded-lg shadow-sm p-4 border-l-4 border-amber-400">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <textarea
                        value={editBody}
                        onChange={e => setEditBody(e.target.value)}
                        rows={4}
                        className="w-full border border-slate-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white resize-y"
                        autoFocus
                      />
                    ) : note.note_type && note.note_type !== 'plain' && note.table_data ? (
                      <div className="space-y-2">
                        <p className="text-sm font-semibold text-slate-700">{note.body}</p>
                        <SummaryNoteTable tableData={note.table_data} />
                      </div>
                    ) : (
                      <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{note.body}</p>
                    )}
                    <div className="mt-2 text-xs text-slate-400 flex gap-3">
                      {note.author && <span>✍ {note.author}</span>}
                      {date && <span>🕐 {date}</span>}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {isEditing ? (
                      <>
                        <button onClick={() => saveEdit(note.id)} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"><Save className="w-4 h-4" /></button>
                        <button onClick={() => setEditingId(null)} className="p-1 text-slate-400 hover:bg-slate-100 rounded"><X className="w-4 h-4" /></button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => startEdit(note)} className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => deleteNote(note.id)} className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 className="w-4 h-4" /></button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return <div className="flex justify-center py-12"><div className="w-7 h-7 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;
}