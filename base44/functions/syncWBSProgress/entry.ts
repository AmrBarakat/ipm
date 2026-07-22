import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { requirePrivilege } from '../../shared/requirePrivilege.ts';

// Business timezone — Saudi Arabia (UTC+3). Milestone completed_date is stamped
// in Asia/Riyadh so a completion late in the local day lands on today, not
// yesterday (UTC). Matches checkMilestoneCompletion's tz helper.
const BUSINESS_TZ = 'Asia/Riyadh';
function tzDateStr(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: BUSINESS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value || '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function rollupProgress(id, tree, byId) {
  const children = tree[id] || [];
  if (children.length === 0) return byId[id]?.progress || 0;
  const childProgresses = children.map(c => ({ p: rollupProgress(c.id, tree, byId), w: c.weight || 1 }));
  const totalWeight = childProgresses.reduce((s, c) => s + c.w, 0);
  return Math.round(childProgresses.reduce((s, c) => s + c.p * c.w, 0) / (totalWeight || 1));
}

Deno.serve(async (req) => {
  try {
    // Keep the automation-secret auth for entity/scheduled automations, but
    // ALSO accept authenticated user calls so the Gantt / WBS tabs can invoke
    // the rollup directly after edits (the frontend SDK sends the user token,
    // not the automation secret).
    const secret = req.headers.get('x-automation-secret');
    const isAutomation = !!secret && secret === Deno.env.get('AUTOMATION_SECRET');
    const base44 = createClientFromRequest(req);
    if (!isAutomation) {
      const user = await base44.auth.me().catch(() => null);
      const denied = requirePrivilege(user, 'modify');
      if (denied) return denied;
    }

    const body = await req.json().catch(() => ({}));
    // Support both: direct call { project_id } and entity automation { data: { project_id } }
    const projectId = body?.project_id || body?.data?.project_id;
    if (!projectId) {
      return Response.json({ skipped: true, reason: 'no project_id' });
    }

    // Fetch all WBS items for this project
    const items = await base44.asServiceRole.entities.WBSItem.filter({ project_id: projectId }, 'wbs_code', 2000);
    if (items.length === 0) {
      return Response.json({ skipped: true, reason: 'no WBS items' });
    }

    // ── 1. PROJECT PROGRESS: weighted tree rollup (unchanged) ───────────────
    const byId = Object.fromEntries(items.map(i => [i.id, i]));
    const tree = {};
    items.forEach(i => { const pid = i.parent_id || '__root__'; (tree[pid] ||= []).push(i); });
    const roots = tree['__root__'] || [];
    if (roots.length === 0) {
      return Response.json({ skipped: true, reason: 'no root items' });
    }

    const rootProgresses = roots.map(r => ({ p: rollupProgress(r.id, tree, byId), w: r.weight || 1 }));
    const totalWeight = rootProgresses.reduce((s, r) => s + r.w, 0);
    const overallProgress = Math.round(
      rootProgresses.reduce((s, r) => s + r.p * r.w, 0) / (totalWeight || 1)
    );

    await base44.asServiceRole.entities.Project.update(projectId, { progress: overallProgress });
    await base44.asServiceRole.entities.AuditLog.create({
      project_id: projectId,
      entity_type: 'Project',
      entity_id: projectId,
      action: 'progress_synced',
      actor: 'system',
      summary: `Project progress synced to ${overallProgress}% from WBS rollup.`,
      metadata: { overallProgress, wbs_item_count: items.length },
    });

    // ── 2. MILESTONE ROLLUP (WBS-driven milestones only) ───────────────────
    // Per-item rolled-up progress (full subtree) so a milestone reflects the
    // complete subtree under each linked item, not just a leaf's manual value.
    const itemProgress = {};
    items.forEach(i => { itemProgress[i.id] = rollupProgress(i.id, tree, byId); });

    // Group WBS items by their linked milestone_id.
    const linkedByMs = {};
    items.forEach(i => { if (i.milestone_id) (linkedByMs[i.milestone_id] ||= []).push(i); });

    const milestones = await base44.asServiceRole.entities.Milestone.filter({ project_id: projectId }, 'planned_date', 1000);
    const today = tzDateStr();
    const msResults = [];

    for (const ms of milestones) {
      const linked = linkedByMs[ms.id];
      // Milestones with no WBS links are left to checkMilestoneCompletion
      // (task-driven) — never zero them out here.
      if (!linked || linked.length === 0) continue;

      // progress = weighted average of linked items' rolled-up progress.
      const wTotal = linked.reduce((s, i) => s + (i.weight || 1), 0);
      const msProgress = Math.round(
        linked.reduce((s, i) => s + itemProgress[i.id] * (i.weight || 1), 0) / (wTotal || 1)
      );

      // planned_date = MAX(planned_end) across linked items (milestone is
      // reached when its last contributing activity finishes). derived_start
      // = MIN(planned_start) for display. Leave planned_date unchanged when no
      // linked item has a planned_end.
      const ends = linked.map(i => i.planned_end).filter(Boolean).sort();
      const starts = linked.map(i => i.planned_start).filter(Boolean).sort();
      const newPlannedDate = ends.length ? ends[ends.length - 1] : null;
      const newDerivedStart = starts.length ? starts[0] : null;

      // Status: never downgrade a milestone already marked completed.
      const wasCompleted = ms.status === 'completed';
      let newStatus = ms.status || 'pending';
      if (msProgress >= 100) {
        newStatus = 'completed';
      } else if (msProgress > 0) {
        newStatus = wasCompleted ? 'completed' : 'in_progress';
      } else {
        if (wasCompleted) {
          newStatus = 'completed';
        } else if (ms.planned_date && ms.planned_date < today) {
          newStatus = 'overdue';
        } else {
          newStatus = 'pending';
        }
      }

      // Only write fields that actually changed (avoid churn).
      const patch = {};
      if ((ms.progress || 0) !== msProgress) patch.progress = msProgress;
      if (newPlannedDate && ms.planned_date !== newPlannedDate) patch.planned_date = newPlannedDate;
      if ((newDerivedStart || null) !== (ms.derived_start ?? null)) patch.derived_start = newDerivedStart;
      if (newStatus !== ms.status) patch.status = newStatus;
      if (newStatus === 'completed' && !wasCompleted) patch.completed_date = today;

      if (Object.keys(patch).length === 0) continue;

      await base44.asServiceRole.entities.Milestone.update(ms.id, patch);

      // One audit entry per milestone whose progress OR status changed.
      if (patch.progress !== undefined || patch.status !== undefined) {
        await base44.asServiceRole.entities.AuditLog.create({
          project_id: projectId,
          entity_type: 'Milestone',
          entity_id: ms.id,
          action: 'progress_synced',
          actor: 'system',
          summary: `Milestone "${ms.title}" synced from WBS (${linked.length} linked item${linked.length === 1 ? '' : 's'}): progress ${ms.progress || 0}% → ${msProgress}%, status ${ms.status} → ${newStatus}.`,
          metadata: {
            before: { progress: ms.progress || 0, status: ms.status },
            after: { progress: msProgress, status: newStatus },
            linked_items: linked.length,
          },
        });
      }
      msResults.push({ id: ms.id, title: ms.title, ...patch });
    }

    return Response.json({ success: true, projectId, overallProgress, milestones: msResults });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});