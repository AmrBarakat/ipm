/**
 * revertCharterBaseline — the REVERT step for the charter review flow.
 *
 * Reads created_entity_refs[] from the completed Extraction and undoes each:
 *   - BaselineLine "created": deleted.
 *   - CharterBaseline "updated": set to "superseded" (NOT restored to draft —
 *     a reverted baseline is retired, not re-opened).
 *   - Project "updated": active_charter_baseline_id cleared if it pointed at
 *     this baseline; the stored "before" snapshot is restored otherwise.
 *
 * Then marks the Extraction status "reverted" with reverted_at.
 *
 * Output: { extraction_id, reverted: [...], skipped: [...] }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { requirePrivilege } from '../../shared/requirePrivilege.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    let user = null;
    try { user = await base44.auth.me(); } catch (_) { user = null; }
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const denied = requirePrivilege(user, 'modify');
    if (denied) return denied;

    const body = await req.json();
    const { extraction_id } = body;
    if (!extraction_id)
      return Response.json({ error: 'extraction_id is required' }, { status: 400 });

    const actor = user?.full_name || user?.email || 'system';
    const now = new Date().toISOString();

    const extraction = await base44.asServiceRole.entities.Extraction.get(extraction_id);
    if (!extraction) return Response.json({ error: 'Extraction not found' }, { status: 404 });
    if (extraction.status !== 'completed')
      return Response.json({ error: 'Only completed extractions can be reverted' }, { status: 400 });

    const refs = Array.isArray(extraction.created_entity_refs) ? extraction.created_entity_refs : [];
    const projectId = extraction.project_id;
    const reverted = [];
    const skipped = [];

    // Find the baseline id so we can check Project.active_charter_baseline_id
    const baselineRef = refs.find(r => r.entity_type === 'CharterBaseline');
    const baseline_id = baselineRef?.entity_id || null;

    // Reverse order — undo the last write first (Project → CharterBaseline → BaselineLines).
    for (let i = refs.length - 1; i >= 0; i--) {
      const ref = refs[i];
      const type = ref.entity_type;
      const id = ref.entity_id;
      const action = ref.action;

      if (type === 'BaselineLine' && action === 'created') {
        try {
          await base44.asServiceRole.entities.BaselineLine.delete(id);
          reverted.push({ entity_type: type, entity_id: id, action: 'deleted' });
        } catch (e) {
          skipped.push({ entity_type: type, entity_id: id, reason: e?.message || 'Failed to delete' });
        }
      } else if (type === 'CharterBaseline' && action === 'updated') {
        // Set to "superseded" — a reverted baseline is retired, not re-opened.
        try {
          await base44.asServiceRole.entities.CharterBaseline.update(id, { status: 'superseded' });
          reverted.push({ entity_type: type, entity_id: id, action: 'superseded' });
        } catch (e) {
          skipped.push({ entity_type: type, entity_id: id, reason: e?.message || 'Failed to supersede' });
        }
      } else if (type === 'Project' && action === 'updated') {
        // Restore the before snapshot for active_charter_baseline_id.
        // Clear it if it pointed at this baseline; otherwise restore the old value.
        try {
          const project = await base44.asServiceRole.entities.Project.get(id);
          const before = ref.before || {};
          const currentActive = project?.active_charter_baseline_id || '';
          const restoreVal = (currentActive === baseline_id) ? (before.active_charter_baseline_id || '') : currentActive;
          await base44.asServiceRole.entities.Project.update(id, { active_charter_baseline_id: restoreVal });
          reverted.push({ entity_type: type, entity_id: id, action: 'restored' });
        } catch (e) {
          skipped.push({ entity_type: type, entity_id: id, reason: e?.message || 'Failed to restore' });
        }
      }
    }

    await base44.asServiceRole.entities.Extraction.update(extraction_id, {
      status: 'reverted', reverted_at: now,
    });

    // AuditLog
    try {
      await base44.asServiceRole.entities.AuditLog.create({
        project_id: projectId,
        entity_type: 'CharterBaseline',
        entity_id: baseline_id || '',
        action: 'updated',
        actor,
        summary: `Charter baseline reverted — extraction ${extraction_id} set to superseded`,
        metadata: { extraction_id, reverted_count: reverted.length, skipped_count: skipped.length },
      });
    } catch (_) {}

    return Response.json({ extraction_id, reverted, skipped });
  } catch (error) {
    return Response.json({ error: error.message || 'Revert failed' }, { status: 500 });
  }
});