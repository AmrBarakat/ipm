import { useMemo } from 'react';
import { useEntityList } from '@/hooks/useEntity';
import { sortMilestones } from '@/lib/utils';
import { ENTITY_QUERY } from '@/lib/entityQueryDefaults';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend } from 'recharts';
import { Target, Package, Activity } from 'lucide-react';

const MILESTONE_COLOR = '#f59e0b';   // amber-500
const DELIVERABLE_COLOR = '#3b82f6'; // blue-500

const DELIVERABLE_STATUS_PCT = {
  pending: 0,
  in_progress: 50,
  delivered: 85,
  accepted: 100,
  rejected: 0,
};
const DELIVERABLE_STATUS_LABEL = {
  pending: 'Pending',
  in_progress: 'In Progress',
  delivered: 'Delivered',
  accepted: 'Accepted',
  rejected: 'Rejected',
};
const MILESTONE_STATUS_LABEL = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
  overdue: 'Overdue',
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
    const ms = sortMilestones(milestones).map(m => ({
      name: truncate(m.title),
      fullName: m.title,
      progress: Math.max(0, Math.min(100, Number(m.progress) || 0)),
      type: 'Milestone',
      status: MILESTONE_STATUS_LABEL[m.status] || m.status || '—',
    }));
    const ds = deliverables.map(d => ({
      name: truncate(d.name),
      fullName: d.name,
      progress: DELIVERABLE_STATUS_PCT[d.status] ?? 0,
      type: 'Deliverable',
      status: DELIVERABLE_STATUS_LABEL[d.status] || d.status || '—',
    }));
    return [...ms, ...ds];
  }, [milestones, deliverables]);

  const milestoneCount = milestones.length;
  const deliverableCount = deliverables.length;
  const msCompleted = milestones.filter(m => m.status === 'completed').length;
  const delDone = deliverables.filter(d => d.status === 'delivered' || d.status === 'accepted').length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-5">
        <h3 className="font-semibold text-slate-700 text-sm uppercase tracking-wide flex items-center gap-2 border-b pb-3 mb-4">
          <Activity className="w-4 h-4 text-amber-500" /> Milestone & Deliverable Progress
        </h3>
        <p className="text-sm text-slate-400 text-center py-8">No milestones or deliverables yet.</p>
      </div>
    );
  }

  const chartHeight = Math.max(180, data.length * 34 + 40);

  return (
    <div className="bg-white rounded-lg shadow-sm p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-3">
        <h3 className="font-semibold text-slate-700 text-sm uppercase tracking-wide flex items-center gap-2">
          <Activity className="w-4 h-4 text-amber-500" /> Milestone & Deliverable Progress
        </h3>
        <div className="flex flex-wrap gap-5 text-sm">
          <div className="flex items-center gap-1.5">
            <Target className="w-3.5 h-3.5 text-amber-500" />
            <span className="text-slate-500">Milestones</span>
            <span className="font-semibold text-slate-800">{msCompleted}/{milestoneCount}</span>
            <span className="text-xs text-slate-400">done</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Package className="w-3.5 h-3.5 text-blue-500" />
            <span className="text-slate-500">Deliverables</span>
            <span className="font-semibold text-slate-800">{delDone}/{deliverableCount}</span>
            <span className="text-xs text-slate-400">done</span>
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
          <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={v => `${v}%`} />
          <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#475569' }} width={140} />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload;
              return (
                <div className="bg-white border border-slate-200 rounded-lg shadow-lg px-3 py-2 text-xs">
                  <div className="font-semibold text-slate-800 mb-1">{d.fullName}</div>
                  <div className="text-slate-500">{d.type} · {d.status}</div>
                  <div className="text-slate-700 font-medium">{d.progress}%</div>
                </div>
              );
            }}
          />
          <Legend
            formatter={(v) => <span className="text-xs text-slate-500">{v}</span>}
            wrapperStyle={{ fontSize: 12 }}
          />
          <Bar dataKey="progress" name="Milestone" radius={[0, 4, 4, 0]} maxBarSize={22}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.type === 'Milestone' ? MILESTONE_COLOR : DELIVERABLE_COLOR} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <div className="flex flex-wrap gap-4 text-xs text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm" style={{ background: MILESTONE_COLOR }} /> Milestones
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm" style={{ background: DELIVERABLE_COLOR }} /> Deliverables
        </span>
      </div>
    </div>
  );
}