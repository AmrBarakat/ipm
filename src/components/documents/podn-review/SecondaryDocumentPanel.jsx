import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { fmt, fmtPct, normalizeCode } from './helpers';

/** R4 — Supplier quotation panel. Read-only. Lists quotation lines beside matched
 *  PO lines with the variance column and a footer total. Suppresses the totals
 *  comparison when the quotation's figures include tax. */
export default function SecondaryDocumentPanel({ secondary, lines, currency }) {
  const [open, setOpen] = useState(false);
  if (!secondary?.present) return null;
  const taxInclusive = !!secondary.prices_include_tax;
  const quoteTotal = (secondary.lines || []).reduce((s, l) => s + (Number(l.unit_price) * Number(l.qty || 0) || 0), 0);
  const poTotal = lines.reduce((s, l) => s + (Number(l.net_amount) || 0), 0);
  const delta = poTotal - quoteTotal;
  const pct = quoteTotal ? delta / quoteTotal : 0;

  return (
    <div className="border border-slate-200 rounded-lg">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 text-sm font-medium text-slate-700 hover:bg-slate-100">
        <span>Supplier quotation ({secondary.reference || '—'}) — {secondary.kind || 'document'}</span>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      {open && (
        <div className="p-3 space-y-2">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="px-2 py-1 text-left">Quotation line</th>
                  <th className="px-2 py-1 text-left">Part #</th>
                  <th className="px-2 py-1 text-right">Qty</th>
                  <th className="px-2 py-1 text-right">Quote unit</th>
                  <th className="px-2 py-1 text-left">Matched PO line</th>
                  <th className="px-2 py-1 text-right">PO unit</th>
                  <th className="px-2 py-1 text-right">Var %</th>
                </tr>
              </thead>
              <tbody>
                {(secondary.lines || []).map((ql, i) => {
                  const match = (lines || []).find((pl) => pl.quoted_unit_price != null && Number(pl.quoted_unit_price) === Number(ql.unit_price)) ||
                    (lines || []).find((pl) => normalizeCode(pl.part_number) && normalizeCode(pl.part_number) === normalizeCode(ql.part_number));
                  const variance = match && match.quoted_unit_price ? (match.unit_price - match.quoted_unit_price) / match.quoted_unit_price : null;
                  return (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-2 py-1 text-slate-600 max-w-[220px] truncate" title={ql.description}>{ql.description || '—'}</td>
                      <td className="px-2 py-1 font-mono text-slate-500">{ql.part_number || '—'}</td>
                      <td className="px-2 py-1 text-right">{ql.qty ?? '—'}</td>
                      <td className="px-2 py-1 text-right">{fmt(ql.unit_price, currency)}</td>
                      <td className="px-2 py-1 text-slate-600 max-w-[220px] truncate" title={match?.description}>{match ? (match.description || '').slice(0, 40) : '—'}</td>
                      <td className="px-2 py-1 text-right">{match ? fmt(match.unit_price, currency) : '—'}</td>
                      <td className="px-2 py-1 text-right">
                        {variance != null && !taxInclusive ? (
                          <span className={variance < 0 ? 'text-emerald-600 font-semibold' : variance > 0 ? 'text-red-600 font-semibold' : 'text-slate-500'}>{fmtPct(variance)}</span>
                        ) : taxInclusive ? <span className="text-slate-300" title="quotation includes tax">n/a</span> : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!taxInclusive && quoteTotal > 0 && (
            <div className="text-xs text-slate-600 text-right">
              PO total is <span className={delta < 0 ? 'text-emerald-600 font-semibold' : 'text-red-600 font-semibold'}>{fmt(Math.abs(delta), currency)}</span> {delta < 0 ? 'below' : 'above'} quotation total ({fmtPct(Math.abs(pct))})
            </div>
          )}
        </div>
      )}
    </div>
  );
}