/**
 * portfolioMaterialTracking — portfolio-wide BOM material pipeline report.
 *
 * Loads all Projects and BOMItems (asServiceRole), excludes service lines and
 * panel child rows, derives each item's effective material_status (with the
 * legacy-field migration from podnApply), and returns per-project + totals
 * aggregates plus a flat, capped item list for the dashboard view.
 *
 * Auth: 401 if not logged in.
 *
 * Output: { per_project, totals, items }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { deriveMaterialStatus } from '../../shared/podnApply.ts';

function isOverdue(i, ms) {
  if (!i.expected_delivery_date) return false;
  if (ms === 'received' || ms === 'delivered') return false;
  const d = new Date(i.expected_delivery_date);
  if (isNaN(d.getTime())) return false;
  d.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}

function emptyAgg() {
  return {
    counts: { not_ordered: 0, ordered: 0, received: 0, delivered: 0 },
    value: { total_planned: 0, ordered_value: 0, received_value: 0, delivered_value: 0 },
    overdue: 0,
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    let user = null;
    try { user = await base44.auth.me(); } catch (_) { user = null; }
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const projects = await base44.asServiceRole.entities.Project.list('-created_date', 500);
    const bomItems = await base44.asServiceRole.entities.BOMItem.list('-created_date', 5000);

    const byProject = new Map();
    for (const p of projects) {
      byProject.set(p.id, { project_id: p.id, name: p.name, code: p.code, ...emptyAgg() });
    }
    const totals = emptyAgg();
    const items = [];

    for (const i of bomItems) {
      if (i.category === 'service' || i.parent_id) continue;
      const ms = deriveMaterialStatus(i);
      const qty = Number(i.quantity) || 0;
      const unitCost = Number(i.planned_cost_price) || Number(i.cost_price) || 0;
      const lineValue = unitCost * qty;
      const overdue = isOverdue(i, ms) ? 1 : 0;

      const agg = byProject.get(i.project_id);
      if (agg) {
        agg.counts[ms]++;
        agg.value.total_planned += lineValue;
        if (ms !== 'not_ordered') agg.value[ms + '_value'] += lineValue;
        agg.overdue += overdue;
      }
      totals.counts[ms]++;
      totals.value.total_planned += lineValue;
      if (ms !== 'not_ordered') totals.value[ms + '_value'] += lineValue;
      totals.overdue += overdue;

      items.push({
        project_id: i.project_id,
        description: i.description,
        manufacturer_part_number: i.manufacturer_part_number,
        category: i.category,
        supplier: i.supplier,
        quantity: qty,
        stock_qty: Number(i.stock_qty) || 0,
        received_qty: Number(i.received_qty) || Number(i.delivered_qty) || 0,
        material_status: ms,
        expected_delivery_date: i.expected_delivery_date,
        planned_cost_price: unitCost,
      });
    }

    const per_project = [...byProject.values()]
      .filter(p => p.counts.not_ordered + p.counts.ordered + p.counts.received + p.counts.delivered > 0)
      .sort((a, b) => (a.code || '').localeCompare(b.code || ''));

    return Response.json({ per_project, totals, items: items.slice(0, 3000) });
  } catch (error) {
    return Response.json({ error: error?.message || 'Failed to load material tracking' }, { status: 500 });
  }
});