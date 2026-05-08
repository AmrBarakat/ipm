import { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { formatCurrency, TYPE_LABELS, STATUS_LABELS, STATUS_COLORS } from '@/lib/constants';
import { TrendingUp, TrendingDown, Minus, ArrowUpDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const MARGIN_COLORS = {
  high:   { bg: 'bg-emerald-100', text: 'text-emerald-700', bar: 'bg-emerald-500' },
  medium: { bg: 'bg-amber-100',   text: 'text-amber-700',   bar: 'bg-amber-500'   },
  low:    { bg: 'bg-orange-100',  text: 'text-orange-700',  bar: 'bg-orange-500'  },
  loss:   { bg: 'bg-red-100',     text: 'text-red-700',     bar: 'bg-red-500'     },
};

function marginTier(pct) {
  if (pct >= 20) return 'high';
  if (pct >= 10) return 'medium';
  if (pct >= 0)  return 'low';
  return 'loss';
}

export default function ProfitMarginReport({ projects }) {
  const navigate = useNavigate();
  const [invoices,    setInvoices]    = useState([]);
  const [expenses,    setExpenses]    = useState([]);
  const [collections, setCollections] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [sortField,   setSortField]   = useState('margin_pct');
  const [sortDir,     setSortDir]     = useState('asc'); // losses first by default

  useEffect(() => {
    if (!projects.length) { setLoading(false); return; }
    const idSet = new Set(projects.map(p => p.id));
    Promise.all([
      base44.entities.Invoice.list('-planned_date', 2000),
      base44.entities.Expense.list('-planned_date', 2000),
      base44.entities.Collection.list('-received_date', 2000),
    ]).then(([inv, exp, col]) => {
      setInvoices(inv.filter(i => idSet.has(i.project_id)));
      setExpenses(exp.filter(e => idSet.has(e.project_id)));
      setCollections(col.filter(c => idSet.has(c.project_id)));
      setLoading(false);
    });
  }, [projects]);

  const rows = useMemo(() => {
    return projects.map(p => {
      // Realized revenue = total collections received for this project
      const revenue = collections
        .filter(c => c.project_id === p.id)
        .reduce((s, c) => s + (c.amount || 0), 0);

      // Actual invoiced = invoiced/paid/partial/overdue → actual_amount fallback planned_amount
      const actualInvoiced = invoices
        .filter(i => i.project_id === p.id && ['invoiced','paid','partial','overdue'].includes(i.status))
        .reduce((s, i) => s + (i.actual_amount || i.planned_amount || 0), 0);

      // Actual expenses = committed/paid → actual_amount fallback planned_amount
      const actualExpenses = expenses
        .filter(e => e.project_id === p.id && ['committed','paid'].includes(e.status))
        .reduce((s, e) => s + (e.actual_amount || e.planned_amount || 0), 0);

      const netProfit   = revenue - actualExpenses;
      const margin_pct  = revenue > 0 ? (netProfit / revenue) * 100 : null;
      const remaining   = actualInvoiced - revenue;

      return { ...p, revenue, actualInvoiced, actualExpenses, netProfit, margin_pct, remaining };
    });
  }, [projects, invoices, expenses, collections]);

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      let av = a[sortField] ?? -Infinity;
      let bv = b[sortField] ?? -Infinity;
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }, [rows, sortField, sortDir]);

  // Portfolio totals
  const totRevenue     = rows.reduce((s, r) => s + r.revenue, 0);
  const totExpenses    = rows.reduce((s, r) => s + r.actualExpenses, 0);
  const totNetProfit   = totRevenue - totExpenses;
  const totMarginPct   = totRevenue > 0 ? (totNetProfit / totRevenue) * 100 : null;
  const totRemaining   = rows.reduce((s, r) => s + r.remaining, 0);

  function toggleSort(field) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  }

  const SortIcon = ({ field }) => (
    <ArrowUpDown className={`w-3 h-3 inline ml-1 ${sortField === field ? 'text-amber-500' : 'text-slate-300'}`} />
  );

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" />
    </div>
  );

  const tierLabel = { high: '≥20%', medium: '10–20%', low: '0–10%', loss: 'Loss' };
  const distribution = ['high','medium','low','loss'].map(tier => ({
    tier,
    count: rows.filter(r => r.revenue > 0 && marginTier(r.margin_pct) === tier).length,
  }));

  return (
    <div className="space-y-6">
      {/* Portfolio Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <KpiCard label="Total Revenue (Collected)" value={formatCurrency(totRevenue, 'SAR')} color="border-emerald-500" icon={<TrendingUp className="w-5 h-5" />} />
        <KpiCard label="Total Actual Expenses"     value={formatCurrency(totExpenses, 'SAR')} color="border-red-500"     icon={<TrendingDown className="w-5 h-5" />} />
        <KpiCard label="Net Profit"                value={formatCurrency(totNetProfit, 'SAR')} color={totNetProfit >= 0 ? 'border-emerald-600' : 'border-red-600'} valueClass={totNetProfit >= 0 ? 'text-emerald-700' : 'text-red-700'} icon={<Minus className="w-5 h-5" />} />
        <KpiCard label="Portfolio Margin"          value={totMarginPct != null ? `${totMarginPct.toFixed(1)}%` : '—'} color={totMarginPct >= 0 ? 'border-amber-500' : 'border-red-500'} valueClass={totMarginPct >= 20 ? 'text-emerald-700' : totMarginPct >= 0 ? 'text-amber-700' : 'text-red-700'} icon={<TrendingUp className="w-5 h-5" />} />
        <KpiCard label="Remaining to Collect"      value={formatCurrency(totRemaining, 'SAR')} color="border-blue-400" icon={<TrendingUp className="w-5 h-5" />} />
      </div>

      {/* Margin Distribution */}
      <div className="bg-white rounded-lg shadow-sm p-4">
        <h3 className="font-semibold text-slate-700 text-sm mb-3">Margin Distribution</h3>
        <div className="grid grid-cols-4 gap-3">
          {distribution.map(({ tier, count }) => {
            const c = MARGIN_COLORS[tier];
            return (
              <div key={tier} className={`rounded-lg p-3 ${c.bg} text-center`}>
                <div className={`text-2xl font-bold ${c.text}`}>{count}</div>
                <div className={`text-xs font-semibold ${c.text} mt-0.5`}>{tierLabel[tier]}</div>
                <div className="text-xs text-slate-500 mt-0.5 capitalize">{tier === 'loss' ? 'Loss-making' : `${tier} margin`}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Project Table */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200">
          <h3 className="font-semibold text-slate-700 text-sm">Net Profit Margin by Project</h3>
          <p className="text-xs text-slate-400 mt-0.5">Revenue = total collections · Expenses = committed/paid actuals · Click headers to sort</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase border-b border-slate-100">
              <tr>
                <th className="px-4 py-3 text-left">Project</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-right cursor-pointer select-none hover:text-slate-700" onClick={() => toggleSort('actualInvoiced')}>
                  Actual Invoiced <SortIcon field="actualInvoiced" />
                </th>
                <th className="px-4 py-3 text-right cursor-pointer select-none hover:text-slate-700" onClick={() => toggleSort('revenue')}>
                  Revenue (Collected) <SortIcon field="revenue" />
                </th>
                <th className="px-4 py-3 text-right cursor-pointer select-none hover:text-slate-700" onClick={() => toggleSort('remaining')}>
                  Remaining <SortIcon field="remaining" />
                </th>
                <th className="px-4 py-3 text-right cursor-pointer select-none hover:text-slate-700" onClick={() => toggleSort('actualExpenses')}>
                  Actual Expenses <SortIcon field="actualExpenses" />
                </th>
                <th className="px-4 py-3 text-right cursor-pointer select-none hover:text-slate-700" onClick={() => toggleSort('netProfit')}>
                  Net Profit <SortIcon field="netProfit" />
                </th>
                <th className="px-4 py-3 text-right cursor-pointer select-none hover:text-slate-700" onClick={() => toggleSort('margin_pct')}>
                  Margin % <SortIcon field="margin_pct" />
                </th>
                <th className="px-4 py-3 text-left">Margin Bar</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(row => {
                const tier = row.revenue > 0 ? marginTier(row.margin_pct) : null;
                const c = tier ? MARGIN_COLORS[tier] : null;
                const barWidth = tier ? Math.min(100, Math.abs(row.margin_pct || 0)) : 0;
                return (
                  <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => window.location.href = `/projects/${row.id}`}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-800">{row.name}</div>
                      <div className="text-xs text-slate-400">{row.code} · {TYPE_LABELS[row.project_type] || row.project_type}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded font-semibold ${STATUS_COLORS[row.status] || 'bg-slate-100 text-slate-600'}`}>
                        {STATUS_LABELS[row.status] || row.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600">{formatCurrency(row.actualInvoiced, 'SAR')}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-700">{formatCurrency(row.revenue, 'SAR')}</td>
                    <td className="px-4 py-3 text-right text-blue-600">{row.remaining > 0 ? formatCurrency(row.remaining, 'SAR') : <span className="text-emerald-600 text-xs">Fully collected</span>}</td>
                    <td className="px-4 py-3 text-right text-red-600">{formatCurrency(row.actualExpenses, 'SAR')}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`font-semibold ${row.netProfit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                        {formatCurrency(row.netProfit, 'SAR')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {tier ? (
                        <span className={`text-xs font-bold px-2 py-0.5 rounded ${c.bg} ${c.text}`}>
                          {row.margin_pct.toFixed(1)}%
                        </span>
                      ) : <span className="text-xs text-slate-400">No data</span>}
                    </td>
                    <td className="px-4 py-3 w-32">
                      {tier && (
                        <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                          <div className={`h-2 rounded-full ${c.bar}`} style={{ width: `${barWidth}%` }} />
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {/* Totals footer */}
            <tfoot className="bg-slate-50 border-t-2 border-slate-300 text-xs font-semibold text-slate-700">
              <tr>
                <td className="px-4 py-3" colSpan={2}>Portfolio Total ({rows.length} projects)</td>
                <td className="px-4 py-3 text-right">{formatCurrency(rows.reduce((s,r)=>s+r.actualInvoiced,0),'SAR')}</td>
                <td className="px-4 py-3 text-right">{formatCurrency(totRevenue,'SAR')}</td>
                <td className="px-4 py-3 text-right text-blue-600">{formatCurrency(totRemaining,'SAR')}</td>
                <td className="px-4 py-3 text-right text-red-600">{formatCurrency(totExpenses,'SAR')}</td>
                <td className="px-4 py-3 text-right">
                  <span className={totNetProfit >= 0 ? 'text-emerald-700' : 'text-red-600'}>{formatCurrency(totNetProfit,'SAR')}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  {totMarginPct != null && (
                    <span className={`px-2 py-0.5 rounded ${totMarginPct >= 20 ? 'bg-emerald-100 text-emerald-700' : totMarginPct >= 0 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                      {totMarginPct.toFixed(1)}%
                    </span>
                  )}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, color, icon, valueClass = 'text-slate-800' }) {
  return (
    <div className={`bg-white rounded-lg shadow-sm p-4 border-l-4 ${color}`}>
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">{label}</div>
          <div className={`text-lg font-semibold leading-tight ${valueClass}`}>{value}</div>
        </div>
        <div className="text-slate-300 mt-0.5 shrink-0 ml-2">{icon}</div>
      </div>
    </div>
  );
}