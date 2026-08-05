import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { MATERIAL_STATUS, MATERIAL_STATUS_ORDER, materialStatusMeta } from '@/lib/materialStatus';

/**
 * MaterialStatusPill — renders the current material status as a colored pill
 * with a dropdown to change it.
 *
 * When a partial state (Partially Ordered / Partially Received) is selected,
 * an inline number input appears beside the pill ("of {quantity}") defaulted
 * to the current ordered_qty / received_qty, or to 1 when that is zero.
 *
 * The status only saves once a quantity between 1 and quantity-1 is entered.
 * Entering the full quantity promotes it to the complete state automatically
 * and closes the input.
 *
 * Props:
 *   item     — BOM item (needs quantity, ordered_qty, received_qty,
 *              delivered_qty, material_status, order_status, etc.)
 *   onCommit — callback(status, partialQty) where partialQty is null for
 *              non-partial states and a number for partial states.
 *   stop     — optional click handler (e.g. e.stopPropagation to prevent
 *              row-toggle when clicking the select)
 *   disabled — boolean
 */
export default function MaterialStatusPill({ item, onCommit, stop, disabled }) {
  const meta = materialStatusMeta(item);
  const qty = Number(item.quantity) || 0;
  const [partialDraft, setPartialDraft] = useState(null);
  // partialDraft: { state: 'partially_ordered'|'partially_received', value: number }

  function handleSelect(value) {
    if (value === 'partially_ordered' || value === 'partially_received') {
      const current = value === 'partially_ordered'
        ? (Number(item.ordered_qty) || 0)
        : (Number(item.received_qty) || Number(item.delivered_qty) || 0);
      setPartialDraft({ state: value, value: current > 0 ? current : 1 });
    } else {
      setPartialDraft(null);
      onCommit(value, null);
    }
  }

  function commitPartial() {
    if (!partialDraft) return;
    const v = Number(partialDraft.value) || 0;
    if (qty > 0 && v >= qty) {
      // Entering the full quantity promotes to the complete state.
      const complete = partialDraft.state === 'partially_ordered' ? 'ordered' : 'received';
      setPartialDraft(null);
      onCommit(complete, qty);
    } else if (v > 0 && (qty === 0 || v < qty)) {
      setPartialDraft(null);
      onCommit(partialDraft.state, v);
    }
    // else: invalid input, keep the input open
  }

  function cancelPartial() {
    setPartialDraft(null);
  }

  // ── Inline partial-quantity input ──────────────────────────────────────
  if (partialDraft) {
    return (
      <div className="flex items-center gap-1" onClick={stop}>
        <span className={`text-[10px] font-semibold px-1.5 py-1 rounded ${MATERIAL_STATUS[partialDraft.state].cls}`}>
          {MATERIAL_STATUS[partialDraft.state].label}
        </span>
        <input
          type="number"
          min="1"
          max={qty > 0 ? qty : undefined}
          value={partialDraft.value}
          onChange={e => setPartialDraft(d => ({ ...d, value: e.target.value }))}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commitPartial(); }
            if (e.key === 'Escape') cancelPartial();
          }}
          className="w-10 text-[10px] border border-slate-300 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-amber-400 bg-white"
          autoFocus
        />
        <span className="text-[10px] text-slate-500">of {qty}</span>
        <button onClick={commitPartial} className="text-emerald-600 hover:text-emerald-700" title="Confirm">
          <Check className="w-3 h-3" />
        </button>
        <button onClick={cancelPartial} className="text-slate-400 hover:text-red-500" title="Cancel">
          <X className="w-3 h-3" />
        </button>
      </div>
    );
  }

  // ── Status pill + dropdown ─────────────────────────────────────────────
  return (
    <div className="flex flex-col" onClick={stop}>
      <div className="flex items-center gap-1">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta.dot}`} />
        <select
          className={`text-[10px] font-semibold border-0 rounded px-1.5 py-1 cursor-pointer ${meta.cls}`}
          value={meta.status}
          onChange={e => handleSelect(e.target.value)}
          disabled={disabled}
        >
          {MATERIAL_STATUS_ORDER.map(key => (
            <option key={key} value={key}>{MATERIAL_STATUS[key].label}</option>
          ))}
        </select>
      </div>
      {meta.detail && (
        <span className="text-[10px] text-slate-500 mt-0.5 pl-2.5">{meta.detail}</span>
      )}
    </div>
  );
}