import {
  revisedContractValue, projectMargin, projectHealth, HEALTH_LABELS,
  isOverdue, formatCurrency, truncate,
} from '@/lib/reportExport';
import { STATUS_LABELS } from '@/lib/constants';

function healthColor(h) {
  return h === 'green' ? 'green' : h === 'amber' ? 'amber' : 'red';
}

export default {
  id: 'topManagement',
  audience: 'Top Management',
  title: 'Executive Summary',
  description: 'High-level one-pager — overall progress, health, revised contract value & margin, top risks, key upcoming milestones.',
  accent: 'slate',
  contents: ['KPI snapshot', 'Progress donut', 'Health gauge', 'Margin by project', 'Executive summary', 'Top risks', 'Key milestones'],
  buildSections(data) {
    const { project, milestones = [], risks = [], invoices = [], expenses = [], collections = [], changeOrders = [] } = data;
    const cur = project?.currency || 'SAR';
    const rev = revisedContractValue(project, changeOrders);
    const fin = projectMargin(invoices, expenses, collections);

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const overdueMs = (milestones || []).filter(m => isOverdue(m.planned_date, m.status));
    const health = projectHealth(project, overdueMs.length);
    const topRisks = [...(risks || [])].filter(r => r.status === 'open').sort((a, b) => (b.risk_score || 0) - (a.risk_score || 0)).slice(0, 5);
    const upcoming = [...(milestones || [])]
      .filter(m => m.planned_date && m.status !== 'completed' && new Date(m.planned_date) >= today)
      .sort((a, b) => new Date(a.planned_date) - new Date(b.planned_date))
      .slice(0, 5);
    const openRisks = (risks || []).filter(r => r.status === 'open');

    const sections = [];

    // 1. KPI band
    sections.push({
      title: 'Executive Snapshot',
      type: 'kpis',
      cards: [
        { label: 'Overall Progress', value: `${project?.progress || 0}%`, color: 'blue' },
        { label: 'Health', value: HEALTH_LABELS[health], color: healthColor(health) },
        { label: 'Revised Contract', value: formatCurrency(rev.revised, cur), color: 'indigo' },
        { label: 'Margin %', value: fin.marginPct == null ? '—' : `${fin.marginPct}%`, color: fin.marginPct != null && fin.marginPct >= 10 ? 'green' : 'red' },
        { label: 'Open Risks', value: String(openRisks.length), color: openRisks.length > 0 ? 'amber' : 'green' },
      ],
    });

    // 2. Progress donut
    sections.push({
      title: 'Overall Progress',
      type: 'chart',
      chart: 'donut',
      data: { pct: project?.progress || 0, label: 'Project Progress', color: 'blue' },
      opts: { r: 16 },
    });

    // 3. Health gauge
    sections.push({
      title: 'Health Status',
      type: 'chart',
      chart: 'gauge',
      data: { value: project?.progress || 0, thresholds: { green: 60, amber: 80 } },
      opts: { label: HEALTH_LABELS[health] },
    });

    // 4. Executive summary table
    sections.push({
      title: 'Executive Summary',
      type: 'summary',
      summary: [
        { label: 'Project', value: truncate(project?.name || '—', 50) },
        { label: 'Status', value: STATUS_LABELS[project?.status] || project?.status || '—' },
        { label: 'Overall Progress', value: `${project?.progress || 0}%` },
        { label: 'Health', value: HEALTH_LABELS[health] },
        { label: 'Revised Contract Value', value: formatCurrency(rev.revised, cur) },
        { label: 'Margin %', value: fin.marginPct == null ? '—' : `${fin.marginPct}%` },
        { label: 'Open Risks', value: String(openRisks.length) },
        { label: 'Overdue Milestones', value: String(overdueMs.length) },
      ],
    });

    // 5. Top risks → callout when empty
    if (topRisks.length === 0) {
      sections.push({
        title: 'Top Risks',
        type: 'callout',
        tone: 'good',
        title: 'No open risks recorded',
        body: 'There are no open risks for this project at this time.',
      });
    } else {
      sections.push({
        title: 'Top Risks',
        type: 'table',
        columns: [
          { header: 'Risk', key: 'title', width: 0.4 },
          { header: 'Category', key: 'category', width: 0.18 },
          { header: 'Impact', key: 'impact', width: 0.14 },
          { header: 'Probability', key: 'prob', width: 0.14 },
          { header: 'Status', key: 'status', width: 0.14 },
        ],
        rows: topRisks.map(r => ({
          title: truncate(r.title, 50),
          category: r.category || '—',
          impact: r.impact || '—',
          prob: r.probability || '—',
          status: (r.status || '—').replace(/_/g, ' '),
        })),
      });
    }

    // 6. Key upcoming milestones → callout when empty
    if (upcoming.length === 0) {
      sections.push({
        title: 'Key Upcoming Milestones',
        type: 'callout',
        tone: 'good',
        title: 'No upcoming milestones',
        body: 'All milestones are completed or there are none scheduled.',
      });
    } else {
      sections.push({
        title: 'Key Upcoming Milestones',
        type: 'table',
        columns: [
          { header: 'Milestone', key: 'title', width: 0.5 },
          { header: 'Planned Date', key: 'planned', width: 0.25 },
          { header: 'Status', key: 'status', width: 0.25 },
        ],
        rows: upcoming.map(m => ({
          title: truncate(m.title, 50),
          planned: m.planned_date ? new Date(m.planned_date).toLocaleDateString('en-GB') : '—',
          status: (m.status || '—').replace(/_/g, ' '),
        })),
      });
    }

    return sections;
  },
};