import { Plus, Trash2 } from 'lucide-react';

/**
 * Editable version of SummaryNoteTable — lets the user modify cell values,
 * add/remove rows, and edit the document header metadata for a po_summary /
 * dn_summary note. Mirrors the column layout of SummaryNoteTable for both the
 * new (matched / applied_status) and legacy (ordered / this slip / …) shapes.
 *
 * Parent owns the data: changes bubble up via onChange(updatedTableData).
 */
function statusColor(s) {
  if (s === 'Ordered' || s === 'Received' || s === 'Delivered') return 'text-emerald-600 font-semibold';
  if (s === 'Partially Received' || s === 'Partially Delivered') return 'text-amber-600 font-semibold';
  if (s === 'Unmatched') return 'text-amber-700 font-semibold';
  return 'text-slate-400';
}

function Cell({ value, onCommit, numeric = false, mono = false, className = '' }) {
  return (
    <input
      type={numeric ? 'number' : 'text'}
      value={value == null ? '' : value}
      onChange={(e) => {
        const v = e.target.value;
        onCommit(numeric ? (v === '' ? null : Number(v)) : v);
      }}
      className={`w-full bg-transparent border border-transparent hover:border-slate-200 focus:border-amber-400 rounded px-2 py-1 text-xs focus:outline-none ${mono ? 'font-mono text-slate-600' : 'text-slate-700'} ${className}`}
    />
  );
}

function blankRow(isNewShape, isPo) {
  if (isNewShape) return { part_number: '', description: '', qty: null, matched: false, applied_status: '', ocr_uncertain: false };
  if (isPo) return { bom_description: '', part_number: '', ordered_qty: null, action: '', source_ref: '', source_date: '' };
  return { bom_description: '', part_number: '', ordered_qty: null, delivered_this_slip: null, cumulative_delivered: null, remaining: null, action: '', source_ref: '', source_date: '' };
}

export default function EditableSummaryNoteTable({ tableData, onChange }) {
  if (!tableData || !Array.isArray(tableData.rows)) return null;

  const td = { ...tableData };
  const rows = [...(td.rows || [])];
  const isNewShape = rows.some((r) => 'applied_status' in r || 'matched' in r);
  const isPo = td.document_type === 'po';

  function patchTd(next) {
    onChange({ ...td, ...next });
  }
  function updateRow(i, patch) {
    const next = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    patchTd({ rows: next });
  }
  function addRow() {
    patchTd({ rows: [...rows, blankRow(isNewShape, isPo)] });
  }
  function removeRow(i) {
    patchTd({ rows: rows.filter((_, idx) => idx !== i) });
  }

  const th = 'px-3 py-2 text-left font-medium text-slate-500';
  const tdCls = 'px-3 py-1.5 border-t border-slate-100';

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-3 py-1.5 bg-slate-50 text-xs text-slate-500 flex flex-wrap gap-3 items-center">
        <span className="font-semibold text-slate-600">Ref:</span>
        <input
          value={td.document_number || ''}
          onChange={(e) => patchTd({ document_number: e.target.value })}
          className="font-mono bg-transparent border border-transparent hover:border-slate-200 focus:border-amber-400 rounded px-1.5 py-0.5 text-xs focus:outline-none text-slate-600"
          placeholder="Doc #"
        />
        <input
          value={td.document_date || ''}
          onChange={(e) => patchTd({ document_date: e.target.value })}
          className="bg-transparent border border-transparent hover:border-slate-200 focus:border-amber-400 rounded px-1.5 py-0.5 text-xs focus:outline-none"
          placeholder="Date"
        />
        <input
          value={td.vendor_name || ''}
          onChange={(e) => patchTd({ vendor_name: e.target.value })}
          className="bg-transparent border border-transparent hover:border-slate-200 focus:border-amber-400 rounded px-1.5 py-0.5 text-xs focus:outline-none"
          placeholder="Vendor"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          {isNewShape ? (
            <>
              <thead className="bg-slate-100 text-slate-500">
                <tr>
                  <th className={th}>Part #</th>
                  <th className={th}>Description</th>
                  <th className="px-3 py-2 text-right font-medium text-slate-500">Qty</th>
                  <th className="px-3 py-2 text-center font-medium text-slate-500">Matched</th>
                  <th className={th}>Applied Status</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={`border-t border-slate-100 ${!r.matched ? 'bg-amber-50/50' : ''}`}>
                    <td className={tdCls}><Cell value={r.part_number} onCommit={(v) => updateRow(i, { part_number: v })} mono /></td>
                    <td className={`${tdCls} max-w-[280px]`}><Cell value={r.description} onCommit={(v) => updateRow(i, { description: v })} /></td>
                    <td className={`${tdCls} text-right`}><Cell value={r.qty} onCommit={(v) => updateRow(i, { qty: v })} numeric className="text-right" /></td>
                    <td className={`${tdCls} text-center`}>
                      <input type="checkbox" checked={!!r.matched} onChange={(e) => updateRow(i, { matched: e.target.checked })} className="accent-amber-500" />
                    </td>
                    <td className={tdCls}>
                      <Cell value={r.applied_status} onCommit={(v) => updateRow(i, { applied_status: v })} className={statusColor(r.applied_status)} />
                    </td>
                    <td className="px-1 text-center">
                      <button onClick={() => removeRow(i)} className="p-1 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 className="w-3.5 h-3.5" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </>
          ) : (
            <>
              <thead className="bg-slate-100 text-slate-500">
                <tr>
                  <th className={th}>BOM Item</th>
                  <th className={th}>Part #</th>
                  {isPo ? (
                    <>
                      <th className="px-3 py-2 text-right font-medium text-slate-500">Ordered Qty</th>
                      <th className={th}>Action</th>
                    </>
                  ) : (
                    <>
                      <th className="px-3 py-2 text-right font-medium text-slate-500">Ordered</th>
                      <th className="px-3 py-2 text-right font-medium text-slate-500">This Slip</th>
                      <th className="px-3 py-2 text-right font-medium text-slate-500">Cumulative</th>
                      <th className="px-3 py-2 text-right font-medium text-slate-500">Remaining</th>
                      <th className={th}>Status</th>
                    </>
                  )}
                  <th className={th}>Source Ref</th>
                  <th className={th}>Source Date</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className={tdCls}><Cell value={r.bom_description} onCommit={(v) => updateRow(i, { bom_description: v })} /></td>
                    <td className={tdCls}><Cell value={r.part_number} onCommit={(v) => updateRow(i, { part_number: v })} mono /></td>
                    {isPo ? (
                      <>
                        <td className={`${tdCls} text-right`}><Cell value={r.ordered_qty} onCommit={(v) => updateRow(i, { ordered_qty: v })} numeric className="text-right" /></td>
                        <td className={tdCls}><Cell value={r.action} onCommit={(v) => updateRow(i, { action: v })} className={statusColor(r.action)} /></td>
                      </>
                    ) : (
                      <>
                        <td className={`${tdCls} text-right`}><Cell value={r.ordered_qty} onCommit={(v) => updateRow(i, { ordered_qty: v })} numeric className="text-right" /></td>
                        <td className={`${tdCls} text-right`}><Cell value={r.delivered_this_slip} onCommit={(v) => updateRow(i, { delivered_this_slip: v })} numeric className="text-right" /></td>
                        <td className={`${tdCls} text-right`}><Cell value={r.cumulative_delivered} onCommit={(v) => updateRow(i, { cumulative_delivered: v })} numeric className="text-right" /></td>
                        <td className={`${tdCls} text-right`}><Cell value={r.remaining} onCommit={(v) => updateRow(i, { remaining: v })} numeric className="text-right" /></td>
                        <td className={tdCls}><Cell value={r.action} onCommit={(v) => updateRow(i, { action: v })} className={statusColor(r.action)} /></td>
                      </>
                    )}
                    <td className={tdCls}><Cell value={r.source_ref} onCommit={(v) => updateRow(i, { source_ref: v })} mono /></td>
                    <td className={tdCls}><Cell value={r.source_date} onCommit={(v) => updateRow(i, { source_date: v })} /></td>
                    <td className="px-1 text-center">
                      <button onClick={() => removeRow(i)} className="p-1 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 className="w-3.5 h-3.5" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </>
          )}
        </table>
      </div>

      <div className="px-3 py-2 bg-slate-50 border-t border-slate-100">
        <button onClick={addRow} className="inline-flex items-center gap-1 text-xs text-amber-700 hover:text-amber-800 font-medium">
          <Plus className="w-3.5 h-3.5" /> Add row
        </button>
      </div>
    </div>
  );
}