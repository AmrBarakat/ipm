import { useEntityList } from '@/hooks/useEntity';
import { ENTITY_QUERY } from '@/lib/entityQueryDefaults';
import { baselineVariance } from '@/lib/reportExport';
import { formatCurrency } from '@/lib/constants';
import { GitCompare, AlertTriangle, TrendingDown, FileText } from 'lucide-react';

const STREAM_LABELS = { goods: 'Goods', services: 'Services', support: 'Support' };

export default function BaselineVarianceCard({ project }) {
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
        <div className="h-20 bg-slate-100 rounded animate-pulse" />
      </div>
    );
  }

  if (!bv.hasBaseline) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-5">
        <div className="flex items-center gap-2 border-b pb-2 mb-3">
          <GitCompare className="w-4 h-4 text-slate-400" />
          <h3 className="font-semibold text-slate-700 text-sm uppercase tracking-wide">Baseline Variance</h3>
        </div>
        <p className="text-sm text-slate-400 text-center py-3">
          No active charter baseline. Import a charter document in the Documents tab to establish a commercial baseline.
        </p>
      </div>
    );
  }

  const cur = bv.currency;
  const pctStr = (v) => v != null ? `${Math.round(v * 100)}%` : '—';

  return (
    <div className="bg-white rounded-lg shadow-sm p-5 space-y-4">
      <div className="flex items-center justify-between border-b pb-2">
        <h3 className="font-semibold text-slate-700 text-sm uppercase tracking-wide flex items-center gap-2">
          <GitCompare className="w-4 h-4 text-blue-500" /> Baseline Variance
        </h3>
        <span className="text-xs text-slate-400">{bv.revisionLabel || 'Rev 0'}</span>
      </div>

      {/* Per-stream table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-100 text-slate-500 uppercase">
            <tr>
              <th className="px-3 py-2 text-left">Stream</th>
              <th className="px-3 py-2 text-right">Planned</th>
              <th className="px-3 py-2 text-right">Committed</th>
              <th className="px-3 py-2 text-right">Actual</th>
              <th className="px-3 py-2 text-right">Variance</th>
            </tr>
          </thead>
          <tbody>
            {bv.streams.map(s => {
              const over = s.variance > 0;
              const pctVal = s.planned > 0 ? Math.round(s.variance / s.planned * 100) : 0;
              return (
                <tr key={s.stream} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-700">{STREAM_LABELS[s.stream] || s.stream}</td>
                  <td className="px-3 py-2 text-right text-slate-600">{formatCurrency(s.planned, cur)}</td>
                  <td className="px-3 py-2 text-right text-slate-600">{formatCurrency(s.committed, cur)}</td>
                  <td className="px-3 py-2 text-right text-slate-700 font-medium">{formatCurrency(s.actual, cur)}</td>
                  <td className={`px-3 py-2 text-right font-semibold ${over ? 'text-red-600' : 'text-emerald-600'}`}>
                    {over ? '+' : ''}{formatCurrency(s.variance, cur)} ({pctVal}%)
                  </td>
                </tr>
              );
            })}
            {bv.uncategorisedActual > 0 && (
              <tr className="border-t border-slate-100 bg-amber-50/40">
                <td className="px-3 py-2 font-medium text-amber-700">Uncategorised</td>
                <td className="px-3 py-2 text-right text-slate-300">—</td>
                <td className="px-3 py-2 text-right text-slate-300">—</td>
                <td className="px-3 py-2 text-right text-amber-700 font-medium">{formatCurrency(bv.uncategorisedActual, cur)}</td>
                <td className="px-3 py-2 text-right text-amber-500">—</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Margin erosion */}
      <div className="flex items-center gap-4 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-sm">
        <div className="text-center">
          <div className="text-xs text-slate-400 uppercase tracking-wide">Margin at Baseline</div>
          <div className="font-bold text-slate-800">{pctStr(bv.marginAtBaseline)}</div>
        </div>
        <TrendingDown className="w-4 h-4 text-slate-300" />
        <div className="text-center">
          <div className="text-xs text-slate-400 uppercase tracking-wide">Margin at Completion</div>
          <div className={`font-bold ${bv.erosionPoints != null && bv.erosionPoints > 3 ? 'text-red-600' : 'text-slate-800'}`}>{pctStr(bv.marginAtCompletion)}</div>
        </div>
        <div className="ml-auto text-center">
          <div className="text-xs text-slate-400 uppercase tracking-wide">Erosion</div>
          <div className={`font-bold ${bv.erosionPoints != null && bv.erosionPoints > 3 ? 'text-red-600' : 'text-emerald-600'}`}>
            {bv.erosionPoints != null ? `${bv.erosionPoints} pts` : '—'}
          </div>
        </div>
      </div>

      {/* Insights */}
      {bv.insights.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-amber-700 font-semibold uppercase tracking-wide">
            <AlertTriangle className="w-3.5 h-3.5" /> Insights
          </div>
          {bv.insights.map((ins, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-amber-700">
              <FileText className="w-3 h-3 mt-0.5 shrink-0 opacity-50" />
              <span>{ins.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}