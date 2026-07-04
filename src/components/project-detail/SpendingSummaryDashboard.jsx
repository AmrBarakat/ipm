import { useMemo } from 'react';
import { useEntityList } from '@/hooks/useEntity';
import { formatCurrency, EXPENSE_CATEGORY_LABELS } from '@/lib/constants';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Wallet, TrendingDown, Scale, Gauge } from 'lucide-react';

export default function SpendingSummaryDashboard({ projectId, currency = 'SAR' }) {
  const { data: expenses = [], isLoading: loading } = useEntityList('Expense', { project_id: projectId }, 'planned_date', 500);

  const { totalPlanned, totalActual, byCategory } = useMemo(() => {
    const planned = expenses
      .filter(e => e.status !== 'cancelled')
      .reduce((s, e) => s + (e.planned_amount || 0), 0);
    const actual = expenses
      .filter(e => ['committed', 'paid'].includes(e.status))
      .reduce((s, e) => s + (e.actual_amount || e.planned_amount || 0), 0);

    const map = {};
    expenses.forEach(e => {
      const cat = e.category || 'other';
      if (!map[cat]) map[cat] = { planned: 0, actual: 0 };
      if (e.status !== 'cancelled') map[cat].planned += (e.planned_amount || 0);
      if (['committed', 'paid'].includes(e.status)) map[cat].actual += (e.actual_amount || e.planned_amount || 0);
    });
    const rows = Object.entries(map)
      .map(([cat, v]) => ({
        name: EXPENSE_CATEGORY_LABELS[cat] || cat,
        Planned: Math.round(v.planned),
        Actual: Math.round(v.actual),
      }))
      .filter(r => r.Planned > 0 || r.Actual > 0)
      .sort((a, b) => (b.Planned + b.Actual) - (a.Planned + a.Actual));
    return { totalPlanned: planned, totalActual: actual, byCategory: rows };
  }, [expenses]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (expenses.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-5">
        <h3 className="font-semibold text-slate-700 text-sm uppercase tracking-wide flex items-center gap-2 border-b pb-3 mb-4">
          <Wallet className="w-4 h-4 text-amber-500" /> Actual vs Planned Spending
        </h3>
        <p className="text-sm text-slate-400 text-center py-8">No expenses recorded yet.</p>
      </div>
    );
  }

  const variance = totalPlanned - totalActual;
  const pctSpent = totalPlanned > 0 ? Math.round((totalActual / totalPlanned) * 100) : 0;
  const overBudget = totalActual > totalPlanned && totalPlanned > 0;

  return (
    <div className="bg-white rounded-lg shadow-sm p-5 space-y-5">
      <h3 className="font-semibold text-slate-700 text-sm uppercase tracking-wide flex items-center gap-2 border-b pb-3">
        <Wallet className="w-4 h-4 text-amber-500" /> Actual vs Planned Spending
      </h3>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi label="Planned Spending" value={formatCurrency(totalPlanned, currency)} icon={<TrendingDown className="w-5 h-5" />} accent="border-blue-400" />
        <Kpi label="Actual Spending" value={formatCurrency(totalActual, currency)} icon={<Wallet className="w-5 h-5" />} accent={overBudget ? 'border-red-500' : 'border-emerald-400'} />
        <Kpi label="Variance" value={formatCurrency(variance, currency)} icon={<Scale className="w-5 h-5" />} accent={variance < 0 ? 'border-red-500' : 'border-amber-400'} sub={variance < 0 ? 'Over plan' : 'Under plan'} />
        <Kpi label="% Spent" value={`${pctSpent}%`} icon={<Gauge className="w-5 h-5" />} accent={pctSpent > 100 ? 'border-red-500' : 'border-slate-400'} />
      </div>

      {/* Overall progress bar */}
      <div>
        <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
          <span>Overall spend vs plan</span>
          <span className={overBudget ? 'text-red-600 font-semibold' : 'text-slate-600'}>{pctSpent}%</span>
        </div>
        <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden relative">
          <div
            className={overBudget ? 'bg-red-500 h-3 rounded-full' : 'bg-amber-500 h-3 rounded-full'}
            style={{ width: `${Math.min(pctSpent, 100)}%` }}
          />
          {overBudget && (
            <div className="absolute top-0 right-0 h-3 w-2 bg-red-700" title={`${pctSpent - 100}% over plan`} />
          )}
        </div>
        <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
          <span>{formatCurrency(totalActual, currency)} spent</span>
          <span>{formatCurrency(totalPlanned, currency)} planned</span>
        </div>
      </div>

      {/* By-category grouped bar chart */}
      {byCategory.length > 0 ? (
        <div>
          <p className="text-xs text-slate-400 mb-2">Spending by category</p>
          <ResponsiveContainer width="100%" height={Math.max(220, byCategory.length * 48)}>
            <BarChart data={byCategory} margin={{ top: 4, right: 16, left: 8, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} angle={-25} textAnchor="end" interval={0} />
              <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
              <Tooltip
                formatter={(value) => formatCurrency(value, currency)}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Planned" fill="#93c5fd" radius={[4, 4, 0, 0]} maxBarSize={40} />
              <Bar dataKey="Actual" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="text-sm text-slate-400 text-center py-4">No categorized spending data yet.</p>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, icon, accent = 'border-slate-400' }) {
  return (
    <div className={`bg-white rounded-lg shadow-sm p-4 border-l-4 ${accent}`}>
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