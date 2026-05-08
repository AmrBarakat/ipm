import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * generateMilestoneInvoice
 *
 * Triggered automatically when a Milestone status changes to 'completed'.
 * Also callable manually with { milestone_id } in the body.
 *
 * Logic:
 *  1. Load the milestone + project
 *  2. Calculate the milestone's share of the contract value (by weight %)
 *  3. Pull linked BOM items (via milestone_id) and WBS actual hours for billable hours
 *  4. Create an Invoice draft with a descriptive breakdown in the notes field
 *  5. Fire a Notification
 */
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  const body = await req.json();

  // Support both automation payload (entity event) and direct call
  const milestone_id = body.milestone_id || body.data?.id || body.data?.milestone_id;
  const event_type   = body.event?.type;

  // When called from automation, only proceed if status just became 'completed'
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

  // 1. Load milestone
  let milestone;
  try {
    const milestones = await base44.asServiceRole.entities.Milestone.filter({ id: milestone_id });
    milestone = milestones[0];
  } catch (_) {
    return Response.json({ error: 'Milestone not found.' }, { status: 404 });
  }
  if (!milestone) {
    return Response.json({ error: 'Milestone not found.' }, { status: 404 });
  }

  const project_id = milestone.project_id;

  // 2. Load project
  let project;
  try {
    const projects = await base44.asServiceRole.entities.Project.filter({ id: project_id });
    project = projects[0];
  } catch (_) {
    project = null;
  }
  if (!project) {
    return Response.json({ error: 'Project not found.' }, { status: 404 });
  }

  const contractValue = project.contract_value || 0;
  const currency      = project.currency || 'SAR';

  // 3a. Milestone weight → invoice amount
  //     Weight is a % of the contract value. Default to equal split if 0.
  const milestoneWeight = milestone.weight || 0;
  let milestoneAmount = milestoneWeight > 0
    ? Math.round((milestoneWeight / 100) * contractValue * 100) / 100
    : 0;

  // 3b. Pull BOM items linked to this milestone
  const bomItems = await base44.asServiceRole.entities.BOMItem.filter({
    project_id,
    milestone_id,
  });

  const bomTotal = bomItems.reduce((sum, item) => {
    const unitPrice = Number(item.selling_price) || Number(item.planned_cost_price) || 0;
    const qty       = Number(item.quantity) || 1;
    return sum + unitPrice * qty;
  }, 0);

  // 3c. Pull WBS items linked to this milestone for billable hours
  const wbsItems = await base44.asServiceRole.entities.WBSItem.filter({
    project_id,
    milestone_id,
  });

  const totalActualHours  = wbsItems.reduce((sum, w) => sum + (Number(w.actual_hours)  || 0), 0);
  const totalPlannedHours = wbsItems.reduce((sum, w) => sum + (Number(w.planned_hours) || 0), 0);
  const billableHours     = totalActualHours || totalPlannedHours;

  // 4. Build invoice amount:
  //    - If milestone has a weight, use that as the primary amount
  //    - Add BOM items total if milestone amount is 0
  //    - If still 0, fall back to BOM total or 0
  const plannedAmount = milestoneAmount > 0
    ? milestoneAmount
    : bomTotal > 0
      ? bomTotal
      : 0;

  // 5. Build descriptive notes
  const today = new Date().toISOString().slice(0, 10);

  const bomLines = bomItems.length > 0
    ? bomItems.map(i => {
        const unit = Number(i.selling_price) || Number(i.planned_cost_price) || 0;
        return `  • ${i.description} × ${i.quantity} ${i.unit || 'pcs'} @ ${unit} ${currency}`;
      }).join('\n')
    : '  (none linked to this milestone)';

  const wbsLines = wbsItems.length > 0
    ? wbsItems.map(w => `  • ${w.wbs_code} ${w.name}: ${w.actual_hours || w.planned_hours || 0} hrs`).join('\n')
    : '  (none linked to this milestone)';

  const notes = [
    `Auto-generated invoice draft upon completion of milestone: "${milestone.title}"`,
    ``,
    `Contract Value: ${contractValue} ${currency}`,
    `Milestone Weight: ${milestoneWeight}%`,
    ``,
    `BOM Items:`,
    bomLines,
    `BOM Subtotal: ${bomTotal.toFixed(2)} ${currency}`,
    ``,
    `WBS / Billable Hours:`,
    wbsLines,
    `Total Billable Hours: ${billableHours} hrs`,
    ``,
    `Planned Invoice Amount: ${plannedAmount.toFixed(2)} ${currency}`,
  ].join('\n');

  // 6. Create Invoice draft
  const invoice = await base44.asServiceRole.entities.Invoice.create({
    project_id,
    milestone_id,
    description: `Milestone: ${milestone.title}`,
    status: 'planned',
    planned_date: today,
    planned_amount: plannedAmount,
    notes,
  });

  // 7. Notification
  await base44.asServiceRole.entities.Notification.create({
    project_id,
    project_code: project.code,
    title: `Invoice Draft Created — ${milestone.title}`,
    body: `Milestone "${milestone.title}" completed. An invoice draft of ${plannedAmount.toFixed(2)} ${currency} has been generated. Review it in the Financials tab.`,
    severity: 'info',
    link: `/projects/${project_id}?tab=financials`,
    is_read: false,
  });

  return Response.json({
    success: true,
    invoice_id: invoice.id,
    milestone: milestone.title,
    planned_amount: plannedAmount,
    currency,
    bom_items: bomItems.length,
    billable_hours: billableHours,
    message: `Invoice draft created for milestone "${milestone.title}" — ${plannedAmount.toFixed(2)} ${currency}`,
  });
});