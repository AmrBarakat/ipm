import { useMemo } from 'react';
import { formatCurrency } from '@/lib/constants';
import { DollarSign, TrendingUp, Layers, CheckSquare } from 'lucide-react';

export default function ProjectSummaryWidget({ projects }) {
  const metrics = useMemo(() => {
    if (!projects.length) return null;

    const totalValue = projects.reduce((s, p) => s + (p.contract_value || 0), 0);
    const avgProgress = Math.round(
      projects.reduce((s, p) => s + (p.progress || 0), 0) / projects.length
    );
    const activeCount = projects.filter(p => ['planning', 'in_progress', 'commissioning'].includes(p.status)).length;
    const completedCount = projects.filter(p => p.status === 'completed').length;

    return { totalValue, avgProgress, activeCount, completedCount };
  }, [projects]);

  if (!metrics) return null;

  // Currency — use most common currency across projects
  const currency = projects[0]?.currency || 'SAR';

  // Average progress ring data
  const pct = metrics.avgProgress;
  const CIRC = 2 * Math.PI * 20;
  const offset = CIRC - (pct / 100) * CIRC;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      {/* Total Contract Value */}
      <div className="bg-white rounded-lg shadow-sm p-4 border-l-4 border-blue-400">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">Total Contract Value</div>
            <div className="text-xl font-semibold text-slate-800 leading-tight">
              {formatCurrency(metrics.totalValue, currency)}
            </div>
            <div className="text-xs text-slate-400 mt-0.5">{projects.length} projects</div>
          </div>
          <DollarSign className="w-5 h-5 text-slate-300 shrink-0 mt-0.5" />
        </div>
      </div>

      {/* Average Progress */}
      <div className="bg-white rounded-lg shadow-sm p-4 border-l-4 border-amber-400">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">Average Progress</div>
            <div className="text-xl font-semibold text-slate-800">{pct}%</div>
            <div className="w-full bg-slate-100 rounded-full h-1.5 mt-2">
              <div
                className="h-1.5 rounded-full bg-amber-400 transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
          <TrendingUp className="w-5 h-5 text-slate-300 shrink-0 mt-0.5 ml-3" />
        </div>
      </div>

      {/* Active Projects */}
      <div className="bg-white rounded-lg shadow-sm p-4 border-l-4 border-purple-400">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">Active Projects</div>
            <div className="text-xl font-semibold text-slate-800">{metrics.activeCount}</div>
            <div className="text-xs text-slate-400 mt-0.5">currently in progress</div>
          </div>
          <Layers className="w-5 h-5 text-slate-300 shrink-0 mt-0.5" />
        </div>
      </div>

      {/* Completed Projects */}
      <div className="bg-white rounded-lg shadow-sm p-4 border-l-4 border-emerald-400">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">Completed Projects</div>
            <div className="text-xl font-semibold text-emerald-700">{metrics.completedCount}</div>
            <div className="text-xs text-slate-400 mt-0.5">of {projects.length} total</div>
          </div>
          <CheckSquare className="w-5 h-5 text-slate-300 shrink-0 mt-0.5" />
        </div>
      </div>
    </div>
  );
}