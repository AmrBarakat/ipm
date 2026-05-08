import { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { formatCurrency, TYPE_LABELS } from '@/lib/constants';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  LineChart, Line, ComposedChart, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';
import {
  TrendingUp, TrendingDown, DollarSign, Wallet,
  ReceiptText, ArrowUpCircle, ArrowDownCircle, Activity
} from 'lucide-react';

const PIE_COLORS = ['#f59e0b', '#3b82f6', '#10b981', '#8b5cf6', '#ef4444', '#06b6d4'];

// ── Helpers ────────────────────────────────────────────────────────────────
function periodKey(dateStr, mode) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  const y = d.getFullYear();
  const m = d.getMonth(); // 0-indexed
  if (mode === 'monthly')   return `${y}-${String(m + 1).padStart(2, '0')}`;
  if (mode === 'quarterly') return `${y}-Q${Math.floor(m / 3) + 1}`;
  return `${y}`;
}

function periodLabel(key, mode) {
  if (!key) return key;
  if (mode === 'monthly') {
    const [y, mo] = key.split('-');
    const d = new Date(Number(y), Number(mo) - 1, 1);
    return d.toLocaleDateString('en', { month: 'short', year: '2-digit' });
  }
  if (mode === 'quarterly') return key.replace('-', ' ');
  return key;
}

function inRange(dateStr, from, to) {
  if (!dateStr) return false;
  const d = dateStr.slice(0, 10);
  if (from && d < from) return false;
  if (to   && d > to)   return false;
  return true;
}

const selCls = 'border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400 bg-white';

// ── Main Component ─────────────────────────────────────────────────────────
export default function FinancialDashboard({ projects }) {
  const [invoices,    setInvoices]    = useState([]);
  const [collections, setCollections] = useState([]);
  const [expenses,    setExpenses]    = useState([]);
  const [loading,     setLoading]     = useState(true);

  // Filters
  const [period,      setPeriod]      = useState('monthly');
  const [projectType, setProjectType] = useState('');
  const [dateFrom,    setDateFrom]    = useState('');
  const [dateTo,      setDateTo]      = useState('');
  const [view,        setView]        = useState('actual'); // actual | planned | both

  useEffect(() => {
    if (!projects.length) { setLoading(false); return; }
    const ids = projects.map(p => p.id);

    // Fetch all financial data across all projects in parallel
    Promise.all([
      base44.entities.Invoice.list('-planned_date', 2000),
      base44.entities.Collection.list('-received_date', 2000),
      base44.entities.Expense.list('-planned_date', 2000),
    ]).then(([inv, col, exp]) => {
      const idSet = new Set(ids);
      setInvoices(inv.filter(i => idSet.has(i.project_id)));
      setCollections(col.filter(c => idSet.has(c.project_id)));
      setExpenses(exp.filter(e => idSet.has(e.project_id)));
      setLoading(false);
    });
  }, [projects]);

  // Project id → type lookup
  const projectTypeMap = useMemo(() =>
    Object.fromEntries(projects.map(p => [p.id, p.project_type])),
    [projects]
  );

  // Filtered project ids for type + date filter
  const filteredProjectIds = useMemo(() => {
    return new Set(
      projects.filter(p => {
        const matchType = !projectType || p.project_type === projectType;
        const matchFrom = !dateFrom || (p.start_date && p.start_date >= dateFrom);
        const matchTo   = !dateTo   || (p.start_date && p.start_date <= dateTo);
        return matchType && matchFrom && matchTo;
      }).map(p => p.id)
    );
  }, [projects, projectType, dateFrom, dateTo]);

  // Apply all filters to raw data
  const fInvoices = useMemo(() =>
    invoices.filter(i =>
      filteredProjectIds.has(i.project_id) &&
      inRange(i.planned_date || i.actual_invoice_date, dateFrom, dateTo)
    ), [invoices, filteredProjectIds, dateFrom, dateTo]);

  const fCollections = useMemo(() =>
    collections.filter(c =>
      filteredProjectIds.has(c.project_id) &&
      inRange(c.received_date, dateFrom, dateTo)
    ), [collections, filteredProjectIds, dateFrom, dateTo]);

  const fExpenses = useMemo(() =>
    expenses.filter(e =>
      filteredProjectIds.has(e.project_id) &&
      inRange(e.planned_date || e.actual_date, dateFrom, dateTo)
    ), [expenses, filteredProjectIds, dateFrom, dateTo]);

  // ── KPI Totals ──────────────────────────────────────────────────────────
  const totalBooking    = useMemo(() =>
    projects.filter(p => filteredProjectIds.has(p.id))
            .reduce((s, p) => s + (p.contract_value || 0), 0),
    [projects, filteredProjectIds]
  );
  // Planned invoiced: all non-cancelled → planned_amount
  const totalPlannedInvoiced = useMemo(() => fInvoices.filter(i => i.status !== 'cancelled').reduce((s, i) => s + (i.planned_amount || 0), 0), [fInvoices]);
  // Actual invoiced: invoiced/paid/partial/overdue → actual_amount fallback planned_amount
  const totalActualInvoiced  = useMemo(() => fInvoices.filter(i => ['invoiced','paid','partial','overdue'].includes(i.status)).reduce((s, i) => s + (i.actual_amount || i.planned_amount || 0), 0), [fInvoices]);
  const totalInvoiced = totalPlannedInvoiced; // keep for backward-compat references
  const totalCashIn     = useMemo(() => fCollections.reduce((s, c) => s + (c.amount || 0), 0), [fCollections]);
  // Cash out: planned = all non-cancelled planned_amount; actual = committed/paid actual_amount fallback planned_amount
  const totalPlannedCashOut = useMemo(() => fExpenses.filter(e => e.status !== 'cancelled').reduce((s, e) => s + (e.planned_amount || 0), 0), [fExpenses]);
  const totalCashOut        = useMemo(() => fExpenses.filter(e => ['committed','paid'].includes(e.status)).reduce((s, e) => s + (e.actual_amount || e.planned_amount || 0), 0), [fExpenses]);
  const netCash         = totalCashIn - totalCashOut;
  const collectionBal   = totalActualInvoiced - totalCashIn;

  // ── Period-bucketed data ────────────────────────────────────────────────
  function bucketByPeriod(items, dateField, amountField) {
    const map = {};
    items.forEach(item => {
      const key = periodKey(item[dateField], period);
      if (!key) return;
      map[key] = (map[key] || 0) + (Number(item[amountField]) || 0);
    });
    return map;
  }

  const bookingByPeriod = useMemo(() => {
    const map = {};
    projects.filter(p => filteredProjectIds.has(p.id)).forEach(p => {
      const key = periodKey(p.start_date, period);
      if (!key) return;
      map[key] = (map[key] || 0) + (p.contract_value || 0);
    });
    return map;
  }, [projects, filteredProjectIds, period]);

  const invoicedPlannedByPeriod = useMemo(() =>
    bucketByPeriod(fInvoices.filter(i => i.status !== 'cancelled'), 'planned_date', 'planned_amount'),
    [fInvoices, period]
  );
  const invoicedActualByPeriod = useMemo(() => {
    const map = {};
    fInvoices
      .filter(i => ['invoiced', 'paid', 'partial', 'overdue'].includes(i.status))
      .forEach(i => {
        const dateStr = i.actual_invoice_date || i.planned_date;
        const key = periodKey(dateStr, period);
        if (!key) return;
        map[key] = (map[key] || 0) + (i.actual_amount || i.planned_amount || 0);
      });
    return map;
  }, [fInvoices, period]);
  const cashInByPeriod           = useMemo(() => bucketByPeriod(fCollections, 'received_date', 'amount'), [fCollections, period]);
  const cashOutByPeriod          = useMemo(() => {
    const map = {};
    fExpenses.filter(e => ['committed','paid'].includes(e.status)).forEach(e => {
      const dateField = e.actual_date || e.planned_date;
      const key = periodKey(dateField, period);
      if (!key) return;
      map[key] = (map[key] || 0) + (e.actual_amount || e.planned_amount || 0);
    });
    return map;
  }, [fExpenses, period]);

  // Build sorted period keys union
  const allKeys = useMemo(() => {
    const s = new Set([
      ...Object.keys(bookingByPeriod),
      ...Object.keys(invoicedPlannedByPeriod),
      ...Object.keys(invoicedActualByPeriod),
      ...Object.keys(cashInByPeriod),
      ...Object.keys(cashOutByPeriod),
    ]);
    return [...s].sort();
  }, [bookingByPeriod, invoicedPlannedByPeriod, invoicedActualByPeriod, cashInByPeriod, cashOutByPeriod]);

  // Chart 1 — Booking & Invoicing
  const bookingInvoicingData = useMemo(() =>
    allKeys.map(k => ({
      period:            periodLabel(k, period),
      Booking:           Math.round(bookingByPeriod[k] || 0),
      'Invoiced (Plan)': Math.round(invoicedPlannedByPeriod[k] || 0),
      'Invoiced (Act)':  Math.round(invoicedActualByPeriod[k] || 0),
      'Cash In':         Math.round(cashInByPeriod[k] || 0),
    })),
    [allKeys, period, bookingByPeriod, invoicedPlannedByPeriod, invoicedActualByPeriod, cashInByPeriod]
  );

  // Chart 2 — Cash In vs Out
  const cashFlowData = useMemo(() =>
    allKeys.map(k => {
      const ci = Math.round(cashInByPeriod[k] || 0);
      const co = Math.round(cashOutByPeriod[k] || 0);
      return { period: periodLabel(k, period), 'Cash In': ci, 'Cash Out': -co, Net: ci - co };
    }),
    [allKeys, period, cashInByPeriod, cashOutByPeriod]
  );

  // Chart 3 — Cumulative Cash Flow
  const cumulativeData = useMemo(() => {
    let cumIn = 0, cumOut = 0, cumNet = 0;
    return allKeys.map(k => {
      cumIn  += cashInByPeriod[k]  || 0;
      cumOut += cashOutByPeriod[k] || 0;
      cumNet  = cumIn - cumOut;
      return { period: periodLabel(k, period), 'Cum Cash In': Math.round(cumIn), 'Cum Cash Out': Math.round(cumOut), 'Cum Net': Math.round(cumNet) };
    });
  }, [allKeys, period, cashInByPeriod, cashOutByPeriod]);

  // Chart 4 — Booking by Project Type
  const bookingByType = useMemo(() => {
    const map = {};
    projects.filter(p => filteredProjectIds.has(p.id)).forEach(p => {
      const t = p.project_type || 'other';
      map[t] = (map[t] || 0) + (p.contract_value || 0);
    });
    return Object.entries(map)
      .map(([type, value]) => ({ name: TYPE_LABELS[type] || type, value: Math.round(value) }))
      .filter(d => d.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [projects, filteredProjectIds]);

  const currency = 'SAR';
  const fmt = v => {
    if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
    if (v >= 1_000)     return (v / 1_000).toFixed(0) + 'k';
    return String(v);
  };

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-6">
      {/* ── Filter Bar ─────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-lg shadow-sm p-4 flex flex-wrap gap-3 items-center">
        {/* Period toggle */}
        <div className="flex items-center border border-slate-200 rounded overflow-hidden text-xs">
          {['monthly','quarterly','yearly'].map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 font-medium capitalize transition border-r border-slate-200 last:border-0 ${period === p ? 'bg-amber-500 text-slate-900' : 'hover:bg-slate-100 text-slate-600'}`}>
              {p}
            </button>
          ))}
        </div>

        {/* Project Type */}
        <select value={projectType} onChange={e => setProjectType(e.target.value)} className={selCls}>
          <option value="">All Types</option>
          {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>

        {/* Date Range */}
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          From
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="border border-slate-200 rounded px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-400" />
          To
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="border border-slate-200 rounded px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-400" />
        </div>

        {/* View toggle */}
        <div className="flex items-center border border-slate-200 rounded overflow-hidden text-xs ml-auto">
          {[['actual','Actual'],['planned','Planned'],['both','Plan vs Actual']].map(([v, l]) => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-1.5 font-medium transition border-r border-slate-200 last:border-0 ${view === v ? 'bg-amber-500 text-slate-900' : 'hover:bg-slate-100 text-slate-600'}`}>
              {l}
            </button>
          ))}
        </div>

        {(projectType || dateFrom || dateTo) && (
          <button onClick={() => { setProjectType(''); setDateFrom(''); setDateTo(''); }}
            className="text-xs text-slate-400 hover:text-red-500 underline">Clear</button>
        )}
      </div>

      {/* ── KPI Cards ──────────────────────────────────────────────────────── */}
      {/* Row 0 — Portfolio overview (filter-aware) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Total Projects"   value={projects.filter(p => filteredProjectIds.has(p.id)).length}                                                           icon={<TrendingUp className="w-5 h-5" />}     color="border-blue-400"    sub={projectType ? TYPE_LABELS[projectType] : 'All types'} />
        <KpiCard label="In Progress"      value={projects.filter(p => filteredProjectIds.has(p.id) && p.status === 'in_progress').length}                             icon={<Activity className="w-5 h-5" />}       color="border-amber-400"   sub="Active projects" />
        <KpiCard label="Completed"        value={projects.filter(p => filteredProjectIds.has(p.id) && p.status === 'completed').length}                               icon={<ArrowUpCircle className="w-5 h-5" />}  color="border-emerald-400" sub="Finished projects" />
        <KpiCard label="Total Booking"    value={formatCurrency(totalBooking, currency)}                                                                               icon={<TrendingUp className="w-5 h-5" />}     color="border-blue-500"    sub={`${projects.filter(p=>filteredProjectIds.has(p.id)).length} projects`} />
      </div>
      {/* Row 1 — Invoicing & collections */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Planned Invoiced"     value={formatCurrency(totalPlannedInvoiced,  currency)} icon={<ReceiptText className="w-5 h-5" />}     color="border-purple-400"  sub={totalBooking > 0 ? `${Math.round((totalPlannedInvoiced/totalBooking)*100)}% of booking` : null} />
        <KpiCard label="Actual Invoiced"      value={formatCurrency(totalActualInvoiced,   currency)} icon={<ReceiptText className="w-5 h-5" />}     color="border-purple-600"  sub={totalPlannedInvoiced > 0 ? `${Math.round((totalActualInvoiced/totalPlannedInvoiced)*100)}% of planned` : null} />
        <KpiCard label="Cash In (Collected)"  value={formatCurrency(totalCashIn,           currency)} icon={<ArrowUpCircle className="w-5 h-5" />}   color="border-emerald-500" sub={totalActualInvoiced > 0 ? `${Math.round((totalCashIn/totalActualInvoiced)*100)}% collected` : null} />
        <KpiCard label="Remaining Collection" value={formatCurrency(collectionBal,         currency)} icon={<DollarSign className="w-5 h-5" />}      color="border-amber-500"   highlight={collectionBal > 0 ? 'amber' : 'green'} sub="Actual Invoiced – Collected" />
      </div>
      {/* Row 2 — Expenses & net */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Planned Expenses"     value={formatCurrency(totalPlannedCashOut,   currency)} icon={<ArrowDownCircle className="w-5 h-5" />} color="border-red-400"     sub="Non-cancelled" />
        <KpiCard label="Actual Expenses"      value={formatCurrency(totalCashOut,          currency)} icon={<ArrowDownCircle className="w-5 h-5" />} color="border-red-600"     sub="Committed / paid" />
        <KpiCard label="Net Cash"             value={formatCurrency(netCash,               currency)} icon={<Wallet className="w-5 h-5" />}          color={netCash >= 0 ? 'border-emerald-500' : 'border-red-500'} highlight={netCash < 0 ? 'red' : 'green'} sub="Cash In – Actual Expenses" />
        <KpiCard label="On Hold / Closed"     value={projects.filter(p => filteredProjectIds.has(p.id) && ['on_hold','closed'].includes(p.status)).length}            icon={<ArrowDownCircle className="w-5 h-5" />} color="border-slate-400"   sub="Inactive projects" />
      </div>

      {/* ── Charts Grid ────────────────────────────────────────────────────── */}
      {allKeys.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm p-12 text-center text-slate-400">
          <Activity className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No financial data available for the selected filters.</p>
          <p className="text-xs mt-1">Add invoices, collections, and expenses to projects to populate these charts.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Chart 1 — Booking & Invoicing (Plan vs Actual) */}
          <ChartCard title="Booking & Invoicing" subtitle={`Contract booking vs invoiced — ${view === 'planned' ? 'planned only' : view === 'actual' ? 'actual only' : 'plan vs actual'}`}>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={bookingInvoicingData} margin={{ top: 4, right: 16, left: 0, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="period" tick={{ fontSize: 10, fill: '#94a3b8' }} angle={-30} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={fmt} width={55} />
                <Tooltip formatter={(v) => formatCurrency(v, currency)} contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                <Bar dataKey="Booking" fill="#3b82f6" radius={[3,3,0,0]} maxBarSize={36} />
                {(view === 'planned' || view === 'both') && <Bar dataKey="Invoiced (Plan)" fill="#c4b5fd" radius={[3,3,0,0]} maxBarSize={36} />}
                {(view === 'actual'  || view === 'both') && <Bar dataKey="Invoiced (Act)"  fill="#8b5cf6" radius={[3,3,0,0]} maxBarSize={36} />}
                <Line dataKey="Cash In" type="monotone" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Chart 2 — Cash In vs Out */}
          <ChartCard title="Cash In vs Cash Out" subtitle="Monthly cash movements with net overlay">
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={cashFlowData} margin={{ top: 4, right: 16, left: 0, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="period" tick={{ fontSize: 10, fill: '#94a3b8' }} angle={-30} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={fmt} width={55} />
                <Tooltip formatter={(v, n) => [formatCurrency(Math.abs(v), currency), n]} contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                <Bar dataKey="Cash In"  fill="#10b981" radius={[3,3,0,0]} maxBarSize={40} />
                <Bar dataKey="Cash Out" fill="#ef4444" radius={[3,3,0,0]} maxBarSize={40} />
                <Line dataKey="Net" type="monotone" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Chart 3 — Cumulative Cash Flow */}
          <ChartCard title="Cumulative Cash Flow" subtitle="Running totals over time">
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={cumulativeData} margin={{ top: 4, right: 16, left: 0, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="period" tick={{ fontSize: 10, fill: '#94a3b8' }} angle={-30} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={fmt} width={55} />
                <Tooltip formatter={(v) => formatCurrency(v, currency)} contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                <Line dataKey="Cum Cash In"  type="monotone" stroke="#10b981" strokeWidth={2} dot={{ r: 2 }} />
                <Line dataKey="Cum Cash Out" type="monotone" stroke="#ef4444" strokeWidth={2} dot={{ r: 2 }} />
                <Line dataKey="Cum Net"      type="monotone" stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 3 }} strokeDasharray="5 3" />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Chart 4 — Booking by Project Type */}
          <ChartCard title="Booking by Project Type" subtitle="Portfolio contract value mix">
            {bookingByType.length === 0 ? (
              <div className="flex items-center justify-center h-[280px] text-slate-400 text-sm">No data</div>
            ) : (
              <div className="flex items-center gap-4 h-[280px]">
                <ResponsiveContainer width="60%" height="100%">
                  <PieChart>
                    <Pie data={bookingByType} cx="50%" cy="50%" innerRadius="45%" outerRadius="75%"
                      dataKey="value" nameKey="name" paddingAngle={2}>
                      {bookingByType.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => formatCurrency(v, currency)} contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-2">
                  {bookingByType.map((d, i) => {
                    const pct = totalBooking > 0 ? Math.round((d.value / totalBooking) * 100) : 0;
                    return (
                      <div key={d.name} className="flex items-center gap-2 text-xs">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                        <span className="text-slate-700 font-medium truncate flex-1">{d.name}</span>
                        <span className="text-slate-500 shrink-0">{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </ChartCard>
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, value, sub, icon, color, highlight }) {
  const textColor = highlight === 'red' ? 'text-red-600' : highlight === 'green' ? 'text-emerald-600' : highlight === 'amber' ? 'text-amber-600' : 'text-slate-800';
  return (
    <div className={`bg-white rounded-lg shadow-sm p-4 border-l-4 ${color}`}>
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-slate-400 uppercase tracking-wide mb-1 truncate">{label}</div>
          <div className={`text-lg font-semibold leading-tight ${textColor}`}>{value}</div>
          {sub && <div className="text-xs text-slate-400 mt-0.5 truncate">{sub}</div>}
        </div>
        <div className="text-slate-300 mt-0.5 shrink-0 ml-2">{icon}</div>
      </div>
    </div>
  );
}

function ChartCard({ title, subtitle, children }) {
  return (
    <div className="bg-white rounded-lg shadow-sm p-5">
      <div className="mb-4">
        <h3 className="font-semibold text-slate-700 text-sm">{title}</h3>
        {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}