/**
 * Shared PO / Delivery-Note apply logic.
 *
 * Used by extractPODN (auto-apply of matched lines) and applyPODNLine (manual
 * assignment of an unmatched line from the results panel) so the update rules
 * live in exactly one place.
 *
 * Material pipeline (material_status):
 *   not_ordered → ordered (PO placed) → received (goods arrived at warehouse
 *   from supplier DN/packing slip) → delivered (handed over to project site).
 *
 * Migration: items created before `material_status` existed have a null /
 * "not_ordered" value. deriveMaterialStatus() reconstructs it from the legacy
 * order_status / delivered_qty fields so the pipeline never downgrades an item
 * that was already received/delivered. When writing, received_qty is mirrored
 * to the legacy delivered_qty for backward compatibility.
 */

/** Strip dotted vendor prefixes (TQ. / ES. / ES.TQ.), uppercase, drop non-alphanumerics. */
export function normalizePart(s) {
  let x = (s || '').toString().toUpperCase().trim();
  x = x.replace(/^(?:ES\.TQ\.|TQ\.|ES\.)+/, '');
  x = x.replace(/[^A-Z0-9]/g, '');
  return x;
}

/** Effective material_status, deriving from legacy fields when missing/not_ordered. */
export function deriveMaterialStatus(item) {
  const ms = item?.material_status;
  if (ms && ms !== 'not_ordered') return ms;
  const dq = Number(item?.delivered_qty) || 0;
  const qty = Number(item?.quantity) || 0;
  if (qty > 0 && dq >= qty) return 'received';
  if (item?.order_status === 'ordered' || item?.ordered) return 'ordered';
  return 'not_ordered';
}

export function deliveryStatusFor(received, qty) {
  if (qty > 0 && received >= qty) return 'delivered';
  if (received > 0) return 'partially_delivered';
  return 'not_delivered';
}

/**
 * Apply one PO/DN line to a matched BOM item. Performs the entity update + audit
 * log via the supplied per-request client (asServiceRole-capable).
 *
 * Returns { bom_item_id, applied_status }.
 */
export async function applyLine({ base44, bom, document_type, document_number, document_date, qty, actor, project_id }) {
  const ref = document_number || (document_type === 'po' ? 'PO' : 'Delivery note');
  const refDate = document_date || '';
  const curStatus = deriveMaterialStatus(bom);
  const update = {};
  let appliedStatus = '';
  let auditField = 'material_status';
  let auditOld = curStatus;
  let auditNew = curStatus;
  let auditSummary = '';

  if (document_type === 'po') {
    update.po_number = ref;
    update.po_date = refDate;
    if (curStatus !== 'received' && curStatus !== 'delivered') {
      update.order_status = 'ordered';
      update.ordered = true;
      update.material_status = 'ordered';
      appliedStatus = 'Ordered';
      auditNew = 'ordered';
      auditSummary = `Marked ordered per ${ref}`;
    } else {
      appliedStatus = curStatus === 'received' ? 'Already Received' : 'Already Delivered';
      auditSummary = `PO ${ref} linked (already ${curStatus})`;
    }
  } else {
    const prevReceived = Number(bom.received_qty) || Number(bom.delivered_qty) || 0;
    const totalQty = Number(bom.quantity) || 0;
    const slipQty = Number(qty) || 0;
    const newReceived = prevReceived + slipQty;
    const newRemaining = Math.max(0, totalQty - newReceived);
    update.received_qty = newReceived;
    update.delivered_qty = newReceived; // mirror to legacy field
    update.remaining_qty = newRemaining;
    let newStatus = curStatus;
    if (totalQty > 0 && newReceived >= totalQty) newStatus = 'received';
    if (curStatus === 'delivered') newStatus = 'delivered'; // never downgrade
    else if (curStatus === 'received' && newStatus !== 'received') newStatus = 'received';
    update.material_status = newStatus;
    update.delivery_status = deliveryStatusFor(newReceived, totalQty);
    appliedStatus = newStatus === 'delivered' ? 'Delivered'
      : newStatus === 'received' ? 'Received'
      : newReceived > 0 ? 'Partially Received' : 'Unchanged';
    auditField = 'received_qty';
    auditOld = prevReceived;
    auditNew = newReceived;
    auditSummary = `Received ${slipQty} per ${ref} (cumulative ${newReceived})`;
  }

  await base44.asServiceRole.entities.BOMItem.update(bom.id, update);
  await base44.asServiceRole.entities.AuditLog.create({
    project_id,
    entity_type: 'BOMItem',
    entity_id: bom.id,
    action: 'updated',
    actor: actor || 'system',
    summary: auditSummary,
    metadata: { field: auditField, old: auditOld, new: auditNew, source_document: ref, source_date: refDate },
  });

  return { bom_item_id: bom.id, applied_status: appliedStatus };
}