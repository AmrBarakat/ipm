import { useState } from 'react';
import { X, FileText, Sheet, Loader2 } from 'lucide-react';
import { exportSectionsPDF, exportSectionsExcel } from '@/lib/reportExport';

export default function PreviewModal({ bundle, sections, subtitle, onClose }) {
  const [busy, setBusy] = useState(null);
  const fileBase = `${(bundle.id || 'report').replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}`;

  async function handlePDF() {
    setBusy('pdf');
    try { exportSectionsPDF(`${fileBase}.pdf`, bundle.title, sections, { subtitle }); }
    finally { setBusy(null); }
  }
  async function handleExcel() {
    setBusy('excel');
    try { exportSectionsExcel(`${fileBase}.xlsx`, sections); }
    finally { setBusy(null); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wide text-amber-600">{bundle.audience}</span>
            <h2 className="font-bold text-slate-800 text-base">{bundle.title} — Preview</h2>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handlePDF} disabled={!!busy}
              className="flex items-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 rounded-lg text-xs font-semibold disabled:opacity-50">
              {busy === 'pdf' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />} PDF
            </button>
            <button onClick={handleExcel} disabled={!!busy}
              className="flex items-center gap-1.5 px-3 py-2 border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-semibold disabled:opacity-50">
              {busy === 'excel' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sheet className="w-3.5 h-3.5" />} Excel
            </button>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500"><X className="w-5 h-5" /></button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50">
          {subtitle && <div className="text-xs text-slate-400 -mt-2">{subtitle}</div>}
          {sections.map((s, i) => (
            <div key={i} className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
                <div className="w-1 h-4 bg-amber-500 rounded" />
                <h3 className="font-semibold text-slate-700 text-sm">{s.title}</h3>
              </div>
              {s.type === 'summary' && s.summary ? (
                <div className="divide-y divide-slate-100">
                  {s.summary.map((row, ri) => (
                    <div key={ri} className="flex items-center justify-between px-4 py-2 text-sm">
                      <span className="text-slate-500">{row.label}</span>
                      <span className="font-semibold text-slate-800">{row.value}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-100 text-slate-500 uppercase border-b border-slate-100">
                      <tr>
                        {s.columns.map((c, ci) => (
                          <th key={ci} className={`px-3 py-2 ${c.align === 'right' ? 'text-right' : 'text-left'} whitespace-nowrap`}>{c.header}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {s.rows.length === 0 ? (
                        <tr><td colSpan={s.columns.length} className="px-3 py-6 text-center text-slate-400 italic">No data</td></tr>
                      ) : s.rows.map((row, ri) => (
                        <tr key={ri} className={`border-t border-slate-100 ${ri % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                          {s.columns.map((c, ci) => (
                            <td key={ci} className={`px-3 py-2 ${c.align === 'right' ? 'text-right' : 'text-left'} text-slate-700`}>
                              {row[c.key] != null ? String(row[c.key]) : '—'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                    {s.summary && (
                      <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                        {s.summary.map((row, ri) => (
                          <tr key={ri}>
                            <td className="px-3 py-2 text-xs font-semibold text-slate-600">{row.label}</td>
                            <td className="px-3 py-2 text-right text-xs font-bold text-slate-800">{row.value}</td>
                          </tr>
                        ))}
                      </tfoot>
                    )}
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}