import {
  wbsRollup, isOverdue, projectHealth, HEALTH_LABELS,
  formatDate, truncate,
} from '@/lib/reportExport';
import { STATUS_LABELS } from '@/lib/constants';

export default {
  id: 'pm',
  audience: 'Project Managers',
  title: 'Operations Report',
  description: 'The operational picture — schedule, milestones, WBS, tasks, risks, and overdue items.',
  accent: 'amber',
  contents: ['Schedule status', 'Milestone progress', 'WBS rollup', 'Open tasks', 'Open risks with mitigation status', 'Overdue items'],
  buildSections(data) {
    const { project, milestones = [], wbsItems = [], tasks = [], risks = [] } = data;
    const { rollup, overall } = wbsRollup(wbsItems);

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const overdueMs = (milestones || []).filter(m => isOverdue(m.planned_date, m.status));
    const overdueWbs = (wbsItems || []).filter(w => isOverdue(w.planned_end, w.status));
    const health = projectHealth(project, overdueMs.length + overdueWbs.length);

    const sections = [];
    sections.push({
      title: 'Schedule Status',
      type: 'summary',
      summary: [
        { label: 'Project', value: project?.name || '—' },
        { label: 'Code', value: project?.code || '—' },
        { label: 'Status', value: STATUS_LABELS[project?.status] || project?.status || '—' },
        { label: 'Start Date', value: formatDate(project?.start_date) },
        { label: 'Target Completion', value: formatDate(project?.target_completion_date) },
        { label: 'Overall Progress', value: `${project?.progress || 0}%` },
        { label: 'WBS Rollup Progress', value: `${overall}%` },
        { label: 'Health', value: HEALTH_LABELS[health] },
      ],
    });

    sections.push({
      title: 'Milestone Progress',
      type: 'table',
      columns: [
        { header: 'Title', key: 'title', width: 0.4 },
        { header: 'Planned', key: 'planned', width: 0.16 },
        { header: 'Completed', key: 'completed', width: 0.16 },
        { header: 'Status', key: 'status', width: 0.16 },
        { header: 'Progress', key: 'progress', align: 'right', width: 0.12 },
      ],
      rows: (milestones || []).map(m => ({
        title: truncate(m.title, 50),
        planned: formatDate(m.planned_date),
        completed: formatDate(m.completed_date),
        status: (m.status || '—').replace(/_/g, ' '),
        progress: `${m.progress ?? 0}%`,
      })),
    });

    const sortedWbs = [...(wbsItems || [])].sort((a, b) => (a.wbs_code || '').localeCompare(b.wbs_code || '', undefined, { numeric: true }));
    sections.push({
      title: `WBS Rollup  ·  Overall ${overall}%`,
      type: 'table',
      columns: [
        { header: 'WBS', key: 'code', width: 0.14 },
        { header: 'Name', key: 'name', width: 0.46 },
        { header: 'Status', key: 'status', width: 0.16 },
        { header: 'Assignee', key: 'assignee', width: 0.16 },
        { header: 'Progress', key: 'progress', align: 'right', width: 0.08 },
      ],
      rows: sortedWbs.map(w => ({
        code: w.wbs_code || '—',
        name: truncate(w.name, 46),
        status: (w.status || '—').replace(/_/g, ' '),
        assignee: truncate(w.assignee || '—', 22),
        progress: `${rollup(w.id)}%`,
      })),
    });

    sections.push({
      title: 'Open Tasks',
      type: 'table',
      columns: [
        { header: 'Title', key: 'title', width: 0.4 },
        { header: 'Status', key: 'status', width: 0.16 },
        { header: 'Priority', key: 'priority', width: 0.14 },
        { header: 'Assignee', key: 'assignee', width: 0.2 },
        { header: 'Due', key: 'due', width: 0.1 },
      ],
      rows: (tasks || []).filter(t => t.status !== 'done').map(t => ({
        title: truncate(t.title, 50),
        status: (t.status || '—').replace(/_/g, ' '),
        priority: t.priority || '—',
        assignee: truncate(t.assignee || '—', 22),
        due: formatDate(t.due_date),
      })),
    });

    sections.push({
      title: 'Open Risks (Mitigation Status)',
      type: 'table',
      columns: [
        { header: 'Risk', key: 'title', width: 0.26 },
        { header: 'Category', key: 'category', width: 0.12 },
        { header: 'Prob.', key: 'prob', width: 0.1 },
        { header: 'Impact', key: 'impact', width: 0.1 },
        { header: 'Status', key: 'status', width: 0.12 },
        { header: 'Owner', key: 'owner', width: 0.14 },
        { header: 'Mitigation', key: 'mitigation', width: 0.16 },
      ],
      rows: (risks || []).filter(r => r.status === 'open').map(r => ({
        title: truncate(r.title, 30),
        category: r.category || '—',
        prob: r.probability || '—',
        impact: r.impact || '—',
        status: (r.status || '—').replace(/_/g, ' '),
        owner: truncate(r.owner || '—', 18),
        mitigation: truncate(r.mitigation_plan || '—', 22),
      })),
    });

    const overdueItems = [
      ...overdueMs.map(m => ({ type: 'Milestone', item: truncate(m.title, 50), due: formatDate(m.planned_date) })),
      ...overdueWbs.map(w => ({ type: 'WBS', item: truncate(`${w.wbs_code || ''} ${w.name || ''}`.trim(), 50), due: formatDate(w.planned_end) })),
    ];
    sections.push({
      title: `Overdue Items (${overdueItems.length})`,
      type: 'table',
      columns: [
        { header: 'Type', key: 'type', width: 0.16 },
        { header: 'Item', key: 'item', width: 0.64 },
        { header: 'Due Date', key: 'due', width: 0.2 },
      ],
      rows: overdueItems,
    });

    return sections;
  },
};