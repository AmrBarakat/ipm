import { formatDate, truncate } from '@/lib/reportExport';
import { STATUS_LABELS } from '@/lib/constants';

// Clean external-facing progress report. NO costs, margins, vendor pricing,
// or internal risk details.
export default {
  id: 'client',
  audience: 'Client',
  title: 'Client Progress Report',
  description: 'A clean external-facing report — milestone status, overall completion, and upcoming deliverables. No commercial data.',
  accent: 'violet',
  contents: ['KPI snapshot', 'Overall completion', 'Milestone progress', 'Project overview', 'Milestone status', 'Upcoming deliverables'],
  buildSections(data) {
    const { project, milestones = [], deliverables = [] } = data;

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const upcomingDeliv = [...(deliverables || [])]
      .filter(d => ['pending', 'in_progress'].includes(d.status) || (d.planned_delivery_date && new Date(d.planned_delivery_date) >= today))
      .sort((a, b) => new Date(a.planned_delivery_date || 0) - new Date(b.planned_delivery_date || 0))
      .slice(0, 20);

    const openMilestones = (milestones || []).filter(m => m.status !== 'completed');

    const sections = [];

    // 1. KPI band
    sections.push({
      title: 'Project Snapshot',
      type: 'kpis',
      cards: [
        { label: 'Overall Completion', value: `${project?.progress || 0}%`, color: 'violet' },
        { label: 'Status', value: STATUS_LABELS[project?.status] || project?.status || '—', color: 'blue' },
        { label: 'Total Milestones', value: String((milestones || []).length), color: 'indigo' },
        { label: 'Open Milestones', value: String(openMilestones.length), color: 'amber' },
        { label: 'Upcoming Deliverables', value: String(upcomingDeliv.length), color: 'blue' },
      ],
    });

    // 2. Progress donut
    sections.push({
      title: 'Overall Completion',
      type: 'chart',
      chart: 'donut',
      data: { pct: project?.progress || 0, label: 'Project Completion', color: 'violet' },
      opts: { r: 16 },
    });

    // 3. Milestone progress bars
    if ((milestones || []).length) {
      sections.push({
        title: 'Milestone Progress',
        type: 'chart',
        chart: 'hbars',
        data: {
          rows: (milestones || []).map(m => ({
            label: truncate(m.title, 40),
            value: m.progress ?? 0,
            max: 100,
            color: m.status === 'completed' ? 'green' : m.status === 'in_progress' ? 'blue' : 'grey',
          })),
        },
        opts: { labelW: 50, barH: 5, gap: 3 },
      });
    }

    // 4. Project overview summary
    sections.push({
      title: 'Project Overview',
      type: 'summary',
      summary: [
        { label: 'Project', value: truncate(project?.name || '—', 50) },
        { label: 'Client', value: project?.client || '—' },
        { label: 'Status', value: STATUS_LABELS[project?.status] || project?.status || '—' },
        { label: 'Start Date', value: formatDate(project?.start_date) },
        { label: 'Target Completion', value: formatDate(project?.target_completion_date) },
        { label: 'Overall Completion', value: `${project?.progress || 0}%` },
      ],
    });

    // 5. Milestone status table
    sections.push({
      title: 'Milestone Status',
      type: 'table',
      columns: [
        { header: 'Milestone', key: 'title', width: 0.45 },
        { header: 'Planned Date', key: 'planned', width: 0.2 },
        { header: 'Status', key: 'status', width: 0.2 },
        { header: 'Progress', key: 'progress', align: 'right', width: 0.15 },
      ],
      rows: (milestones || []).map(m => ({
        title: truncate(m.title, 50),
        planned: formatDate(m.planned_date),
        status: (m.status || '—').replace(/_/g, ' '),
        progress: `${m.progress ?? 0}%`,
      })),
    });

    // 6. Upcoming deliverables → callout when empty
    if (upcomingDeliv.length === 0) {
      sections.push({
        title: 'Upcoming Deliverables',
        type: 'callout',
        tone: 'good',
        title: 'No upcoming deliverables',
        body: 'All deliverables have been completed or there are none pending.',
      });
    } else {
      sections.push({
        title: 'Upcoming Deliverables',
        type: 'table',
        columns: [
          { header: 'Deliverable', key: 'name', width: 0.4 },
          { header: 'Type', key: 'type', width: 0.18 },
          { header: 'Planned Delivery', key: 'planned', width: 0.22 },
          { header: 'Status', key: 'status', width: 0.2 },
        ],
        rows: upcomingDeliv.map(d => ({
          name: truncate(d.name, 40),
          type: d.type || '—',
          planned: formatDate(d.planned_delivery_date),
          status: (d.status || '—').replace(/_/g, ' '),
        })),
      });
    }

    return sections;
  },
};