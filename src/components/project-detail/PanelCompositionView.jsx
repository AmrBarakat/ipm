import { useMemo } from 'react';
import * as XLSX from 'xlsx';
import { Download, Layers } from 'lucide-react';
import { formatCurrency } from '@/lib/constants';

const DELIVERY_COLORS = {
  not_delivered: 'bg-slate-100 text-slate-600',
  partially_delivered: 'bg-amber-100 text-amber-800',
  delivered: 'bg-emerald-100 text-emerald-700',
};

function deriveDeliveryStatus(item) {
  const dq = Number(item.delivered_qty) || 0;
  const tq = Number(item.quantity) || 0;
  if (dq <= 0) return 'not_delivered';
  if (tq > 0 && dq < tq) return 'partially_delivered';
  return 'delivered';
}
function deliveryLabel(ds) {
  return ds === 'delivered' ? 'Delivered' : ds === 'partially_delivered' ? 'Partial' : 'Not Del.';
}

/**
 * Panel Composition view — derives entirely from the already-loaded BOM items
 * list (no fetching). One card per panel (category 'panel', no parent_id).
 * Each card lists allocated components (from panel_allocations) followed by the
 * panel's own enclosure/wiring child rows.
 */
export default function PanelCompositionView({ items }) {
  const panels = useMemo(
    () => items
      .filter(i => !i.parent_id && i.category === 'panel')
      .sort((a, b) => (a.description || '').localeCompare(b.description || '')),
    [items]
  );
  const topLevelNonPanel = useMemo(() => items.filter(i => !i.parent_id && i.category !== 'panel'), [items]);
  const childrenByParent = useMemo(() => {
    const map = {};
    for (const c of items) if (c.parent_id) (map[c.parent_id] ||= []).push(c);
    return map;
  }, [items]);

  const panelData = useMemo(() => panels.map(panel => {
    const compRows = [];
    for (const item of topLevelNonPanel) {
      const allocs = Array.isArray(item.panel_allocations) ? item.panel_allocations : [];
      const entry = allocs.find(a => a.panel_name === panel.description);
      if (entry) {
        compRows.push({
          partNo: item.manufacturer_part_number || '',
          description: item.description || '',
          qty: entry.qty,
          delivery: deriveDeliveryStatus(item),
        });
      }
    }
    const enclosureRows = (childrenByParent[panel.id] || []).map(c => ({
      partNo: c.manufacturer_part_number || '',
      description: c.description || '',
      qty: c.quantity,
      delivery: deriveDeliveryStatus(c),
    }));
    const totalPlanned = (Number(panel.planned_cost_price) || 0) * (Number(panel.quantity) || 1);
    return { panel, compRows, enclosureRows, totalPlanned };
  }), [panels, topLevelNonPanel, childrenByParent]);

  function exportComposition() {
    const rows = [];
    panelData.forEach(({ panel, compRows, enclosureRows }) => {
      rows.push([`Panel: ${panel.description || ''}`]);
      rows.push(['#', 'Part No', 'Description', 'Qty']);
      let n = 1;
      compRows.forEach(r => rows.push([n++, r.partNo, r.description, r.qty]));
      if (enclosureRows.length) {
        rows.push(['', '', 'Enclosure & wiring', '']);
        enclosureRows.forEach(r => rows.push([n++, r.partNo, r.description, r.qty]));
      }
      rows.push([]); // blank separator between panels
    });
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Panel Composition');
    XLSX.writeFile(wb, 'panel_composition.xlsx');
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
      <div className="flex justify-end">
        <button onClick={exportComposition}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded">
          <Download className="w-4 h-4" /> Export Composition
        </button>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {panelData.map(({ panel, compRows, enclosureRows, totalPlanned }) => {
          const hasData = compRows.length > 0 || enclosureRows.length > 0;
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
                      <th className="px-3 py-2 text-left w-28">Delivery</th>
                    </tr>
                  </thead>
                  <tbody>
                    {compRows.map((r, i) => (
                      <tr key={`c${i}`} className="border-t border-slate-100">
                        <td className="px-3 py-1.5 text-slate-400">{n++}</td>
                        <td className="px-3 py-1.5 font-mono text-slate-600">{r.partNo || '—'}</td>
                        <td className="px-3 py-1.5 text-slate-700">{r.description}</td>
                        <td className="px-3 py-1.5 text-right font-semibold">{r.qty}</td>
                        <td className="px-3 py-1.5"><span className={`px-2 py-0.5 rounded font-semibold ${DELIVERY_COLORS[r.delivery]}`}>{deliveryLabel(r.delivery)}</span></td>
                      </tr>
                    ))}
                    {enclosureRows.length > 0 && (
                      <>
                        <tr className="border-t border-slate-200 bg-slate-50">
                          <td colSpan={5} className="px-3 py-1.5 text-[10px] uppercase tracking-wide font-semibold text-slate-500">Enclosure &amp; wiring</td>
                        </tr>
                        {enclosureRows.map((r, i) => (
                          <tr key={`e${i}`} className="border-t border-slate-100">
                            <td className="px-3 py-1.5 text-slate-400">{n++}</td>
                            <td className="px-3 py-1.5 font-mono text-slate-600">{r.partNo || '—'}</td>
                            <td className="px-3 py-1.5 text-slate-700">{r.description}</td>
                            <td className="px-3 py-1.5 text-right font-semibold">{r.qty}</td>
                            <td className="px-3 py-1.5"><span className={`px-2 py-0.5 rounded font-semibold ${DELIVERY_COLORS[r.delivery]}`}>{deliveryLabel(r.delivery)}</span></td>
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