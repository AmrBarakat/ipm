/**
 * applyPOReceipt — records goods received against a Purchase Order, rolls the
 * line receipts up into the PO status, and cascades the result into BOM items.
 *
 * Input:
 *   { purchase_order_id, project_id,
 *     lines: [{ line_no, received_qty, received_date, receipt_note }],
 *     mode: 'partial' | 'all' }
 *
 * When mode is 'all', every line's received_qty is set to its ordered quantity
 * and received_date to today unless the payload overrides it.
 *
 * Output: { purchase_order_id, po_status, receipt_progress, bom_updated,
 *           bom_failed, warnings, build_id }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { requirePrivilege } from '../../shared/requirePrivilege.ts';
import { deriveMaterialStatus, deliveryStatusFor } from '../../shared/podnApply.ts';

const BUILD_ID = 'po-receipt-v1';

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);

    // ── Auth + privilege ──────────────────────────────────────────────────────
    let user: any = null;
    try { user = await base44.auth.me(); } catch (_) { user = null; }
    if (!user) return Response.json({ error: 'Unauthorized', build_id: BUILD_ID }, { status: 401 });
    const denied = requirePrivilege(user, 'modify');
    if (denied) return Response.json({ ...(await denied.json()), build_id: BUILD_ID }, { status: denied.status });

    const body = await req.json().catch(() => ({}));
    const { purchase_order_id, project_id, mode } = body;
    const inputLines: any[] = Array.isArray(body.lines) ? body.lines : [];

    if (!purchase_order_id || !project_id)
      return Response.json({ error: 'purchase_order_id and project_id are required', build_id: BUILD_ID }, { status: 400 });

    const actor = user?.full_name || user?.email || 'system';
    const today = new Date().toISOString().slice(0, 10);
    const warnings: string[] = [];

    // ── a. Load the PO ──────────────────────────────────────────────────────
    const po: any = await base44.asServiceRole.entities.PurchaseOrder.get(purchase_order_id);
    if (!po)
      return Response.json({ error: 'Purchase order not found', build_id: BUILD_ID }, { status: 404 });

    const items: any[] = Array.isArray(po.items) ? po.items.map((it: any) => ({ ...it })) : [];

    // Merge input received quantities into items.
    if (mode === 'all') {
      for (const it of items) {
        const ln = Number(it.line_no);
        const override = inputLines.find((l) => Number(l.line_no) === ln);
        it.received_qty = override && override.received_qty != null
          ? Math.min(Number(override.received_qty), Number(it.quantity) || 0)
          : Number(it.quantity) || 0;
        it.received_date = override?.received_date || today;
        it.receipt_note = override?.receipt_note || it.receipt_note || '';
      }
    } else {
      for (const inp of inputLines) {
        const ln = Number(inp.line_no);
        const it = items.find((x) => Number(x.line_no) === ln);
        if (!it) { warnings.push(`Line ${ln} not found on PO, skipped.`); continue; }
        const qty = Number(it.quantity) || 0;
        const rq = Number(inp.received_qty) || 0;
        it.received_qty = Math.max(0, Math.min(rq, qty));
        it.received_date = inp.received_date || it.received_date || '';
        it.receipt_note = inp.receipt_note ?? it.receipt_note ?? '';
      }
    }

    // ── b. Recompute PO status & receipt_progress ───────────────────────────
    const subtotalNet = po.subtotal_net != null
      ? Number(po.subtotal_net)
      : items.reduce((s, it) => s + (Number(it.net_amount) || 0), 0);

    const receivedNet = items.reduce((s, it) => {
      const q = Number(it.quantity) || 0;
      const rq = Number(it.received_qty) || 0;
      const up = Number(it.unit_price) || 0;
      const ratio = q > 0 ? Math.min(rq / q, 1) : 0;
      return s + ratio * (Number(it.net_amount) || (q * up));
    }, 0);

    const receiptProgress = subtotalNet > 0
      ? Math.round((receivedNet / subtotalNet) * 1000) / 10
      : 0;

    const allFullyReceived = items.length > 0 && items.every((it) => {
      const q = Number(it.quantity) || 0;
      const rq = Number(it.received_qty) || 0;
      return q > 0 && rq >= q;
    });
    const anyReceived = items.some((it) => (Number(it.received_qty) || 0) > 0);

    const prevStatus = po.status;
    let newStatus = prevStatus;
    // Never downgrade a PO that is already 'delivered' unless a line's
    // received_qty is explicitly reduced (detected by allFullyReceived becoming false).
    if (allFullyReceived) {
      newStatus = 'delivered';
    } else if (anyReceived) {
      newStatus = prevStatus === 'delivered' ? 'partially_delivered' : 'partially_delivered';
    } else {
      // Nothing received — leave the existing status untouched.
      newStatus = prevStatus === 'delivered' ? 'partially_delivered' : prevStatus;
    }
    if (prevStatus === 'cancelled') {
      newStatus = 'cancelled'; // never override a cancellation via receipts
      warnings.push('PO is cancelled — status unchanged.');
    }

    const receivedAt = newStatus === 'delivered' && !po.received_at
      ? new Date().toISOString()
      : po.received_at || null;

    // Update the PO
    const poUpdate: any = {
      items,
      status: newStatus,
      receipt_progress: receiptProgress,
      received_at: receivedAt,
      actual_delivery_date: newStatus === 'delivered'
        ? (po.actual_delivery_date || today)
        : po.actual_delivery_date,
    };
    await base44.asServiceRole.entities.PurchaseOrder.update(purchase_order_id, poUpdate);

    // AuditLog for the PO
    await base44.asServiceRole.entities.AuditLog.create({
      project_id,
      entity_type: 'PurchaseOrder',
      entity_id: purchase_order_id,
      action: 'updated',
      actor,
      summary: `PO ${po.po_number || '—'} receipt: ${newStatus} (${receiptProgress}%). ${items.length} lines.`,
      metadata: { source_document: po.po_number || '', previous_status: prevStatus, new_status: newStatus, receipt_progress: receiptProgress },
    });

    // ── c. Cascade into BOM items ───────────────────────────────────────────
    // Load ALL POs on the project so we can sum received quantities per
    // bom_item_id across every PO, not just this one.
    const allPOs: any[] = await base44.asServiceRole.entities.PurchaseOrder.filter({ project_id }, '-created_date', 500);

    // Collect the set of bom_item_ids referenced by THIS PO's lines.
    const bomIdsToUpdate = new Set<string>();
    for (const it of items) {
      if (it.bom_item_id) bomIdsToUpdate.add(it.bom_item_id);
    }

    // For each bom_item_id, sum received_qty across ALL POs' lines.
    const cumulativeByBom: Record<string, number> = {};
    for (const p of allPOs) {
      for (const ln of (p.items || [])) {
        if (ln.bom_item_id) {
          cumulativeByBom[ln.bom_item_id] = (cumulativeByBom[ln.bom_item_id] || 0) + (Number(ln.received_qty) || 0);
        }
      }
    }

    const bomResults = await Promise.allSettled(
      [...bomIdsToUpdate].map(async (bomId) => {
        const bom: any = await base44.asServiceRole.entities.BOMItem.get(bomId);
        if (!bom) { warnings.push(`BOM item ${bomId} not found.`); return null; }

        const cumulative = cumulativeByBom[bomId] || 0;
        const qty = Number(bom.quantity) || 0;
        const curStatus = deriveMaterialStatus(bom);
        const prevReceived = Number(bom.received_qty) || Number(bom.delivered_qty) || 0;

        const update: any = {
          received_qty: cumulative,
          delivered_qty: cumulative, // mirror to legacy field
          remaining_qty: Math.max(0, qty - cumulative),
          delivery_status: deliveryStatusFor(cumulative, qty),
        };

        // Material-status transition
        let newBomStatus = curStatus;
        if (curStatus === 'delivered') {
          // Never downgrade delivered
        } else if (qty > 0 && cumulative >= qty) {
          newBomStatus = 'received';
        } else if (cumulative > 0) {
          newBomStatus = curStatus === 'received' ? 'received' : 'ordered';
        } else {
          // No cumulative receipt — downgrade to ordered if it was received/ordered
          newBomStatus = (bom.order_status === 'ordered' || bom.ordered) ? 'ordered' : 'not_ordered';
        }
        update.material_status = newBomStatus;
        update.order_status = newBomStatus === 'not_ordered' ? 'not_ordered' : 'ordered';
        update.ordered = newBomStatus !== 'not_ordered';

        await base44.asServiceRole.entities.BOMItem.update(bomId, update);

        await base44.asServiceRole.entities.AuditLog.create({
          project_id,
          entity_type: 'BOMItem',
          entity_id: bomId,
          action: 'updated',
          actor,
          summary: `Receipt from PO ${po.po_number || '—'}: cumulative ${cumulative}/${qty} → ${newBomStatus}.`,
          metadata: {
            source_document: po.po_number || '',
            received_qty: cumulative,
            previous_received: prevReceived,
            previous_status: curStatus,
            new_status: newBomStatus,
            bom_quantity: qty,
          },
        });

        return { bom_item_id: bomId, status: newBomStatus, cumulative };
      })
    );

    const bom_updated = bomResults.filter((r) => r.status === 'fulfilled' && r.value != null).map((r: any) => r.value);
    const bom_failed = bomResults
      .map((r, i) => ({ r, id: [...bomIdsToUpdate][i] }))
      .filter(({ r }) => r.status === 'rejected')
      .map(({ r, id }) => ({ bom_item_id: id, error: (r as PromiseRejectedResult).reason?.message || 'failed' }));

    return Response.json({
      purchase_order_id,
      po_status: newStatus,
      receipt_progress: receiptProgress,
      received_at: receivedAt,
      bom_updated,
      bom_failed,
      warnings,
      build_id: BUILD_ID,
    });
  } catch (error) {
    return Response.json({ error: error.message, build_id: BUILD_ID }, { status: 500 });
  }
}