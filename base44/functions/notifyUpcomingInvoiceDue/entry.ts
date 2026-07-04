import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * notifyUpcomingInvoiceDue
 *
 * Scheduled daily check. For every invoice whose planned_date falls within the
 * next WINDOW_DAYS and that is not yet paid/cancelled, creates an internal
 * Notification so the project manager is alerted ahead of the due date.
 * Uses Invoice.due_alert_date to avoid sending the same alert more than once
 * for a given due date.
 */
const WINDOW_DAYS = 7;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const horizonMs = now.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const horizonStr = new Date(horizonMs).toISOString().slice(0, 10);

    const [invoices, projects] = await Promise.all([
      base44.asServiceRole.entities.Invoice.list('-created_date', 1000),
      base44.asServiceRole.entities.Project.list('-created_date', 1000),
    ]);

    const projectById = {};
    projects.forEach((p) => { projectById[p.id] = p; });

    let sent = 0;
    let skipped = 0;

    for (const inv of invoices) {
      // Skip invoices that are settled or cancelled
      if (['paid', 'cancelled'].includes(inv.status)) { skipped++; continue; }
      // Need a due date to check against
      if (!inv.planned_date) { skipped++; continue; }
      // Only future dates within the horizon
      if (inv.planned_date < todayStr || inv.planned_date > horizonStr) { skipped++; continue; }
      // Already alerted for this due date
      if (inv.due_alert_date === inv.planned_date) { skipped++; continue; }

      const project = projectById[inv.project_id];
      const projectCode = project?.code || inv.project_id;
      const currency = project?.currency || 'SAR';
      const amount = inv.actual_amount != null ? inv.actual_amount : (inv.planned_amount || 0);

      const daysAway = Math.max(
        0,
        Math.round((new Date(inv.planned_date).getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
      );

      const isPayment = ['invoiced', 'partial', 'overdue'].includes(inv.status);
      const subject = isPayment ? 'Payment' : 'Invoice';

      const title = `${subject} due soon — ${inv.description}`;
      const body = `${subject} "${inv.description}" for project ${projectCode} is due on ${inv.planned_date} (${daysAway} day${daysAway === 1 ? '' : 's'} away). Amount: ${amount} ${currency}. Review it in the Financials tab.`;

      await base44.asServiceRole.entities.Notification.create({
        project_id: inv.project_id,
        project_code: projectCode,
        title,
        body,
        severity: daysAway <= 2 ? 'warning' : 'info',
        link: `/projects/${inv.project_id}?tab=financials`,
        is_read: false,
      });

      // Record that we've alerted for this due date so we don't repeat
      await base44.asServiceRole.entities.Invoice.update(inv.id, { due_alert_date: inv.planned_date });

      sent++;
    }

    return Response.json({
      success: true,
      windowDays: WINDOW_DAYS,
      today: todayStr,
      horizon: horizonStr,
      checked: invoices.length,
      sent,
      skipped,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});