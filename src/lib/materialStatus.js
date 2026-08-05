export const MATERIAL_STATUS = {
  not_ordered: {
    value: 'not_ordered', label: 'Not Ordered', step: 0, partial: false,
    cls: 'bg-slate-100 text-slate-600 border border-slate-200',
    dot: 'bg-slate-400', hex: '#94a3b8',
  },
  partially_ordered: {
    value: 'partially_ordered', label: 'Partially Ordered', step: 1, partial: true,
    cls: 'bg-amber-100 text-amber-800 border border-dashed border-amber-400',
    dot: 'bg-amber-500', hex: '#f59e0b',
  },
  ordered: {
    value: 'ordered', label: 'Ordered', step: 2, partial: false,
    cls: 'bg-blue-100 text-blue-700 border border-blue-200',
    dot: 'bg-blue-500', hex: '#3b82f6',
  },
  partially_received: {
    value: 'partially_received', label: 'Partially Received', step: 3, partial: true,
    cls: 'bg-violet-100 text-violet-700 border border-dashed border-violet-400',
    dot: 'bg-violet-500', hex: '#8b5cf6',
  },
  received: {
    value: 'received', label: 'Received', step: 4, partial: false,
    cls: 'bg-indigo-100 text-indigo-700 border border-indigo-200',
    dot: 'bg-indigo-500', hex: '#6366f1',
  },
  delivered: {
    value: 'delivered', label: 'Delivered', step: 5, partial: false,
    cls: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
    dot: 'bg-emerald-500', hex: '#10b981',
  },
};

export const MATERIAL_STATUS_ORDER = [
  'not_ordered', 'partially_ordered', 'ordered', 'partially_received', 'received', 'delivered',
];

/**
 * Derive the effective material status from quantities, highest state first,
 * and never downgrade below an explicitly stored material_status.
 *
 * The stored material_status and the quantity-derived status are compared by
 * step; whichever is higher wins. This means the PO pipeline and manual edits
 * can both only move an item forward.
 */
export function resolveMaterialStatus(item) {
  const qty = Number(item?.quantity) || 0;
  const orderedQ = item?.ordered_qty == null ? null : (Number(item.ordered_qty) || 0);
  const recvQ = Number(item?.received_qty) || Number(item?.delivered_qty) || 0;
  const isOrderedFlag = item?.order_status === 'ordered' || !!item?.ordered;
  const isSiteDelivered = !!item?.site_delivered_date || item?.delivery_status === 'delivered';

  let derived = 'not_ordered';
  // LEGACY GUARD: ordered_qty null + ordered flag → fully ordered, not partial.
  if (orderedQ != null && orderedQ > 0 && qty > 0 && orderedQ < qty) derived = 'partially_ordered';
  else if (isOrderedFlag || (orderedQ != null && qty > 0 && orderedQ >= qty)) derived = 'ordered';

  if (recvQ > 0 && qty > 0 && recvQ < qty) derived = 'partially_received';
  else if (recvQ > 0 && (qty === 0 || recvQ >= qty)) derived = 'received';
  if (isSiteDelivered) derived = 'delivered';

  const stored = item?.material_status;
  const storedValid = stored && MATERIAL_STATUS_ORDER.includes(stored) ? stored : null;
  if (!storedValid) return derived;
  if (MATERIAL_STATUS[derived].step >= MATERIAL_STATUS[storedValid].step) return derived;
  return storedValid;
}

/**
 * Returns { status, label, cls, dot, hex, partial, detail }.
 * For partial states, detail is the quantity fragment — "3 of 5 received"
 * for partially_received, "2 of 5 ordered" for partially_ordered — and label
 * stays the plain status name.
 */
export function materialStatusMeta(item) {
  const status = resolveMaterialStatus(item);
  const meta = MATERIAL_STATUS[status];
  const qty = Number(item?.quantity) || 0;
  const orderedQ = item?.ordered_qty == null ? null : (Number(item.ordered_qty) || 0);
  const recvQ = Number(item?.received_qty) || Number(item?.delivered_qty) || 0;

  let detail = '';
  if (status === 'partially_ordered' && orderedQ != null) {
    detail = `${orderedQ} of ${qty} ordered`;
  } else if (status === 'partially_received') {
    detail = `${recvQ} of ${qty} received`;
  }

  return {
    status,
    label: meta.label,
    cls: meta.cls,
    dot: meta.dot,
    hex: meta.hex,
    partial: meta.partial,
    detail,
  };
}

/**
 * Keep legacy fields consistent with the material_status.
 *
 * For non-partial states, quantities are set explicitly:
 *   not_ordered → ordered_qty 0, received_qty 0, delivered_qty 0, remaining = qty
 *   ordered     → ordered_qty = qty, received 0
 *   received/delivered → received_qty = qty, delivered_qty = qty, remaining 0
 *
 * For PARTIAL states (partially_ordered, partially_received), quantities are
 * NOT included — the caller must provide them from the inline number input.
 */
export function legacyFieldsFor(status, item) {
  const qty = Number(item?.quantity) || 0;
  const recvQ = Number(item?.received_qty) || Number(item?.delivered_qty) || 0;

  const order_status = status === 'not_ordered' ? 'not_ordered' : 'ordered';
  const ordered = status !== 'not_ordered';

  let delivery_status;
  if (status === 'delivered') delivery_status = 'delivered';
  else if (status === 'received' || status === 'partially_received') {
    delivery_status = (recvQ > 0 && qty > 0 && recvQ >= qty) ? 'delivered' : 'partially_delivered';
  } else {
    delivery_status = 'not_delivered';
  }

  const site_delivered_date = status === 'delivered'
    ? (item?.site_delivered_date || new Date().toISOString().slice(0, 10))
    : null;

  // Partial states: return flags only, no quantities.
  if (status === 'partially_ordered' || status === 'partially_received') {
    return { order_status, ordered, delivery_status, site_delivered_date };
  }

  // Non-partial: set quantities explicitly.
  let ordered_qty, received_qty, delivered_qty, remaining_qty;
  if (status === 'not_ordered') {
    ordered_qty = 0; received_qty = 0; delivered_qty = 0; remaining_qty = qty;
  } else if (status === 'ordered') {
    ordered_qty = qty; received_qty = 0; delivered_qty = 0; remaining_qty = qty;
  } else { // received or delivered
    ordered_qty = item?.ordered_qty ?? qty;
    received_qty = qty; delivered_qty = qty; remaining_qty = 0;
  }

  return { order_status, ordered, delivery_status, site_delivered_date, ordered_qty, received_qty, delivered_qty, remaining_qty };
}