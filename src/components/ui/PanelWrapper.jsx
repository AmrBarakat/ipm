import { useState, useRef } from 'react';
import { Maximize2, Minimize2, Download, FileText, Sheet } from 'lucide-react';
import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';

/**
 * PanelWrapper – wraps any table/chart with fullscreen + PDF/Excel export.
 *
 * Props:
 *   title        – string shown in fullscreen header & export filename
 *   exportData   – array of plain objects for Excel/PDF export (optional)
 *   exportCols   – array of { key, label } for controlling columns (optional)
 *   children     – the actual content
 */
export default function PanelWrapper({ title = 'Panel', exportData, exportCols, children }) {
  const [fullscreen, setFullscreen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const contentRef = useRef(null);

  function exportExcel() {
    if (!exportData?.length) return;
    const rows = exportData.map(row => {
      if (!exportCols) return row;
      return Object.fromEntries(exportCols.map(c => [c.label, row[c.key] ?? '']));
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 31));
    XLSX.writeFile(wb, `${title.replace(/\s+/g, '_')}.xlsx`);
    setMenuOpen(false);
  }

  function exportPDF() {
    if (!exportData?.length || !exportCols?.length) return;
    const doc = new jsPDF({ orientation: 'landscape' });
    doc.setFontSize(14);
    doc.text(title, 14, 16);
    doc.setFontSize(8);

    const headers = exportCols.map(c => c.label);
    const colW = Math.max(20, Math.floor(270 / headers.length));
    let y = 26;

    // Header row
    doc.setFillColor(241, 245, 249);
    doc.rect(14, y - 4, colW * headers.length, 8, 'F');
    doc.setFont(undefined, 'bold');
    headers.forEach((h, i) => doc.text(String(h), 14 + i * colW, y, { maxWidth: colW - 2 }));
    doc.setFont(undefined, 'normal');
    y += 8;

    exportData.forEach((row, ri) => {
      if (y > 185) { doc.addPage(); y = 20; }
      if (ri % 2 === 0) {
        doc.setFillColor(248, 250, 252);
        doc.rect(14, y - 4, colW * headers.length, 7, 'F');
      }
      exportCols.forEach((c, i) => {
        const val = row[c.key] !== undefined && row[c.key] !== null ? String(row[c.key]) : '';
        doc.text(val, 14 + i * colW, y, { maxWidth: colW - 2 });
      });
      y += 7;
    });

    doc.save(`${title.replace(/\s+/g, '_')}.pdf`);
    setMenuOpen(false);
  }

  const canExport = exportData?.length > 0 && exportCols?.length > 0;

  const toolbar = (
    <div className="flex items-center gap-1 shrink-0">
      {canExport && (
        <div className="relative">
          <button
            onClick={() => setMenuOpen(v => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-slate-200 rounded hover:bg-slate-100 text-slate-600 font-medium"
            title="Export"
          >
            <Download className="w-3.5 h-3.5" /> Export
          </button>
          {menuOpen && (
            <div className="absolute right-0 mt-1 w-36 bg-white border border-slate-200 rounded shadow-lg z-50 py-1">
              <button onClick={exportExcel} className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-slate-50 text-slate-700">
                <Sheet className="w-3.5 h-3.5 text-emerald-600" /> Excel (.xlsx)
              </button>
              <button onClick={exportPDF} className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-slate-50 text-slate-700">
                <FileText className="w-3.5 h-3.5 text-red-500" /> PDF
              </button>
            </div>
          )}
        </div>
      )}
      <button
        onClick={() => setFullscreen(v => !v)}
        className="p-1.5 border border-slate-200 rounded hover:bg-slate-100 text-slate-600"
        title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
      >
        {fullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
      </button>
    </div>
  );

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-white flex flex-col">
        {/* Fullscreen header */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-slate-200 bg-slate-50 shrink-0">
          <h2 className="font-semibold text-slate-700 text-sm">{title}</h2>
          {toolbar}
        </div>
        <div className="flex-1 overflow-auto p-6" ref={contentRef}>
          {children}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-end mb-2 gap-2">
        {toolbar}
      </div>
      <div ref={contentRef}>
        {children}
      </div>
    </div>
  );
}