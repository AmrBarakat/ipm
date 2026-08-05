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
export function legacyFieldsFor(status, item) {
  return {
    order_status:    status === 'not_ordered' ? 'not_ordered' : 'ordered',
    ordered:         status !== 'not_ordered',
    delivery_status: status === 'delivered' ? 'delivered'
                   : (Number(item?.delivered_qty) || 0) > 0 ? 'partially_delivered'
                   : 'not_delivered',
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