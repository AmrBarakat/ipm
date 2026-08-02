import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { ClipboardPaste, X, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { EXPENSE_CATEGORY_LABELS, EXPENSE_STATUS_LABELS } from '@/lib/constants';

// Default column order when the pasted block has no recognizable header row.
const DEFAULT_COLS = ['description', 'category', 'vendor', 'planned_amount', 'actual_amount', 'planned_date', 'actual_date', 'status'];
const CAT_KEYS = Object.keys(EXPENSE_CATEGORY_LABELS);
const STATUS_KEYS = Object.keys(EXPENSE_STATUS_LABELS);

function detectDelimiter(line) {
  if (line.includes('\t')) return '\t';
  if (line.includes(';')) return ';';
  return ',';
}

function toNum(v) {
  if (v == null || v === '') return null;
  const cleaned = String(v).replace(/[,$€£\s]/g, '').replace(/[^0-9.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  return isNaN(n) ? null : n;
}

function normalizeDate(v) {
  if (!v) return '';
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return isNaN(d) ? '' : d.toISOString().slice(0, 10);
}

function normalizeHeader(h) {
  const s = String(h).toLowerCase();
  if (/desc|item|name|details/.test(s)) return 'description';
  if (/categ|type/.test(s)) return 'category';
  if (/vendor|supplier|payee/.test(s)) return 'vendor';
  if (/planned.*amt|planned.*amount|budget/.test(s)) return 'planned_amount';
  if (/actual.*amt|actual.*amount|cost/.test(s)) return 'actual_amount';
  if (/planned.*date/.test(s)) return 'planned_date';
  if (/actual.*date/.test(s)) return 'actual_date';
  if (/status|state/.test(s)) return 'status';
  return s;
}

function matchKey(v, keys, labels, fallback) {
  if (!v) return fallback;
  const s = String(v).trim().toLowerCase();
  return keys.find((k) => k === s || String(labels[k]).toLowerCase() === s || s.includes(k) || String(labels[k]).toLowerCase().includes(s)) || fallback;
}

const inp = 'border border-slate-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white w-full';

export default function BulkExpensePaste({ projectId, onClose }) {
  const [raw, setRaw] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null); // { ok } | { err }
  const qc = useQueryClient();

  const { headers, rows, skipped } = useMemo(() => {
    const text = raw.trim();
    if (!text) return { headers: DEFAULT_COLS, rows: [], skipped: 0 };
    const lines = text.split(/\r?\n/);
    const nonEmpty = lines.filter((l) => l.trim() !== '');
    if (!nonEmpty.length) return { headers: DEFAULT_COLS, rows: [], skipped: 0 };
    const delim = detectDelimiter(nonEmpty[0]);
    const firstCells = nonEmpty[0].split(delim).map((c) => c.trim().toLowerCase());
    let hdrs;
    let dataStart = 0;
    if (firstCells.some((c) => /desc|categ|vendor|amount|date|status|item|name/.test(c))) {
      hdrs = firstCells.map(normalizeHeader);
      dataStart = 1;
    } else {
      hdrs = DEFAULT_COLS.slice(0, firstCells.length);
    }
    const parsed = nonEmpty.slice(dataStart).map((line) => {
      const cells = line.split(delim);
      const obj = {};
      hdrs.forEach((h, i) => { obj[h] = (cells[i] || '').trim(); });
      return obj;
    });
    const valid = parsed.filter((r) => r.description);
    return { headers: hdrs, rows: valid, skipped: parsed.length - valid.length };
  }, [raw]);

  const records = useMemo(
    () =>
      rows.map((r) => {
        const rec = {
          project_id: projectId,
          description: r.description || '',
          category: matchKey(r.category, CAT_KEYS, EXPENSE_CATEGORY_LABELS, 'other'),
          vendor: r.vendor || '',
          planned_amount: toNum(r.planned_amount) ?? 0,
          status: matchKey(r.status, STATUS_KEYS, EXPENSE_STATUS_LABELS, 'planned'),
        };
        const a = toNum(r.actual_amount);
        if (a != null) rec.actual_amount = a;
        const pd = normalizeDate(r.planned_date); if (pd) rec.planned_date = pd;
        const ad = normalizeDate(r.actual_date); if (ad) rec.actual_date = ad;
        return rec;
      }),
    [rows, projectId],
  );

  async function doImport() {
    if (!records.length) return;
    setImporting(true);
    try {
      await base44.entities.Expense.bulkCreate(records);
      await qc.invalidateQueries({ queryKey: ['Expense'] });
      setResult({ ok: records.length });
    } catch (e) {
      setResult({ err: e?.response?.data?.error || e?.message || 'Import failed.' });
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <ClipboardPaste className="w-5 h-5 text-red-500" />
            <h3 className="font-semibold text-slate-800">Bulk expense entry</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-slate-100 text-slate-500"><X className="w-5 h-5" /></button>
        </div>

        {result ? (
          <div className="p-8 text-center">
            {result.ok ? (
              <>
                <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-emerald-500" />
                <p className="text-lg font-semibold text-slate-800">{result.ok} expense{result.ok === 1 ? '' : 's'} imported</p>
                <p className="text-sm text-slate-500 mt-1">The expenses table has been refreshed.</p>
                <button onClick={onClose} className="mt-5 px-5 py-2 bg-red-500 hover:bg-red-400 text-white font-semibold text-sm rounded">Done</button>
              </>
            ) : (
              <>
                <AlertCircle className="w-12 h-12 mx-auto mb-3 text-red-500" />
                <p className="text-lg font-semibold text-slate-800">Import failed</p>
                <p className="text-sm text-red-600 mt-1 max-w-md mx-auto">{result.err}</p>
                <button onClick={() => setResult(null)} className="mt-5 px-5 py-2 border border-slate-300 text-slate-600 text-sm rounded hover:bg-slate-100">Back</button>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="p-5 overflow-y-auto">
              <p className="text-sm text-slate-600 mb-3">
                Paste rows directly from a spreadsheet (Excel / Google Sheets). A header row is auto-detected; otherwise columns are read in this order:{' '}
                <span className="text-slate-400">Description, Category, Vendor, Planned Amount, Actual Amount, Planned Date, Actual Date, Status</span>.
              </p>

              <textarea
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                placeholder={'Description\tCategory\tVendor\tPlanned\tActual\tPlanned Date\tActual Date\tStatus\nSteel cable\tmaterial\tVendor A\t12000\t\t2026-08-01\t\tplanned\n...'}
                rows={8}
                className={`${inp} font-mono text-xs leading-relaxed`}
                autoFocus
              />

              {raw.trim() && (
                <div className="mt-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Preview</span>
                    <span className="text-xs text-slate-500">
                      {records.length} ready{skipped > 0 ? <span className="text-amber-600"> · {skipped} skipped (no description)</span> : null}
                    </span>
                  </div>
                  {records.length === 0 ? (
                    <div className="text-center py-6 text-sm text-slate-400 border border-dashed border-slate-200 rounded-lg">
                      No valid rows yet — make sure each line has a description.
                    </div>
                  ) : (
                    <div className="border border-slate-200 rounded-lg overflow-x-auto max-h-64">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50 text-slate-500 uppercase sticky top-0">
                          <tr>
                            <th className="px-2 py-2 text-left">Description</th>
                            <th className="px-2 py-2 text-left">Category</th>
                            <th className="px-2 py-2 text-left">Vendor</th>
                            <th className="px-2 py-2 text-right">Planned</th>
                            <th className="px-2 py-2 text-right">Actual</th>
                            <th className="px-2 py-2 text-left">Planned Date</th>
                            <th className="px-2 py-2 text-left">Actual Date</th>
                            <th className="px-2 py-2 text-left">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {records.slice(0, 50).map((r, i) => (
                            <tr key={i} className="border-t border-slate-100">
                              <td className="px-2 py-1.5 text-slate-800">{r.description}</td>
                              <td className="px-2 py-1.5 text-slate-600">{EXPENSE_CATEGORY_LABELS[r.category] || r.category}</td>
                              <td className="px-2 py-1.5 text-slate-600">{r.vendor || '—'}</td>
                              <td className="px-2 py-1.5 text-right text-slate-700">{r.planned_amount}</td>
                              <td className="px-2 py-1.5 text-right text-slate-600">{r.actual_amount ?? '—'}</td>
                              <td className="px-2 py-1.5 text-slate-500">{r.planned_date || '—'}</td>
                              <td className="px-2 py-1.5 text-slate-500">{r.actual_date || '—'}</td>
                              <td className="px-2 py-1.5 text-slate-600">{EXPENSE_STATUS_LABELS[r.status] || r.status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {records.length > 50 && (
                        <div className="px-3 py-2 text-xs text-slate-400 bg-slate-50">Showing first 50 of {records.length} rows.</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50 rounded-b-xl">
              <button onClick={onClose} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded hover:bg-slate-100">Cancel</button>
              <button
                onClick={doImport}
                disabled={!records.length || importing}
                className="flex items-center gap-1.5 px-4 py-2 bg-red-500 hover:bg-red-400 text-white font-semibold text-sm rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardPaste className="w-4 h-4" />}
                Import {records.length || ''} expense{records.length === 1 ? '' : 's'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}