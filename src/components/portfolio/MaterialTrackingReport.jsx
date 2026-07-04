import { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { formatCurrency, formatDate } from '@/lib/constants';
import { Package, AlertTriangle, FileText, Loader2, Truck, CheckCircle2, Clock } from 'lucide-react';
import { jsPDF } from 'jspdf';

const PO_STATUS_LABELS = {
  draft: 'Draft',
  issued: 'Issued',
  acknowledged: 'Acknowledged',
  in_transit: 'In Transit',
  partially_delivered: 'Partially Delivered',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

const PO_STATUS_COLORS = {
  draft: 'bg-slate-100 text-slate-600',
  issued: 'bg-blue-100 text-blue-700',
  acknowledged: 'bg-indigo-100 text-indigo-700',
  in_transit: 'bg-amber-100 text-amber-700',
  partially_delivered: 'bg-orange-100 text-orange-700',
  delivered: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-slate-200 text-slate-500 line-through',
};

function isPoOverdue(po) {
  if (!po.expected_delivery_date) return false;
  if (['delivered', 'cancelled'].includes(po.status)) return false;
  const d = new Date(po.expected_delivery_date); d.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return d < today;
}

export default function MaterialTrackingReport({ projects }) {
  const [pos, setPos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const projectMap = useMemo(() => Object.fromEntries(projects.map(p => [p.id, p])), [projects]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const projectIds = new Set(projects.map(p => p.id));
      const all = await base44.entities.PurchaseOrder.list('-created_date', 2000);
      setPos(all.filter(po => projectIds.has(po.project_id)));
      setLoading(false);
    }
    load();
  }, [projects]);

  // Group POs by project (only projects that have POs)
  const groups = useMemo(() => {
    const map = {};
    pos.forEach(po => {
      if (!map[po.project_id]) map[po.project_id] = [];
      map[po.project_id].push(po);
    });
    return Object.entries(map)
      .map(([pid, poList]) => ({ project: projectMap[pid], pos: poList }))
      .filter(g => g.project)
      .sort((a, b) => (a.project.code || '').localeCompare(b.project.code || ''));
  }, [pos, projectMap]);

  // Totals
  const grandTotal = pos.reduce((s, po) => s + (po.amount || 0), 0);
  const overdueCount = pos.filter(isPoOverdue).length;
  const deliveredCount = pos.filter(po => po.status === 'delivered').length;
  const openCount = pos.length - deliveredCount - pos.filter(po => po.status === 'cancelled').length;

  function projectTotal(poList) {
    return poList.reduce((s, po) => s + (po.amount || 0), 0);
  }

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
    function sectionTitle(text) {
      checkPage(10);
      doc.setFillColor(245, 158, 11);
      doc.rect(margin, y - 4, 3, 6, 'F');
      doc.setFontSize(10);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text(text, margin + 5, y);
      y += 6;
    }
    function poHeader() {
      checkPage(8);
      const cols = [0.22, 0.12, 0.13, 0.13, 0.15, 0.13, 0.12];
      const labels = ['Vendor', 'PO #', 'Value', 'Delivery Date', 'Status', 'Type', 'Overdue'];
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
    function poRow(po, cols, shade) {
      checkPage(8);
      const overdue = isPoOverdue(po);
      if (shade) { doc.setFillColor(248, 250, 252); doc.rect(margin, y - 4, colW, 7, 'F'); }
      if (overdue) { doc.setFillColor(254, 226, 226); doc.rect(margin, y - 4, colW, 7, 'F'); }
      doc.setFontSize(7);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(overdue ? 185 : 30, overdue ? 28 : 41, overdue ? 28 : 59);
      const vals = [
        truncate(po.vendor_name || '—', 40),
        po.po_number || '—',
        formatCurrency(po.amount || 0, po.currency || 'SAR'),
        po.expected_delivery_date ? formatDate(po.expected_delivery_date) : '—',
        PO_STATUS_LABELS[po.status] || po.status || '—',
        po.type || '—',
        overdue ? 'OVERDUE' : '—',
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
    doc.text(`Generated: ${today}  |  ${pos.length} POs across ${groups.length} projects  |  Grand Total: ${formatCurrency(grandTotal, 'SAR')}`, margin, 17);
    doc.setTextColor(0, 0, 0);
    y = 30;

    // KPI line
    doc.setFontSize(8);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(71, 85, 105);
    doc.text(`Overdue: ${overdueCount}  ·  Delivered: ${deliveredCount}  ·  Open: ${openCount}`, margin, y);
    y += 6;

    // Per-project groups
    groups.forEach(g => {
      checkPage(16);
      sectionTitle(`${g.project.code} — ${truncate(g.project.name, 50)}  ·  ${g.pos.length} POs  ·  ${formatCurrency(projectTotal(g.pos), g.project.currency || 'SAR')}${g.pos.some(isPoOverdue) ? `  ·  ⚠ ${g.pos.filter(isPoOverdue).length} overdue` : ''}`);
      const cols = poHeader();
      g.pos.forEach((po, i) => poRow(po, cols, i % 2 === 0));
      // Per-project subtotal
      checkPage(8);
      doc.setFillColor(241, 245, 249);
      doc.rect(margin, y - 4, colW, 7, 'F');
      doc.setFontSize(8);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text('Project Subtotal', margin + 1, y);
      doc.text(formatCurrency(projectTotal(g.pos), g.project.currency || 'SAR'), margin + colW * (0.22 + 0.12) + 1, y);
      y += 10;
    });

    // Grand total
    checkPage(12);
    doc.setFillColor(15, 23, 42);
    doc.rect(margin, y - 4, colW, 9, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.setFont(undefined, 'bold');
    doc.text('GRAND TOTAL', margin + 1, y + 2);
    doc.text(formatCurrency(grandTotal, 'SAR'), margin + colW * (0.22 + 0.12) + 1, y + 2);
    y += 12;

    // Footer
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

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Total POs" value={pos.length} icon={<Package className="w-5 h-5" />} color="border-slate-400" />
        <KpiCard label="Grand Total" value={formatCurrency(grandTotal, 'SAR')} icon={<Truck className="w-5 h-5" />} color="border-blue-400" />
        <KpiCard label="Delivered" value={deliveredCount} icon={<CheckCircle2 className="w-5 h-5" />} color="border-emerald-400" />
        <KpiCard label="Overdue" value={overdueCount} icon={<AlertTriangle className="w-5 h-5" />} color={overdueCount > 0 ? 'border-red-500' : 'border-slate-400'} valueClass={overdueCount > 0 ? 'text-red-600' : ''} />
      </div>

      {/* Export bar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{groups.length} projects · {pos.length} purchase orders</p>
        <button onClick={exportPDF} disabled={generating || pos.length === 0}
          className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded disabled:opacity-50">
          {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
          {generating ? 'Generating…' : 'Export PDF'}
        </button>
      </div>

      {/* Grouped report */}
      {groups.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <Package className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No purchase orders found across projects.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map(g => {
            const total = projectTotal(g.pos);
            const pOverdue = g.pos.filter(isPoOverdue);
            return (
              <div key={g.project.id} className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                {/* Project header */}
                <div className="flex items-center gap-3 px-4 py-2.5 bg-slate-800 text-white">
                  <span className="font-mono text-xs text-slate-300">{g.project.code}</span>
                  <span className="text-sm font-semibold truncate">{g.project.name}</span>
                  <span className="text-slate-400 text-xs">·</span>
                  <span className="text-xs text-slate-300">{g.pos.length} POs</span>
                  {pOverdue.length > 0 && (
                    <span className="flex items-center gap-1 text-xs text-red-300 font-semibold">
                      <AlertTriangle className="w-3 h-3" /> {pOverdue.length} overdue
                    </span>
                  )}
                  <span className="ml-auto text-xs">
                    Project Total: <span className="text-amber-300 font-bold">{formatCurrency(total, g.project.currency || 'SAR')}</span>
                  </span>
                </div>
                {/* PO table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[820px]">
                    <thead className="bg-slate-50 text-slate-500 text-xs uppercase border-b">
                      <tr>
                        <th className="px-4 py-2.5 text-left">Vendor</th>
                        <th className="px-4 py-2.5 text-left">PO #</th>
                        <th className="px-4 py-2.5 text-right">Value</th>
                        <th className="px-4 py-2.5 text-left">Delivery Date</th>
                        <th className="px-4 py-2.5 text-left">Status</th>
                        <th className="px-4 py-2.5 text-left">Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.pos.map((po, i) => {
                        const overdue = isPoOverdue(po);
                        return (
                          <tr key={po.id} className={`border-t border-slate-100 ${overdue ? 'bg-red-50' : i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                            <td className="px-4 py-2.5 text-xs text-slate-700 font-medium">
                              {po.vendor_name || '—'}
                            </td>
                            <td className="px-4 py-2.5 text-xs font-mono text-slate-600">{po.po_number || '—'}</td>
                            <td className="px-4 py-2.5 text-xs text-right font-semibold text-slate-800">{formatCurrency(po.amount || 0, po.currency || 'SAR')}</td>
                            <td className="px-4 py-2.5 text-xs">
                              {po.expected_delivery_date ? (
                                <span className={overdue ? 'text-red-600 font-semibold' : 'text-slate-500'}>
                                  {formatDate(po.expected_delivery_date)}
                                  {overdue && <span className="ml-1.5 inline-flex items-center gap-0.5 text-red-500"><AlertTriangle className="w-3 h-3" /></span>}
                                </span>
                              ) : <span className="text-slate-400">—</span>}
                            </td>
                            <td className="px-4 py-2.5">
                              <span className={`text-xs px-2 py-0.5 rounded font-semibold ${PO_STATUS_COLORS[po.status] || 'bg-slate-100 text-slate-600'}`}>
                                {PO_STATUS_LABELS[po.status] || po.status || '—'}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-xs text-slate-500 capitalize">{po.type || '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-slate-50 border-t border-slate-200">
                      <tr>
                        <td colSpan={2} className="px-4 py-2.5 text-xs font-semibold text-slate-600">Project Subtotal</td>
                        <td className="px-4 py-2.5 text-xs text-right font-bold text-slate-800">{formatCurrency(total, g.project.currency || 'SAR')}</td>
                        <td colSpan={3}></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            );
          })}

          {/* Grand total */}
          <div className="bg-slate-800 text-white rounded-lg px-4 py-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-200">Grand Total ({pos.length} POs)</span>
            <span className="text-lg font-bold text-amber-300">{formatCurrency(grandTotal, 'SAR')}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, value, icon, color, valueClass }) {
  return (
    <div className={`bg-white rounded-lg shadow-sm p-4 border-l-4 ${color}`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">{label}</div>
          <div className={`text-xl font-bold text-slate-800 ${valueClass || ''}`}>{value}</div>
        </div>
        <div className="text-slate-300 mt-0.5">{icon}</div>
      </div>
    </div>
  );
}

function truncate(str, max) {
  if (!str) return '—';
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}