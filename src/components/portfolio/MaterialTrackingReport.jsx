import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { formatCurrency, formatDate } from '@/lib/constants';
import { Package, AlertTriangle, FileText, Loader2, ChevronDown, ChevronRight, Filter, Search, RefreshCw } from 'lucide-react';
import { exportSectionsPDF } from '@/lib/reportExport';
import { logActivity } from '@/lib/logActivity';

const STATUSES = [
  { value: 'not_ordered', label: 'Not Ordered', chip: 'bg-slate-100 text-slate-600' },
  { value: 'ordered', label: 'Ordered', chip: 'bg-blue-100 text-blue-700' },
  { value: 'received', label: 'Received', chip: 'bg-amber-100 text-amber-700' },
  { value: 'delivered', label: 'Delivered', chip: 'bg-emerald-100 text-emerald-700' },
];
const STATUS_LABEL = Object.fromEntries(STATUSES.map(s => [s.value, s.label]));
const STATUS_BADGE = {
  not_ordered: 'bg-slate-100 text-slate-600',
  ordered: 'bg-blue-100 text-blue-700',
  received: 'bg-amber-100 text-amber-700',
  delivered: 'bg-emerald-100 text-emerald-700',
};

function isItemOverdue(it) {
  if (!it.expected_delivery_date) return false;
  if (it.material_status === 'received' || it.material_status === 'delivered') return false;
  const d = new Date(it.expected_delivery_date);
  if (isNaN(d.getTime())) return false;
  d.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}

export default function MaterialTrackingReport() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['portfolioMaterialTracking'],
    queryFn: async () => {
      const res = await base44.functions.invoke('portfolioMaterialTracking');
      return res.data;
    },
    staleTime: 60000,
  });

  const [expanded, setExpanded] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [search, setSearch] = useState('');
  const [generating, setGenerating] = useState(false);

  const per_project = data?.per_project || [];
  const totals = data?.totals || { counts: {}, value: {}, overdue: 0 };
  const items = data?.items || [];

  const suppliers = useMemo(
    () => [...new Set(items.map(i => i.supplier).filter(Boolean))].sort(),
    [items]
  );

  const filteredItems = useMemo(() => items.filter(i => {
    if (statusFilter && i.material_status !== statusFilter) return false;
    if (supplierFilter && i.supplier !== supplierFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const hay = ((i.description || '') + ' ' + (i.manufacturer_part_number || '')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }), [items, statusFilter, supplierFilter, search]);

  const itemsByProject = useMemo(() => {
    const m = {};
    filteredItems.forEach(i => { (m[i.project_id] ||= []).push(i); });
    return m;
  }, [filteredItems]);

  const totalCount =
    (totals.counts.not_ordered || 0) + (totals.counts.ordered || 0) +
    (totals.counts.received || 0) + (totals.counts.delivered || 0);

  // ── PDF export (shared engine) ─────────────────────────────────────────
  async function exportPDF() {
    setGenerating(true);
    try {
      const projById = Object.fromEntries(per_project.map((p) => [p.project_id, p]));
      const columns = [
        { header: 'Project', key: 'project', width: 0.22 },
        { header: 'Item', key: 'description', width: 0.30 },
        { header: 'Part No.', key: 'part', width: 0.13 },
        { header: 'Qty', key: 'qty', align: 'right', width: 0.07 },
        { header: 'Status', key: 'status', width: 0.10 },
        { header: 'Received', key: 'received', align: 'right', width: 0.08 },
        { header: 'Expected Delivery', key: 'expected', width: 0.10,
          cellColor: (r) => (r._overdue ? [185, 28, 28] : null) },
      ];
      const rows = filteredItems.map((it) => {
        const p = projById[it.project_id] || {};
        return {
          project: `${p.code || '—'} · ${p.name || '—'}`,
          description: it.description || '—',
          part: it.manufacturer_part_number || '—',
          qty: String(it.quantity ?? '—'),
          status: STATUS_LABEL[it.material_status] || it.material_status || '—',
          received: `${it.received_qty ?? 0}/${it.quantity ?? 0}`,
          expected: it.expected_delivery_date ? formatDate(it.expected_delivery_date) : '—',
          _overdue: isItemOverdue(it),
        };
      });
      exportSectionsPDF(
        `Material_Tracking_PORTFOLIO_${new Date().toISOString().slice(0, 10)}.pdf`,
        'Material Tracking Report',
        [
          {
            title: 'Summary', type: 'summary',
            summary: [
              { label: 'Total items', value: String(totalCount) },
              { label: 'Projects', value: String(per_project.length) },
              { label: 'Total planned', value: formatCurrency(totals.value.total_planned || 0, 'SAR') },
              { label: 'Ordered', value: String(totals.counts.ordered || 0) },
              { label: 'Received', value: String(totals.counts.received || 0) },
              { label: 'Delivered', value: String(totals.counts.delivered || 0) },
              { label: 'Overdue', value: String(totals.overdue || 0) },
            ],
          },
          { title: 'Material Items', type: 'table', columns, rows },
        ],
        { orientation: 'landscape' },
      );
      logActivity({ entity_type: 'Report', action: 'generated', summary: 'Material Tracking report exported (portfolio).' });
    } finally {
      setGenerating(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <AlertTriangle className="w-8 h-8 text-red-400" />
        <p className="text-sm text-red-500">Failed to load material tracking.</p>
        <button onClick={() => refetch()} className="px-3 py-1.5 text-xs font-semibold border border-red-300 text-red-600 rounded hover:bg-red-50">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <KpiCard label="Total Items" value={totalCount} color="border-slate-400" />
        <KpiCard label="Ordered" value={totals.counts.ordered || 0} color="border-blue-400" />
        <KpiCard label="Received" value={totals.counts.received || 0} color="border-amber-400" />
        <KpiCard label="Delivered" value={totals.counts.delivered || 0} color="border-emerald-400" />
        <KpiCard label="Overdue" value={totals.overdue || 0} color={totals.overdue ? 'border-red-500' : 'border-slate-400'} valueClass={totals.overdue ? 'text-red-600' : ''} />
      </div>

      {/* Filters + export */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Filter className="w-4 h-4 text-slate-400" />
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="text-sm border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white">
              <option value="">All Status</option>
              {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <select value={supplierFilter} onChange={e => setSupplierFilter(e.target.value)}
            className="text-sm border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white">
            <option value="">All Suppliers</option>
            {suppliers.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search description / part no."
              className="text-sm border border-slate-200 rounded pl-7 pr-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white w-56" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refetch()} className="flex items-center gap-1.5 px-3 py-2 text-sm border border-slate-300 rounded hover:bg-slate-50 text-slate-600 font-medium">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <button onClick={exportPDF} disabled={generating || per_project.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded disabled:opacity-50">
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            {generating ? 'Generating…' : 'Export PDF'}
          </button>
        </div>
      </div>

      {/* Per-project table */}
      {per_project.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <Package className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No BOM materials found across projects.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[860px]">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase border-b">
                <tr>
                  <th className="px-4 py-3 w-8"></th>
                  <th className="px-4 py-3 text-left">Project</th>
                  <th className="px-4 py-3 text-left">Material Status (counts)</th>
                  <th className="px-4 py-3 text-right">Total Planned</th>
                  <th className="px-4 py-3 text-right">Overdue</th>
                </tr>
              </thead>
              <tbody>
                {per_project.map(p => {
                  const isOpen = expanded === p.project_id;
                  const projItems = itemsByProject[p.project_id] || [];
                  return (
                    <>
                      <tr key={p.project_id} onClick={() => setExpanded(isOpen ? null : p.project_id)}
                        className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer">
                        <td className="px-4 py-3 text-slate-400">
                          {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-800">{p.name || '—'}</div>
                          <div className="text-xs text-slate-400 font-mono">{p.code || '—'}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            {STATUSES.map(s => (
                              <span key={s.value} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${s.chip}`}>
                                {s.label}: {p.counts[s.value] || 0}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-800">{formatCurrency(p.value.total_planned || 0, 'SAR')}</td>
                        <td className="px-4 py-3 text-right">
                          {p.overdue > 0
                            ? <span className="text-red-600 font-semibold flex items-center justify-end gap-1"><AlertTriangle className="w-3.5 h-3.5" /> {p.overdue}</span>
                            : <span className="text-slate-300">—</span>}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr key={p.project_id + '-items'} className="bg-slate-50/60">
                          <td></td>
                          <td colSpan={4} className="px-4 py-3">
                            {projItems.length === 0 ? (
                              <p className="text-xs text-slate-400 italic py-2">No items match the current filters.</p>
                            ) : (
                              <div className="overflow-x-auto rounded border border-slate-200">
                                <table className="w-full text-xs min-w-[640px]">
                                  <thead className="bg-slate-100 text-slate-500 uppercase">
                                    <tr>
                                      <th className="px-3 py-2 text-left">Description</th>
                                      <th className="px-3 py-2 text-left">Part No.</th>
                                      <th className="px-3 py-2 text-right">Qty</th>
                                      <th className="px-3 py-2 text-left">Status</th>
                                      <th className="px-3 py-2 text-right">Received x/y</th>
                                      <th className="px-3 py-2 text-left">Expected Delivery</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {projItems.map((it, i) => {
                                      const overdue = isItemOverdue(it);
                                      return (
                                        <tr key={i} className={`border-t border-slate-100 ${overdue ? 'bg-red-50' : i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                                          <td className="px-3 py-2 text-slate-700 max-w-[260px] truncate" title={it.description}>{it.description || '—'}</td>
                                          <td className="px-3 py-2 font-mono text-slate-500">{it.manufacturer_part_number || '—'}</td>
                                          <td className="px-3 py-2 text-right font-semibold text-slate-700">{it.quantity ?? '—'}</td>
                                          <td className="px-3 py-2">
                                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${STATUS_BADGE[it.material_status] || 'bg-slate-100 text-slate-600'}`}>
                                              {STATUS_LABEL[it.material_status] || it.material_status}
                                            </span>
                                          </td>
                                          <td className="px-3 py-2 text-right text-slate-600">{it.received_qty ?? 0}/{it.quantity ?? 0}</td>
                                          <td className="px-3 py-2">
                                            {it.expected_delivery_date ? (
                                              <span className={overdue ? 'text-red-600 font-semibold' : 'text-slate-500'}>
                                                {formatDate(it.expected_delivery_date)}
                                                {overdue && <AlertTriangle className="w-3 h-3 inline ml-1 text-red-500" />}
                                              </span>
                                            ) : <span className="text-slate-400">—</span>}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
              <tfoot className="bg-slate-800 text-white">
                <tr>
                  <td></td>
                  <td className="px-4 py-3 text-xs font-semibold text-slate-200">Grand Total ({per_project.length} projects)</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {STATUSES.map(s => (
                        <span key={s.value} className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-700 text-slate-200">
                          {s.label}: {totals.counts[s.value] || 0}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-amber-300">{formatCurrency(totals.value.total_planned || 0, 'SAR')}</td>
                  <td className="px-4 py-3 text-right font-bold text-red-300">{totals.overdue || 0}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, value, color, valueClass }) {
  return (
    <div className={`bg-white rounded-lg shadow-sm p-4 border-l-4 ${color}`}>
      <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">{label}</div>
      <div className={`text-xl font-bold text-slate-800 ${valueClass || ''}`}>{value}</div>
    </div>
  );
}