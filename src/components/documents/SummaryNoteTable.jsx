/**
 * Renders a structured summary table stored on a Note (po_summary / dn_summary).
 * Used by TabNotes. Handles the new PODN shape (matched / applied_status /
 * ocr_uncertain) and falls back to the legacy row shape for older notes.
 */
function statusColor(s) {
  if (s === 'Ordered' || s === 'Received' || s === 'Delivered') return 'text-emerald-600 font-semibold';
  if (s === 'Partially Received' || s === 'Partially Delivered') return 'text-amber-600 font-semibold';
  if (s === 'Unmatched') return 'text-amber-700 font-semibold';
  return 'text-slate-400';
}

export default function SummaryNoteTable({ tableData }) {
  if (!tableData || !Array.isArray(tableData.rows)) return null;
  const { document_type, document_number, document_date, vendor_name, rows } = tableData;
  const isNewShape = rows.some(r => 'applied_status' in r || 'matched' in r);

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-3 py-1.5 bg-slate-50 text-xs text-slate-500 flex flex-wrap gap-3">
        {document_number && <span className="font-mono font-semibold text-slate-600">Ref: {document_number}</span>}
        {document_date && <span>· {document_date}</span>}
        {vendor_name && <span>· {vendor_name}</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          {isNewShape ? (
            <>
              <thead className="bg-slate-100 text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Part #</th>
                  <th className="px-3 py-2 text-left">Description</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-center">Matched</th>
                  <th className="px-3 py-2 text-left">Applied Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={`border-t border-slate-100 ${!r.matched ? 'bg-amber-50' : ''}`}>
                    <td className="px-3 py-1.5 font-mono text-slate-600">{r.part_number || '—'}</td>
                    <td className="px-3 py-1.5 text-slate-700 max-w-[280px] truncate" title={r.description}>{r.description || '—'}</td>
                    <td className="px-3 py-1.5 text-right">
                      <span className="inline-flex items-center gap-1 justify-end">
                        {r.qty ?? '—'}
                        {r.ocr_uncertain && <span className="px-1 py-0.5 rounded bg-amber-100 text-amber-700 text-[9px] font-semibold uppercase">verify</span>}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-center">{r.matched ? '✓' : '—'}</td>
                    <td className="px-3 py-1.5"><span className={statusColor(r.applied_status)}>{r.applied_status}</span></td>
                  </tr>
                ))}
              </tbody>
            </>
          ) : (
            <>
              <thead className="bg-slate-100 text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">BOM Item</th>
                  <th className="px-3 py-2 text-left">Part #</th>
                  {document_type === 'po' ? (
                    <>
                      <th className="px-3 py-2 text-right">Ordered Qty</th>
                      <th className="px-3 py-2 text-left">Action</th>
                    </>
                  ) : (
                    <>
                      <th className="px-3 py-2 text-right">Ordered</th>
                      <th className="px-3 py-2 text-right">This Slip</th>
                      <th className="px-3 py-2 text-right">Cumulative</th>
                      <th className="px-3 py-2 text-right">Remaining</th>
                      <th className="px-3 py-2 text-left">Status</th>
                    </>
                  )}
                  <th className="px-3 py-2 text-left">Source</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-3 py-1.5 text-slate-700">{r.bom_description || '—'}</td>
                    <td className="px-3 py-1.5 font-mono text-slate-500">{r.part_number || '—'}</td>
                    {document_type === 'po' ? (
                      <>
                        <td className="px-3 py-1.5 text-right">{r.ordered_qty ?? '—'}</td>
                        <td className="px-3 py-1.5"><span className={statusColor(r.action)}>{r.action}</span></td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-1.5 text-right">{r.ordered_qty ?? '—'}</td>
                        <td className="px-3 py-1.5 text-right">{r.delivered_this_slip ?? '—'}</td>
                        <td className="px-3 py-1.5 text-right">{r.cumulative_delivered ?? '—'}</td>
                        <td className="px-3 py-1.5 text-right">{r.remaining ?? '—'}</td>
                        <td className="px-3 py-1.5"><span className={statusColor(r.action)}>{r.action}</span></td>
                      </>
                    )}
                    <td className="px-3 py-1.5 font-mono text-slate-500">
                      {r.source_ref || '—'} <span className="text-slate-400">{r.source_date || ''}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </>
          )}
        </table>
      </div>
    </div>
  );
}