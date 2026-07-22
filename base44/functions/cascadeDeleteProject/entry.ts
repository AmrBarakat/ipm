import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// Entities that carry a project_id and should be purged when a project is deleted.
// Messages are linked by conversation_id (no project_id), so they are not listed;
// deleting their parent Conversations removes them from view.
const CHILD_ENTITIES = [
  'Task', 'Milestone', 'WBSItem', 'BOMItem', 'Invoice', 'Expense', 'Collection',
  'Deliverable', 'Document', 'Note', 'Risk', 'ChangeOrder', 'PurchaseOrder',
  'Baseline', 'AuditLog', 'Conversation',
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Authenticate: either the platform automation (AUTOMATION_SECRET) or an admin user.
    const secret = Deno.env.get('AUTOMATION_SECRET');
    const provided = new URL(req.url).searchParams.get('secret') || req.headers.get('x-automation-secret');
    const isAutomation = !!(secret && provided && provided === secret);

    let body = null;
    try { body = await req.json(); } catch (_) { body = null; }

    // Entity-delete automation payload: { event: { entity_name, entity_id }, data }
    const projectId = body?.event?.entity_id || body?.project_id || body?.data?.id || null;

    if (!isAutomation) {
      const user = await base44.auth.me().catch(() => null);
      if (!user || user.role !== 'admin') return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!projectId) return Response.json({ error: 'project_id required' }, { status: 400 });

    // Service role bypasses RLS so child records are removed regardless of who owned them.
    const results = {};
    for (const name of CHILD_ENTITIES) {
      try {
        await base44.asServiceRole.entities[name].deleteMany({ project_id: projectId });
        results[name] = 'ok';
      } catch (e) {
        results[name] = 'error: ' + (e?.message || String(e));
      }
    }
    return Response.json({ project_id: projectId, purged: CHILD_ENTITIES.length, results });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});