/**
 * revertPODNExtraction — R9 REVERT. Reads created_entity_refs[] in reverse order
 * and, for each:
 *   - action "created": deletes the entity (Vendor / PurchaseOrder / Expense),
 *     EXCEPT Note which is marked "[REVERTED …]" rather than deleted (per the
 *     summary-note acceptance rule).
 *   - action "updated": restores the stored "before" snapshot — but ONLY if the
 *     entity's current updated_date still equals the stored applied_updated_date.
 *     If it differs, the entity was hand-edited after the apply and is listed as
 *     skipped (never silently overwritten).
 *
 * Writes an AuditLog per reverted entity, then marks the Extraction status
 * "reverted" with reverted_at so it can be corrected and re-applied.
 *
 * Output: { extraction_id, reverted: [{entity_type,entity_id,action}], skipped: [{entity_type,entity_id,reason}] }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { requirePrivilege } from '../../shared/requirePrivilege.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    let user: any = null;
    try { user = await base44.auth.me(); } catch (_) { user = null; }
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const denied = requirePrivilege(user, 'modify');
    if (denied) return denied;

    const body = await req.json();
    const { extraction_id } = body;
    if (!extraction_id)
      return Response.json({ error: 'extraction_id is required' }, { status: 400 });

    const extraction: any = await base44.asServiceRole.entities.Extraction.get(extraction_id);
    if (!extraction) return Response.json({ error: 'Extraction not found' }, { status: 404 });
    if (extraction.status !== 'completed')
      return Response.json({ error: 'Only completed extractions can be reverted' }, { status: 400 });

    const refs: any[] = Array.isArray(extraction.created_entity_refs) ? extraction.created_entity_refs : [];
    const actor = user?.full_name || user?.email || 'system';
    const now = new Date().toISOString();
    const projectId = extraction.project_id;
    const reverted: any[] = [];
    const skipped: any[] = [];

    const audit = async (type: string, id: string, summary: string) => {
      try {
        await base44.asServiceRole.entities.AuditLog.create({
          project_id: projectId, entity_type: type, entity_id: id,
          action: 'updated', actor, summary,
        });
      } catch (_) {}
    };

    // Reverse order — undo the last write first (Note → Expense → BOMs → PO → Vendor).
    for (let i = refs.length - 1; i >= 0; i--) {
      const ref = refs[i];
      const type: string = ref.entity_type;
      const id: string = ref.entity_id;
      const action: string = ref.action;
      const api: any = (base44.asServiceRole.entities as any)[type];
      if (!api) {
        skipped.push({ entity_type: type, entity_id: id, reason: `Unknown entity type "${type}" — skipped` });
        continue;
      }

      if (action === 'created') {
        if (type === 'Note') {
          // Summary note: mark reverted, keep it for audit (do not delete).
          try {
            const note: any = await api.get(id);
            if (!note) { skipped.push({ entity_type: type, entity_id: id, reason: 'Note no longer exists' }); continue; }
            if (!String(note.body || '').startsWith('[REVERTED')) {
              const stamp = `[REVERTED — extraction reverted on ${now.slice(0, 10)}] `;
              await api.update(id, { body: stamp + (note.body || '') });
            }
            await audit(type, id, `Reverted extraction ${extraction_id}: marked summary note reverted`);
            reverted.push({ entity_type: type, entity_id: id, action: 'marked_reverted' });
          } catch (e: any) {
            skipped.push({ entity_type: type, entity_id: id, reason: e?.message || 'Failed to mark note reverted' });
          }
        } else {
          try {
            await api.delete(id);
            await audit(type, id, `Reverted extraction ${extraction_id}: deleted ${type}`);
            reverted.push({ entity_type: type, entity_id: id, action: 'deleted' });
          } catch (e: any) {
            skipped.push({ entity_type: type, entity_id: id, reason: e?.message || 'Failed to delete' });
          }
        }
      } else if (action === 'updated') {
        try {
          const current: any = await api.get(id);
          if (!current) { skipped.push({ entity_type: type, entity_id: id, reason: `${type} ${id} no longer exists` }); continue; }
          // Safety: never restore an entity hand-edited since the apply.
          // Safety: never restore an entity hand-edited since the apply. Compare
          // at millisecond precision with a small tolerance — the update()
          // response carries microsecond precision while the stored value is
          // millisecond, so a naive !== check would always skip. A real hand-edit
          // always moves updated_date by > 100ms.
          if (ref.applied_updated_date && current.updated_date) {
            const curMs = new Date(current.updated_date).getTime();
            const refMs = new Date(ref.applied_updated_date).getTime();
            if (!isNaN(curMs) && !isNaN(refMs) && Math.abs(curMs - refMs) > 100) {
              skipped.push({
                entity_type: type, entity_id: id,
                reason: `${type} ${id} was edited by hand after the apply (updated_date changed) — left untouched`,
              });
              continue;
            }
          }
          const before = ref.before || {};
          await api.update(id, before);
          await audit(type, id, `Reverted extraction ${extraction_id}: restored ${type} to pre-apply values`);
          reverted.push({ entity_type: type, entity_id: id, action: 'restored' });
        } catch (e: any) {
          skipped.push({ entity_type: type, entity_id: id, reason: e?.message || 'Failed to restore' });
        }
      }
    }

    await base44.asServiceRole.entities.Extraction.update(extraction_id, {
      status: 'reverted', reverted_at: now,
    });

    return Response.json({ extraction_id, reverted, skipped });
  } catch (error) {
    return Response.json({ error: (error as any)?.message || 'Revert failed' }, { status: 500 });
  }
});