import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * generateMilestoneInvoice
 *
 * Triggered when a Milestone status changes to 'completed'.
 * Creates a linked Invoice draft based on the milestone's weight % of the contract value.
 *
 * Idempotent / race-safe: the unique constraint on Invoice.milestone_id guarantees
 * that two near-simultaneous completion events cannot double-bill the client — the
 * second create fails cleanly on the unique index and is treated as a no-op that
 * returns the existing invoice.
 */
Deno.serve(async (req) => {
  try {
    const secret = req.headers.get('x-automation-secret');
    if (!secret || secret !== Deno.env.get('AUTOMATION_SECRET')) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const base44 = createClientFromRequest(req);
    const body = await req.json();

    // Support automation payload or direct call
    const milestone_id = body.milestone_id || body.data?.id;
    const event_type = body.event?.type;

    // When called from automation, skip if not a completion transition
    if (event_type === 'update') {
      const newStatus = body.data?.status;
      const oldStatus = body.old_data?.status;
      if (newStatus !== 'completed' || oldStatus === 'completed') {
        return Response.json({ message: 'Not a completion event — skipped.' });
      }
    }

    if (!milestone_id) {
      return Response.json({ error: 'milestone_id is required.' }, { status: 400 });
    }

    // Load milestone
    const milestones = await base44.asServiceRole.entities.Milestone.filter({ id: milestone_id });
    const milestone = milestones[0];
    if (!milestone) {
      return Response.json({ error: 'Milestone not found.' }, { status: 404 });
    }

    // Optimistic duplicate check (fast path for the common, non-concurrent case)
    const existingInvoices = await base44.asServiceRole.entities.Invoice.filter({
      project_id: milestone.project_id,
      milestone_id,
    });
    if (existingInvoices.length > 0) {
      return Response.json({ message: 'Invoice already exists for this milestone — skipped.', invoice_id: existingInvoices[0].id });
    }

    // Load project
    const projects = await base44.asServiceRole.entities.Project.filter({ id: milestone.project_id });
    const project = projects[0];
    if (!project) {
      return Response.json({ error: 'Project not found.' }, { status: 404 });
    }

    const contractValue = project.contract_value || 0;
    const currency = project.currency || 'SAR';
    const milestoneWeight = milestone.weight || 0;

    // Calculate invoice amount from milestone weight % of contract value
    const plannedAmount = milestoneWeight > 0
      ? Math.round((milestoneWeight / 100) * contractValue * 100) / 100
      : 0;

    const today = new Date().toISOString().slice(0, 10);

    // Create Invoice draft linked to the milestone. The unique constraint on
    // milestone_id makes a concurrent completion event fail cleanly here
    // instead of creating a duplicate (double-billing guard).
    let invoice;
    try {
      invoice = await base44.asServiceRole.entities.Invoice.create({
        project_id: milestone.project_id,
        milestone_id,
        description: `Milestone: ${milestone.title}`,
        status: 'planned',
        planned_date: today,
        planned_amount: plannedAmount,
        notes: `Auto-generated upon completion of milestone "${milestone.title}".\nContract Value: ${contractValue} ${currency}\nMilestone Weight: ${milestoneWeight}%\nPlanned Amount: ${plannedAmount.toFixed(2)} ${currency}`,
      });
    } catch (createError) {
      // Unique-constraint violation: a concurrent event already created the
      // invoice. Treat as a no-op — return the existing invoice.
      const alreadyExisting = await base44.asServiceRole.entities.Invoice.filter({
        project_id: milestone.project_id,
        milestone_id,
      });
      if (alreadyExisting.length > 0) {
        return Response.json({
          message: 'Invoice already exists for this milestone — skipped (concurrent create).',
          invoice_id: alreadyExisting[0].id,
        });
      }
      throw createError;
    }

    // Notification
    await base44.asServiceRole.entities.Notification.create({
      project_id: milestone.project_id,
      project_code: project.code,
      title: `Invoice Draft Created — ${milestone.title}`,
      body: `Milestone "${milestone.title}" completed. An invoice draft of ${plannedAmount.toFixed(2)} ${currency} has been generated. Review it in the Financials tab.`,
      severity: 'info',
      link: `/projects/${milestone.project_id}?tab=financials`,
      is_read: false,
    });

    await base44.asServiceRole.entities.AuditLog.create({
      project_id: milestone.project_id,
      entity_type: 'Invoice',
      entity_id: invoice.id,
      action: 'auto_invoiced',
      actor: 'system',
      summary: `Invoice draft created for milestone "${milestone.title}" (${plannedAmount.toFixed(2)} ${currency}).`,
      metadata: {
        milestone_id,
        milestone_title: milestone.title,
        milestone_weight: milestoneWeight,
        contract_value: contractValue,
        planned_amount: plannedAmount,
        currency,
      },
    });

    return Response.json({
      success: true,
      invoice_id: invoice.id,
      milestone: milestone.title,
      planned_amount: plannedAmount,
      currency,
      message: `Invoice draft created for milestone "${milestone.title}" — ${plannedAmount.toFixed(2)} ${currency}`,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});