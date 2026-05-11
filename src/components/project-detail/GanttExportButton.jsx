import { useState } from 'react';
import { Download, Loader2, Sheet, FileText } from 'lucide-react';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';

function toISO(date) {
  return new Date(date).toISOString().slice(0, 10);
}

export default function GanttExportButton({
  project, zoom, viewStart, viewEnd,
  milestones, wbsItems, wbsRows, wbsImpact, chartContainerRef,
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const baseName = `Gantt_${project?.code || 'Project'}_${zoom.label}_${new Date().toISOString().slice(0, 10)}`;

  function buildMsRows() {
    return milestones.map(m => ({
      'Title': m.title || '',
      'Status': (m.status || '').replace(/_/g, ' '),
      'Planned Date': m.planned_date || '',
      'Completed Date': m.completed_date || '',
      'Progress %': m.progress ?? 0,
      'Weight': m.weight ?? 0,
      'Description': m.description || '',
    }));
  }

  function buildWbsRows() {
    return wbsItems.map(w => {
      const linkedMs = milestones.find(m => m.id === w.milestone_id);
      const dep = wbsImpact[w.id] || {};
      return {
        'WBS Code': w.wbs_code || '',
        'Name': w.name || '',
        'Status': (w.status || '').replace(/_/g, ' '),
        'Assignee': w.assignee || '',
        'Planned Start': w.planned_start || '',
        'Planned End': w.planned_end || '',
        'Actual Start': w.actual_start || '',
        'Actual End': w.actual_end || '',
        'Progress %': w.progress ?? 0,
        'Weight': w.weight ?? 0,
        'Planned Hours': w.planned_hours ?? '',
        'Actual Hours': w.actual_hours ?? '',
        'Planned Cost': w.planned_cost ?? '',
        'Actual Cost': w.actual_cost ?? '',
        'Linked Milestone': linkedMs?.title || '',
        'Schedule Conflict': dep.delayed ? 'Yes' : 'No',
        'Description': w.description || '',
      };
    });
  }

  function buildViewInfo() {
    return [{
      'View Filter': zoom.label,
      'View Start': viewStart ? toISO(viewStart) : '',
      'View End': viewEnd ? toISO(viewEnd) : '',
      'Total Milestones': milestones.length,
      'Total WBS Items': wbsItems.length,
      'WBS Items with Dates': wbsRows.length,
      'Schedule Conflicts': Object.values(wbsImpact).filter(v => v.delayed).length,
    }];
  }

  function autoWidth(ws, rows) {
    if (!rows.length) return;
    const cols = Object.keys(rows[0]);
    ws['!cols'] = cols.map(col => ({
      wch: Math.max(col.length, ...rows.map(r => String(r[col] ?? '').length)) + 2,
    }));
  }

  function exportExcel() {
    const msRows = buildMsRows();
    const wbsDataRows = buildWbsRows();
    const viewRows = buildViewInfo();

    const wb = XLSX.utils.book_new();

    const msSheet = XLSX.utils.json_to_sheet(msRows.length ? msRows : [{ Note: 'No milestones' }]);
    autoWidth(msSheet, msRows);
    XLSX.utils.book_append_sheet(wb, msSheet, 'Milestones');

    const wbsSheet = XLSX.utils.json_to_sheet(wbsDataRows.length ? wbsDataRows : [{ Note: 'No WBS items' }]);
    autoWidth(wbsSheet, wbsDataRows);
    XLSX.utils.book_append_sheet(wb, wbsSheet, 'WBS Items');

    const viewSheet = XLSX.utils.json_to_sheet(viewRows);
    autoWidth(viewSheet, viewRows);
    XLSX.utils.book_append_sheet(wb, viewSheet, 'View Info');

    XLSX.writeFile(wb, `${baseName}.xlsx`);
    setOpen(false);
  }

  function exportPDF() {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 12;
    const contentW = pageW - margin * 2;

    function drawHeader(text) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.setTextColor(30, 30, 30);
      doc.text(text, margin, 16);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);
      doc.text(`View: ${zoom.label}  |  ${viewStart ? toISO(viewStart) : ''} → ${viewEnd ? toISO(viewEnd) : ''}  |  ${new Date().toLocaleDateString()}`, margin, 22);
      doc.setDrawColor(220, 220, 220);
      doc.line(margin, 24, pageW - margin, 24);
    }

    function drawTable(headers, rows, startY) {
      const colW = contentW / headers.length;
      let y = startY;

      // Header row
      doc.setFillColor(241, 245, 249);
      doc.rect(margin, y - 4, contentW, 7, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(60, 60, 60);
      headers.forEach((h, i) => doc.text(String(h), margin + i * colW + 1, y, { maxWidth: colW - 2 }));
      doc.setFont('helvetica', 'normal');
      y += 7;

      rows.forEach((row, ri) => {
        if (y > doc.internal.pageSize.getHeight() - 15) {
          doc.addPage();
          y = 30;
          // Repeat header
          doc.setFillColor(241, 245, 249);
          doc.rect(margin, y - 4, contentW, 7, 'F');
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(7.5);
          headers.forEach((h, i) => doc.text(String(h), margin + i * colW + 1, y, { maxWidth: colW - 2 }));
          doc.setFont('helvetica', 'normal');
          y += 7;
        }
        if (ri % 2 === 0) {
          doc.setFillColor(248, 250, 252);
          doc.rect(margin, y - 4, contentW, 6.5, 'F');
        }
        doc.setFontSize(7);
        doc.setTextColor(40, 40, 40);
        const vals = typeof row === 'object' ? Object.values(row) : [];
        vals.forEach((v, i) => doc.text(String(v ?? ''), margin + i * colW + 1, y, { maxWidth: colW - 2 }));
        y += 6.5;
      });

      return y;
    }

    // ── Page 1: Milestones ──
    drawHeader('Gantt Report – Milestones');
    const msRows = buildMsRows();
    const msHeaders = msRows.length ? Object.keys(msRows[0]) : [];
    drawTable(msHeaders, msRows.map(r => Object.values(r)), 32);

    // ── Page 2: WBS Items ──
    doc.addPage();
    drawHeader('Gantt Report – WBS Items');
    const wbsDataRows = buildWbsRows();
    const wbsHeaders = wbsDataRows.length ? Object.keys(wbsDataRows[0]) : [];
    drawTable(wbsHeaders, wbsDataRows.map(r => Object.values(r)), 32);

    doc.save(`${baseName}.pdf`);
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        disabled={loading}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-slate-200 rounded hover:bg-slate-100 text-slate-600 font-medium disabled:opacity-50"
      >
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
        Export ({zoom.label})
      </button>
      {open && (
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
  );
}