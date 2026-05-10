import { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { formatDate } from '@/lib/constants';
import { Package, CheckCircle2, Clock, AlertCircle, Filter, X, Download, FileText, Sheet } from 'lucide-react';
import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';

const DELIVERY_COLORS = {
  received:           'bg-emerald-100 text-emerald-700',
  partially_received: 'bg-amber-100 text-amber-700',
  pending:            'bg-slate-100 text-slate-600',
};

const DELIVERY_LABELS = {
  received:           'Received',
  partially_received: 'Partially Received',
  pending:            'Pending',
};

const ORDER_STATUS_COLORS = {
  ordered:     'bg-blue-100 text-blue-700',
  not_ordered: 'bg-red-100 text-red-700',
};

export default function MaterialTrackingReport({ projects }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterProject, setFilterProject] = useState('');
  const [filterSupplier, setFilterSupplier] = useState('');
  const [filterDelivery, setFilterDelivery] = useState('');
  const [exportMenu, setExportMenu] = useState(false);

  const projectMap = useMemo(() =>
    Object.fromEntries(projects.map(p => [p.id, p])), [projects]);

  useEffect(() => {
    base44.entities.BOMItem.list('-created_date', 2000).then(all => {
      const projectIds = new Set(projects.map(p => p.id));
      setItems(all.filter(i => projectIds.has(i.project_id)));
      setLoading(false);
    });
  }, [projects]);

  const suppliers = useMemo(() => {
    const s = new Set(items.map(i => i.supplier).filter(Boolean));
    return [...s].sort();
  }, [items]);

  const filtered = useMemo(() => {
    return items.filter(i => {
      if (filterProject && i.project_id !== filterProject) return false;
      if (filterSupplier && i.supplier !== filterSupplier) return false;
      if (filterDelivery && i.delivery_status !== filterDelivery) return false;
      return true;
    });
  }, [items, filterProject, filterSupplier, filterDelivery]);

  // KPIs (based on filtered)
  const totalOrdered = filtered.filter(i => i.order_status === 'ordered').length;
  const totalReceived = filtered.filter(i => i.delivery_status === 'received').length;
  const totalPartial = filtered.filter(i => i.delivery_status === 'partially_received').length;
  const totalPending = filtered.filter(i => i.order_status === 'ordered' && i.delivery_status === 'pending').length;

  const clearFilters = () => { setFilterProject(''); setFilterSupplier(''); setFilterDelivery(''); };
  const hasFilters = filterProject || filterSupplier || filterDelivery;

  function getExportRows() {
    return filtered.map(item => {
      const proj = projectMap[item.project_id];
      return {
        'Project Code': proj?.code || '',
        'Project Name': proj?.name || '',
        'Description': item.description || '',
        'Manufacturer': item.manufacturer || '',
        'Part No.': item.manufacturer_part_number || '',
        'Supplier': item.supplier || '',
        'Qty': item.quantity,
        'Unit': item.unit || '',
        'PO #': item.po_number || '',
        'Order Status': item.order_status === 'ordered' ? 'Ordered' : 'Not Ordered',
        'Delivery Status': DELIVERY_LABELS[item.delivery_status] || item.delivery_status,
        'Expected Delivery': item.expected_delivery_date ? formatDate(item.expected_delivery_date) : '',
        'Actual Delivery': item.actual_delivery_date ? formatDate(item.actual_delivery_date) : '',
      };
    });
  }

  function exportExcel() {
    const rows = getExportRows();
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Material Tracking');
    XLSX.writeFile(wb, `Material_Tracking_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
    setExportMenu(false);
  }

  function exportPDF() {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const W = 297;
    const margin = 12;
    const colW = W - margin * 2;
    let y = 0;

    // Header
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, W, 22, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(13);
    doc.setFont(undefined, 'bold');
    doc.text('Material Tracking Report', margin, 10);
    doc.setFontSize(8);
    doc.setFont(undefined, 'normal');
    doc.text(`Generated: ${new Date().toLocaleDateString('en-GB')}  |  ${filtered.length} items`, margin, 17);
    doc.setTextColor(0, 0, 0);
    y = 30;

    const cols = [
      { label: 'Project', frac: 0.10 },
      { label: 'Description', frac: 0.18 },
      { label: 'Manufacturer', frac: 0.10 },
      { label: 'Part No.', frac: 0.10 },
      { label: 'Supplier', frac: 0.10 },
      { label: 'Qty', frac: 0.05 },
      { label: 'PO #', frac: 0.08 },
      { label: 'Order Status', frac: 0.09 },
      { label: 'Delivery', frac: 0.09 },
      { label: 'Expected', frac: 0.06 },
      { label: 'Actual', frac: 0.05 },
    ];

    // Table header
    doc.setFillColor(15, 23, 42);
    doc.rect(margin, y - 5, colW, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(7);
    doc.setFont(undefined, 'bold');
    let cx = margin + 1;
    cols.forEach(c => {
      doc.text(c.label, cx, y);
      cx += colW * c.frac;
    });
    doc.setTextColor(30, 41, 59);
    y += 5;

    filtered.forEach((item, idx) => {
      if (y > 185) { doc.addPage(); y = 15; }
      if (idx % 2 === 0) { doc.setFillColor(248, 250, 252); doc.rect(margin, y - 4, colW, 7, 'F'); }
      const proj = projectMap[item.project_id];
      const vals = [
        proj?.code || '—',
        (item.description || '').slice(0, 28),
        (item.manufacturer || '—').slice(0, 18),
        (item.manufacturer_part_number || '—').slice(0, 18),
        (item.supplier || '—').slice(0, 18),
        `${item.quantity || ''} ${item.unit || ''}`,
        (item.po_number || '—').slice(0, 12),
        item.order_status === 'ordered' ? 'Ordered' : 'Not Ordered',
        DELIVERY_LABELS[item.delivery_status] || '—',
        item.expected_delivery_date ? formatDate(item.expected_delivery_date) : '—',
        item.actual_delivery_date ? formatDate(item.actual_delivery_date) : '—',
      ];
      doc.setFontSize(6.5);
      doc.setFont(undefined, 'normal');
      cx = margin + 1;
      vals.forEach((v, i) => {
        doc.text(String(v), cx, y);
        cx += colW * cols[i].frac;
      });
      y += 7;
    });

    // Footer
    const pageCount = doc.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p);
      doc.setFontSize(6.5);
      doc.setTextColor(148, 163, 184);
      doc.text(`Material Tracking Report  ·  Page ${p} of ${pageCount}`, W / 2, 205, { align: 'center' });
    }

    doc.save(`Material_Tracking_Report_${new Date().toISOString().slice(0, 10)}.pdf`);
    setExportMenu(false);
  }

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Total Ordered" value={totalOrdered} icon={<Package className="w-5 h-5" />} color="border-blue-400" />
        <KpiCard label="Fully Received" value={totalReceived} icon={<CheckCircle2 className="w-5 h-5" />} color="border-emerald-400" />
        <KpiCard label="Partially Received" value={totalPartial} icon={<AlertCircle className="w-5 h-5" />} color="border-amber-400" />
        <KpiCard label="Pending Delivery" value={totalPending} icon={<Clock className="w-5 h-5" />} color="border-red-400" />
      </div>

      {/* Filters + Export */}
      <div className="bg-white rounded-lg shadow-sm p-4 flex flex-wrap gap-3 items-center">
        <Filter className="w-4 h-4 text-slate-400 shrink-0" />

        <select value={filterProject} onChange={e => setFilterProject(e.target.value)}
          className="border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400 bg-white">
          <option value="">All Projects</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
        </select>

        <select value={filterSupplier} onChange={e => setFilterSupplier(e.target.value)}
          className="border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400 bg-white">
          <option value="">All Suppliers</option>
          {suppliers.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <select value={filterDelivery} onChange={e => setFilterDelivery(e.target.value)}
          className="border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400 bg-white">
          <option value="">All Statuses</option>
          <option value="received">Received</option>
          <option value="partially_received">Partially Received</option>
          <option value="pending">Pending</option>
        </select>

        {hasFilters && (
          <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-slate-400 hover:text-red-500">
            <X className="w-3.5 h-3.5" /> Clear
          </button>
        )}

        <span className="text-xs text-slate-400 ml-auto">{filtered.length} item{filtered.length !== 1 ? 's' : ''}</span>

        {/* Export dropdown */}
        <div className="relative">
          <button onClick={() => setExportMenu(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-slate-200 rounded hover:bg-slate-100 text-slate-600 font-medium">
            <Download className="w-3.5 h-3.5" /> Export
          </button>
          {exportMenu && (
            <div className="absolute right-0 mt-1 w-40 bg-white border border-slate-200 rounded shadow-lg z-50 py-1">
              <button onClick={exportExcel} className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-slate-50 text-slate-700">
                <Sheet className="w-3.5 h-3.5 text-emerald-600" /> Excel (.xlsx)
              </button>
              <button onClick={exportPDF} className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-slate-50 text-slate-700">
                <FileText className="w-3.5 h-3.5 text-red-500" /> PDF
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <Package className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No materials found for the selected filters.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm overflow-hidden border border-slate-200">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[1000px]">
              <thead className="bg-slate-800 text-white text-xs">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Project</th>
                  <th className="px-4 py-3 text-left font-semibold">Description</th>
                  <th className="px-4 py-3 text-left font-semibold">Manufacturer</th>
                  <th className="px-4 py-3 text-left font-semibold">Part No.</th>
                  <th className="px-4 py-3 text-left font-semibold">Supplier</th>
                  <th className="px-4 py-3 text-right font-semibold">Qty</th>
                  <th className="px-4 py-3 text-left font-semibold">PO #</th>
                  <th className="px-4 py-3 text-left font-semibold">Order Status</th>
                  <th className="px-4 py-3 text-left font-semibold">Delivery Status</th>
                  <th className="px-4 py-3 text-left font-semibold">Expected Delivery</th>
                  <th className="px-4 py-3 text-left font-semibold">Actual Delivery</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item, idx) => {
                  const proj = projectMap[item.project_id];
                  return (
                    <tr key={item.id} className={`border-t border-slate-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                      <td className="px-4 py-2.5">
                        <div className="font-mono text-xs text-slate-500">{proj?.code || '—'}</div>
                        <div className="text-xs text-slate-700 truncate max-w-[110px]">{proj?.name || '—'}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="text-xs text-slate-800 font-medium max-w-[180px]">{item.description}</div>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-500">{item.manufacturer || '—'}</td>
                      <td className="px-4 py-2.5 text-xs font-mono text-slate-600">{item.manufacturer_part_number || '—'}</td>
                      <td className="px-4 py-2.5 text-xs text-slate-700">{item.supplier || '—'}</td>
                      <td className="px-4 py-2.5 text-xs text-right text-slate-700">{item.quantity} {item.unit}</td>
                      <td className="px-4 py-2.5 text-xs font-mono text-slate-500">{item.po_number || '—'}</td>
                      <td className="px-4 py-2.5">
                        <span className={`text-xs px-2 py-0.5 rounded font-semibold ${ORDER_STATUS_COLORS[item.order_status] || 'bg-slate-100 text-slate-600'}`}>
                          {item.order_status === 'ordered' ? 'Ordered' : 'Not Ordered'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`text-xs px-2 py-0.5 rounded font-semibold ${DELIVERY_COLORS[item.delivery_status] || 'bg-slate-100 text-slate-600'}`}>
                          {DELIVERY_LABELS[item.delivery_status] || item.delivery_status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-500">
                        {item.expected_delivery_date ? formatDate(item.expected_delivery_date) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-500">
                        {item.actual_delivery_date
                          ? <span className="text-emerald-600 font-medium">{formatDate(item.actual_delivery_date)}</span>
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, value, icon, color }) {
  return (
    <div className={`bg-white rounded-lg shadow-sm p-4 border-l-4 ${color}`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">{label}</div>
          <div className="text-2xl font-bold text-slate-800">{value}</div>
        </div>
        <div className="text-slate-300 mt-0.5">{icon}</div>
      </div>
    </div>
  );
}