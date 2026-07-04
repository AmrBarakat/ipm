import { useState } from 'react';
import { Eye, FileText, Sheet, Loader2, ChevronRight } from 'lucide-react';
import { exportSectionsPDF, exportSectionsExcel } from '@/lib/reportExport';
import PreviewModal from '@/components/reports/PreviewModal';

const ACCENT = {
  amber:   { bar: 'bg-amber-500',   chip: 'bg-amber-100 text-amber-700',   ring: 'border-amber-200' },
  emerald: { bar: 'bg-emerald-500', chip: 'bg-emerald-100 text-emerald-700', ring: 'border-emerald-200' },
  blue:    { bar: 'bg-blue-500',    chip: 'bg-blue-100 text-blue-700',     ring: 'border-blue-200' },
  slate:   { bar: 'bg-slate-700',   chip: 'bg-slate-100 text-slate-700',    ring: 'border-slate-200' },
  violet:  { bar: 'bg-violet-500',  chip: 'bg-violet-100 text-violet-700',  ring: 'border-violet-200' },
};

export default function BundleCard({ bundle, data, subtitle }) {
  const [busy, setBusy] = useState(null); // 'pdf' | 'excel' | null
  const [preview, setPreview] = useState(false);
  const accent = ACCENT[bundle.accent] || ACCENT.slate;

  const fileBase = `${(bundle.id || 'report').replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}`;

  async function handlePDF() {
    setBusy('pdf');
    try {
      const sections = bundle.buildSections(data);
      exportSectionsPDF(`${fileBase}.pdf`, bundle.title, sections, { subtitle });
    } finally { setBusy(null); }
  }

  async function handleExcel() {
    setBusy('excel');
    try {
      const sections = bundle.buildSections(data);
      exportSectionsExcel(`${fileBase}.xlsx`, sections);
    } finally { setBusy(null); }
  }

  return (
    <>
      <div className={`bg-white rounded-xl shadow-sm border ${accent.ring} overflow-hidden flex flex-col`}>
        <div className={`h-1.5 ${accent.bar}`} />
        <div className="p-5 flex flex-col flex-1">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div>
              <span className={`text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded ${accent.chip}`}>
                {bundle.audience}
              </span>
              <h3 className="font-bold text-slate-800 text-base mt-2">{bundle.title}</h3>
            </div>
          </div>
          <p className="text-xs text-slate-500 mb-3 leading-relaxed">{bundle.description}</p>

          <div className="mb-4">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Contains</div>
            <ul className="space-y-1">
              {bundle.contents.map((c, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs text-slate-600">
                  <ChevronRight className="w-3 h-3 text-slate-300 mt-0.5 shrink-0" />
                  {c}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-wrap gap-2 mt-auto pt-2">
            <button
              onClick={() => setPreview(true)}
              className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
            >
              <Eye className="w-3.5 h-3.5" /> Preview
            </button>
            <button
              onClick={handlePDF}
              disabled={!!busy}
              className="flex items-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 rounded-lg text-xs font-semibold disabled:opacity-50 transition"
            >
              {busy === 'pdf' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
              Export PDF
            </button>
            <button
              onClick={handleExcel}
              disabled={!!busy}
              className="flex items-center gap-1.5 px-3 py-2 border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-semibold disabled:opacity-50 transition"
            >
              {busy === 'excel' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sheet className="w-3.5 h-3.5" />}
              Export Excel
            </button>
          </div>
        </div>
      </div>

      {preview && (
        <PreviewModal bundle={bundle} data={data} subtitle={subtitle} onClose={() => setPreview(false)} />
      )}
    </>
  );
}