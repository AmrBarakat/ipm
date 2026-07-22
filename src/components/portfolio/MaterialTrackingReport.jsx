import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { formatCurrency, formatDate } from '@/lib/constants';
import { Package, AlertTriangle, FileText, Loader2, ChevronDown, ChevronRight, Filter, Search, RefreshCw } from 'lucide-react';
import { jsPDF } from 'jspdf';

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

function truncate(str, max) {
  if (!str) return '—';
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
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

  // ── PDF export ──────────────────────────────────────────────────────────
  async function exportPDF() {
    setGenerating(true);
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const W = 297, margin = 12, colW = W - margin * 2;
    let y = 0;
    const today = new Date().toLocaleDateString('en-GB');

    function checkPage(needed = 10) {
      if (y + needed > 200) { doc.addPage(); y = 16; }
    }
    function itemHeader() {
      checkPage(8);
      const cols = [0.30, 0.16, 0.10, 0.14, 0.14, 0.16];
      const labels = ['Description', 'Part No.', 'Qty', 'Status', 'Received', 'Exp. Delivery'];
      doc.setFillColor(15, 23, 42);
      doc.rect(margin, y - 4, colW, 7, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(7);
      doc.setFont(undefined, 'bold');
      let cx = margin + 1;
      labels.forEach((l, i) => { doc.text(l, cx, y); cx += colW * cols[i]; });
      doc.setTextColor(30, 41, 59);
      y += 6;
      return cols;
    }
    function itemRow(it, cols, shade) {
      checkPage(7);
      const overdue = isItemOverdue(it);
      if (shade) { doc.setFillColor(248, 250, 252); doc.rect(margin, y - 4, colW, 6, 'F'); }
      if (overdue) { doc.setFillColor(254, 226, 226); doc.rect(margin, y - 4, colW, 6, 'F'); }
      doc.setFontSize(7);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(overdue ? 185 : 30, overdue ? 28 : 41, overdue ? 28 : 59);
      const vals = [
        truncate(it.description || '—', 50),
        it.manufacturer_part_number || '—',
        String(it.quantity ?? '—'),
        STATUS_LABEL[it.material_status] || it.material_status || '—',
        `${it.received_qty ?? 0}/${it.quantity ?? 0}`,
        it.expected_delivery_date ? formatDate(it.expected_delivery_date) : '—',
      ];
      let cx = margin + 1;
      vals.forEach((v, i) => { doc.text(String(v), cx, y); cx += colW * cols[i]; });
      y += 6;
    }

    // Header band
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, W, 22, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(13);
    doc.setFont(undefined, 'bold');
    doc.text('Material Tracking Report', margin, 10);
    doc.setFontSize(8);
    doc.setFont(undefined, 'normal');
    doc.text(
      `Generated: ${today}  |  ${totalCount} items across ${per_project.length} projects  |  Total Planned: ${formatCurrency(totals.value.total_planned || 0, 'SAR')}`,
      margin, 17
    );
    doc.setTextColor(0, 0, 0);
    y = 30;

    // KPI line
    doc.setFontSize(8);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(71, 85, 105);
    doc.text(
      `Ordered: ${totals.counts.ordered || 0}  ·  Received: ${totals.counts.received || 0}  ·  Delivered: ${totals.counts.delivered || 0}  ·  Overdue: ${totals.overdue || 0}`,
      margin, y
    );
    y += 6;

    // Per-project groups
    per_project.forEach(p => {
      checkPage(16);
      doc.setFillColor(245, 158, 11);
      doc.rect(margin, y - 4, 3, 6, 'F');
      doc.setFontSize(10);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text(
        `${p.code || '—'} — ${truncate(p.name, 50)}  ·  ${p.counts.not_ordered + p.counts.ordered + p.counts.received + p.counts.delivered} items  ·  ${formatCurrency(p.value.total_planned || 0, 'SAR')}${p.overdue ? `  ·  ⚠ ${p.overdue} overdue` : ''}`,
        margin + 5, y
      );
      y += 6;

      const cols = itemHeader();
      const projItems = items.filter(i => i.project_id === p.project_id);
      projItems.forEach((it, i) => itemRow(it, cols, i % 2 === 0));
    });

    // Grand total
    checkPage(12);
    doc.setFillColor(15, 23, 42);
    doc.rect(margin, y - 4, colW, 9, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.setFont(undefined, 'bold');
    doc.text('GRAND TOTAL', margin + 1, y + 2);
    doc.text(formatCurrency(totals.value.total_planned || 0, 'SAR'), margin + colW * 0.46 + 1, y + 2);
    y += 12;

    const pageCount = doc.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p);
      doc.setFontSize(6.5);
      doc.setTextColor(148, 163, 184);
      doc.text(`Material Tracking Report  ·  Page ${p} of ${pageCount}`, W / 2, 205, { align: 'center' });
    }

    doc.save(`Material_Tracking_Report_${new Date().toISOString().slice(0, 10)}.pdf`);
    setGenerating(false);
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