import { useMemo } from 'react';
import { useEntityList } from '@/hooks/useEntity';
import { formatCurrency, STATUS_LABELS, STATUS_COLORS } from '@/lib/constants';
import { AlertTriangle, ArrowUpRight, ArrowDownRight, Flag } from 'lucide-react';
import SkeletonTable from '@/components/ui/SkeletonTable';
import EmptyState from '@/components/ui/EmptyState';

const ACTIVE_STATUSES = ['planning', 'in_progress', 'commissioning'];
const ATTENTION_VARIANCE_PCT = 5; // over budget by >5%

function todayStr() { return new Date().toISOString().slice(0, 10); }

export default function PortfolioHealthTable({ projects }) {
  const { data: expenses = [], isLoading: eLoading, isError: eError, refetch: refetchE } = useEntityList('Expense', null, '-created_date', 1000);
  const { data: milestones = [], isLoading: mLoading, isError: mError, refetch: refetchM } = useEntityList('Milestone', null, '-created_date', 1000);
  const loading = eLoading || mLoading;
  const isError = eError || mError;
  const refetch = () => { refetchE(); refetchM(); };

  const activeProjects = useMemo(
    () => projects.filter(p => ACTIVE_STATUSES.includes(p.status)),
    [projects]
  );

  const rows = useMemo(() => {
    const expByProject = {};
    expenses.forEach(e => {
      if (!expByProject[e.project_id]) expByProject[e.project_id] = [];
      expByProject[e.project_id].push(e);
    });
    const milByProject = {};
    milestones.forEach(m => {
      if (!milByProject[m.project_id]) milByProject[m.project_id] = [];
      milByProject[m.project_id].push(m);
    });

    const today = todayStr();
    return activeProjects.map(p => {
      const pExp = expByProject[p.id] || [];
      const pMil = milByProject[p.id] || [];

      // Cost variance: actual vs planned from expenses
      const plannedCost = pExp
        .filter(e => e.status !== 'cancelled')
        .reduce((s, e) => s + (e.planned_amount || 0), 0);
      const actualCost = pExp
        .filter(e => ['committed', 'paid'].includes(e.status))
        .reduce((s, e) => s + (e.actual_amount || e.planned_amount || 0), 0);
      const costVariance = actualCost - plannedCost; // positive = over planned
      const variancePct = plannedCost > 0 ? (costVariance / plannedCost) * 100 : 0;
      const overBudget = costVariance > 0 && plannedCost > 0 && variancePct > ATTENTION_VARIANCE_PCT;

      // Milestone progress
      const total = pMil.length;
      const completed = pMil.filter(m => m.status === 'completed').length;
      const overdue = pMil.filter(m =>
        m.status !== 'completed' && m.planned_date && m.planned_date < today
      ).length;
      const totalWeight = pMil.reduce((s, m) => s + (m.weight || 0), 0);
      const completedWeight = pMil
        .filter(m => m.status === 'completed')
        .reduce((s, m) => s + (m.weight || 0), 0);
      const milestoneProgress = totalWeight > 0
        ? Math.round((completedWeight / totalWeight) * 100)
        : total > 0 ? Math.round((completed / total) * 100) : 0;

      const needsAttention = overBudget || overdue > 0;

      return {
        project: p,
        plannedCost,
        actualCost,
        costVariance,
        variancePct,
        overBudget,
        total,
        completed,
        overdue,
        milestoneProgress,
        needsAttention,
      };
    }).sort((a, b) => {
      // Attention first, then most over budget, then least milestone progress
      if (a.needsAttention !== b.needsAttention) return a.needsAttention ? -1 : 1;
      if (b.costVariance !== a.costVariance) return b.costVariance - a.costVariance;
      return a.milestoneProgress - b.milestoneProgress;
    });
  }, [activeProjects, expenses, milestones]);

  if (loading) return <SkeletonTable columns={6} rows={6} />;

  if (isError) return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <AlertTriangle className="w-8 h-8 text-red-400" />
      <p className="text-sm text-red-500">Failed to load health data.</p>
      <button onClick={refetch} className="px-3 py-1.5 text-xs font-semibold border border-red-300 text-red-600 rounded hover:bg-red-50">Retry</button>
    </div>
  );

  if (activeProjects.length === 0) {
    return (
      <EmptyState
        icon={<Flag className="w-12 h-12 opacity-40" />}
        title="No active projects"
        message="Projects in planning, in progress, or commissioning will appear here for comparison."
      />
    );
  }

  const attentionCount = rows.filter(r => r.needsAttention).length;

  return (
    <div className="bg-white rounded-lg shadow-sm overflow-hidden">
      {/* Header summary */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
        <div>
          <h2 className="font-semibold text-slate-700 text-sm">Project Health Comparison</h2>
          <p className="text-xs text-slate-400">{rows.length} active project{rows.length !== 1 ? 's' : ''}</p>
        </div>
        {attentionCount > 0 && (
          <span className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-700 border border-red-200 rounded text-xs font-semibold">
            <AlertTriangle className="w-3.5 h-3.5" /> {attentionCount} need{attentionCount === 1 ? 's' : ''} attention
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[860px]">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase border-b border-slate-100">
            <tr>
              <th className="px-4 py-3 text-left">Project</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-right">Planned Cost</th>
              <th className="px-4 py-3 text-right">Actual Cost</th>
              <th className="px-4 py-3 text-right">Cost Variance</th>
              <th className="px-4 py-3 text-left">Milestone Progress</th>
              <th className="px-4 py-3 text-center">Attention</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.project.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-3">
                  <a href={`/projects/${r.project.id}`} className="block">
                    <div className="font-semibold text-slate-800 hover:text-amber-600">{r.project.name}</div>
                    <div className="text-xs text-slate-400 flex items-center gap-2">
                      <span className="font-mono">{r.project.code}</span>
                      {r.project.client && <span>· {r.project.client}</span>}
                    </div>
                  </a>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded font-semibold ${STATUS_COLORS[r.project.status] || 'bg-slate-100 text-slate-600'}`}>
                    {STATUS_LABELS[r.project.status] || r.project.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-slate-600">{formatCurrency(r.plannedCost, r.project.currency)}</td>
                <td className="px-4 py-3 text-right font-semibold text-slate-800">{formatCurrency(r.actualCost, r.project.currency)}</td>
                <td className="px-4 py-3 text-right">
                  {r.plannedCost > 0 ? (
                    <span className={`inline-flex items-center gap-1 font-semibold ${
                      r.costVariance > 0 ? 'text-red-600' : r.costVariance < 0 ? 'text-emerald-600' : 'text-slate-500'
                    }`}>
                      {r.costVariance > 0 ? <ArrowUpRight className="w-3.5 h-3.5" /> : r.costVariance < 0 ? <ArrowDownRight className="w-3.5 h-3.5" /> : null}
                      {r.costVariance > 0 ? '+' : ''}{formatCurrency(r.costVariance, r.project.currency)}
                      <span className="text-xs text-slate-400 font-normal">({r.variancePct > 0 ? '+' : ''}{r.variancePct.toFixed(1)}%)</span>
                    </span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {r.total === 0 ? (
                    <span className="text-xs text-slate-400">No milestones</span>
                  ) : (
                    <div className="flex items-center gap-2 min-w-[160px]">
                      <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-2 rounded-full ${r.overdue > 0 ? 'bg-red-500' : r.milestoneProgress === 100 ? 'bg-emerald-500' : 'bg-amber-500'}`}
                          style={{ width: `${r.milestoneProgress}%` }}
                        />
                      </div>
                      <span className="text-xs font-semibold text-slate-600 w-9 text-right">{r.milestoneProgress}%</span>
                      <span className="text-xs text-slate-400 whitespace-nowrap">
                        {r.completed}/{r.total}
                        {r.overdue > 0 && <span className="text-red-500 font-semibold"> · {r.overdue} overdue</span>}
                      </span>
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  {r.needsAttention ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600">
                      <AlertTriangle className="w-3.5 h-3.5" /> Attention
                    </span>
                  ) : (
                    <span className="text-xs text-emerald-600 font-semibold">On track</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}