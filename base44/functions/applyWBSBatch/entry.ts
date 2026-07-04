import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * applyWBSBatch
 *
 * Applies a coherent batch of WBS item and/or Milestone updates as a single unit
 * with manual rollback. Use for operations where partial failure would leave the
 * project inconsistent — WBS reparenting/renumbering (parent_id + wbs_code) and
 * schedule cascade moves (planned_start + planned_end, milestone planned_date).
 *
 * Purely additive bulk edits (e.g. setting a status on many rows) stay on the
 * client with allSettled reporting — this function is only for batches that must
 * land together or not at all.
 *
 * Auth: frontend callers authenticated via the user token (user-scoped writes, so
 *       project permissions / RLS apply the same as a direct client update).
 *
 * Input:  { wbs_updates: [{ id, ...fields }], milestone_updates: [{ id, ...fields }] }
 * Output: { success, wbs_applied, milestones_applied }  (500 with rollback on failure)
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    let user = null;
    try { user = await base44.auth.me(); } catch (_) { user = null; }
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    let body = {};
    try { body = await req.json(); } catch (_) { body = {}; }
    const wbs_updates = Array.isArray(body?.wbs_updates) ? body.wbs_updates : [];
    const milestone_updates = Array.isArray(body?.milestone_updates) ? body.milestone_updates : [];

    if (wbs_updates.length === 0 && milestone_updates.length === 0) {
      return Response.json({ success: true, wbs_applied: 0, milestones_applied: 0 });
    }
    const bad = [...wbs_updates, ...milestone_updates].find((u) => !u?.id);
    if (bad) return Response.json({ error: 'Each update must include an id.' }, { status: 400 });

    // Snapshot the current values of the fields being changed so we can roll back.
    const wbsOriginals = await Promise.all(wbs_updates.map((u) => base44.entities.WBSItem.get(u.id)));
    const msOriginals = await Promise.all(milestone_updates.map((u) => base44.entities.Milestone.get(u.id)));

    const revertPatches = (updates, originals) =>
      updates.map((u, i) => {
        const revert = { id: u.id };
        for (const k of Object.keys(u)) {
          if (k !== 'id') revert[k] = originals[i]?.[k];
        }
        return revert;
      });

    try {
      if (wbs_updates.length) await base44.entities.WBSItem.bulkUpdate(wbs_updates);
      if (milestone_updates.length) await base44.entities.Milestone.bulkUpdate(milestone_updates);
    } catch (e) {
      // Roll the changed fields back to their pre-batch values (best-effort).
      try {
        if (wbs_updates.length) await base44.entities.WBSItem.bulkUpdate(revertPatches(wbs_updates, wbsOriginals));
        if (milestone_updates.length) await base44.entities.Milestone.bulkUpdate(revertPatches(milestone_updates, msOriginals));
      } catch (_) { /* rollback is best-effort */ }
      return Response.json({
        error: 'Batch failed and was rolled back: ' + (e?.message || 'unknown error'),
      }, { status: 500 });
    }

    return Response.json({
      success: true,
      wbs_applied: wbs_updates.length,
      milestones_applied: milestone_updates.length,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});