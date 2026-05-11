import { useState } from 'react';
import { Download, Loader2, Sheet, FileText } from 'lucide-react';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

function toISO(date) {
  if (!date) return '';
  return new Date(date).toISOString().slice(0, 10);
}

export default function GanttExportButton({
  project, zoom, viewStart, viewEnd,
  milestones, wbsItems, wbsRows, wbsImpact, chartContainerRef,
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const baseName = `Gantt_${project?.code || 'Project'}_${zoom?.label || ''}_${new Date().toISOString().slice(0, 10)}`;

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

  function buildWbsDataRows() {
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
        'Conflict': dep.delayed ? 'Yes' : 'No',
      };
    });
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
    const wbsDataRows = buildWbsDataRows();

    const wb = XLSX.utils.book_new();

    const msSheet = XLSX.utils.json_to_sheet(msRows.length ? msRows : [{ Note: 'No milestones' }]);
    autoWidth(msSheet, msRows);
    XLSX.utils.book_append_sheet(wb, msSheet, 'Milestones');

    const wbsSheet = XLSX.utils.json_to_sheet(wbsDataRows.length ? wbsDataRows : [{ Note: 'No WBS items' }]);
    autoWidth(wbsSheet, wbsDataRows);
    XLSX.utils.book_append_sheet(wb, wbsSheet, 'WBS Items');

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{
      'Project': project?.name || '',
      'Code': project?.code || '',
      'View Filter': zoom?.label || '',
      'View Start': viewStart ? toISO(viewStart) : '',
      'View End': viewEnd ? toISO(viewEnd) : '',
      'Total Milestones': milestones.length,
      'Total WBS Items': wbsItems.length,
      'WBS Items with Dates': wbsRows.length,
      'Schedule Conflicts': Object.values(wbsImpact).filter(v => v.delayed).length,
    }]), 'Summary');

    XLSX.writeFile(wb, `${baseName}.xlsx`);
    setOpen(false);
  }

  async function exportPDF() {
    setLoading(true);
    setOpen(false);
    try {
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const margin = 12;
      const contentW = pageW - margin * 2;
      const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

      // ── Page 1: Cover / Summary ──────────────────────────────────────────────
      doc.setFillColor(30, 41, 59); // slate-800
      doc.rect(0, 0, pageW, 40, 'F');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      doc.setTextColor(255, 255, 255);
      doc.text('Gantt Chart Report', margin, 18);

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(203, 213, 225); // slate-300
      doc.text(`${project?.name || ''}  |  ${project?.code || ''}  |  ${today}`, margin, 28);
      doc.text(`View: ${zoom?.label || ''}  ·  ${viewStart ? toISO(viewStart) : ''} → ${viewEnd ? toISO(viewEnd) : ''}`, margin, 34);

      // Summary stats
      const stats = [
        ['Project', project?.name || '—'],
        ['Project Code', project?.code || '—'],
        ['Client', project?.client || '—'],
        ['Status', (project?.status || '').replace(/_/g, ' ')],
        ['Project Manager', project?.project_manager || '—'],
        ['Start Date', project?.start_date || '—'],
        ['Target Completion', project?.target_completion_date || '—'],
        ['Progress', `${project?.progress ?? 0}%`],
        ['Total Milestones', String(milestones.length)],
        ['Completed Milestones', String(milestones.filter(m => m.status === 'completed').length)],
        ['Total WBS Items', String(wbsItems.length)],
        ['WBS Items w/ Dates', String(wbsRows.length)],
        ['Schedule Conflicts', String(Object.values(wbsImpact).filter(v => v.delayed).length)],
      ];

      let y = 50;
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 41, 59);
      doc.text('Project Summary', margin, y);
      y += 6;
      doc.setDrawColor(245, 158, 11); // amber-500
      doc.setLineWidth(0.5);
      doc.line(margin, y, margin + 60, y);
      y += 5;

      doc.setFontSize(9);
      stats.forEach(([label, val], i) => {
        if (i % 2 === 0) {
          doc.setFillColor(248, 250, 252);
          doc.rect(margin, y - 3.5, contentW, 6, 'F');
        }
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(71, 85, 105);
        doc.text(label, margin + 1, y);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(30, 41, 59);
        doc.text(String(val), margin + 55, y);
        y += 6;
      });

      // ── Page 2: Gantt Chart Screenshot ──────────────────────────────────────
      if (chartContainerRef?.current) {
        doc.addPage();

        // Re-draw page header
        doc.setFillColor(30, 41, 59);
        doc.rect(0, 0, pageW, 12, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(255, 255, 255);
        doc.text('Gantt Chart', margin, 8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(203, 213, 225);
        doc.text(`${project?.code || ''}  |  View: ${zoom?.label || ''}  |  ${toISO(viewStart)} → ${toISO(viewEnd)}`, pageW / 2, 8, { align: 'center' });

        // Temporarily expand the chart container so html2canvas sees the full width
        const el = chartContainerRef.current;
        const prevOverflow = el.style.overflow;
        el.style.overflow = 'visible';

        const canvas = await html2canvas(el, {
          scale: 4,
          useCORS: true,
          backgroundColor: '#ffffff',
          logging: false,
          scrollX: 0,
          scrollY: -window.scrollY,
          windowWidth: el.scrollWidth,
          windowHeight: el.scrollHeight,
        });

        el.style.overflow = prevOverflow;

        const imgData = canvas.toDataURL('image/png', 1.0);
        const imgW = contentW;
        const imgH = Math.min((canvas.height / canvas.width) * imgW, pageH - 22);
        doc.addImage(imgData, 'PNG', margin, 16, imgW, imgH, undefined, 'FAST');
      }

      // ── Page 3: Milestones Table ──────────────────────────────────────────────
      doc.addPage();
      drawPageHeader(doc, pageW, margin, 'Milestones', project, zoom, viewStart, viewEnd);

      const msRows = buildMsRows();
      if (msRows.length) {
        const msHeaders = Object.keys(msRows[0]);
        const msColW = contentW / msHeaders.length;
        let my = 22;

        // Header
        doc.setFillColor(245, 158, 11); // amber-500
        doc.rect(margin, my - 4, contentW, 8, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(255, 255, 255);
        msHeaders.forEach((h, i) => doc.text(h, margin + i * msColW + 1, my, { maxWidth: msColW - 2 }));
        my += 8;

        doc.setFont('helvetica', 'normal');
        msRows.forEach((row, ri) => {
          if (my > pageH - 15) { doc.addPage(); drawPageHeader(doc, pageW, margin, 'Milestones (cont.)', project, zoom, viewStart, viewEnd); my = 22; }
          if (ri % 2 === 0) { doc.setFillColor(254, 252, 232); doc.rect(margin, my - 3.5, contentW, 6.5, 'F'); }
          doc.setFontSize(7);
          doc.setTextColor(30, 41, 59);
          Object.values(row).forEach((v, i) => doc.text(String(v ?? ''), margin + i * msColW + 1, my, { maxWidth: msColW - 2 }));
          my += 6.5;
        });
      } else {
        doc.setFontSize(9); doc.setTextColor(150, 150, 150);
        doc.text('No milestones found.', margin, 30);
      }

      // ── Page 4+: WBS Items Table ──────────────────────────────────────────────
      doc.addPage();
      drawPageHeader(doc, pageW, margin, 'WBS Items', project, zoom, viewStart, viewEnd);

      const wbsDataRows = buildWbsDataRows();
      if (wbsDataRows.length) {
        const wbsHeaders = Object.keys(wbsDataRows[0]);
        const wbsColW = contentW / wbsHeaders.length;
        let wy = 22;

        doc.setFillColor(124, 58, 237); // purple-600
        doc.rect(margin, wy - 4, contentW, 8, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        doc.setTextColor(255, 255, 255);
        wbsHeaders.forEach((h, i) => doc.text(h, margin + i * wbsColW + 1, wy, { maxWidth: wbsColW - 2 }));
        wy += 8;

        doc.setFont('helvetica', 'normal');
        wbsDataRows.forEach((row, ri) => {
          if (wy > pageH - 15) { doc.addPage(); drawPageHeader(doc, pageW, margin, 'WBS Items (cont.)', project, zoom, viewStart, viewEnd); wy = 22; }
          const vals = Object.values(row);
          const isConflict = vals[vals.length - 1] === 'Yes';
          if (isConflict) { doc.setFillColor(254, 226, 226); doc.rect(margin, wy - 3.5, contentW, 6.5, 'F'); }
          else if (ri % 2 === 0) { doc.setFillColor(245, 243, 255); doc.rect(margin, wy - 3.5, contentW, 6.5, 'F'); }
          doc.setFontSize(6.5);
          doc.setTextColor(30, 41, 59);
          vals.forEach((v, i) => {
            if (i === vals.length - 1 && isConflict) doc.setTextColor(220, 38, 38);
            else doc.setTextColor(30, 41, 59);
            doc.text(String(v ?? ''), margin + i * wbsColW + 1, wy, { maxWidth: wbsColW - 2 });
          });
          wy += 6.5;
        });
      } else {
        doc.setFontSize(9); doc.setTextColor(150, 150, 150);
        doc.text('No WBS items found.', margin, 30);
      }

      // Page numbers
      const totalPages = doc.getNumberOfPages();
      for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p);
        doc.setFontSize(7);
        doc.setTextColor(150, 150, 150);
        doc.text(`Page ${p} of ${totalPages}`, pageW - margin, pageH - 5, { align: 'right' });
        doc.text(`Confidential  ·  ${today}`, margin, pageH - 5);
      }

      doc.save(`${baseName}.pdf`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        disabled={loading}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-slate-200 rounded hover:bg-slate-100 text-slate-600 font-medium disabled:opacity-50"
      >
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
        {loading ? 'Generating…' : `Export (${zoom?.label || ''})`}
      </button>
      {open && !loading && (
        <div className="absolute right-0 mt-1 w-44 bg-white border border-slate-200 rounded shadow-lg z-50 py-1">
          <button onClick={exportExcel} className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-slate-50 text-slate-700">
            <Sheet className="w-3.5 h-3.5 text-emerald-600" /> Excel (.xlsx)
          </button>
          <button onClick={exportPDF} className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-slate-50 text-slate-700">
            <FileText className="w-3.5 h-3.5 text-red-500" /> PDF (full report)
          </button>
        </div>
      )}
    </div>
  );
}

function drawPageHeader(doc, pageW, margin, sectionTitle, project, zoom, viewStart, viewEnd) {
  doc.setFillColor(30, 41, 59);
  doc.rect(0, 0, pageW, 12, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text(sectionTitle, margin, 8);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(203, 213, 225);
  doc.text(
    `${project?.code || ''}  |  View: ${zoom?.label || ''}  |  ${viewStart ? new Date(viewStart).toISOString().slice(0,10) : ''} → ${viewEnd ? new Date(viewEnd).toISOString().slice(0,10) : ''}`,
    pageW / 2, 8, { align: 'center' }
  );
}