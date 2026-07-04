import {
  revisedContractValue, projectMargin, projectHealth, HEALTH_LABELS,
  formatCurrency, truncate,
} from '@/lib/reportExport';
import { STATUS_LABELS } from '@/lib/constants';

export default {
  id: 'topManagementPortfolio',
  audience: 'Top Management',
  title: 'Portfolio Executive Summary',
  description: 'All projects — total contract value, total margin, count by health status, and portfolio-level risk flags.',
  accent: 'slate',
  isPortfolio: true,
  contents: ['Total contract value', 'Total margin', 'Count by health status', 'Portfolio-level risk flags'],
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

    // Portfolio-level risk flags: highest open risk per project
    sections.push({
      title: 'Portfolio Risk Flags',
      type: 'table',
      columns: [
        { header: 'Project', key: 'name', width: 0.28 },
        { header: 'Top Risk', key: 'risk', width: 0.4 },
        { header: 'Impact', key: 'impact', width: 0.14 },
        { header: 'Status', key: 'status', width: 0.18 },
      ],
      rows: rows.map(r => {
        const topRisk = [...r.pRisks].filter(x => x.status === 'open').sort((a, b) => (b.risk_score || 0) - (a.risk_score || 0))[0];
        return {
          name: truncate(r.p.name || '—', 28),
          risk: topRisk ? truncate(topRisk.title, 40) : '—',
          impact: topRisk?.impact || '—',
          status: topRisk ? (topRisk.status || '—').replace(/_/g, ' ') : '—',
        };
      }).filter(r => r.risk !== '—'),
    });

    return sections;
  },
};