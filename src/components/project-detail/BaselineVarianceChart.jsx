import { useEntityList } from '@/hooks/useEntity';
import { ENTITY_QUERY } from '@/lib/entityQueryDefaults';
import { baselineVariance } from '@/lib/reportExport';
import { formatCurrency } from '@/lib/constants';
import { GitCompare } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell,
} from 'recharts';

const STREAM_LABELS = { goods: 'Goods', services: 'Services', support: 'Support' };

// Visual chart comparing the active charter baseline (planned) against live
// committed + actual cost per stream, so cost drifts surface early. Reuses the
// shared baselineVariance helper — no local arithmetic.
export default function BaselineVarianceChart({ project }) {
  const { data: baselines = [], isLoading: blLoading } = useEntityList('CharterBaseline', { project_id: project.id }, ENTITY_QUERY.CharterBaseline.sort, ENTITY_QUERY.CharterBaseline.limit);
  const { data: baselineLines = [], isLoading: llLoading } = useEntityList('BaselineLine', { project_id: project.id }, ENTITY_QUERY.BaselineLine.sort, ENTITY_QUERY.BaselineLine.limit);
  const { data: bomItems = [], isLoading: bomLoading } = useEntityList('BOMItem', { project_id: project.id }, ENTITY_QUERY.BOMItem.sort, ENTITY_QUERY.BOMItem.limit);
  const { data: expenses = [], isLoading: expLoading } = useEntityList('Expense', { project_id: project.id }, 'planned_date', 500);

  const loading = blLoading || llLoading || bomLoading || expLoading;
  const bv = baselineVariance(project, baselines, baselineLines, bomItems, expenses);

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-5">
        <div className="h-6 w-48 bg-slate-100 rounded animate-pulse mb-4" />
        <div className="h-64 bg-slate-100 rounded animate-pulse" />
      </div>
    );
  }

  if (!bv.hasBaseline) {
    return null; // The BaselineVarianceCard already shows the empty-state message.
  }

  const cur = bv.currency;
  const chartData = bv.streams.map(s => ({
    stream: STREAM_LABELS[s.stream] || s.stream,
    Planned: Math.round(s.planned),
    Committed: Math.round(s.committed),
    Actual: Math.round(s.actual),
    variance: s.variance,
  }));
  // Append uncategorised as its own column so it's visible but not compared to a baseline.
  if (bv.uncategorisedActual > 0) {
    chartData.push({
      stream: 'Uncategorised',
      Planned: 0,
      Committed: 0,
      Actual: Math.round(bv.uncategorisedActual),
      variance: bv.uncategorisedActual,
    });
  }

  const maxVal = Math.max(...chartData.flatMap(d => [d.Planned, d.Committed, d.Actual]), 1);
  const yDomain = [0, Math.ceil(maxVal * 1.1)];

  return (
    <div className="bg-white rounded-lg shadow-sm p-5 space-y-4">
      <div className="flex items-center justify-between border-b pb-2">
        <h3 className="font-semibold text-slate-700 text-sm uppercase tracking-wide flex items-center gap-2">
          <GitCompare className="w-4 h-4 text-blue-500" /> Baseline vs Live Cost Drift
        </h3>
        <span className="text-xs text-slate-400">{bv.revisionLabel || 'Rev 0'}</span>
      </div>

      <div className="flex flex-wrap gap-4 text-xs">
        <Legend2 color="#64748b" label="Planned (baseline)" />
        <Legend2 color="#f59e0b" label="Committed" />
        <Legend2 color="#dc2626" label="Actual (over baseline)" />
        <Legend2 color="#059669" label="Actual (under baseline)" />
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="stream" tick={{ fontSize: 12, fill: '#475569' }} />
          <YAxis
            domain={yDomain}
            tick={{ fontSize: 11, fill: '#64748b' }}
            tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
          />
          <Tooltip
            formatter={(value, name) => [formatCurrency(value, cur), name]}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="Planned" fill="#64748b" radius={[3, 3, 0, 0]} maxBarSize={48} />
          <Bar dataKey="Committed" fill="#f59e0b" radius={[3, 3, 0, 0]} maxBarSize={48} />
          <Bar dataKey="Actual" radius={[3, 3, 0, 0]} maxBarSize={48}>
            {chartData.map((d, i) => (
              <Cell key={i} fill={d.Planned > 0 && d.Actual > d.Planned ? '#dc2626' : '#059669'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Drift summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <DriftStat label="Baseline Cost" value={formatCurrency(bv.totalBaselineCost, cur)} tone="neutral" />
        <DriftStat label="Live Actual Cost" value={formatCurrency(bv.totalActualCost, cur)} tone={bv.totalActualCost > bv.totalBaselineCost ? 'bad' : 'good'} />
        <DriftStat
          label="Total Drift"
          value={formatCurrency(bv.totalActualCost - bv.totalBaselineCost, cur)}
          tone={bv.totalActualCost > bv.totalBaselineCost ? 'bad' : 'good'}
        />
        <DriftStat
          label="Margin Erosion"
          value={bv.erosionPoints != null ? `${bv.erosionPoints} pts` : '—'}
          tone={bv.erosionPoints != null && bv.erosionPoints > 3 ? 'bad' : 'good'}
        />
      </div>
    </div>
  );
}

function Legend2({ color, label }) {
  return (
    <div className="flex items-center gap-1.5 text-slate-500">
      <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
      {label}
    </div>
  );
}

function DriftStat({ label, value, tone }) {
  const toneClass = tone === 'bad' ? 'text-red-600' : tone === 'good' ? 'text-emerald-600' : 'text-slate-700';
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
      <div className="text-[10px] text-slate-400 uppercase tracking-wide">{label}</div>
      <div className={`font-bold ${toneClass}`}>{value}</div>
    </div>
  );
}