import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function rollupProgress(id, tree, byId) {
  const children = tree[id] || [];
  if (children.length === 0) return byId[id]?.progress || 0;
  const childProgresses = children.map(c => ({ p: rollupProgress(c.id, tree, byId), w: c.weight || 1 }));
  const totalWeight = childProgresses.reduce((s, c) => s + c.w, 0);
  return Math.round(childProgresses.reduce((s, c) => s + c.p * c.w, 0) / (totalWeight || 1));
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();

    // Called from entity automation — get project_id from the changed WBS item
    const projectId = body?.data?.project_id;
    if (!projectId) {
      return Response.json({ skipped: true, reason: 'no project_id' });
    }

    // Fetch all WBS items for this project
    const items = await base44.asServiceRole.entities.WBSItem.filter({ project_id: projectId }, 'wbs_code', 500);
    if (items.length === 0) {
      return Response.json({ skipped: true, reason: 'no WBS items' });
    }

    // Build tree
    const byId = Object.fromEntries(items.map(i => [i.id, i]));
    const tree = {};
    items.forEach(i => {
      const pid = i.parent_id || '__root__';
      if (!tree[pid]) tree[pid] = [];
      tree[pid].push(i);
    });

    // Compute weighted rollup from roots
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

    return Response.json({ success: true, projectId, overallProgress });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});