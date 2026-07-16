import { useMemo } from 'react';
import { useEntityList } from '@/hooks/useEntity';
import { ENTITY_QUERY } from '@/lib/entityQueryDefaults';
import { formatDate, formatCurrency, EXPENSE_CATEGORY_LABELS, isTopLevelBOM } from '@/lib/constants';
import { FileText, CreditCard, CheckCircle, AlertCircle, ClipboardList, BarChart2, PieChart, Wallet, Package, Tag, Truck, ShoppingCart, TrendingUp } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import StatusProgressChart from '@/components/project-detail/StatusProgressChart';
import SpendingSummaryDashboard from '@/components/project-detail/SpendingSummaryDashboard';

export default function TabOverview({ project, onRefresh }) {
  const { data: invoices = [], isLoading: invoicesLoading } = useEntityList('Invoice', { project_id: project.id }, 'planned_date', 500);
  const { data: expenses = [], isLoading: expensesLoading } = useEntityList('Expense', { project_id: project.id }, 'planned_date', 500);
  const { data: bomItems = [], isLoading: bomLoading } = useEntityList('BOMItem', { project_id: project.id }, ENTITY_QUERY.BOMItem.sort, ENTITY_QUERY.BOMItem.limit);
  const { data: collections = [], isLoading: colLoading } = useEntityList('Collection', { project_id: project.id }, '-received_date', 500);
  const loading = invoicesLoading || expensesLoading || bomLoading || colLoading;

  const cur = project?.currency || 'SAR';
  const contractValue = project?.contract_value || 0;

  // Financial KPIs — aligned with TabFinancials logic
  // Planned invoiced: all non-cancelled invoices → planned_amount
  const plannedInvoiced = invoices.filter(i => i.status !== 'cancelled').reduce((s, i) => s + (i.planned_amount || 0), 0);
  // Actual invoiced: invoiced/paid/partial/overdue → actual_amount fallback planned_amount
  const actualInvoiced = invoices.filter(i => ['invoiced','paid','partial','overdue'].includes(i.status)).reduce((s, i) => s + (i.actual_amount || i.planned_amount || 0), 0);
  const totalReceived = collections.reduce((s, c) => s + (c.amount || 0), 0);
  const outstanding = actualInvoiced - totalReceived;

  // Cost KPIs — aligned with TabFinancials logic
  // Planned: all non-cancelled expenses → planned_amount
  const plannedCost = expenses.filter(e => e.status !== 'cancelled').reduce((s, e) => s + (e.planned_amount || 0), 0);
  // Actual: committed/paid expenses → actual_amount fallback planned_amount
  const actualCost = expenses.filter(e => ['committed','paid'].includes(e.status)).reduce((s, e) => s + (e.actual_amount || e.planned_amount || 0), 0);
  const plannedMargin = contractValue - plannedCost;
  const plannedMarginPct = contractValue > 0 ? Math.round((plannedMargin / contractValue) * 100) : 0;
  const cashOnHand = totalReceived - actualCost;

  // BOM KPIs — exclude panel child rows (parent_id) so a panel is counted once
  // and its cost isn't double-counted with its components.
  const topBom = bomItems.filter(isTopLevelBOM);
  const bomCost = topBom.reduce((s, i) => s + (i.cost_price || 0) * (i.quantity || 1), 0);
  const bomSell = topBom.reduce((s, i) => s + (i.selling_price || 0) * (i.quantity || 1), 0);
  const bomMarginPct = bomSell > 0 ? Math.round(((bomSell - bomCost) / bomSell) * 100) : 0;
  const alreadyOrdered = topBom.filter(i => i.ordered).reduce((s, i) => s + (i.cost_price || 0) * (i.quantity || 1), 0);
  const orderedCount = topBom.filter(i => i.ordered).length;
  const toOrderItems = topBom.filter(i => !i.ordered && i.stock_status === 'non_stock');
  const toOrderValue = toOrderItems.reduce((s, i) => s + (i.cost_price || 0) * (i.quantity || 1), 0);

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
      {/* Financial Summary KPIs */}
      {!loading && (
        <>
          {/* Row 1: Contract / Invoiced / Paid / Outstanding */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard
              label="Contract Value"
              value={formatCurrency(contractValue, cur)}
              icon={<FileText className="w-5 h-5" />}
              accent="blue"
            />
            <KpiCard
              label="Planned Invoiced"
              value={formatCurrency(plannedInvoiced, cur)}
              sub={contractValue > 0 ? `${Math.round((plannedInvoiced / contractValue) * 100)}% of contract` : null}
              icon={<CreditCard className="w-5 h-5" />}
              accent="green"
            />
            <KpiCard
              label="Received"
              value={formatCurrency(totalReceived, cur)}
              sub={contractValue > 0 ? `${Math.round((totalReceived / contractValue) * 100)}% of contract` : null}
              icon={<CheckCircle className="w-5 h-5" />}
              accent="purple"
            />
            <KpiCard
              label="Outstanding"
              value={formatCurrency(outstanding, cur)}
              icon={<AlertCircle className="w-5 h-5" />}
              accent="amber"
            />
          </div>

          {/* Row 2: Planned Cost / Actual Cost / Planned Margin / Cash on Hand */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard
              label="Planned Cost"
              value={formatCurrency(plannedCost, cur)}
              icon={<ClipboardList className="w-5 h-5" />}
              accent="blue"
            />
            <KpiCard
              label="Actual Cost"
              value={formatCurrency(actualCost, cur)}
              icon={<BarChart2 className="w-5 h-5" />}
              accent="red"
            />
            <KpiCard
              label="Planned Margin"
              value={formatCurrency(plannedMargin, cur)}
              sub={`${plannedMarginPct}% margin`}
              icon={<PieChart className="w-5 h-5" />}
              accent="green"
            />
            <KpiCard
              label="Cash on Hand (so far)"
              value={formatCurrency(cashOnHand, cur)}
              icon={<Wallet className="w-5 h-5" />}
              accent={cashOnHand >= 0 ? 'amber' : 'red'}
            />
          </div>

          {/* Row 3: BOM Cost / BOM Sell / Already Ordered / To Order */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard
              label="BOM Cost (Parts)"
              value={formatCurrency(bomCost, cur)}
              sub={`${topBom.length} line item${topBom.length !== 1 ? 's' : ''}`}
              icon={<Package className="w-5 h-5" />}
              accent="blue"
            />
            <KpiCard
              label="BOM Sell"
              value={formatCurrency(bomSell, cur)}
              sub={`Margin ${bomMarginPct}%`}
              icon={<Tag className="w-5 h-5" />}
              accent="green"
            />
            <KpiCard
              label="Already Ordered"
              value={formatCurrency(alreadyOrdered, cur)}
              sub={`${orderedCount} PO${orderedCount !== 1 ? 's' : ''} issued`}
              icon={<Truck className="w-5 h-5" />}
              accent="purple"
            />
            <KpiCard
              label="To Order"
              value={formatCurrency(toOrderValue, cur)}
              sub={`${toOrderItems.length} non-stock item${toOrderItems.length !== 1 ? 's' : ''} pending`}
              icon={<ShoppingCart className="w-5 h-5" />}
              accent="amber"
            />
          </div>
        </>
      )}

      {loading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
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