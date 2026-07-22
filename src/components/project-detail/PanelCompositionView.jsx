import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx-js-style';
import { Download, Layers, Info, X } from 'lucide-react';
import { formatCurrency } from '@/lib/constants';
import { styleSheet } from '@/lib/reportExport';

// Top-level component categories eligible for single-panel allocation inference.
// Everything except panel, service, software_license, it_hardware.
const INFERABLE_CATEGORIES = new Set(['plc', 'network', 'hmi', 'drive', 'meter', 'other']);

/** Trim + collapse whitespace + lowercase. */
function normName(s) {
  return (s || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Robust allocation match: equal normalized names, OR "X" ↔ "X Panel" so naming
 * drift between the component section and the panel section doesn't drop rows.
 */
function namesMatch(allocName, panelDesc) {
  const a = normName(allocName);
  const p = normName(panelDesc);
  if (!a || !p) return false;
  if (a === p) return true;
  const SUFFIX = ' panel';
  const aBase = a.endsWith(SUFFIX) ? a.slice(0, -SUFFIX.length).trim() : a;
  const pBase = p.endsWith(SUFFIX) ? p.slice(0, -SUFFIX.length).trim() : p;
  return aBase === pBase;
}

function hasAllocations(item) {
  return Array.isArray(item.panel_allocations) && item.panel_allocations.length > 0;
}

/**
 * Panel Composition view — derives entirely from the already-loaded BOM items
 * list (no fetching). One card per panel (category 'panel', no parent_id).
 * Each card lists allocated components (from panel_allocations), then inferred
 * components for legacy data when the project has a single panel, followed by
 * the panel's own enclosure/wiring child rows.
 */
export default function PanelCompositionView({ items }) {
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const panels = useMemo(
    () => items
      .filter(i => !i.parent_id && i.category === 'panel')
      .sort((a, b) => (a.description || '').localeCompare(b.description || '')),
    [items]
  );
  const topLevelNonPanel = useMemo(
    () => items.filter(i => !i.parent_id && i.category !== 'panel'),
    [items]
  );
  const childrenByParent = useMemo(() => {
    const map = {};
    for (const c of items) if (c.parent_id) (map[c.parent_id] ||= []).push(c);
    return map;
  }, [items]);

  const singlePanel = panels.length === 1;
  const hasUnallocated = topLevelNonPanel.some(i => !hasAllocations(i));
  const showBanner = hasUnallocated && panels.length > 1;

  const panelData = useMemo(() => panels.map(panel => {
    const compRows = [];
    const inferredRows = [];
    for (const item of topLevelNonPanel) {
      const allocs = Array.isArray(item.panel_allocations) ? item.panel_allocations : [];
      const entry = allocs.find(a => namesMatch(a.panel_name, panel.description));
      if (entry) {
        compRows.push({
          partNo: item.manufacturer_part_number || '',
          description: item.description || '',
          qty: entry.qty,
          inferred: false,
        });
      } else if (singlePanel && allocs.length === 0 && INFERABLE_CATEGORIES.has(item.category)) {
        inferredRows.push({
          partNo: item.manufacturer_part_number || '',
          description: item.description || '',
          qty: item.quantity,
          inferred: true,
        });
      }
    }
    const enclosureRows = (childrenByParent[panel.id] || []).map(c => ({
      partNo: c.manufacturer_part_number || '',
      description: c.description || '',
      qty: c.quantity,
      inferred: false,
    }));
    const totalPlanned = (Number(panel.planned_cost_price) || 0) * (Number(panel.quantity) || 1);
    return { panel, compRows, inferredRows, enclosureRows, totalPlanned };
  }), [panels, topLevelNonPanel, childrenByParent, singlePanel]);

  function exportComposition() {
    const rows = [];
    const headerRows = [];
    panelData.forEach(({ panel, compRows, inferredRows, enclosureRows }) => {
      rows.push([`Panel: ${panel.description || ''}`]);
      rows.push(['#', 'Part No', 'Description', 'Qty']);
      headerRows.push(rows.length - 1);
      let n = 1;
      compRows.forEach(r => rows.push([n++, r.partNo, r.description, r.qty]));
      inferredRows.forEach(r => rows.push([n++, r.partNo, `${r.description} *`, r.qty]));
      if (inferredRows.length) rows.push(['', '', '* allocation inferred', '']);
      if (enclosureRows.length) {
        rows.push(['', '', 'Enclosure & wiring', '']);
        enclosureRows.forEach(r => rows.push([n++, r.partNo, r.description, r.qty]));
      }
      rows.push([]); // blank separator between panels
    });
    const ws = XLSX.utils.aoa_to_sheet(rows);
    // Styled frozen header (bold white on dark) on each panel's column header row.
    styleSheet(ws, { headerRows, freezeRow: (headerRows[0] ?? 0) + 1, autoFilter: false });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Panel Composition');
    XLSX.writeFile(wb, `Panel_Composition_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  if (panels.length === 0) {
    return (
      <div className="text-center py-16 bg-white rounded-lg shadow-sm border border-slate-100">
        <Layers className="w-12 h-12 mx-auto mb-3 text-slate-300" />
        <p className="text-sm font-semibold text-slate-600">No panels to display</p>
        <p className="text-xs text-slate-400 mt-1">Panel composition is built from BOM items with category “Panel” and no parent.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {showBanner && !bannerDismissed && (
        <div className="flex items-start gap-2.5 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-800">
          <Info className="w-4 h-4 mt-0.5 shrink-0 text-blue-500" />
          <p className="flex-1">
            Some items were imported before panel composition tracking — re-import the BOM to populate the full per-panel breakdown.
          </p>
          <button onClick={() => setBannerDismissed(true)} className="text-blue-400 hover:text-blue-700 shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="flex justify-end">
        <button onClick={exportComposition}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded">
          <Download className="w-4 h-4" /> Export Composition
        </button>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {panelData.map(({ panel, compRows, inferredRows, enclosureRows, totalPlanned }) => {
          const hasData = compRows.length > 0 || inferredRows.length > 0 || enclosureRows.length > 0;
          let n = 1;
          return (
            <div key={panel.id} className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 bg-orange-50 border-b border-orange-100">
                <Layers className="w-4 h-4 text-orange-500 shrink-0" />
                <span className="font-semibold text-slate-800 text-sm truncate">{panel.description || '(Unnamed panel)'}</span>
                <span className="text-xs text-slate-500 shrink-0">· Qty {panel.quantity ?? 1}</span>
                <span className="ml-auto text-xs text-slate-600 shrink-0">Planned: <b className="text-slate-800">{formatCurrency(totalPlanned, panel.currency || 'SAR')}</b></span>
              </div>
              {!hasData ? (
                <div className="px-4 py-6 text-center text-xs text-slate-400">No composition data</div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-500 uppercase">
                    <tr>
                      <th className="px-3 py-2 text-left w-8">#</th>
                      <th className="px-3 py-2 text-left">Part No.</th>
                      <th className="px-3 py-2 text-left">Description</th>
                      <th className="px-3 py-2 text-right w-16">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {compRows.map((r, i) => (
                      <tr key={`c${i}`} className="border-t border-slate-100">
                        <td className="px-3 py-1.5 text-slate-400">{n++}</td>
                        <td className="px-3 py-1.5 font-mono text-slate-600">{r.partNo || '—'}</td>
                        <td className="px-3 py-1.5 text-slate-700">{r.description}</td>
                        <td className="px-3 py-1.5 text-right font-semibold">{r.qty}</td>
                      </tr>
                    ))}
                    {inferredRows.length > 0 && (
                      <>
                        {inferredRows.map((r, i) => (
                          <tr key={`inf${i}`} className="border-t border-slate-100 bg-amber-50/40">
                            <td className="px-3 py-1.5 text-slate-400">{n++}</td>
                            <td className="px-3 py-1.5 font-mono text-slate-600">{r.partNo || '—'}</td>
                            <td className="px-3 py-1.5 text-slate-700">
                              {r.description} <span className="text-amber-600" title="allocation inferred">*</span>
                            </td>
                            <td className="px-3 py-1.5 text-right font-semibold">{r.qty}</td>
                          </tr>
                        ))}
                        <tr className="border-t border-slate-100">
                          <td colSpan={4} className="px-3 py-1.5 text-[10px] italic text-amber-600">* allocation inferred</td>
                        </tr>
                      </>
                    )}
                    {enclosureRows.length > 0 && (
                      <>
                        <tr className="border-t border-slate-200 bg-slate-50">
                          <td colSpan={4} className="px-3 py-1.5 text-[10px] uppercase tracking-wide font-semibold text-slate-500">Enclosure &amp; wiring</td>
                        </tr>
                        {enclosureRows.map((r, i) => (
                          <tr key={`e${i}`} className="border-t border-slate-100">
                            <td className="px-3 py-1.5 text-slate-400">{n++}</td>
                            <td className="px-3 py-1.5 font-mono text-slate-600">{r.partNo || '—'}</td>
                            <td className="px-3 py-1.5 text-slate-700">{r.description}</td>
                            <td className="px-3 py-1.5 text-right font-semibold">{r.qty}</td>
                          </tr>
                        ))}
                      </>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}