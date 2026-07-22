import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// Central activity logger. Two invocation shapes:
//   1. Entity automation: { event: { type, entity_name, entity_id }, data, old_data, changed_fields, payload_too_large }
//      → derives action + human summary from the event and writes one AuditLog row.
//   2. Direct client call: { entity_type, entity_id, action, summary, project_id, metadata }
//      → writes the row verbatim (used by the frontend to log report/PDF/Excel exports).
// Both run as service role (AuditLog is system bookkeeping) and are fire-and-forget
// from the caller's perspective — failures never break the triggering action.

const VERB = { create: 'created', update: 'updated', delete: 'deleted' };

function pickName(d) {
  return d?.title || d?.name || d?.description || d?.po_number || d?.invoice_number || '';
}

function summarize(entityName, eventType, data, oldData, changedFields) {
  const d = data || {};
  switch (entityName) {
    case 'Task':
      if (eventType === 'update' && changedFields?.includes('status') && d.status === 'done') {
        return { action: 'completed', summary: `Task "${d.title || '—'}" marked complete.` };
      }
      if (eventType === 'update') {
        return { action: 'updated', summary: `Task "${d.title || '—'}" updated.` };
      }
      return { action: 'created', summary: `New task "${d.title || '—'}" added.` };
    case 'Expense':
      return {
        action: 'created',
        summary: `Expense logged: ${d.description || '—'}${d.planned_amount ? ` · ${d.planned_amount} ${d.category || ''}`.trim() : ''}.`,
      };
    case 'PurchaseOrder':
      return {
        action: 'created',
        summary: `Purchase order ${d.po_number || 'draft'} created${d.vendor_name ? ` for ${d.vendor_name}` : ''}.`,
      };
    case 'Milestone':
      return { action: 'created', summary: `Milestone "${d.title || '—'}" added.` };
    case 'ChangeOrder':
      return { action: 'created', summary: `Change order "${d.title || '—'}" submitted.` };
    case 'BOMItem':
      return { action: 'created', summary: `BOM item added: ${d.description || '—'}${d.quantity ? ` (Qty ${d.quantity})` : ''}.` };
    case 'Invoice':
      return { action: 'created', summary: `Invoice ${d.invoice_number || d.description || '—'} created.` };
    case 'Risk':
      return { action: 'created', summary: `Risk flagged: ${d.title || '—'}.` };
    default: {
      const name = pickName(eventType === 'delete' ? oldData : d);
      return { action: VERB[eventType] || 'updated', summary: `${entityName} ${VERB[eventType] || 'updated'}${name ? `: ${name}` : ''}.` };
    }
  }
}

Deno.serve(async (req) => {
  try {
    const secret = req.headers.get('x-automation-secret');
    const isAutomation = !!secret && secret === Deno.env.get('AUTOMATION_SECRET');
    const base44 = createClientFromRequest(req);

    let actor = 'system';
    if (!isAutomation) {
      const user = await base44.auth.me().catch(() => null);
      if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
      actor = user.email || user.full_name || 'user';
    }

    const body = await req.json().catch(() => ({}));

    // ── Entity-automation payload ──────────────────────────────────────────
    if (body?.event?.type && body?.event?.entity_name) {
      const { type, entity_name, entity_id } = body.event;
      let data = body.data || null;
      const oldData = body.old_data || null;
      const changedFields = body.changed_fields || [];

      if (body.payload_too_large && entity_id) {
        try { data = await base44.asServiceRole.entities[entity_name]?.get?.(entity_id); } catch (_) {}
      }

      const projectId = data?.project_id || oldData?.project_id || '';
      const { action, summary } = summarize(entity_name, type, data, oldData, changedFields);

      await base44.asServiceRole.entities.AuditLog.create({
        project_id: projectId,
        entity_type: entity_name,
        entity_id: entity_id || '',
        action,
        actor,
        summary,
        metadata: { event_type: type, changed_fields: changedFields },
      });
      return Response.json({ logged: true });
    }

    // ── Direct client call (report generation, etc.) ───────────────────────
    const { entity_type, entity_id, action, summary, project_id, metadata } = body || {};
    if (!entity_type || !summary) return Response.json({ skipped: true, reason: 'missing entity_type/summary' });

    await base44.asServiceRole.entities.AuditLog.create({
      project_id: project_id || '',
      entity_type,
      entity_id: entity_id || '',
      action: action || 'updated',
      actor,
      summary,
      metadata: metadata || null,
    });
    return Response.json({ logged: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});