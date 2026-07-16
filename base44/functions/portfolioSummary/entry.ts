/**
 * portfolioSummary
 *
 * Replaces the Portfolio dashboard's client-side full-table loads of
 * Invoice / Collection / Expense / PurchaseOrder / Milestone with a single
 * server-side aggregation. Returns:
 *   - projects:           compact project list (fields needed by the dashboard)
 *   - totalsByProject:    per-project aggregates (invoiced, collected, expense,
 *                         PO committed, open/overdue PO counts, milestone progress)
 *   - portfolioTotals:    sums across all projects
 *   - records:            minimal Invoice/Collection/Expense records (with dates)
 *                         so the FinancialDashboard time-series charts keep working
 *
 * Auth: 401 gate (same pattern as applyWBSBatch). Uses asServiceRole so the
 * caller's RLS does not limit the aggregate; the frontend still filters the
 * returned records by its own (RLS-scoped) projects prop.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    let user = null;
    try { user = await base44.auth.me(); } catch (_) { user = null; }
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const [projects, invoices, collections, expenses, purchaseOrders, milestones] = await Promise.all([
      base44.asServiceRole.entities.Project.list('-updated_date', 5000),
      base44.asServiceRole.entities.Invoice.filter({}, '-planned_date', 2000),
      base44.asServiceRole.entities.Collection.filter({}, '-received_date', 2000),
      base44.asServiceRole.entities.Expense.filter({}, '-planned_date', 2000),
      base44.asServiceRole.entities.PurchaseOrder.filter({}, '-created_date', 2000),
      base44.asServiceRole.entities.Milestone.filter({}, '-created_date', 2000),
    ]);

    const today = new Date().toISOString().slice(0, 10);

    const INV_ACTUAL = new Set(['invoiced', 'paid', 'partial', 'overdue']);
    const EXP_ACTUAL = new Set(['committed', 'paid']);
    const PO_OPEN = new Set(['issued', 'acknowledged', 'in_transit', 'partially_delivered']);

    // Per-project accumulators
    const totalsByProject = {};
    for (const p of projects) {
      totalsByProject[p.id] = {
        invoicedTotal: 0,
        collectedTotal: 0,
        expensePlanned: 0,
        expenseActual: 0,
        poCommitted: 0,
        openPoCount: 0,
        overduePoCount: 0,
        milestoneTotal: 0,
        milestoneCompleted: 0,
        milestoneOverdue: 0,
        milestoneProgress: 0,
      };
    }

    // Portfolio-wide milestone weight accumulators (for a single weighted progress %)
    let portMsTotalWeight = 0;
    let portMsCompletedWeight = 0;

    for (const inv of invoices) {
      const t = totalsByProject[inv.project_id];
      if (!t) continue;
      if (INV_ACTUAL.has(inv.status)) {
        t.invoicedTotal += Number(inv.actual_amount || inv.planned_amount || 0);
      }
    }

    for (const col of collections) {
      const t = totalsByProject[col.project_id];
      if (!t) continue;
      t.collectedTotal += Number(col.amount || 0);
    }

    for (const exp of expenses) {
      const t = totalsByProject[exp.project_id];
      if (!t) continue;
      if (exp.status !== 'cancelled') t.expensePlanned += Number(exp.planned_amount || 0);
      if (EXP_ACTUAL.has(exp.status)) t.expenseActual += Number(exp.actual_amount || exp.planned_amount || 0);
    }

    for (const po of purchaseOrders) {
      const t = totalsByProject[po.project_id];
      if (!t) continue;
      if (po.status !== 'cancelled' && po.status !== 'draft') {
        t.poCommitted += Number(po.amount || 0);
      }
      if (PO_OPEN.has(po.status)) t.openPoCount += 1;
      const overdue = (po.delay_days && po.delay_days > 0) ||
        (po.expected_delivery_date && po.expected_delivery_date < today &&
          po.status !== 'delivered' && po.status !== 'cancelled');
      if (overdue) t.overduePoCount += 1;
    }

    for (const ms of milestones) {
      const t = totalsByProject[ms.project_id];
      if (!t) continue;
      t.milestoneTotal += 1;
      const w = Number(ms.weight || 0);
      portMsTotalWeight += w;
      if (ms.status === 'completed') {
        t.milestoneCompleted += 1;
        portMsCompletedWeight += w;
      }
      if (ms.status !== 'completed' && ms.planned_date && ms.planned_date < today) {
        t.milestoneOverdue += 1;
      }
    }

    // Resolve weighted milestone progress per project
    const msByProject = {};
    for (const ms of milestones) {
      const t = totalsByProject[ms.project_id];
      if (!t) continue;
      if (!msByProject[ms.project_id]) msByProject[ms.project_id] = { tw: 0, cw: 0 };
      msByProject[ms.project_id].tw += Number(ms.weight || 0);
      if (ms.status === 'completed') msByProject[ms.project_id].cw += Number(ms.weight || 0);
    }
    for (const id of Object.keys(totalsByProject)) {
      const t = totalsByProject[id];
      const w = msByProject[id];
      t.milestoneProgress = w && w.tw > 0
        ? Math.round((w.cw / w.tw) * 100)
        : t.milestoneTotal > 0 ? Math.round((t.milestoneCompleted / t.milestoneTotal) * 100) : 0;
    }

    // Portfolio totals
    const portfolioTotals = {
      invoicedTotal: 0,
      collectedTotal: 0,
      expensePlanned: 0,
      expenseActual: 0,
      poCommitted: 0,
      openPoCount: 0,
      overduePoCount: 0,
      milestoneTotal: 0,
      milestoneCompleted: 0,
      milestoneOverdue: 0,
      milestoneProgress: portMsTotalWeight > 0
        ? Math.round((portMsCompletedWeight / portMsTotalWeight) * 100)
        : 0,
    };
    for (const id of Object.keys(totalsByProject)) {
      const t = totalsByProject[id];
      portfolioTotals.invoicedTotal += t.invoicedTotal;
      portfolioTotals.collectedTotal += t.collectedTotal;
      portfolioTotals.expensePlanned += t.expensePlanned;
      portfolioTotals.expenseActual += t.expenseActual;
      portfolioTotals.poCommitted += t.poCommitted;
      portfolioTotals.openPoCount += t.openPoCount;
      portfolioTotals.overduePoCount += t.overduePoCount;
      portfolioTotals.milestoneTotal += t.milestoneTotal;
      portfolioTotals.milestoneCompleted += t.milestoneCompleted;
      portfolioTotals.milestoneOverdue += t.milestoneOverdue;
    }

    const projectsCompact = projects.map((p) => ({
      id: p.id,
      name: p.name,
      code: p.code,
      status: p.status,
      budget: p.contract_value || 0,
      progress: p.progress || 0,
      updated_date: p.updated_date,
      project_type: p.project_type,
      start_date: p.start_date,
      client: p.client,
      currency: p.currency,
    }));

    const records = {
      invoices: invoices.map((i) => ({
        project_id: i.project_id,
        status: i.status,
        planned_date: i.planned_date,
        actual_invoice_date: i.actual_invoice_date,
        planned_amount: i.planned_amount,
        actual_amount: i.actual_amount,
      })),
      collections: collections.map((c) => ({
        project_id: c.project_id,
        received_date: c.received_date,
        amount: c.amount,
      })),
      expenses: expenses.map((e) => ({
        project_id: e.project_id,
        status: e.status,
        planned_date: e.planned_date,
        actual_date: e.actual_date,
        planned_amount: e.planned_amount,
        actual_amount: e.actual_amount,
      })),
    };

    return Response.json({ projects: projectsCompact, totalsByProject, portfolioTotals, records });
  } catch (error) {
    return Response.json({ error: error?.message || 'portfolioSummary failed' }, { status: 500 });
  }
});