/**
 * applyPODNLine — manual assignment of an unmatched PO/DN line to a BOM item.
 *
 * Called from the PODNExtractionPanel when the user picks a BOM row for a line
 * the auto-match missed. Reads the summary note to get the document metadata
 * and the line's qty, applies the same update rules as extractPODN (shared
 * podnApply.applyLine), writes an AuditLog, and patches the note's table_data
 * row to matched.
 *
 * Input:  { note_id, row_index, bom_item_id }
 * Output: { row }  (the patched row)
 *
 * Auth: 401 if not logged in.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { applyLine } from '../../shared/podnApply.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    let user = null;
    try { user = await base44.auth.me(); } catch (_) { user = null; }
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { note_id, row_index, bom_item_id } = await req.json();
    if (!note_id || bom_item_id == null || row_index == null)
      return Response.json({ error: 'note_id, row_index, and bom_item_id are required' }, { status: 400 });

    const note = await base44.asServiceRole.entities.Note.get(note_id);
    if (!note) return Response.json({ error: 'Summary note not found' }, { status: 404 });
    const td = note.table_data || {};
    const rows = Array.isArray(td.rows) ? td.rows : [];
    const row = rows[row_index];
    if (!row) return Response.json({ error: 'Row index out of range' }, { status: 400 });

    const bom = await base44.asServiceRole.entities.BOMItem.get(bom_item_id);
    if (!bom) return Response.json({ error: 'BOM item not found' }, { status: 404 });

    const actor = user?.full_name || user?.email || 'system';
    const res = await applyLine({
      base44,
      bom,
      document_type: td.document_type,
      document_number: td.document_number,
      document_date: td.document_date,
      qty: row.qty,
      actor,
      project_id: note.project_id,
    });

    // Patch the note row in place.
    rows[row_index] = {
      ...row,
      matched: true,
      bom_item_id: res.bom_item_id,
      applied_status: res.applied_status,
    };
    await base44.asServiceRole.entities.Note.update(note_id, { table_data: { ...td, rows } });

    return Response.json({ row: rows[row_index] });
  } catch (error) {
    return Response.json({ error: error?.message || 'Assignment failed' }, { status: 500 });
  }
});