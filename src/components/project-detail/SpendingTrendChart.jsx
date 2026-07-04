import { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { formatCurrency } from '@/lib/constants';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { TrendingUp, Snowflake } from 'lucide-react';

/**
 * SpendingTrendChart – cumulative actual spending vs the baseline plan,
 * plotted month-by-month across the project timeline.
 */
export default function SpendingTrendChart({ expenses = [], project }) {
  const [baselines, setBaselines] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const bl = await base44.entities.Baseline.filter({ project_id: project?.id }, 'captured_date', 100);
        bl.sort((a, b) => (a.captured_date || '').localeCompare(b.captured_date || ''));
        if (active) setBaselines(bl);
      } catch {
        if (active) setBaselines([]);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [project?.id]);

  const earliest = baselines[0] || null;
  const currency = project?.currency || earliest?.currency || 'SAR';

  const data = useMemo(() => {
    if (!project) return [];

    // Determine timeline window
    const startStr = project.start_date || earliest?.captured_date;
    const endStr = project.target_completion_date || new Date().toISOString().slice(0, 10);
    if (!startStr) return [];
    const start = new Date(startStr.slice(0, 10) + 'T00:00:00');
    const end = new Date(endStr.slice(0, 10) + 'T00:00:00');
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return [];
    const span = end - start || 1;

    // Build month buckets
    const months = [];
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);
    while (cursor <= endMonth) {
      months.push(new Date(cursor));
      cursor.setMonth(cursor.getMonth() + 1);
    }

    // Actual expenses (committed/paid) sorted by date for cumulative sum
    const actuals = expenses
      .filter(e => ['committed', 'paid'].includes(e.status))
      .map(e => ({ date: (e.actual_date || e.planned_date || '').slice(0, 10), amount: Number(e.actual_amount) || Number(e.planned_amount) || 0 }))
      .filter(e => e.date)
      .sort((a, b) => a.date.localeCompare(b.date));

    const baselineTotal = earliest?.total_planned_cost || 0;

    return months.map(m => {
      const monthEnd = new Date(m.getFullYear(), m.getMonth() + 1, 0); // last day of month
      const monthEndStr = monthEnd.toISOString().slice(0, 10);

      // Cumulative actual up to end of this month
      const actualCum = actuals
        .filter(a => a.date <= monthEndStr)
        .reduce((s, a) => s + a.amount, 0);

      // Baseline plan: linear cumulative distribution of the frozen total across the timeline
      const elapsed = Math.max(0, Math.min(1, (monthEnd - start) / span));
      const baselineCum = Math.round(baselineTotal * elapsed);

      return {
        month: m.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        'Baseline Plan': baselineCum,
        'Actual Spending': Math.round(actualCum),
      };
    });
  }, [expenses, project, earliest]);

  const hasBaseline = !!earliest;

  return (
    <div className="bg-white rounded-lg shadow-sm p-5 space-y-3">
      <h3 className="font-semibold text-slate-700 text-sm uppercase tracking-wide flex items-center gap-2 border-b pb-3">
        <TrendingUp className="w-4 h-4 text-amber-500" /> Spending Trend — Actual vs Baseline Plan
      </h3>

      {loading ? (
        <div className="flex justify-center py-10"><div className="w-7 h-7 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>
      ) : !hasBaseline ? (
        <div className="flex flex-col items-center text-center py-8 text-slate-400">
          <Snowflake className="w-8 h-8 mb-2 opacity-40" />
          <p className="text-sm">No baseline captured yet. Capture a baseline to compare the spending trend against the plan.</p>
        </div>
      ) : data.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-8">Add project start and target completion dates to plot the trend.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1"><Snowflake className="w-3 h-3 text-amber-500" /> Baseline: <span className="font-semibold text-slate-700">{earliest.baseline_name}</span> ({formatCurrency(earliest.total_planned_cost, currency)})</span>
            <span>· {data.length} month{data.length !== 1 ? 's' : ''}</span>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={data} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} />
              <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
              <Tooltip
                formatter={(value) => formatCurrency(value, currency)}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="Baseline Plan" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 5" dot={false} />
              <Line type="monotone" dataKey="Actual Spending" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </>
      )}
    </div>
  );
}