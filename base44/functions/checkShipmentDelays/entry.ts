import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Business timezone — Saudi Arabia (UTC+3). "Today" for overdue detection is anchored
// to Asia/Riyadh so a shipment due late in the local day isn't treated as still-current
// by the UTC clock.
const BUSINESS_TZ = 'Asia/Riyadh';
function tzDateStr(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: BUSINESS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value || '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * checkShipmentDelays
 *
 * Scans PurchaseOrders for overdue shipments and notifies the project team.
 *
 * Auth: automation callers pass `x-automation-secret` matching AUTOMATION_SECRET;
 *       manual callers are authenticated via the user token. Either is accepted.
 *
 * Input:  { project_id?: string }   // omit to scan all projects
 * Output:  { data: { overdue_count: number, overdue_pos: [{ id, po_number, vendor }] } }
 *
 * A PO is overdue if it has an expected_delivery_date in the past AND its status
 * is not "delivered" and not "cancelled".
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // ── Auth ──────────────────────────────────────────────────────────────
    const secret = req.headers.get('x-automation-secret');
    const isAutomation = !!secret && secret === Deno.env.get('AUTOMATION_SECRET');
    if (!isAutomation) {
      let user = null;
      try { user = await base44.auth.me(); } catch (_) { user = null; }
      if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ── Input ─────────────────────────────────────────────────────────────
    let body = {};
    try { body = await req.json(); } catch (_) { body = {}; }
    const projectId = body.project_id || null;

    const todayStr = tzDateStr();
    const today = new Date(todayStr + 'T00:00:00Z');

    // Scan PurchaseOrders for the project (or all projects if none specified)
    const poFilter = projectId ? { project_id: projectId } : {};
    const pos = await base44.asServiceRole.entities.PurchaseOrder.filter(poFilter, '-expected_delivery_date', 1000);

    // Overdue: delivery_date in the past AND status not delivered/cancelled
    const isOverdue = (po) => {
      if (!po.expected_delivery_date) return false;
      if (po.status === 'delivered' || po.status === 'cancelled') return false;
      const expected = new Date(po.expected_delivery_date);
      expected.setHours(0, 0, 0, 0);
      return expected < today;
    };
    const overdue = pos.filter(isOverdue);

    // ── Notify: create a Notification per newly-overdue PO (dedup via delay_alerted) ──
    for (const po of overdue) {
      const expected = new Date(po.expected_delivery_date);
      expected.setHours(0, 0, 0, 0);
      const delayDays = Math.round((today - expected) / 86400000);

      await base44.asServiceRole.entities.PurchaseOrder.update(po.id, { delay_days: delayDays });

      // Alert once per PO (or re-alert if delay grew by 7+ days since last alert)
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

        await base44.asServiceRole.entities.AuditLog.create({
          project_id: po.project_id,
          entity_type: 'PurchaseOrder',
          entity_id: po.id,
          action: 'delay_alerted',
          actor: 'system',
          summary: `Shipment delay alert for PO ${po.po_number || po.description || po.id} — ${delayDays} day${delayDays !== 1 ? 's' : ''} overdue.`,
          metadata: {
            po_number: po.po_number,
            vendor_name: po.vendor_name,
            expected_delivery_date: po.expected_delivery_date,
            delay_days: delayDays,
            priority: po.priority,
          },
        });
      }
    }

    // ── Response contract ─────────────────────────────────────────────────
    return Response.json({
      data: {
        overdue_count: overdue.length,
        overdue_pos: overdue.map(po => ({
          id: po.id,
          po_number: po.po_number || '',
          vendor: po.vendor_name || '',
        })),
      },
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});