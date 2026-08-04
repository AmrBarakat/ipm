import { useState, useMemo } from 'react';
import { useEntityList, useEntityMutation } from '@/hooks/useEntity';
import { useCan } from '@/lib/can';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { formatDate } from '@/lib/constants';
import { AlertTriangle, Trash2, ChevronDown, ChevronRight, ShieldAlert } from 'lucide-react';

/**
 * Legacy extraction cleanup — surfaces Note records and BOMItem AuditLog writes
 * created by the retired extractPODN auto-apply path.
 *
 * Legacy note detection: note_type is po_summary/dn_summary AND at least one row
 * has `applied_status` with a null `unit_price` (the retired path wrote null
 * prices; the v2 apply path writes Number(unit_price) || 0).
 *
 * Legacy BOM writes: AuditLog entries whose metadata.source_document matches any
 * PO number or delivery-note reference number belonging to this project.
 */
export default function LegacyExtractionCleanup({ projectId }) {
  const { isAdmin } = useCan();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const confirm = useConfirm();

  const { data: notes = [], isLoading: loadingNotes } = useEntityList('Note', { project_id: projectId }, '-created_date', 500);
  const { data: pos = [] } = useEntityList('PurchaseOrder', { project_id: projectId }, '-created_date', 200);
  const { data: docs = [] } = useEntityList('Document', { project_id: projectId }, '-created_date', 200);
  const { data: logs = [], isLoading: loadingLogs } = useEntityList('AuditLog', { project_id: projectId }, '-created_date', 500);
  const noteMutation = useEntityMutation('Note', ['AuditLog']);

  // Collect all PO/DN numbers for this project
  const docNumbers = useMemo(() => {
    const set = new Set();
    for (const p of pos) {
      if (p.po_number) set.add(p.po_number);
      for (const dn of (p.delivery_notes || [])) {
        if (dn.dn_number) set.add(dn.dn_number);
      }
    }
    for (const d of docs) {
      if (d.reference_number) set.add(d.reference_number);
    }
    return set;
  }, [pos, docs]);

  // Legacy notes: rows have applied_status but unit_price is null/undefined
  const legacyNotes = useMemo(() => {
    return notes.filter(n => {
      if (n.note_type !== 'po_summary' && n.note_type !== 'dn_summary') return false;
      const rows = n.table_data?.rows || [];
      if (!rows.length) return false;
      return rows.some(r => 'applied_status' in r && r.unit_price == null);
    }).map(n => ({
      id: n.id,
      body: n.body,
      created_date: n.created_date,
      document_number: n.table_data?.document_number || '—',
      row_count: (n.table_data?.rows || []).length,
    }));
  }, [notes]);

  // Legacy BOM writes: AuditLog with metadata.source_document matching a project doc number
  const legacyBomWrites = useMemo(() => {
    if (!docNumbers.size) return [];
    return logs.filter(l => {
      const sd = l.metadata?.source_document;
      return sd && docNumbers.has(sd);
    }).map(l => ({
      id: l.id,
      entity_type: l.entity_type,
      entity_id: l.entity_id,
      field: l.metadata?.field || '—',
      old: l.metadata?.old ?? '—',
      new: l.metadata?.new ?? '—',
      created_date: l.created_date,
      actor: l.actor,
    }));
  }, [logs, docNumbers]);

  async function deleteNote(id) {
    const ok = await confirm({
      title: 'Delete legacy note?',
      description: 'This note was created by the retired extractor and will be permanently removed.',
      confirmText: 'Delete',
      variant: 'destructive',
    });
    if (!ok) return;
    await noteMutation.mutateAsync({ action: 'delete', id });
  }

  async function deleteAll() {
    const ok = await confirm({
      title: `Delete ${legacyNotes.length} legacy note${legacyNotes.length !== 1 ? 's' : ''}?`,
      description: `All ${legacyNotes.length} note${legacyNotes.length !== 1 ? 's' : ''} created by the retired extractor will be permanently removed.`,
      confirmText: `Delete ${legacyNotes.length}`,
      variant: 'destructive',
    });
    if (!ok) return;
    setDeleting(true);
    await Promise.allSettled(
      legacyNotes.map(n => noteMutation.mutateAsync({ action: 'delete', id: n.id }))
    );
    setDeleting(false);
  }

  if (!isAdmin) return null;
  if (loadingNotes || loadingLogs) return null;
  if (!legacyNotes.length && !legacyBomWrites.length) return null;

  const inp = 'border border-slate-200 rounded px-2 py-1 text-xs bg-white';

  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-2.5 bg-red-50 border-b border-red-200 hover:bg-red-100 transition">
        <ShieldAlert className="w-4 h-4 text-red-600" />
        <span className="font-semibold text-red-800 text-sm">Legacy extraction cleanup</span>
        <span className="text-xs text-red-600 bg-red-100 rounded-full px-2 py-0.5">
          {legacyNotes.length} note{legacyNotes.length !== 1 ? 's' : ''}, {legacyBomWrites.length} BOM write{legacyBomWrites.length !== 1 ? 's' : ''}
        </span>
        <span className="ml-auto text-red-400">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>
      </button>

      {open && (
        <div className="p-4 space-y-4">
          <div className="text-xs text-slate-500">
            {legacyNotes.length} legacy note{legacyNotes.length !== 1 ? 's' : ''}, {legacyBomWrites.length} legacy BOM write{legacyBomWrites.length !== 1 ? 's' : ''}.
          </div>

          {/* Legacy notes */}
          {legacyNotes.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> Legacy notes
                </h4>
                <button onClick={deleteAll} disabled={deleting}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs border border-red-300 rounded text-red-700 hover:bg-red-50 disabled:opacity-50 font-medium">
                  <Trash2 className="w-3 h-3" /> Delete all listed ({legacyNotes.length})
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                      <th className="text-left px-2 py-1.5 font-medium">Note ID</th>
                      <th className="text-left px-2 py-1.5 font-medium">Title</th>
                      <th className="text-left px-2 py-1.5 font-medium">Created</th>
                      <th className="text-left px-2 py-1.5 font-medium">Doc No.</th>
                      <th className="text-right px-2 py-1.5 font-medium">Rows</th>
                      <th className="text-right px-2 py-1.5 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {legacyNotes.map(n => (
                      <tr key={n.id} className="hover:bg-slate-50">
                        <td className="px-2 py-1.5 font-mono text-slate-400">{n.id.slice(-8)}</td>
                        <td className="px-2 py-1.5 text-slate-700 max-w-xs truncate">{n.body}</td>
                        <td className="px-2 py-1.5 text-slate-500 whitespace-nowrap">{formatDate(n.created_date)}</td>
                        <td className="px-2 py-1.5 font-mono text-slate-600">{n.document_number}</td>
                        <td className="px-2 py-1.5 text-right text-slate-600">{n.row_count}</td>
                        <td className="px-2 py-1.5 text-right">
                          <button onClick={() => deleteNote(n.id)} disabled={deleting}
                            className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded disabled:opacity-50">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Legacy BOM writes */}
          <div>
            <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5 mb-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> Legacy BOM writes
            </h4>
            {legacyBomWrites.length === 0 ? (
              <p className="text-xs text-slate-400 py-2">0 legacy BOM writes.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                      <th className="text-left px-2 py-1.5 font-medium">Entity</th>
                      <th className="text-left px-2 py-1.5 font-medium">Entity ID</th>
                      <th className="text-left px-2 py-1.5 font-medium">Field</th>
                      <th className="text-left px-2 py-1.5 font-medium">Old</th>
                      <th className="text-left px-2 py-1.5 font-medium">New</th>
                      <th className="text-left px-2 py-1.5 font-medium">Timestamp</th>
                      <th className="text-left px-2 py-1.5 font-medium">Actor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {legacyBomWrites.map(l => (
                      <tr key={l.id} className="hover:bg-slate-50">
                        <td className="px-2 py-1.5 text-slate-700">{l.entity_type}</td>
                        <td className="px-2 py-1.5 font-mono text-slate-400">{l.entity_id?.slice(-8) || '—'}</td>
                        <td className="px-2 py-1.5 text-slate-600">{l.field}</td>
                        <td className="px-2 py-1.5 text-slate-600 font-mono">{String(l.old)}</td>
                        <td className="px-2 py-1.5 text-slate-600 font-mono">{String(l.new)}</td>
                        <td className="px-2 py-1.5 text-slate-500 whitespace-nowrap">{formatDate(l.created_date)}</td>
                        <td className="px-2 py-1.5 text-slate-500">{l.actor}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}