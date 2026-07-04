import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const secret = req.headers.get('x-automation-secret');
  if (!secret || secret !== Deno.env.get('AUTOMATION_SECRET')) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const base44 = createClientFromRequest(req);

  const body = await req.json();
  // Support both direct calls and automation payloads
  const project_id = body.project_id || body.data?.project_id;

  if (!project_id) {
    return Response.json({ message: 'No project_id provided.' });
  }

  // Get all tasks and milestones for the project
  const [tasks, milestones] = await Promise.all([
    base44.asServiceRole.entities.Task.filter({ project_id }),
    base44.asServiceRole.entities.Milestone.filter({ project_id }),
  ]);

  const pendingMilestones = milestones.filter(m => m.status !== 'completed');
  if (pendingMilestones.length === 0) {
    return Response.json({ message: 'No pending milestones to check.' });
  }

  const completed = [];

  for (const milestone of pendingMilestones) {
    // Find tasks linked to this milestone via milestone_id field
    const milestoneTasks = tasks.filter(t => t.milestone_id === milestone.id);

    if (milestoneTasks.length === 0) continue; // no tasks linked, skip

    const allDone = milestoneTasks.every(t => t.status === 'done');
    if (!allDone) continue;

    // All tasks done — mark milestone as completed
    const today = new Date().toISOString().slice(0, 10);
    await base44.asServiceRole.entities.Milestone.update(milestone.id, {
      status: 'completed',
      completed_date: today,
      progress: 100,
    });

    // Fetch project details for the notification
    const projects = await base44.asServiceRole.entities.Project.filter({ id: project_id });
    const projectCode = projects[0]?.code || project_id;

    await base44.asServiceRole.entities.Notification.create({
      project_id,
      project_code: projectCode,
      title: `Milestone Completed: ${milestone.title}`,
      body: `All tasks for milestone "${milestone.title}" in project ${projectCode} have been completed. The milestone has been automatically marked as completed.`,
      severity: 'info',
      link: `/projects/${project_id}`,
      is_read: false,
    });

    await base44.asServiceRole.entities.AuditLog.create({
      project_id,
      entity_type: 'Milestone',
      entity_id: milestone.id,
      action: 'auto_completed',
      actor: 'system',
      summary: `Milestone "${milestone.title}" auto-completed (all linked tasks done).`,
      metadata: {
        before: { status: milestone.status, progress: milestone.progress },
        after: { status: 'completed', progress: 100 },
      },
    });

    completed.push(milestone.title);
  }

  return Response.json({
    checked: pendingMilestones.length,
    completed,
    message: completed.length > 0
      ? `Auto-completed milestones: ${completed.join(', ')}`
      : 'No milestones auto-completed.',
  });
});