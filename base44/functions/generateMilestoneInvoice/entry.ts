import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Business timezone — Saudi Arabia (UTC+3). The auto-generated invoice planned_date
// is stamped in Asia/Riyadh so it matches the local calendar day the milestone completed.
const BUSINESS_TZ = 'Asia/Riyadh';
function tzDateStr(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: BUSINESS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value || '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * generateMilestoneInvoice
 *
 * Triggered when a Milestone status changes to 'completed'.
 * Creates a linked Invoice draft based on the milestone's weight % of the contract value.
 *
 * Idempotent / race-safe: the platform does not enforce a DB-level unique index on
 * milestone_id, so a concurrent completion event could pass the pre-check and also
 * create an invoice. We resolve the race immediately after creating by keeping
 * only the earliest invoice for the milestone (by created_date, then id) and
 * deleting the rest — guaranteeing at most one invoice per milestone.
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

    const today = tzDateStr();

    // Create Invoice draft linked to the milestone. Since the DB does not enforce
    // uniqueness on milestone_id, a concurrent completion event could also reach
    // here. We reconcile immediately after creating: keep only the earliest
    // invoice for this milestone and delete any duplicates from the race.
    const invoice = await base44.asServiceRole.entities.Invoice.create({
      project_id: milestone.project_id,
      milestone_id,
      description: `Milestone: ${milestone.title}`,
      status: 'planned',
      planned_date: today,
      planned_amount: plannedAmount,
      notes: `Auto-generated upon completion of milestone "${milestone.title}".\nContract Value: ${contractValue} ${currency}\nMilestone Weight: ${milestoneWeight}%\nPlanned Amount: ${plannedAmount.toFixed(2)} ${currency}`,
    });

    // Race guard: if a concurrent call also created an invoice for this milestone,
    // keep the earliest (by created_date, then id) and delete the rest. Both
    // concurrent calls agree deterministically on which is earliest, so exactly
    // one invoice survives.
    const invoicesForMs = await base44.asServiceRole.entities.Invoice.filter({ milestone_id });
    if (invoicesForMs.length > 1) {
      invoicesForMs.sort((a, b) => {
        const ca = a.created_date || '';
        const cb = b.created_date || '';
        if (ca !== cb) return ca < cb ? -1 : 1;
        return a.id < b.id ? -1 : 1;
      });
      const keep = invoicesForMs[0];
      await Promise.all(
        invoicesForMs.slice(1).map(d =>
          base44.asServiceRole.entities.Invoice.delete(d.id).catch(() => {})
        )
      );
      // If this call's invoice was a duplicate (not the earliest), stop here —
      // the winner creates the notification/audit.
      if (keep.id !== invoice.id) {
        return Response.json({
          message: 'Invoice already exists for this milestone — duplicate removed.',
          invoice_id: keep.id,
        });
      }
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