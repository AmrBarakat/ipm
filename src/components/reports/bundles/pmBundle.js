import {
  wbsRollup, isOverdue, projectHealth, HEALTH_LABELS,
  formatDate, truncate,
} from '@/lib/reportExport';
import { STATUS_LABELS } from '@/lib/constants';

// Status → chart colour name (resolved by reportCharts.resolveColor)
const STATUS_COLOR = {
  completed: 'green', in_progress: 'blue', pending: 'grey', overdue: 'red', blocked: 'red',
  not_started: 'grey', done: 'green', todo: 'grey', review: 'amber',
};

function healthColor(h) {
  return h === 'green' ? 'green' : h === 'amber' ? 'amber' : 'red';
}

// Compute a simple planned-vs-actual S-curve from project dates + current progress.
// Returns [{ name, color, points: [{ date, value }] }] or [] if no date range.
function computeSCurve(project, progress) {
  const start = project?.start_date;
  const end = project?.target_completion_date;
  if (!start || !end) return [];
  const sTime = new Date(start).getTime();
  const eTime = new Date(end).getTime();
  if (isNaN(sTime) || isNaN(eTime) || eTime <= sTime) return [];
  const dur = eTime - sTime;
  const prog = Number(progress) || 0;
  const today = Date.now();

  // Monthly buckets
  const step = 30 * 86400000;
  const planned = [];
  const actual = [];
  for (let t = sTime; t <= eTime; t += step) {
    const frac = (t - sTime) / dur;
    // Sigmoid S-curve for planned
    const plannedPct = 100 / (1 + Math.exp(-6 * (frac - 0.5)));
    planned.push({ date: new Date(t).toISOString(), value: Math.round(plannedPct) });
    if (t <= today) {
      const actFrac = Math.min(1, (t - sTime) / Math.max(1, today - sTime));
      actual.push({ date: new Date(t).toISOString(), value: Math.round(prog * actFrac) });
    }
  }
  // Ensure today is included in actual
  const lastAct = actual[actual.length - 1];
  if (!lastAct || lastAct.value < prog) {
    actual.push({ date: new Date(today).toISOString(), value: prog });
  }
  return [
    { name: 'Planned', color: 'blue', points: planned },
    { name: 'Actual', color: 'amber', points: actual },
  ];
}

export default {
  id: 'pm',
  audience: 'Project Managers',
  title: 'Operations Report',
  description: 'The operational picture — schedule, milestones, WBS, tasks, risks, and overdue items.',
  accent: 'amber',
  contents: ['KPI snapshot', 'Progress & health', 'Milestone progress', 'WBS rollup', 'S-curve', 'Open tasks', 'Open risks', 'Overdue items'],
  buildSections(data) {
    const { project, milestones = [], wbsItems = [], tasks = [], risks = [] } = data;
    const { rollup, overall } = wbsRollup(wbsItems);

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const overdueMs = (milestones || []).filter(m => isOverdue(m.planned_date, m.status));
    const overdueWbs = (wbsItems || []).filter(w => isOverdue(w.planned_end, w.status));
    const health = projectHealth(project, overdueMs.length + overdueWbs.length);
    const openTasks = (tasks || []).filter(t => t.status !== 'done');
    const overdueItems = [
      ...overdueMs.map(m => ({ type: 'Milestone', item: truncate(m.title, 50), due: formatDate(m.planned_date) })),
      ...overdueWbs.map(w => ({ type: 'WBS', item: truncate(`${w.wbs_code || ''} ${w.name || ''}`.trim(), 50), due: formatDate(w.planned_end) })),
    ];

    const sections = [];

    // 1. KPI band
    sections.push({
      title: 'Project Snapshot',
      type: 'kpis',
      cards: [
        { label: 'Overall Progress', value: `${project?.progress || 0}%`, color: 'blue' },
        { label: 'WBS Rollup', value: `${overall}%`, color: 'indigo' },
        { label: 'Health', value: HEALTH_LABELS[health], color: healthColor(health) },
        { label: 'Open Tasks', value: String(openTasks.length), color: 'amber' },
        { label: 'Overdue Items', value: String(overdueItems.length), color: overdueItems.length > 0 ? 'red' : 'green' },
      ],
    });

    // 2. Donut for overall progress
    sections.push({
      title: 'Overall Progress',
      type: 'chart',
      chart: 'donut',
      data: { pct: project?.progress || 0, label: 'Project Progress', color: 'blue' },
      opts: { r: 16 },
    });

    // 3. RAG gauge for health
    sections.push({
      title: 'Health Status',
      type: 'chart',
      chart: 'gauge',
      data: {
        value: project?.progress || 0,
        thresholds: { green: 60, amber: 80 },
      },
      opts: { label: HEALTH_LABELS[health] },
    });

    // 4. Milestone progress as horizontal bars + detail table
    sections.push({
      title: 'Milestone Progress',
      type: 'chart',
      chart: 'hbars',
      data: {
        rows: (milestones || []).map(m => ({
          label: truncate(m.title, 40),
          value: m.progress ?? 0,
          max: 100,
          color: STATUS_COLOR[m.status] || 'grey',
        })),
      },
      opts: { labelW: 50, barH: 5, gap: 3 },
    });

    sections.push({
      title: 'Milestone Details',
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

    // 5. WBS stacked bar + indented table
    const wbsStatusCounts = { not_started: 0, in_progress: 0, completed: 0, blocked: 0 };
    (wbsItems || []).forEach(w => {
      const st = w.status || 'not_started';
      wbsStatusCounts[st] = (wbsStatusCounts[st] || 0) + 1;
    });

    sections.push({
      title: 'WBS Status Breakdown',
      type: 'chart',
      chart: 'stacked',
      data: {
        segments: [
          { label: 'Completed', value: wbsStatusCounts.completed || 0, color: 'green' },
          { label: 'In Progress', value: wbsStatusCounts.in_progress || 0, color: 'blue' },
          { label: 'Not Started', value: wbsStatusCounts.not_started || 0, color: 'grey' },
          { label: 'Blocked', value: wbsStatusCounts.blocked || 0, color: 'red' },
        ],
      },
      opts: { h: 6 },
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
      rows: sortedWbs.map(w => {
        const depth = (w.wbs_code || '').split('.').length - 1;
        return {
          code: w.wbs_code || '—',
          name: truncate(w.name, 46),
          status: (w.status || '—').replace(/_/g, ' '),
          assignee: truncate(w.assignee || '—', 22),
          progress: `${rollup(w.id)}%`,
          _indent: Math.min(depth * 3, 12),
          _bold: depth <= 1,
          _fill: depth <= 1 ? [241, 245, 249] : null,
        };
      }),
    });

    // 6. S-curve (conditional on project dates)
    const sCurve = computeSCurve(project, project?.progress || 0);
    if (sCurve.length) {
      sections.push({
        title: 'Planned vs Actual Progress',
        type: 'chart',
        chart: 'line',
        data: { series: sCurve },
        opts: { h: 55, estimatedH: 65 },
      });
    }

    // 7. Open tasks (overdue first, Due cell coloured red)
    const sortedTasks = [...openTasks].sort((a, b) => {
      const aOver = isOverdue(a.due_date, a.status);
      const bOver = isOverdue(b.due_date, b.status);
      if (aOver && !bOver) return -1;
      if (!aOver && bOver) return 1;
      return 0;
    });
    sections.push({
      title: 'Open Tasks',
      type: 'table',
      columns: [
        { header: 'Title', key: 'title', width: 0.4 },
        { header: 'Status', key: 'status', width: 0.16 },
        { header: 'Priority', key: 'priority', width: 0.14 },
        { header: 'Assignee', key: 'assignee', width: 0.2 },
        { header: 'Due', key: 'due', width: 0.1, cellColor: (row) => isOverdue(row._rawDate, row._rawStatus) ? [239, 68, 68] : null },
      ],
      rows: sortedTasks.map(t => ({
        title: truncate(t.title, 50),
        status: (t.status || '—').replace(/_/g, ' '),
        priority: t.priority || '—',
        assignee: truncate(t.assignee || '—', 22),
        due: formatDate(t.due_date),
        _rawDate: t.due_date,
        _rawStatus: t.status,
      })),
    });

    // 8. Open risks → callout when empty
    const openRisks = (risks || []).filter(r => r.status === 'open');
    if (openRisks.length === 0) {
      sections.push({
        title: 'Open Risks',
        type: 'callout',
        tone: 'good',
        title: 'No open risks recorded',
        body: 'There are no open risks for this project at this time.',
      });
    } else {
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
        rows: openRisks.map(r => ({
          title: truncate(r.title, 30),
          category: r.category || '—',
          prob: r.probability || '—',
          impact: r.impact || '—',
          status: (r.status || '—').replace(/_/g, ' '),
          owner: truncate(r.owner || '—', 18),
          mitigation: truncate(r.mitigation_plan || '—', 22),
        })),
      });
    }

    // 9. Overdue items → callout when empty
    if (overdueItems.length === 0) {
      sections.push({
        title: 'Overdue Items',
        type: 'callout',
        tone: 'good',
        title: 'No overdue items',
        body: 'All milestones and WBS items are on track.',
      });
    } else {
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
    }

    return sections;
  },
};