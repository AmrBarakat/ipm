import { useMemo } from 'react';
import { useEntityList } from '@/hooks/useEntity';
import { formatDate, formatCurrency, EXPENSE_CATEGORY_LABELS } from '@/lib/constants';
import { CreditCard, CheckCircle, Wallet, TrendingUp, ShieldAlert, CalendarClock } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import StatusProgressChart from '@/components/project-detail/StatusProgressChart';
import SpendingSummaryDashboard from '@/components/project-detail/SpendingSummaryDashboard';

export default function TabOverview({ project, onRefresh }) {
  const { data: invoices = [], isLoading: invoicesLoading } = useEntityList('Invoice', { project_id: project.id }, 'planned_date', 500);
  const { data: expenses = [], isLoading: expensesLoading } = useEntityList('Expense', { project_id: project.id }, 'planned_date', 500);
  const { data: collections = [], isLoading: colLoading } = useEntityList('Collection', { project_id: project.id }, '-received_date', 500);
  const { data: risks = [], isLoading: risksLoading } = useEntityList('Risk', { project_id: project.id }, '-created_date', 200);
  const loading = invoicesLoading || expensesLoading || colLoading || risksLoading;

  const cur = project?.currency || 'SAR';
  const contractValue = project?.contract_value || 0;

  // Actual invoiced: invoiced/paid/partial/overdue → actual_amount fallback planned_amount
  const actualInvoiced = invoices.filter(i => ['invoiced','paid','partial','overdue'].includes(i.status)).reduce((s, i) => s + (i.actual_amount || i.planned_amount || 0), 0);
  const totalReceived = collections.reduce((s, c) => s + (c.amount || 0), 0);

  // Cost KPIs — aligned with TabFinancials logic
  const plannedCost = expenses.filter(e => e.status !== 'cancelled').reduce((s, e) => s + (e.planned_amount || 0), 0);
  const actualCost = expenses.filter(e => ['committed','paid'].includes(e.status)).reduce((s, e) => s + (e.actual_amount || e.planned_amount || 0), 0);
  const budgetVariance = plannedCost - actualCost;

  // Operational KPIs
  const invoicedPct = contractValue > 0 ? Math.round((actualInvoiced / contractValue) * 100) : null;
  const collectedPct = actualInvoiced > 0 ? Math.round((totalReceived / actualInvoiced) * 100) : null;
  const openRisks = risks.filter(r => r.status === 'open').length;

  // Schedule variance: planned end (target_completion_date) vs today.
  const targetDate = project?.target_completion_date;
  const scheduleVarianceDays = targetDate
    ? Math.round((new Date(targetDate) - new Date(new Date().toISOString().slice(0, 10))) / 86400000)
    : null;
  const scheduleValue = scheduleVarianceDays == null ? '—'
    : scheduleVarianceDays >= 0 ? `${scheduleVarianceDays}d left`
    : `${Math.abs(scheduleVarianceDays)}d over`;

  // Projected Profit: Collections (received) minus committed/paid expenses actual cost
  const totalExpenseActualCost = expenses.filter(e => ['committed','paid'].includes(e.status)).reduce((s, e) => s + (e.actual_amount || e.planned_amount || 0), 0);
  const projectedProfit = totalReceived - totalExpenseActualCost;
  const projectedProfitPct = totalReceived > 0 ? Math.round((projectedProfit / totalReceived) * 100) : 0;

  // Chart data: expense cost breakdown by category (committed/paid only)
  const profitChartData = useMemo(() => {
    const expByCategory = {};
    expenses.filter(e => ['committed','paid'].includes(e.status)).forEach(e => {
      const cat = e.category || 'other';
      if (!expByCategory[cat]) expByCategory[cat] = 0;
      expByCategory[cat] += (e.actual_amount || e.planned_amount || 0);
    });
    return Object.entries(expByCategory)
      .map(([cat, cost]) => ({ name: EXPENSE_CATEGORY_LABELS[cat] || cat, cost: Math.round(cost) }))
      .filter(r => r.cost > 0)
      .sort((a, b) => b.cost - a.cost);
  }, [expenses]);

  return (
    <div className="space-y-6">
      {/* Operational KPIs */}
      {!loading && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <KpiCard
            label="Progress"
            value={`${project.progress || 0}%`}
            icon={<TrendingUp className="w-5 h-5" />}
            accent="blue"
            sub="Overall"
          />
          <KpiCard
            label="Schedule"
            value={scheduleValue}
            icon={<CalendarClock className="w-5 h-5" />}
            accent={scheduleVarianceDays != null && scheduleVarianceDays < 0 ? 'red' : 'amber'}
            sub={targetDate ? `Target ${formatDate(targetDate)}` : 'No target date'}
          />
          <KpiCard
            label="Budget"
            value={formatCurrency(actualCost, cur)}
            icon={<Wallet className="w-5 h-5" />}
            accent={budgetVariance < 0 ? 'red' : 'blue'}
            sub={plannedCost > 0 ? `${Math.round((actualCost / plannedCost) * 100)}% of plan` : '—'}
          />
          <KpiCard
            label="Invoiced"
            value={invoicedPct == null ? '—' : `${invoicedPct}%`}
            icon={<CreditCard className="w-5 h-5" />}
            accent="purple"
            sub={formatCurrency(actualInvoiced, cur)}
          />
          <KpiCard
            label="Collected"
            value={collectedPct == null ? '—' : `${collectedPct}%`}
            icon={<CheckCircle className="w-5 h-5" />}
            accent="green"
            sub={formatCurrency(totalReceived, cur)}
          />
          <KpiCard
            label="Open Risks"
            value={openRisks}
            icon={<ShieldAlert className="w-5 h-5" />}
            accent={openRisks > 0 ? 'red' : 'green'}
            sub={`${risks.length} total`}
          />
        </div>
      )}

      {loading && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white rounded-lg shadow-sm p-4 h-20 animate-pulse bg-slate-100" />
          ))}
        </div>
      )}

      {/* Actual vs Planned Spending Dashboard */}
      {!loading && <SpendingSummaryDashboard projectId={project.id} currency={project.currency} />}

      {/* Milestone & Deliverable Progress Chart */}
      {!loading && <StatusProgressChart projectId={project.id} />}

      {/* Projected Profit Section */}
      {!loading && totalReceived > 0 && (
        <div className="bg-white rounded-lg shadow-sm p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-3">
            <h3 className="font-semibold text-slate-700 text-sm uppercase tracking-wide flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-500" /> Projected Profit Analysis
            </h3>
            <div className="flex flex-wrap gap-6 text-sm">
              <div className="text-center">
                <div className="text-xs text-slate-400 uppercase tracking-wide">Collected (Received)</div>
                <div className="font-bold text-slate-800">{formatCurrency(totalReceived, cur)}</div>
              </div>
              <div className="text-center">
                <div className="text-xs text-slate-400 uppercase tracking-wide">Total Expenses</div>
                <div className="font-bold text-red-600">{formatCurrency(totalExpenseActualCost, cur)}</div>
              </div>
              <div className="text-center">
                <div className="text-xs text-slate-400 uppercase tracking-wide">Projected Profit</div>
                <div className={`font-bold text-lg ${projectedProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {formatCurrency(projectedProfit, cur)}
                </div>
                <div className={`text-xs font-semibold ${projectedProfit >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                  {projectedProfitPct}% margin
                </div>
              </div>
            </div>
          </div>

          {profitChartData.length > 0 ? (
            <div>
              <p className="text-xs text-slate-400 mb-3">Expense cost breakdown by category</p>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={profitChartData} margin={{ top: 4, right: 16, left: 16, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} angle={-30} textAnchor="end" interval={0} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                  <Tooltip formatter={(value) => [formatCurrency(value, cur), 'Cost']} contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                  <Bar dataKey="cost" radius={[4, 4, 0, 0]} maxBarSize={60} fill="#f59e0b" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-slate-400 text-center py-4">No cost data yet to display chart.</p>
          )}
        </div>
      )}

      {/* Details + Description */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow-sm p-5 space-y-3">
          <h3 className="font-semibold text-slate-700 text-sm uppercase tracking-wide border-b pb-2">Project Details</h3>
          <Row label="Project Manager" value={project.project_manager} />
          <Row label="Start Date" value={formatDate(project.start_date)} />
          <Row label="Target Completion" value={formatDate(project.target_completion_date)} />
          <Row label="Contract Value" value={formatCurrency(project.contract_value, project.currency)} />
          <Row label="Type" value={project.project_type} />
          <Row label="Location" value={project.location} />
          <Row label="Client" value={project.client} />
        </div>

        <div className="space-y-4">
          {project.description && (
            <div className="bg-white rounded-lg shadow-sm p-5">
              <h3 className="font-semibold text-slate-700 text-sm uppercase tracking-wide border-b pb-2 mb-3">Description</h3>
              <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">{project.description}</p>
            </div>
          )}
          {project.scope && (
            <div className="bg-white rounded-lg shadow-sm p-5">
              <h3 className="font-semibold text-slate-700 text-sm uppercase tracking-wide border-b pb-2 mb-3">Scope of Work</h3>
              <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">{project.scope}</p>
            </div>
          )}
          {!project.description && !project.scope && (
            <div className="bg-white rounded-lg shadow-sm p-5 text-slate-400 text-sm text-center">
              No description or scope defined. Edit the project to add details.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const ACCENT_COLORS = {
  blue:   'border-blue-500',
  green:  'border-green-500',
  purple: 'border-purple-500',
  amber:  'border-amber-500',
  red:    'border-red-500',
};

function KpiCard({ label, value, sub, icon, accent = 'blue' }) {
  return (
    <div className={`bg-white rounded-lg shadow-sm p-4 border-l-4 ${ACCENT_COLORS[accent]}`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">{label}</div>
          <div className="text-xl font-semibold text-slate-800 leading-tight">{value}</div>
          {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
        </div>
        <div className="text-slate-300 shrink-0 mt-0.5">{icon}</div>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-800 text-right">{value || '—'}</span>
    </div>
  );
}