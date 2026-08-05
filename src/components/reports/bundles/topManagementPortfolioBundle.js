import {
  revisedContractValue, projectMargin, projectHealth, HEALTH_LABELS,
  formatCurrency, truncate,
} from '@/lib/reportExport';
import { STATUS_LABELS } from '@/lib/constants';

function healthColor(h) {
  return h === 'green' ? 'green' : h === 'amber' ? 'amber' : 'red';
}

export default {
  id: 'topManagementPortfolio',
  audience: 'Top Management',
  title: 'Portfolio Executive Summary',
  description: 'All projects — total contract value, total margin, count by health status, and portfolio-level risk flags.',
  accent: 'slate',
  isPortfolio: true,
  contents: ['KPI snapshot', 'Portfolio health', 'Margin by project', 'Portfolio summary', 'Health distribution', 'Project margin & health', 'Portfolio risk flags'],
  buildSections(data) {
    const { projects = [], invoices = [], expenses = [], collections = [], risks = [], changeOrders = [] } = data;

    const rows = projects.map(p => {
      const cur = p.currency || 'SAR';
      const pInv = invoices.filter(i => i.project_id === p.id);
      const pExp = expenses.filter(e => e.project_id === p.id);
      const pCol = collections.filter(c => c.project_id === p.id);
      const pCO = changeOrders.filter(co => co.project_id === p.id);
      const pRisks = risks.filter(r => r.project_id === p.id);
      const rev = revisedContractValue(p, pCO);
      const fin = projectMargin(pInv, pExp, pCol);
      const health = projectHealth(p, 0);
      return { p, cur, rev, fin, health, pRisks };
    });

    const totalContract = rows.reduce((s, r) => s + r.rev.original, 0);
    const totalRevised = rows.reduce((s, r) => s + r.rev.revised, 0);
    const totalCollected = rows.reduce((s, r) => s + r.fin.collected, 0);
    const totalSpent = rows.reduce((s, r) => s + r.fin.spent, 0);
    const totalMargin = totalCollected - totalSpent;
    const totalMarginPct = totalCollected > 0 ? Math.round((totalMargin / totalCollected) * 100) : null;

    const healthCounts = { green: 0, amber: 0, red: 0 };
    rows.forEach(r => { healthCounts[r.health] = (healthCounts[r.health] || 0) + 1; });

    const sections = [];

    // 1. KPI band
    sections.push({
      title: 'Portfolio Snapshot',
      type: 'kpis',
      cards: [
        { label: 'Projects', value: String(projects.length), color: 'blue' },
        { label: 'Total Contract Value', value: formatCurrency(totalContract, 'SAR'), color: 'indigo' },
        { label: 'Total Collected', value: formatCurrency(totalCollected, 'SAR'), color: 'green' },
        { label: 'Portfolio Margin %', value: totalMarginPct == null ? '—' : `${totalMarginPct}%`, color: totalMarginPct != null && totalMarginPct >= 10 ? 'green' : 'red' },
        { label: 'At Risk (Amber+Red)', value: String(healthCounts.amber + healthCounts.red), color: healthCounts.amber + healthCounts.red > 0 ? 'amber' : 'green' },
      ],
    });

    // 2. Portfolio health stacked bar
    sections.push({
      title: 'Portfolio Health Distribution',
      type: 'chart',
      chart: 'stacked',
      data: {
        segments: [
          { label: 'On Track', value: healthCounts.green || 0, color: 'green' },
          { label: 'At Risk', value: healthCounts.amber || 0, color: 'amber' },
          { label: 'Critical', value: healthCounts.red || 0, color: 'red' },
        ],
      },
      opts: { h: 6 },
    });

    // 3. Margin by project as horizontal bars
    const maxMargin = Math.max(1, ...rows.map(r => Math.abs(r.fin.marginPct || 0)));
    const marginRows = rows.map(r => ({
      label: truncate(r.p.name || '—', 30),
      value: r.fin.marginPct ?? 0,
      max: maxMargin,
      color: r.fin.marginPct != null && r.fin.marginPct >= 10 ? 'green' : 'red',
    })).sort((a, b) => b.value - a.value);
    if (marginRows.length) {
      sections.push({
        title: 'Margin by Project',
        type: 'chart',
        chart: 'hbars',
        data: { rows: marginRows },
        opts: { labelW: 45, barH: 5, gap: 3 },
      });
    }

    // 4. Portfolio summary
    sections.push({
      title: 'Portfolio Summary',
      type: 'summary',
      summary: [
        { label: 'Number of Projects', value: String(projects.length) },
        { label: 'Total Contract Value', value: formatCurrency(totalContract, 'SAR') },
        { label: 'Total Revised Value (after COs)', value: formatCurrency(totalRevised, 'SAR') },
        { label: 'Total Collected', value: formatCurrency(totalCollected, 'SAR') },
        { label: 'Total Spent', value: formatCurrency(totalSpent, 'SAR') },
        { label: 'Total Net Margin', value: formatCurrency(totalMargin, 'SAR') },
        { label: 'Portfolio Margin %', value: totalMarginPct == null ? '—' : `${totalMarginPct}%` },
      ],
    });

    // 5. Health distribution table
    sections.push({
      title: 'Health Distribution',
      type: 'table',
      columns: [
        { header: 'Health', key: 'health', width: 0.4 },
        { header: 'Count', key: 'count', align: 'right', width: 0.3 },
        { header: 'Contract Value', key: 'value', align: 'right', width: 0.3 },
      ],
      rows: ['green', 'amber', 'red'].map(h => ({
        health: HEALTH_LABELS[h],
        count: String(healthCounts[h] || 0),
        value: formatCurrency(rows.filter(r => r.health === h).reduce((s, r) => s + r.rev.original, 0), 'SAR'),
      })),
    });

    // 6. Project margin & health table
    sections.push({
      title: 'Project Margin & Health',
      type: 'table',
      columns: [
        { header: 'Project', key: 'name', width: 0.3 },
        { header: 'Status', key: 'status', width: 0.14 },
        { header: 'Contract Value', key: 'contract', align: 'right', width: 0.16 },
        { header: 'Margin %', key: 'margin', align: 'right', width: 0.12 },
        { header: 'Health', key: 'health', width: 0.14 },
        { header: 'Top Risk', key: 'topRisk', width: 0.14 },
      ],
      rows: rows.map(r => {
        const topRisk = [...r.pRisks].filter(x => x.status === 'open').sort((a, b) => (b.risk_score || 0) - (a.risk_score || 0))[0];
        return {
          name: truncate(r.p.name || '—', 30),
          status: STATUS_LABELS[r.p.status] || r.p.status || '—',
          contract: formatCurrency(r.rev.original, r.cur),
          margin: r.fin.marginPct == null ? '—' : `${r.fin.marginPct}%`,
          health: HEALTH_LABELS[r.health],
          topRisk: topRisk ? truncate(topRisk.title, 22) : '—',
        };
      }),
    });

    // 7. Portfolio risk flags
    const riskFlagRows = rows.map(r => {
      const topRisk = [...r.pRisks].filter(x => x.status === 'open').sort((a, b) => (b.risk_score || 0) - (a.risk_score || 0))[0];
      return {
        name: truncate(r.p.name || '—', 28),
        risk: topRisk ? truncate(topRisk.title, 40) : '—',
        impact: topRisk?.impact || '—',
        status: topRisk ? (topRisk.status || '—').replace(/_/g, ' ') : '—',
      };
    }).filter(r => r.risk !== '—');

    if (riskFlagRows.length === 0) {
      sections.push({
        title: 'Portfolio Risk Flags',
        type: 'callout',
        tone: 'good',
        title: 'No open risks across the portfolio',
        body: 'There are no open risks recorded for any project.',
      });
    } else {
      sections.push({
        title: 'Portfolio Risk Flags',
        type: 'table',
        columns: [
          { header: 'Project', key: 'name', width: 0.28 },
          { header: 'Top Risk', key: 'risk', width: 0.4 },
          { header: 'Impact', key: 'impact', width: 0.14 },
          { header: 'Status', key: 'status', width: 0.18 },
        ],
        rows: riskFlagRows,
      });
    }

    return sections;
  },
};