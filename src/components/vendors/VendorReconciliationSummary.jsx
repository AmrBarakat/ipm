import { useMemo, useState } from 'react';
import { useEntityList } from '@/hooks/useEntity';
import { formatCurrency, formatDate, BOM_CATEGORY_LABELS } from '@/lib/constants';
import { MATERIAL_STATUS, MATERIAL_STATUS_ORDER, resolveMaterialStatus, materialStatusMeta } from '@/lib/materialStatus';
import { Package, FileText, TrendingUp, ShoppingCart, Search, X } from 'lucide-react';

const PO_STATUS_STYLES = {
  draft: 'bg-slate-100 text-slate-600',
  issued: 'bg-blue-100 text-blue-700',
  acknowledged: 'bg-purple-100 text-purple-700',
  in_transit: 'bg-amber-100 text-amber-800',
  partially_delivered: 'bg-orange-100 text-orange-700',
  delivered: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-slate-200 text-slate-500',
};
const PO_STATUS_LABELS = {
  draft: 'Draft', issued: 'Issued', acknowledged: 'Acknowledged',
  in_transit: 'In Transit', partially_delivered: 'Partially Delivered',
  delivered: 'Delivered', cancelled: 'Cancelled',
};

/**
 * VendorReconciliationSummary — pulls every PO and BOM item linked to a vendor
 * into two clean, scrollable lists with rolled-up totals, for quick reconciliation
 * without leaving the vendor drawer.
 *
 * Props: { vendorId, currency }
 */
export default function VendorReconciliationSummary({ vendorId, currency = 'SAR' }) {
  const { data: pos = [], isLoading: posLoading } = useEntityList(
    'PurchaseOrder', { vendor_id: vendorId }, '-issue_date', 500,
  );
  const { data: bom = [], isLoading: bomLoading } = useEntityList(
    'BOMItem', { vendor_id: vendorId }, '-created_date', 500,
  );

  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  // Quick-search filter across PO number / description and BOM description / part no.
  const filteredPos = useMemo(() => {
    if (!q) return pos;
    return pos.filter(p =>
      `${p.po_number || ''} ${p.description || ''} ${p.vendor_name || ''}`.toLowerCase().includes(q)
    );
  }, [pos, q]);

  const filteredBom = useMemo(() => {
    if (!q) return bom;
    return bom.filter(i =>
      `${i.description || ''} ${i.manufacturer_part_number || ''} ${i.erp_item_code || ''} ${i.supplier || ''}`.toLowerCase().includes(q)
    );
  }, [bom, q]);

  const poTotals = useMemo(() => {
    const active = pos.filter(p => p.status !== 'cancelled');
    const committed = active.reduce((s, p) => s + (Number(p.amount) || Number(p.subtotal_net) || 0), 0);
    const delivered = active.filter(p => p.status === 'delivered').length;
    return { count: pos.length, active: active.length, committed, delivered };
  }, [pos]);

  const bomTotals = useMemo(() => {
    const count = bom.length;
    const plannedCost = bom.reduce((s, i) => s + (Number(i.planned_cost_price) || Number(i.cost_price) || 0) * (Number(i.quantity) || 1), 0);
    const sellValue = bom.reduce((s, i) => s + (Number(i.selling_price) || 0) * (Number(i.quantity) || 1), 0);
    // Always show all six tracking states (zeros included) for at-a-glance status.
    const byStatus = {};
    for (const key of MATERIAL_STATUS_ORDER) byStatus[key] = 0;
    for (const i of bom) {
      const st = resolveMaterialStatus(i);
      byStatus[st] = (byStatus[st] || 0) + 1;
    }
    return { count, plannedCost, sellValue, byStatus };
  }, [bom]);

  const filteredBomTotals = useMemo(() => ({
    count: filteredBom.length,
    plannedCost: filteredBom.reduce((s, i) => s + (Number(i.planned_cost_price) || Number(i.cost_price) || 0) * (Number(i.quantity) || 1), 0),
    sellValue: filteredBom.reduce((s, i) => s + (Number(i.selling_price) || 0) * (Number(i.quantity) || 1), 0),
  }), [filteredBom]);

  const filteredPoTotals = useMemo(() => {
    const active = filteredPos.filter(p => p.status !== 'cancelled');
    const committed = active.reduce((s, p) => s + (Number(p.amount) || Number(p.subtotal_net) || 0), 0);
    return { active: active.length, committed };
  }, [filteredPos]);

  const loading = posLoading || bomLoading;

  if (loading) {
    return (
      <div className="space-y-2">
        <div className="h-20 bg-slate-100 rounded-lg animate-pulse" />
        <div className="h-32 bg-slate-100 rounded-lg animate-pulse" />
      </div>
    );
  }

  if (pos.length === 0 && bom.length === 0) {
    return (
      <div className="text-center py-8 bg-slate-50 rounded-lg border border-dashed border-slate-200">
        <Package className="w-8 h-8 text-slate-300 mx-auto mb-2" />
        <p className="text-sm text-slate-500">No POs or BOM items linked to this vendor yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <MiniKpi icon={<FileText className="w-3.5 h-3.5" />} label="POs" value={poTotals.count} sub={`${poTotals.delivered} delivered`} />
        <MiniKpi icon={<ShoppingCart className="w-3.5 h-3.5" />} label="PO Value" value={formatCurrency(poTotals.committed, currency)} />
        <MiniKpi icon={<Package className="w-3.5 h-3.5" />} label="BOM Items" value={bomTotals.count} />
        <MiniKpi icon={<TrendingUp className="w-3.5 h-3.5" />} label="BOM Sell Value" value={formatCurrency(bomTotals.sellValue, currency)} />
      </div>

      {/* Quick search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search POs & BOM items by number, description, part no…"
          className="w-full border border-slate-200 rounded-md pl-8 pr-8 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
        {query && (
          <button onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Six-state material tracking breakdown */}
      {bom.length > 0 && (
        <div className="grid grid-cols-3 md:grid-cols-6 gap-1.5">
          {MATERIAL_STATUS_ORDER.map(key => {
            const meta = MATERIAL_STATUS[key];
            const n = bomTotals.byStatus[key] || 0;
            return (
              <button
                key={key}
                onClick={() => setQuery('')}
                className={`text-center px-1.5 py-2 rounded-lg border ${meta.cls} ${n === 0 ? 'opacity-50' : ''}`}
                title={meta.label}
              >
                <div className="text-base font-bold leading-none">{n}</div>
                <div className="text-[9px] uppercase tracking-wide mt-1 leading-tight">{meta.label}</div>
              </button>
            );
          })}
        </div>
      )}

      {(q && filteredPos.length === 0 && filteredBom.length === 0) && (
        <div className="text-center py-6 text-xs text-slate-400">
          No POs or BOM items match "{query}".
        </div>
      )}

      {/* Purchase Orders */}
      {filteredPos.length > 0 && (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
            <FileText className="w-3.5 h-3.5 text-amber-500" />
            <h5 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Purchase Orders</h5>
            <span className="text-xs text-slate-400">· {filteredPos.length}{q && filteredPos.length !== pos.length ? ` of ${pos.length}` : ''}</span>
          </div>
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-400 uppercase sticky top-0">
                <tr>
                  <th className="px-3 py-1.5 text-left">PO Number</th>
                  <th className="px-3 py-1.5 text-left">Status</th>
                  <th className="px-3 py-1.5 text-left">Issued</th>
                  <th className="px-3 py-1.5 text-left">Exp. Delivery</th>
                  <th className="px-3 py-1.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {filteredPos.map(po => (
                  <tr key={po.id} className="border-t border-slate-100 hover:bg-amber-50/40">
                    <td className="px-3 py-1.5 font-mono text-slate-700">{po.po_number || '—'}</td>
                    <td className="px-3 py-1.5">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${PO_STATUS_STYLES[po.status] || 'bg-slate-100 text-slate-500'}`}>
                        {PO_STATUS_LABELS[po.status] || po.status}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-slate-500">{formatDate(po.issue_date)}</td>
                    <td className="px-3 py-1.5 text-slate-500">{formatDate(po.expected_delivery_date)}</td>
                    <td className="px-3 py-1.5 text-right font-medium text-slate-700">
                      {formatCurrency(Number(po.amount) || Number(po.subtotal_net) || 0, po.currency || currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-slate-200 bg-slate-50">
                <tr>
                  <td colSpan={4} className="px-3 py-1.5 text-slate-500 font-semibold">Total Committed ({filteredPoTotals.active} active)</td>
                  <td className="px-3 py-1.5 text-right font-bold text-slate-700">{formatCurrency(filteredPoTotals.committed, currency)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* BOM Items */}
      {filteredBom.length > 0 && (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
            <Package className="w-3.5 h-3.5 text-amber-500" />
            <h5 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">BOM Items</h5>
            <span className="text-xs text-slate-400">· {filteredBom.length}{q && filteredBom.length !== bom.length ? ` of ${bom.length}` : ''}</span>
          </div>
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-400 uppercase sticky top-0">
                <tr>
                  <th className="px-3 py-1.5 text-left">Description</th>
                  <th className="px-3 py-1.5 text-left">Part No.</th>
                  <th className="px-3 py-1.5 text-left">Category</th>
                  <th className="px-3 py-1.5 text-right">Qty</th>
                  <th className="px-3 py-1.5 text-right">Unit Cost</th>
                  <th className="px-3 py-1.5 text-right">Total Sell</th>
                  <th className="px-3 py-1.5 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredBom.map(item => {
                  const meta = materialStatusMeta(item);
                  const qty = Number(item.quantity) || 0;
                  const unitCost = Number(item.planned_cost_price) || Number(item.cost_price) || 0;
                  const totalSell = (Number(item.selling_price) || 0) * qty;
                  return (
                    <tr key={item.id} className="border-t border-slate-100 hover:bg-amber-50/40">
                      <td className="px-3 py-1.5 text-slate-700 max-w-[180px] truncate">{item.description || '—'}</td>
                      <td className="px-3 py-1.5 font-mono text-slate-500">{item.manufacturer_part_number || '—'}</td>
                      <td className="px-3 py-1.5 text-slate-500">{BOM_CATEGORY_LABELS[item.category] || item.category || '—'}</td>
                      <td className="px-3 py-1.5 text-right text-slate-700">{qty}</td>
                      <td className="px-3 py-1.5 text-right text-slate-600">{formatCurrency(unitCost, item.currency || currency)}</td>
                      <td className="px-3 py-1.5 text-right text-emerald-700 font-medium">{formatCurrency(totalSell, item.currency || currency)}</td>
                      <td className="px-3 py-1.5">
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${meta.cls}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                          {meta.label}
                          {meta.detail && <span className="opacity-70 font-normal">· {meta.detail}</span>}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t-2 border-slate-200 bg-slate-50">
                <tr>
                  <td colSpan={4} className="px-3 py-1.5 text-slate-500 font-semibold">Totals ({filteredBomTotals.count} items)</td>
                  <td className="px-3 py-1.5 text-right text-slate-600 font-semibold">{formatCurrency(filteredBomTotals.plannedCost, currency)}</td>
                  <td className="px-3 py-1.5 text-right text-emerald-700 font-bold">{formatCurrency(filteredBomTotals.sellValue, currency)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function MiniKpi({ icon, label, value, sub }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg px-3 py-2">
      <div className="flex items-center gap-1.5 text-slate-400 mb-0.5">
        {icon}
        <span className="text-[10px] uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-sm font-bold text-slate-800">{value}</div>
      {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
    </div>
  );
}