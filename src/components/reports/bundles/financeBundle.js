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
  contents: ['Contract value (original vs revised after change orders)', 'Invoiced vs collected vs outstanding', 'Expenses vs budget', 'Margin', 'Cash-flow timing'],
  buildSections(data) {
    const { project, invoices = [], expenses = [], collections = [], changeOrders = [] } = data;
    const cur = project?.currency || 'SAR';
    const rev = revisedContractValue(project, changeOrders);
    const fin = projectMargin(invoices, expenses, collections);

    const sections = [];

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

    sections.push({
      title: 'Expenses vs Budget',
      type: 'summary',
      summary: [
        { label: 'Total Budget (Planned Expenses)', value: formatCurrency(fin.budget, cur) },
        { label: 'Actual / Committed Expenses', value: formatCurrency(fin.spent, cur) },
        { label: 'Budget Variance', value: formatCurrency(fin.budget - fin.spent, cur) },
      ],
    });

    sections.push({
      title: 'Margin',
      type: 'summary',
      summary: [
        { label: 'Revised Contract Value', value: formatCurrency(rev.revised, cur) },
        { label: 'Collected', value: formatCurrency(fin.collected, cur) },
        { label: 'Spent', value: formatCurrency(fin.spent, cur) },
        { label: 'Net Margin', value: formatCurrency(fin.margin, cur) },
        { label: 'Margin %', value: fin.marginPct == null ? '—' : `${fin.marginPct}%` },
      ],
    });

    // Cash-flow timeline (collections in, expenses out) sorted by date
    const events = [];
    (collections || []).forEach(c => events.push({ date: c.received_date, desc: 'Collection', inflow: Number(c.amount) || 0, outflow: 0 }));
    (expenses || []).forEach(e => events.push({
      date: e.actual_date || e.planned_date, desc: truncate(e.description || 'Expense', 30),
      inflow: 0, outflow: (['committed', 'paid'].includes(e.status) ? (Number(e.actual_amount) || Number(e.planned_amount) || 0) : 0),
    }));
    events.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
    let balance = 0;
    const cashRows = events.filter(e => e.date).map(e => {
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