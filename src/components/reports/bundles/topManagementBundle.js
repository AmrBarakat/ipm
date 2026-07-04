import {
  revisedContractValue, projectMargin, projectHealth, HEALTH_LABELS,
  isOverdue, formatCurrency, truncate,
} from '@/lib/reportExport';
import { STATUS_LABELS } from '@/lib/constants';

export default {
  id: 'topManagement',
  audience: 'Top Management',
  title: 'Executive Summary',
  description: 'High-level one-pager — overall progress, health, revised contract value & margin, top risks, key upcoming milestones.',
  accent: 'slate',
  contents: ['Overall progress', 'Health flag', 'Revised contract value & margin', 'Top risks', 'Key upcoming milestones'],
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

    return [
      {
        title: 'Executive Summary',
        type: 'summary',
        summary: [
          { label: 'Project', value: truncate(project?.name || '—', 50) },
          { label: 'Status', value: STATUS_LABELS[project?.status] || project?.status || '—' },
          { label: 'Overall Progress', value: `${project?.progress || 0}%` },
          { label: 'Health', value: HEALTH_LABELS[health] },
          { label: 'Revised Contract Value', value: formatCurrency(rev.revised, cur) },
          { label: 'Margin %', value: fin.marginPct == null ? '—' : `${fin.marginPct}%` },
          { label: 'Open Risks', value: String((risks || []).filter(r => r.status === 'open').length) },
          { label: 'Overdue Milestones', value: String(overdueMs.length) },
        ],
      },
      {
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
      },
      {
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
      },
    ];
  },
};