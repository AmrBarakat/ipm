import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight, AlertCircle } from 'lucide-react';
import { confidenceBadge, tierLabel, fmt, fmtPct, buildNewBomDefaults } from './helpers';

const inpBase = 'border border-slate-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white';
const inpErp = inpBase + ' w-24';
const inpPart = inpBase + ' w-40';
const inpDesc = inpBase + ' w-[380px]';
const inpUom = inpBase + ' w-16';
const inpQty = inpBase + ' w-24 text-right';
const inpPrice = inpBase + ' w-28 text-right';
const inpSelect = inpBase + ' w-[260px]';

const CATEGORY_OPTIONS = [
  ['plc', 'PLC'], ['hmi', 'HMI'], ['drive', 'Drive'], ['sensor', 'Sensor'],
  ['meter', 'Meter'], ['panel', 'Panel'], ['network', 'Network'],
  ['software_license', 'Software License'], ['service', 'Service'],
  ['it_hardware', 'IT Hardware'], ['other', 'Other'],
];

function VerifyBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-semibold uppercase tracking-wide" title="OCR uncertainty — please verify">
      <AlertCircle className="w-2.5 h-2.5" /> verify
    </span>
  );
}

/** Step 3 — Line items → BOM. Editable, tiered match, R6 auto-select, R4 variance. */
export default function StepLines({ draft, setDraft, bomItems }) {
  const [expanded, setExpanded] = useState({});
  const lines = draft.lines;

  const autoSelected = lines.filter((l) => l.selected).length;
  const total = lines.length;
  const needsReview = total - autoSelected;

  function updateLine(idx, patch) {
    setDraft((prev) => {
      const next = prev.lines.slice();
      next[idx] = { ...next[idx], ...patch };
      // recompute net_amount when qty or unit_price changes
      if (patch.qty != null || patch.unit_price != null) {
        const q = Number(next[idx].qty) || 0;
        const up = Number(next[idx].unit_price) || 0;
        next[idx].net_amount = +(q * up).toFixed(2);
      }
      return { ...prev, lines: next };
    });
  }

  function setAllSelected(val) {
    setDraft((prev) => ({ ...prev, lines: prev.lines.map((l) => ({ ...l, selected: val })) }));
  }
  function selectHighConfidence() {
    setDraft((prev) => ({ ...prev, lines: prev.lines.map((l) => ({ ...l, selected: (l.match_confidence || 0) >= 0.85 && !l.ocr_uncertain })) }));
  }

  function setTarget(idx, value) {
    if (value === '__create__') {
      const li = draft.lines[idx];
      updateLine(idx, { bom_item_id: null, _create: true, selected: true, new_bom: buildNewBomDefaults(li, draft) });
    } else if (value === '') {
      updateLine(idx, { bom_item_id: null, _create: false, selected: false, new_bom: null });
    } else {
      updateLine(idx, { bom_item_id: value, _create: false, selected: true, new_bom: null });
    }
  }

  function createAllUnmatched() {
    setDraft((prev) => ({
      ...prev,
      lines: prev.lines.map((li) => {
        if (li.bom_item_id || li._create) return li;
        return { ...li, _create: true, selected: true, new_bom: buildNewBomDefaults(li, prev) };
      }),
    }));
  }

  return (
    <div className="space-y-3">
      {/* R6 banner */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
        <span className="font-semibold">{autoSelected} of {total}</span> lines matched confidently and are ready to apply; <span className="font-semibold">{needsReview}</span> need your review.
      </div>

      {/* Bulk controls */}
      <div className="flex items-center gap-3 text-xs">
        <button onClick={() => setAllSelected(true)} className="px-2.5 py-1 border border-slate-200 rounded hover:bg-slate-100 text-slate-600">Select all</button>
        <button onClick={() => setAllSelected(false)} className="px-2.5 py-1 border border-slate-200 rounded hover:bg-slate-100 text-slate-600">Select none</button>
        <button onClick={selectHighConfidence} className="px-2.5 py-1 border border-slate-200 rounded hover:bg-slate-100 text-slate-600">Only high-confidence</button>
        <button onClick={createAllUnmatched} className="px-2.5 py-1 border border-emerald-300 rounded hover:bg-emerald-50 text-emerald-700 font-medium">Create all unmatched as new</button>
      </div>

      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <style>{`
          .podn-lines input[type=number] { -moz-appearance: textfield; }
          .podn-lines input[type=number]::-webkit-outer-spin-button,
          .podn-lines input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        `}</style>
        <div className="overflow-x-auto podn-lines">
          <table className="min-w-max text-xs border-collapse">
            <thead className="sticky top-0 z-10 text-slate-500">
              <tr>
                <th className="px-2 py-2 w-8 sticky left-0 bg-slate-100 z-20"></th>
                <th className="px-2 py-2 text-left whitespace-nowrap sticky left-8 bg-slate-100 z-20">Line</th>
                <th className="px-2 py-2 text-left whitespace-nowrap bg-slate-100">ERP code</th>
                <th className="px-2 py-2 text-left whitespace-nowrap bg-slate-100">Part #</th>
                <th className="px-2 py-2 text-left whitespace-nowrap bg-slate-100">Description</th>
                <th className="px-2 py-2 text-left whitespace-nowrap bg-slate-100">UOM</th>
                <th className="px-2 py-2 text-right whitespace-nowrap bg-slate-100">Qty</th>
                <th className="px-2 py-2 text-right whitespace-nowrap bg-slate-100">Unit price</th>
                <th className="px-2 py-2 text-right whitespace-nowrap bg-slate-100">Net amount</th>
                <th className="px-2 py-2 text-right whitespace-nowrap bg-slate-100">Quoted</th>
                <th className="px-2 py-2 text-right whitespace-nowrap bg-slate-100">Var %</th>
                <th className="px-2 py-2 text-left whitespace-nowrap bg-slate-100">Matched BOM row</th>
                <th className="px-2 py-2 text-left whitespace-nowrap bg-slate-100">Confidence</th>
                <th className="px-2 py-2 text-left whitespace-nowrap bg-slate-100">Action</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((li, idx) => {
                const bom = li.bom_item_id ? bomItems.find((b) => b.id === li.bom_item_id) : null;
                const badge = confidenceBadge(li.match_confidence || 0);
                const isExpanded = expanded[idx];
                const sel = li.selected;
                const variance = li.price_variance_pct;
                const varianceComparable = li.variance_comparable !== false && li.quoted_unit_price != null;
                const rowBg = li.ocr_uncertain ? 'bg-amber-50' : (!sel ? 'bg-amber-50/40' : 'bg-white');
                return (
                  <Fragment key={idx}>
                    <tr className={`border-t border-slate-100 ${rowBg}`}>
                      <td className="px-2 py-1.5 text-center sticky left-0 z-10" style={{ backgroundColor: 'inherit' }}>
                        <input type="checkbox" checked={!!sel} onChange={(e) => updateLine(idx, { selected: e.target.checked })} className="w-3.5 h-3.5 accent-amber-500" />
                      </td>
                      <td className="px-2 py-1.5 text-slate-500 whitespace-nowrap sticky left-8 z-10" style={{ backgroundColor: 'inherit' }}>{li.line_no ?? idx + 1}
                        {li.ocr_uncertain && <div className="mt-0.5"><VerifyBadge /></div>}
                      </td>
                      <td className="px-2 py-1.5"><input value={li.erp_item_code || ''} onChange={(e) => updateLine(idx, { erp_item_code: e.target.value })} className={inpErp} /></td>
                      <td className="px-2 py-1.5"><input value={li.part_number || ''} onChange={(e) => updateLine(idx, { part_number: e.target.value })} className={inpPart} /></td>
                      <td className="px-2 py-1.5"><input value={li.description || ''} onChange={(e) => updateLine(idx, { description: e.target.value })} className={inpDesc} /></td>
                      <td className="px-2 py-1.5"><input value={li.uom || ''} onChange={(e) => updateLine(idx, { uom: e.target.value })} className={inpUom} /></td>
                      <td className="px-2 py-1.5 text-right"><input type="number" step="any" value={li.qty ?? ''} onChange={(e) => updateLine(idx, { qty: e.target.value === '' ? null : Number(e.target.value) })} className={inpQty} /></td>
                      <td className="px-2 py-1.5 text-right"><input type="number" step="any" value={li.unit_price ?? ''} onChange={(e) => updateLine(idx, { unit_price: e.target.value === '' ? null : Number(e.target.value) })} className={inpPrice} /></td>
                      <td className="px-2 py-1.5 text-right font-medium text-slate-700 whitespace-nowrap">{fmt(li.net_amount, '')}</td>
                      <td className="px-2 py-1.5 text-right text-slate-500 whitespace-nowrap">{li.quoted_unit_price != null ? fmt(li.quoted_unit_price, '') : ''}</td>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap">
                        {li.quoted_unit_price != null ? (
                          <span className={`font-semibold ${!varianceComparable ? 'text-slate-300' : variance < 0 ? 'text-emerald-600' : variance > 0 ? 'text-red-600' : 'text-slate-500'}`} title={!varianceComparable ? 'Quotation figures include tax — not comparable' : undefined}>
                            {varianceComparable ? fmtPct(variance) : 'n/a'}
                          </span>
                        ) : ''}
                      </td>
                      <td className="px-2 py-1.5">
                        <select value={li._create ? '__create__' : (li.bom_item_id || '')} onChange={(e) => setTarget(idx, e.target.value)} className={inpSelect}>
                          <option value="">— Skip this line —</option>
                          <option value="__create__">+ Create new BOM item from this line</option>
                          {li.candidates && li.candidates.length > 0 && (
                            <optgroup label="Candidates">
                              {li.candidates.map((c) => {
                                const b = bomItems.find((x) => x.id === c.bom_item_id);
                                return <option key={c.bom_item_id} value={c.bom_item_id}>{(b?.manufacturer_part_number || b?.item_code || '?')} — {(b?.description || '').slice(0, 40)} ({Math.round(c.score * 100)}%, {c.tier})</option>;
                              })}
                            </optgroup>
                          )}
                          <optgroup label="All BOM items">
                             {bomItems.map((b) => <option key={b.id} value={b.id}>{(b.manufacturer_part_number || b.item_code || '?')} — {(b.description || '').slice(0, 50)}</option>)}
                           </optgroup>
                        </select>
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${badge.cls}`} title={tierLabel(li.match_tier)}>{badge.label}</span>
                        <span className="block text-[10px] text-slate-400 mt-0.5">{tierLabel(li.match_tier)}</span>
                      </td>
                      <td className="px-2 py-1.5">
                        <button onClick={() => setExpanded((p) => ({ ...p, [idx]: !p[idx] }))} className="text-slate-400 hover:text-slate-700">
                          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                      </td>
                    </tr>
                    {li._create && (
                      <tr className="border-t border-slate-100 bg-emerald-50/30">
                        <td colSpan={14} className="px-4 py-2 text-xs border-l-4 border-emerald-400">
                          <NewBomItemPanel li={li} idx={idx} updateLine={updateLine} />
                        </td>
                      </tr>
                    )}
                    {isExpanded && bom && (
                      <tr className="border-t border-slate-100 bg-slate-50">
                        <td colSpan={14} className="px-4 py-2 text-xs">
                          <BomChangePreview bom={bom} line={li} po={draft.po} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** Inline editor for a new BOM item when a line's target is __create__. */
function NewBomItemPanel({ li, idx, updateLine }) {
  const nb = li.new_bom || {};

  function updateField(field, value) {
    updateLine(idx, { new_bom: { ...nb, [field]: value } });
  }

  function handlePricingBlur() {
    const cost = Number(nb.planned_cost_price) || 0;
    updateField('selling_price', +(cost * 1.37).toFixed(2));
  }

  const inpFull = inpBase + ' w-full';

  return (
    <div className="space-y-2">
      <div className="font-semibold text-emerald-700">New BOM item</div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <label className="text-slate-500 col-span-2">Description
          <input value={nb.description || ''} onChange={(e) => updateField('description', e.target.value)} className={inpFull} />
        </label>
        <label className="text-slate-500">Manufacturer part #
          <input value={nb.manufacturer_part_number || ''} onChange={(e) => updateField('manufacturer_part_number', e.target.value)} className={inpFull} />
        </label>
        <label className="text-slate-500">ERP item code
          <input value={nb.erp_item_code || ''} onChange={(e) => updateField('erp_item_code', e.target.value)} className={inpFull} />
        </label>
        <label className="text-slate-500">Item code
          <input value={nb.item_code || ''} onChange={(e) => updateField('item_code', e.target.value)} className={inpFull} />
        </label>
        <label className="text-slate-500">Category
          <select value={nb.category || 'other'} onChange={(e) => updateField('category', e.target.value)} className={inpFull}>
            {CATEGORY_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="text-slate-500">Unit
          <input value={nb.unit || ''} onChange={(e) => updateField('unit', e.target.value)} className={inpFull} />
        </label>
        <label className="text-slate-500">Quantity
          <input type="number" step="any" value={nb.quantity ?? ''} onChange={(e) => updateField('quantity', e.target.value === '' ? null : Number(e.target.value))} className={inpFull} />
        </label>
        <label className="text-slate-500">Planned cost price
          <input type="number" step="any" value={nb.planned_cost_price ?? ''} onChange={(e) => updateField('planned_cost_price', e.target.value === '' ? null : Number(e.target.value))} onBlur={handlePricingBlur} className={inpFull} />
        </label>
        <label className="text-slate-500">Selling price
          <input type="number" step="any" value={nb.selling_price ?? ''} onChange={(e) => updateField('selling_price', e.target.value === '' ? null : Number(e.target.value))} className={inpFull} />
        </label>
        <label className="text-slate-500">Supplier
          <input value={nb.supplier || ''} onChange={(e) => updateField('supplier', e.target.value)} className={inpFull} />
        </label>
        <label className="text-slate-500 col-span-2">Notes
          <input value={nb.notes || ''} onChange={(e) => updateField('notes', e.target.value)} className={inpFull} />
        </label>
      </div>
      <div className="text-[10px] text-slate-400">Planned cost defaults to the PO price, so this item will show zero cost variance. Change it if you had a different plan.</div>
    </div>
  );
}

/** Shows old → new for the fields that applying this line will change on the BOM row. */
function BomChangePreview({ bom, line, po }) {
  const changes = [
    ['ordered_qty', bom.ordered_qty, line.qty],
    ['po_unit_price', bom.po_unit_price, line.unit_price],
    ['actual_cost_price', bom.actual_cost_price, line.unit_price],
    ['po_number', bom.po_number, po.po_number],
    ['po_date', bom.po_date, po.issue_date],
    ['expected_delivery_date', bom.expected_delivery_date, line.supplier_delivery_date],
    ['material_status', bom.material_status, 'ordered'],
  ];
  return (
    <div className="space-y-1">
      <div className="font-semibold text-slate-600 mb-1">Changes to BOM row {(bom.manufacturer_part_number || bom.item_code || '')}:</div>
      <div className="grid grid-cols-3 gap-x-4 gap-y-0.5 max-w-2xl">
        {changes.map(([f, oldV, newV]) => (
          <div key={f} className="contents">
            <span className="text-slate-400">{f}</span>
            <span className="text-slate-500 line-through">{oldV ?? '—'}</span>
            <span className="text-slate-800 font-medium">{newV ?? '—'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}