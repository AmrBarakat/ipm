import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Allow both scheduled (service role) and manual invocation
    let user = null;
    try { user = await base44.auth.me(); } catch {}

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Fetch all active POs that are not yet delivered
    const activePOs = await base44.asServiceRole.entities.PurchaseOrder.filter(
      { status: { $nin: ['delivered', 'cancelled'] } },
      '-expected_delivery_date',
      500
    );

    const delayed = activePOs.filter(po => {
      if (!po.expected_delivery_date) return false;
      const expected = new Date(po.expected_delivery_date);
      expected.setHours(0, 0, 0, 0);
      return expected < today;
    });

    let alertsCreated = 0;
    const results = [];

    for (const po of delayed) {
      const expected = new Date(po.expected_delivery_date);
      expected.setHours(0, 0, 0, 0);
      const delayDays = Math.round((today - expected) / 86400000);

      // Update delay_days on the PO record
      await base44.asServiceRole.entities.PurchaseOrder.update(po.id, { delay_days: delayDays });

      // Only alert once per PO (or re-alert if delay has grown by 7+ days since last alert)
      const shouldAlert = !po.delay_alerted || (po.delay_days !== undefined && delayDays - po.delay_days >= 7);

      if (shouldAlert) {
        const severity = po.priority === 'critical' ? 'error' : po.priority === 'high' ? 'warning' : 'info';
        const title = `Shipment Delayed: ${po.po_number || po.description}`;
        const body = `PO from ${po.vendor_name || 'Unknown Vendor'} is ${delayDays} day${delayDays !== 1 ? 's' : ''} overdue. ` +
          `Expected: ${po.expected_delivery_date}. Status: ${po.status.replace(/_/g, ' ')}.`;

        await base44.asServiceRole.entities.Notification.create({
          project_id: po.project_id,
          title,
          body,
          severity,
          link: `/projects/${po.project_id}`,
          is_read: false,
        });

        await base44.asServiceRole.entities.PurchaseOrder.update(po.id, { delay_alerted: true });
        alertsCreated++;
      }

      results.push({ po_number: po.po_number || po.id, delay_days: delayDays, alerted: shouldAlert });
    }

    return Response.json({
      checked: activePOs.length,
      delayed: delayed.length,
      alerts_created: alertsCreated,
      results,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});