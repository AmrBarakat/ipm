import { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { formatCurrency, formatDate, isTopLevelBOM } from '@/lib/constants';
import { todayLocal } from '@/lib/utils';
import { Camera, GitCompare, Snowflake, TrendingUp, TrendingDown } from 'lucide-react';

/**
 * BaselineManager – read-only baseline capture + Cost Variance vs earliest baseline.
 * Reads the project's current BOM items and contract value, freezes a Baseline record,
 * and shows the delta between current planned/actual totals and the earliest baseline.
 */
export default function BaselineManager({ projectId, project }) {
  const [baselines, setBaselines] = useState([]);
  const [bomItems, setBomItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [baselineName, setBaselineName] = useState('');
  const [showNameInput, setShowNameInput] = useState(false);

  const currency = project?.currency || 'SAR';

  const load = useCallback(async () => {
    setLoading(true);
    const [bl, bom] = await Promise.all([
      base44.entities.Baseline.filter({ project_id: projectId }, 'captured_date', 100),
      base44.entities.BOMItem.filter({ project_id: projectId }, '-created_date', 500),
    ]);
    // Earliest first
    bl.sort((a, b) => (a.captured_date || '').localeCompare(b.captured_date || ''));
    setBaselines(bl);
    setBomItems(bom);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  // Current totals from live BOM items — exclude panel child rows (parent_id)
  // so a panel is counted once and not double-counted with its components.
  const topBom = bomItems.filter(isTopLevelBOM);
  const currentPlannedCost = topBom.reduce(
    (s, i) => s + (Number(i.planned_cost_price) || Number(i.cost_price) || 0) * (Number(i.quantity) || 1),
    0
  );
  const currentActualCost = topBom.reduce(
    (s, i) => s + (Number(i.actual_cost_price) || 0) * (Number(i.quantity) || 1),
    0
  );

  const earliest = baselines[0] || null;

  async function captureBaseline() {
    const name = baselineName.trim() || `Baseline ${baselines.length + 1}`;
    setCapturing(true);
    try {
      const user = await base44.auth.me().catch(() => null);
      const line_items = topBom.map(i => ({
        bom_item_id: i.id,
        description: i.description,
        manufacturer_part_number: i.manufacturer_part_number,
        quantity: Number(i.quantity) || 0,
        planned_cost_price: Number(i.planned_cost_price) || Number(i.cost_price) || 0,
        currency: i.currency || currency,
      }));
      await base44.entities.Baseline.create({
        project_id: projectId,
        baseline_name: name,
        captured_date: todayLocal(),
        captured_by: user?.full_name || 'Unknown',
        total_planned_cost: currentPlannedCost,
        total_contract_value: Number(project?.contract_value) || 0,
        currency,
        line_items,
      });
      setBaselineName('');
      setShowNameInput(false);
      await load();
    } finally {
      setCapturing(false);
    }
  }

  // Variance helpers
  function pct(current, baseline) {
    if (!baseline) return 0;
    return baseline > 0 ? Math.round(((current - baseline) / baseline) * 100) : 0;
  }

  return (
    <div className="bg-white rounded-lg shadow-sm p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
        <h3 className="font-semibold text-slate-700 text-sm uppercase tracking-wide flex items-center gap-2">
          <Snowflake className="w-4 h-4 text-blue-500" /> Project Baselines
        </h3>
        <div className="flex items-center gap-2">
          {showNameInput ? (
            <>
              <input
                value={baselineName}
                onChange={e => setBaselineName(e.target.value)}
                placeholder="Baseline name (optional)"
                className="border border-slate-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 w-44"
              />
              <button
                onClick={captureBaseline}
                disabled={capturing || loading}
                className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded disabled:opacity-60"
              >
                <Camera className="w-4 h-4" /> {capturing ? 'Capturing…' : 'Confirm'}
              </button>
              <button
                onClick={() => { setShowNameInput(false); setBaselineName(''); }}
                className="px-2 py-1.5 border border-slate-300 text-slate-600 text-sm rounded hover:bg-slate-100"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setShowNameInput(true)}
              disabled={capturing || loading}
              className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded disabled:opacity-60"
            >
              <Camera className="w-4 h-4" /> Capture Baseline
            </button>
          )}
        </div>
      </div>

      {/* Variance vs earliest baseline */}
      {earliest ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <GitCompare className="w-3.5 h-3.5" />
            Comparing against earliest baseline:&nbsp;
            <span className="font-semibold text-slate-700">{earliest.baseline_name}</span>
            <span>· {formatDate(earliest.captured_date)}</span>
            <span>· {formatCurrency(earliest.total_planned_cost, earliest.currency || currency)}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <VarianceCard
              label="Planned Cost vs Baseline"
              current={currentPlannedCost}
              baseline={earliest.total_planned_cost}
              currency={currency}
            />
            <VarianceCard
              label="Actual Cost vs Baseline"
              current={currentActualCost}
              baseline={earliest.total_planned_cost}
              currency={currency}
            />
          </div>
        </div>
      ) : (
        !loading && (
          <p className="text-sm text-slate-400 text-center py-3">
            No baseline captured yet. Click <strong>Capture Baseline</strong> to freeze the current planned figures for variance tracking.
          </p>
        )
      )}

      {/* List of all baselines (read-only) */}
      {baselines.length > 0 && (
        <div className="border-t pt-3">
          <div className="text-xs text-slate-400 uppercase tracking-wide mb-2">All Baselines ({baselines.length})</div>
          <div className="flex flex-wrap gap-2">
            {baselines.map((b, idx) => (
              <div key={b.id} className={`text-xs rounded px-3 py-2 border ${idx === 0 ? 'bg-blue-50 border-blue-200 text-blue-800' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
                {idx === 0 && <span className="font-semibold mr-1">★</span>}
                <span className="font-medium">{b.baseline_name}</span>
                <span className="opacity-70"> · {formatDate(b.captured_date)}</span>
                <span> · {formatCurrency(b.total_planned_cost, b.currency || currency)}</span>
                <span className="opacity-60"> · by {b.captured_by}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function VarianceCard({ label, current, baseline, currency }) {
  const delta = current - baseline;
  const percent = baseline > 0 ? Math.round((delta / baseline) * 100) : 0;
  const over = delta > 0;
  const flat = Math.abs(delta) < 0.5;
  return (
    <div className={`rounded-lg p-4 border-l-4 ${flat ? 'bg-white border-slate-300' : over ? 'bg-red-50 border-red-500' : 'bg-emerald-50 border-emerald-500'}`}>
      <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">{label}</div>
      <div className="flex items-baseline gap-2">
        <div className="text-lg font-semibold text-slate-800">{formatCurrency(delta, currency)}</div>
        <div className={`text-xs font-semibold ${flat ? 'text-slate-500' : over ? 'text-red-600' : 'text-emerald-600'}`}>
          {flat ? 'on target' : `${over ? '+' : ''}${percent}%`}
        </div>
        {flat ? <TrendingUp className="w-4 h-4 text-slate-300" /> : over
          ? <TrendingUp className="w-4 h-4 text-red-400" />
          : <TrendingDown className="w-4 h-4 text-emerald-400" />}
      </div>
      <div className="text-xs text-slate-400 mt-1">
        Current {formatCurrency(current, currency)} vs Baseline {formatCurrency(baseline, currency)}
      </div>
    </div>
  );
}