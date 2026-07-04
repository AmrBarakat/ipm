import { useMemo } from 'react';
import { formatCurrency, EXPENSE_CATEGORY_LABELS } from '@/lib/constants';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { BarChart2 } from 'lucide-react';

/**
 * ExpenseCategoryChart – grouped bar chart of Planned vs Actual spending by expense category.
 * Reuses already-fetched expense records (no extra API call).
 */
export default function ExpenseCategoryChart({ expenses = [], currency = 'SAR' }) {
  const data = useMemo(() => {
    const map = {};
    expenses.forEach(e => {
      const cat = e.category || 'other';
      if (!map[cat]) map[cat] = { planned: 0, actual: 0 };
      if (e.status !== 'cancelled') map[cat].planned += (e.planned_amount || 0);
      if (['committed', 'paid'].includes(e.status)) map[cat].actual += (e.actual_amount || e.planned_amount || 0);
    });
    return Object.entries(map)
      .map(([cat, v]) => ({
        name: EXPENSE_CATEGORY_LABELS[cat] || cat,
        Planned: Math.round(v.planned),
        Actual: Math.round(v.actual),
      }))
      .filter(r => r.Planned > 0 || r.Actual > 0)
      .sort((a, b) => (b.Planned + b.Actual) - (a.Planned + a.Actual));
  }, [expenses]);

  if (data.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-5">
        <h3 className="font-semibold text-slate-700 text-sm uppercase tracking-wide flex items-center gap-2 border-b pb-3 mb-4">
          <BarChart2 className="w-4 h-4 text-amber-500" /> Expenses by Category
        </h3>
        <p className="text-sm text-slate-400 text-center py-8">No expense data to chart yet.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-sm p-5 space-y-3">
      <h3 className="font-semibold text-slate-700 text-sm uppercase tracking-wide flex items-center gap-2 border-b pb-3">
        <BarChart2 className="w-4 h-4 text-amber-500" /> Expenses by Category — Planned vs Actual
      </h3>
      <ResponsiveContainer width="100%" height={Math.max(240, data.length * 50)}>
        <BarChart data={data} margin={{ top: 4, right: 16, left: 8, bottom: 40 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} angle={-25} textAnchor="end" interval={0} />
          <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
          <Tooltip
            formatter={(value) => formatCurrency(value, currency)}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="Planned" fill="#93c5fd" radius={[4, 4, 0, 0]} maxBarSize={44} />
          <Bar dataKey="Actual" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={44} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}