import { useState } from 'react';
import { X, FileText, Sheet, Loader2, CheckCircle, AlertTriangle, AlertOctagon } from 'lucide-react';
import { exportSectionsPDF, exportSectionsExcel } from '@/lib/reportExport';

const CALLOUT_STYLES = {
  good: { bg: 'bg-emerald-50', border: 'border-emerald-300', text: 'text-emerald-700', icon: <CheckCircle className="w-5 h-5" /> },
  warn: { bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-700', icon: <AlertTriangle className="w-5 h-5" /> },
  bad: { bg: 'bg-red-50', border: 'border-red-300', text: 'text-red-700', icon: <AlertOctagon className="w-5 h-5" /> },
};

const COLOR_DOT = {
  green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-500', blue: 'bg-blue-500',
  grey: 'bg-slate-400', indigo: 'bg-indigo-500', violet: 'bg-violet-500', slate: 'bg-slate-500', emerald: 'bg-emerald-500',
};

export default function PreviewModal({ bundle, sections, subtitle, projectCode, generatedBy, onClose }) {
  const opts = { projectCode, generatedBy };
  const [busy, setBusy] = useState(null);
  const fileBase = `${(bundle.id || 'report').replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}`;

  async function handlePDF() {
    setBusy('pdf');
    try { exportSectionsPDF(`${fileBase}.pdf`, bundle.title, sections, { subtitle, projectCode: opts?.projectCode, generatedBy: opts?.generatedBy }); }
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
              {s.type === 'kpis' ? (
                <div className="p-4 grid grid-cols-2 md:grid-cols-5 gap-3">
                  {s.cards.map((card, ci) => (
                    <div key={ci} className="bg-slate-50 rounded-lg p-3 border-l-[3px]" style={{ borderLeftColor: 'var(--tw)' }}>
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className={`w-2 h-2 rounded-full ${COLOR_DOT[card.color] || 'bg-amber-500'}`} />
                        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{card.label}</span>
                      </div>
                      <div className="text-lg font-bold text-slate-800">{card.value}</div>
                    </div>
                  ))}
                </div>
              ) : s.type === 'callout' ? (
                <div className={`p-4 flex items-start gap-3 ${CALLOUT_STYLES[s.tone || 'good'].bg} border-l-4 ${CALLOUT_STYLES[s.tone || 'good'].border}`}>
                  <div className={`${CALLOUT_STYLES[s.tone || 'good'].text} shrink-0`}>{CALLOUT_STYLES[s.tone || 'good'].icon}</div>
                  <div>
                    <div className={`font-semibold text-sm ${CALLOUT_STYLES[s.tone || 'good'].text}`}>{s.title}</div>
                    {s.body && <div className="text-xs text-slate-600 mt-0.5">{s.body}</div>}
                  </div>
                </div>
              ) : s.type === 'chart' ? (
                <div className="p-4">
                  <div className="text-xs text-slate-400 mb-2 italic">Chart: {s.chart} — rendered in PDF export</div>
                  {s.chart === 'hbars' && s.data?.rows && (
                    <div className="space-y-2">
                      {s.data.rows.map((row, ri) => (
                        <div key={ri} className="flex items-center gap-2">
                          <span className="text-xs text-slate-600 w-40 truncate">{row.label}</span>
                          <div className="flex-1 bg-slate-100 rounded h-4 overflow-hidden">
                            <div className={`h-full rounded ${COLOR_DOT[row.color] || 'bg-blue-500'}`} style={{ width: `${Math.min(100, (row.value / (row.max || 100)) * 100)}%` }} />
                          </div>
                          <span className="text-xs font-semibold text-slate-700 w-10 text-right">{typeof row.value === 'number' ? `${Math.round(row.value)}%` : row.value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {s.chart === 'stacked' && s.data?.segments && (
                    <div>
                      <div className="flex h-5 rounded overflow-hidden">
                        {s.data.segments.map((seg, si) => (
                          <div key={si} className={`${COLOR_DOT[seg.color] || 'bg-slate-400'}`} style={{ width: `${(seg.value / s.data.segments.reduce((a, b) => a + b.value, 0)) * 100}%` }} />
                        ))}
                      </div>
                      <div className="flex flex-wrap gap-3 mt-2">
                        {s.data.segments.map((seg, si) => (
                          <div key={si} className="flex items-center gap-1 text-xs text-slate-600">
                            <span className={`w-2.5 h-2.5 rounded ${COLOR_DOT[seg.color] || 'bg-slate-400'}`} />
                            {seg.label} ({seg.value})
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {s.chart === 'donut' && (
                    <div className="flex items-center gap-4 py-2">
                      <div className="relative w-20 h-20">
                        <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                          <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeWidth="5" className="text-slate-200" />
                          <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="5" strokeDasharray={`${s.data.pct}, 100`} className={s.data.color ? '' : 'text-blue-500'} stroke="currentColor" strokeLinecap="round" />
                        </svg>
                        <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-slate-800">{s.data.pct}%</span>
                      </div>
                      {s.data.label && <span className="text-xs text-slate-500">{s.data.label}</span>}
                    </div>
                  )}
                  {s.chart === 'gauge' && (
                    <div className="py-2">
                      <div className="relative h-5 rounded overflow-hidden flex">
                        <div className="bg-emerald-500" style={{ width: `${s.data.thresholds?.green ?? 60}%` }} />
                        <div className="bg-amber-500" style={{ width: `${(s.data.thresholds?.amber ?? 80) - (s.data.thresholds?.green ?? 60)}%` }} />
                        <div className="bg-red-500" style={{ width: `${100 - (s.data.thresholds?.amber ?? 80)}%` }} />
                      </div>
                      <div className="text-xs font-bold text-slate-700 mt-1">{s.data.value}% {s.opts?.label}</div>
                    </div>
                  )}
                  {s.chart === 'line' && (
                    <div className="text-xs text-slate-500 py-4">
                      {s.data.series?.map(s => s.name).join(' vs ') || 'Line chart'}
                    </div>
                  )}
                </div>
              ) : s.type === 'summary' && s.summary ? (
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
                            <td key={ci} className={`px-3 py-2 ${c.align === 'right' ? 'text-right' : 'text-left'} text-slate-700`} style={c.cellColor && c.cellColor(row) ? { color: `rgb(${c.cellColor(row).join(',')})` } : undefined}>
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