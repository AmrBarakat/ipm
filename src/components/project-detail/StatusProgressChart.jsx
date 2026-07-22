import { useMemo } from 'react';
import { useEntityList } from '@/hooks/useEntity';
import { sortMilestones } from '@/lib/utils';
import { ENTITY_QUERY } from '@/lib/entityQueryDefaults';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend } from 'recharts';
import { Target, Package, Activity } from 'lucide-react';

const MILESTONE_COLOR = '#f59e0b'; // amber-500
const DELIVERABLE_COLOR = '#3b82f6'; // blue-500

const DELIVERABLE_STATUS_PCT = {
  pending: 0,
  in_progress: 50,
  delivered: 85,
  accepted: 100,
  rejected: 0
};
const DELIVERABLE_STATUS_LABEL = {
  pending: 'Pending',
  in_progress: 'In Progress',
  delivered: 'Delivered',
  accepted: 'Accepted',
  rejected: 'Rejected'
};
const MILESTONE_STATUS_LABEL = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
  overdue: 'Overdue'
};

function truncate(s, n = 28) {
  if (!s) return '—';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export default function StatusProgressChart({ projectId }) {
  const { data: milestones = [], isLoading: msLoading } = useEntityList('Milestone', { project_id: projectId }, ENTITY_QUERY.Milestone.sort, ENTITY_QUERY.Milestone.limit);
  const { data: deliverables = [], isLoading: delLoading } = useEntityList('Deliverable', { project_id: projectId }, ENTITY_QUERY.Deliverable.sort, ENTITY_QUERY.Deliverable.limit);
  const loading = msLoading || delLoading;

  const data = useMemo(() => {
    const ms = sortMilestones(milestones).map((m) => ({
      name: truncate(m.title),
      fullName: m.title,
      progress: Math.max(0, Math.min(100, Number(m.progress) || 0)),
      type: 'Milestone',
      status: MILESTONE_STATUS_LABEL[m.status] || m.status || '—'
    }));
    const ds = deliverables.map((d) => ({
      name: truncate(d.name),
      fullName: d.name,
      progress: DELIVERABLE_STATUS_PCT[d.status] ?? 0,
      type: 'Deliverable',
      status: DELIVERABLE_STATUS_LABEL[d.status] || d.status || '—'
    }));
    return [...ms, ...ds];
  }, [milestones, deliverables]);

  const milestoneCount = milestones.length;
  const deliverableCount = deliverables.length;
  const msCompleted = milestones.filter((m) => m.status === 'completed').length;
  const delDone = deliverables.filter((d) => d.status === 'delivered' || d.status === 'accepted').length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" />
      </div>);

  }

  if (data.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-5">
        <h3 className="font-semibold text-slate-700 text-sm uppercase tracking-wide flex items-center gap-2 border-b pb-3 mb-4">
          <Activity className="w-4 h-4 text-amber-500" /> Milestone & Deliverable Progress
        </h3>
        <p className="text-sm text-slate-400 text-center py-8">No milestones or deliverables yet.</p>
      </div>);

  }

  const chartHeight = Math.max(180, data.length * 34 + 40);

  return null;





























































}