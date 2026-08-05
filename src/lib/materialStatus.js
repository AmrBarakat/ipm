export const MATERIAL_STATUS = {
  not_ordered: { label: 'Not Ordered', cls: 'bg-slate-100 text-slate-600', step: 0 },
  ordered:     { label: 'Ordered',     cls: 'bg-blue-100 text-blue-700',  step: 1 },
  received:    { label: 'Received',    cls: 'bg-indigo-100 text-indigo-700', step: 2 },
  delivered:   { label: 'Delivered',   cls: 'bg-emerald-100 text-emerald-700', step: 3 },
};

// Single source of truth. Never downgrade a status that is already further along.
export function resolveMaterialStatus(item) {
  const ms = item?.material_status;
  const valid = ['not_ordered', 'ordered', 'received', 'delivered'];
  let status = valid.includes(ms) ? ms : 'not_ordered';

  const dq = Number(item?.delivered_qty) || 0;
  const qty = Number(item?.quantity) || 0;
  const isOrdered = item?.order_status === 'ordered' || item?.ordered;
  const isDelivered = item?.delivery_status === 'delivered' || !!item?.site_delivered_date;

  // Only upgrade, never downgrade.
  if (isDelivered && MATERIAL_STATUS[status].step < MATERIAL_STATUS.delivered.step) {
    status = 'delivered';
  }
  if (qty > 0 && dq >= qty && MATERIAL_STATUS[status].step < MATERIAL_STATUS.received.step) {
    status = 'received';
  }
  if (isOrdered && MATERIAL_STATUS[status].step < MATERIAL_STATUS.ordered.step) {
    status = 'ordered';
  }
  return status;
}

// Keep the legacy pair consistent with the merged field.
// When the user manually downgrades, clear the quantity / date fields that
// drove the higher status — otherwise resolveMaterialStatus() immediately
// re-upgrades and the select snaps back.
export function legacyFieldsFor(status, item) {
  const qty = Number(item?.quantity) || 0;
  const prevDq = Number(item?.delivered_qty) || Number(item?.received_qty) || 0;

  // Downgrading below 'received' → zero out received quantities.
  const clearReceived = status === 'not_ordered' || status === 'ordered';
  const delivered_qty = clearReceived ? 0 : prevDq;
  const received_qty  = clearReceived ? 0 : prevDq;
  const remaining_qty = clearReceived ? qty : Math.max(0, qty - delivered_qty);

  // Downgrading below 'delivered' → clear site delivery date.
  const site_delivered_date = status === 'delivered'
    ? (item?.site_delivered_date || new Date().toISOString().slice(0, 10))
    : null;

  return {
    order_status:    status === 'not_ordered' ? 'not_ordered' : 'ordered',
    ordered:         status !== 'not_ordered',
    delivery_status: status === 'delivered' ? 'delivered'
                   : delivered_qty > 0 ? 'partially_delivered'
                   : 'not_delivered',
    delivered_qty,
    received_qty,
    remaining_qty,
    site_delivered_date,
  };
}

// Returns { status, label, cls, partial } — label includes "(n of m)" when partial.
export function materialStatusMeta(item) {
  const status = resolveMaterialStatus(item);
  const meta = MATERIAL_STATUS[status];
  const dq = Number(item?.delivered_qty) || 0;
  const qty = Number(item?.quantity) || 0;
  const partial = (status === 'received' || status === 'delivered') && dq > 0 && (qty === 0 || dq < qty);
  const label = partial ? `${meta.label} (${dq} of ${qty})` : meta.label;
  return { status, label, cls: meta.cls, partial };
}