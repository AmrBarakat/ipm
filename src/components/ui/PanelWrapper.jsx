import { useState, useRef } from 'react';
import { Maximize2, Minimize2, Download, FileText, Sheet } from 'lucide-react';
import * as XLSX from 'xlsx-js-style';
import { exportSectionsPDF, styleSheet } from '@/lib/reportExport';

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
    const cols = exportCols || Object.keys(exportData[0] || {}).map((k) => ({ key: k, label: k }));
    const rows = exportData.map((row) => Object.fromEntries(cols.map((c) => [c.label, row[c.key] ?? ''])));
    const ws = XLSX.utils.json_to_sheet(rows);
    styleSheet(ws, { headerRows: [0], freezeRow: 1, columns: cols.map((c) => ({ header: c.label, fmt: c.fmt })) });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, String(title).slice(0, 31) || 'Sheet');
    XLSX.writeFile(wb, `${title.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    setMenuOpen(false);
  }

  // PDF routes through the shared engine: wrapped cells, header band, repeating
  // table header, and page footer — instead of the old single-page maxWidth draw.
  function exportPDF() {
    if (!exportData?.length || !exportCols?.length) return;
    const columns = exportCols.map((c) => ({ header: c.label, key: c.key, align: c.align || 'left' }));
    exportSectionsPDF(
      `${title.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`,
      title,
      [{ title, type: 'table', columns, rows: exportData }],
    );
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