import { useState, useEffect } from 'react';
import { X, Save } from 'lucide-react';

const STATUS_OPTS = ['not_started', 'in_progress', 'completed', 'blocked'];
const inp = 'border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white w-full';

export default function GanttEditorModal({ row, allWbs, onSave, onClose }) {
  const isMilestone = row.kind === 'milestone';
  const [form, setForm] = useState(() => initForm(row));

  useEffect(() => { setForm(initForm(row)); }, [row]);

  function initForm(r) {
    if (r.kind === 'milestone') {
      return { title: r.data.title, planned_date: r.data.planned_date || '', status: r.data.status || 'pending' };
    }
    return {
      name: r.data.name || '',
      wbs_code: r.data.wbs_code || '',
      assignee: r.data.assignee || '',
      planned_start: r.data.planned_start || '',
      planned_end: r.data.planned_end || '',
      progress: r.data.progress ?? 0,
      status: r.data.status || 'not_started',
      predecessor_ids: r.data.predecessor_ids || [],
    };
  }

  function save() {
    onSave(row, form);
    onClose();
  }

  const otherItems = allWbs.filter(w => w.id !== row.id);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h2 className="font-bold text-slate-800 text-sm">Edit {isMilestone ? 'Milestone' : 'WBS Task'}</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded text-slate-500"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
          {isMilestone ? (
            <>
              <div><label className="text-xs text-slate-500">Title</label><input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className={inp} /></div>
              <div><label className="text-xs text-slate-500">Planned Date</label><input type="date" value={form.planned_date} onChange={e => setForm(f => ({ ...f, planned_date: e.target.value }))} className={inp} /></div>
              <div><label className="text-xs text-slate-500">Status</label>
                <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className={inp}>
                  {['pending','in_progress','completed','overdue'].map(s => <option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
                </select>
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-slate-500">WBS Code</label><input value={form.wbs_code} onChange={e => setForm(f => ({ ...f, wbs_code: e.target.value }))} className={inp} /></div>
                <div><label className="text-xs text-slate-500">Assignee</label><input value={form.assignee} onChange={e => setForm(f => ({ ...f, assignee: e.target.value }))} className={inp} /></div>
              </div>
              <div><label className="text-xs text-slate-500">Name</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inp} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-slate-500">Planned Start</label><input type="date" value={form.planned_start} onChange={e => setForm(f => ({ ...f, planned_start: e.target.value }))} className={inp} /></div>
                <div><label className="text-xs text-slate-500">Planned End</label><input type="date" value={form.planned_end} onChange={e => setForm(f => ({ ...f, planned_end: e.target.value }))} className={inp} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-slate-500">Progress %</label><input type="number" min="0" max="100" value={form.progress} onChange={e => setForm(f => ({ ...f, progress: Number(e.target.value) }))} className={inp} /></div>
                <div><label className="text-xs text-slate-500">Status</label>
                  <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className={inp}>
                    {STATUS_OPTS.map(s => <option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 block mb-1">Dependencies (finish-to-start predecessors):</label>
                <select multiple size={Math.min(6, otherItems.length)} value={form.predecessor_ids} onChange={e => setForm(f => ({ ...f, predecessor_ids: Array.from(e.target.selectedOptions).map(o => o.value) }))}
                  className="w-full border border-slate-200 rounded text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white">
                  {[...otherItems].sort((a,b)=>(a.wbs_code||'').localeCompare(b.wbs_code||'',undefined,{numeric:true})).map(o => (
                    <option key={o.id} value={o.id} className="px-2 py-1">{o.wbs_code} — {o.name}</option>
                  ))}
                </select>
                <p className="text-xs text-slate-400 mt-0.5">Hold Ctrl / Cmd to select multiple</p>
              </div>
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200">
          <button onClick={onClose} className="px-3 py-1.5 border border-slate-300 text-slate-600 text-xs rounded hover:bg-slate-50">Cancel</button>
          <button onClick={save} className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-900 text-xs font-semibold rounded"><Save className="w-3.5 h-3.5" /> Save</button>
        </div>
      </div>
    </div>
  );
}