import {
  revisedContractValue, projectMargin,
  formatCurrency, formatDate, truncate,
} from '@/lib/reportExport';

export default {
  id: 'finance',
  audience: 'Financial Department',
  title: 'Financial Report',
  description: 'Money only — contract value vs revised, invoiced/collected/outstanding, expenses vs budget, margin, and cash-flow timing.',
  accent: 'emerald',
  contents: ['KPI snapshot', 'Cumulative cash flow', 'Margin gauge', 'Expenses by category', 'Contract value', 'Invoicing', 'Cash-flow timing'],
  buildSections(data) {
    const { project, invoices = [], expenses = [], collections = [], changeOrders = [] } = data;
    const cur = project?.currency || 'SAR';
    const rev = revisedContractValue(project, changeOrders);
    const fin = projectMargin(invoices, expenses, collections);

    const sections = [];

    // 1. KPI band
    sections.push({
      title: 'Financial Snapshot',
      type: 'kpis',
      cards: [
        { label: 'Revised Contract', value: formatCurrency(rev.revised, cur), color: 'blue' },
        { label: 'Collected', value: formatCurrency(fin.collected, cur), color: 'green' },
        { label: 'Spent', value: formatCurrency(fin.spent, cur), color: 'amber' },
        { label: 'Outstanding', value: formatCurrency(fin.outstanding, cur), color: 'red' },
        { label: 'Margin %', value: fin.marginPct == null ? '—' : `${fin.marginPct}%`, color: fin.marginPct != null && fin.marginPct >= 10 ? 'green' : 'red' },
      ],
    });

    // 2. Cumulative invoiced vs collected vs spent line chart
    const events = [];
    (collections || []).forEach(c => events.push({ date: c.received_date, invoiced: 0, collected: Number(c.amount) || 0, spent: 0 }));
    (invoices || []).forEach(i => {
      const amt = Number(i.actual_amount) || Number(i.planned_amount) || 0;
      if (['invoiced', 'paid', 'partial', 'overdue'].includes(i.status)) events.push({ date: i.actual_invoice_date || i.planned_date, invoiced: amt, collected: 0, spent: 0 });
    });
    (expenses || []).forEach(e => {
      const amt = ['committed', 'paid'].includes(e.status) ? (Number(e.actual_amount) || Number(e.planned_amount) || 0) : 0;
      if (amt > 0) events.push({ date: e.actual_date || e.planned_date, invoiced: 0, collected: 0, spent: amt });
    });
    events.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
    let cumInv = 0, cumCol = 0, cumSpent = 0;
    const series = [
      { name: 'Invoiced', color: 'blue', points: [] },
      { name: 'Collected', color: 'green', points: [] },
      { name: 'Spent', color: 'amber', points: [] },
    ];
    events.filter(e => e.date).forEach(e => {
      cumInv += e.invoiced;
      cumCol += e.collected;
      cumSpent += e.spent;
      const d = new Date(e.date).toISOString();
      series[0].points.push({ date: d, value: cumInv });
      series[1].points.push({ date: d, value: cumCol });
      series[2].points.push({ date: d, value: cumSpent });
    });
    if (series[0].points.length >= 2) {
      sections.push({
        title: 'Cumulative Cash Flow',
        type: 'chart',
        chart: 'line',
        data: { series },
        opts: { h: 55, estimatedH: 65 },
      });
    }

    // 3. Margin gauge
    if (fin.marginPct != null) {
      sections.push({
        title: 'Margin Health',
        type: 'chart',
        chart: 'gauge',
        data: { value: fin.marginPct, thresholds: { green: 10, amber: 20 } },
        opts: { label: `Net Margin ${formatCurrency(fin.margin, cur)}` },
      });
    }

    // 4. Expenses by category as horizontal bars
    const byCat = {};
    (expenses || []).forEach(e => {
      const cat = e.category || 'other';
      const amt = Number(e.actual_amount) || Number(e.planned_amount) || 0;
      if (!byCat[cat]) byCat[cat] = 0;
      byCat[cat] += amt;
    });
    const maxCat = Math.max(1, ...Object.values(byCat));
    const catRows = Object.entries(byCat).map(([cat, amt]) => ({
      label: cat.charAt(0).toUpperCase() + cat.slice(1),
      value: amt,
      max: maxCat,
      color: 'amber',
    })).sort((a, b) => b.value - a.value);
    if (catRows.length) {
      sections.push({
        title: 'Expenses by Category',
        type: 'chart',
        chart: 'hbars',
        data: { rows: catRows },
        opts: { labelW: 35, barH: 5, gap: 3 },
      });
    }

    // 5. Contract value summary
    sections.push({
      title: 'Contract Value (Original vs Revised)',
      type: 'summary',
      summary: [
        { label: 'Original Contract Value', value: formatCurrency(rev.original, cur) },
        { label: 'Change Order Cost Impact', value: formatCurrency(rev.coImpact, cur) },
        { label: 'Change Order Schedule Impact', value: `${rev.coScheduleDays} days` },
        { label: 'Revised Contract Value', value: formatCurrency(rev.revised, cur) },
      ],
    });

    // 6. Invoicing table
    sections.push({
      title: 'Invoicing',
      type: 'table',
      columns: [
        { header: 'Description', key: 'desc', width: 0.3 },
        { header: 'Status', key: 'status', width: 0.14 },
        { header: 'Planned Date', key: 'planned', width: 0.14 },
        { header: 'Invoice Date', key: 'actual', width: 0.14 },
        { header: 'Planned Amount', key: 'plannedAmt', align: 'right', width: 0.14 },
        { header: 'Actual Amount', key: 'actualAmt', align: 'right', width: 0.14 },
      ],
      rows: (invoices || []).map(i => ({
        desc: truncate(i.description || '—', 36),
        status: (i.status || '—').replace(/_/g, ' '),
        planned: formatDate(i.planned_date),
        actual: formatDate(i.actual_invoice_date),
        plannedAmt: formatCurrency(i.planned_amount, cur),
        actualAmt: formatCurrency(i.actual_amount, cur),
      })),
      summary: [
        { label: 'Total Invoiced', value: formatCurrency(fin.invoiced, cur) },
        { label: 'Total Collected', value: formatCurrency(fin.collected, cur) },
        { label: 'Outstanding', value: formatCurrency(fin.outstanding, cur) },
      ],
    });

    // 7. Cash-flow timing table
    const cfEvents = [];
    (collections || []).forEach(c => cfEvents.push({ date: c.received_date, desc: 'Collection', inflow: Number(c.amount) || 0, outflow: 0 }));
    (expenses || []).forEach(e => cfEvents.push({
      date: e.actual_date || e.planned_date, desc: truncate(e.description || 'Expense', 30),
      inflow: 0, outflow: (['committed', 'paid'].includes(e.status) ? (Number(e.actual_amount) || Number(e.planned_amount) || 0) : 0),
    }));
    cfEvents.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
    let balance = 0;
    const cashRows = cfEvents.filter(e => e.date).map(e => {
      balance += e.inflow - e.outflow;
      return {
        date: formatDate(e.date),
        desc: e.desc,
        inflow: e.inflow > 0 ? formatCurrency(e.inflow, cur) : '—',
        outflow: e.outflow > 0 ? formatCurrency(e.outflow, cur) : '—',
        balance: formatCurrency(balance, cur),
      };
    });
    sections.push({
      title: 'Cash-Flow Timing',
      type: 'table',
      columns: [
        { header: 'Date', key: 'date', width: 0.16 },
        { header: 'Description', key: 'desc', width: 0.34 },
        { header: 'Inflow', key: 'inflow', align: 'right', width: 0.16 },
        { header: 'Outflow', key: 'outflow', align: 'right', width: 0.16 },
        { header: 'Running Balance', key: 'balance', align: 'right', width: 0.18 },
      ],
      rows: cashRows,
    });

    return sections;
  },
};