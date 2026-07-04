/**
 * Renders a structured summary table stored on a Note (po_summary / dn_summary).
 * Used by TabNotes for notes whose note_type !== 'plain'.
 */
function actionColor(action) {
  if (action === 'Ordered') return 'text-blue-600 font-semibold';
  if (action === 'Delivered') return 'text-emerald-600 font-semibold';
  if (action === 'Partially Delivered') return 'text-amber-600 font-semibold';
  return 'text-slate-400';
}

export default function SummaryNoteTable({ tableData }) {
  if (!tableData || !Array.isArray(tableData.rows)) return null;
  const { document_number, document_date, rows } = tableData;

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-3 py-1.5 bg-slate-50 text-xs text-slate-500 flex flex-wrap gap-3">
        {document_number && <span className="font-mono font-semibold text-slate-600">Ref: {document_number}</span>}
        {document_date && <span>· {document_date}</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-100 text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">BOM Item</th>
              <th className="px-3 py-2 text-left">Part #</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-left">Action</th>
              <th className="px-3 py-2 text-left">Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="px-3 py-1.5 text-slate-700">{r.bom_description || '—'}</td>
                <td className="px-3 py-1.5 font-mono text-slate-500">{r.part_number || '—'}</td>
                <td className="px-3 py-1.5 text-right">{r.quantity ?? '—'}</td>
                <td className="px-3 py-1.5">
                  <span className={actionColor(r.action)}>{r.action}</span>
                </td>
                <td className="px-3 py-1.5 font-mono text-slate-500">
                  {r.source_ref || '—'} <span className="text-slate-400">{r.source_date || ''}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}