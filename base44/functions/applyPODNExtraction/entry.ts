/**
 * applyPODNExtraction — R1: the SINGLE WRITE POINT for the PO/DN ingestion
 * pipeline. Takes the reviewed-and-edited draft from the modal and commits
 * everything in one call, in dependency order:
 *
 *   vendor → purchase order → BOM lines → expense → learning → summary note →
 *   close extraction.
 *
 * All monetary values are net of tax. No VAT field is computed, stored or
 * referenced anywhere.
 *
 * Input (top-level OR nested under `payload` — the modal sends `payload`):
 *   { extraction_id, project_id, document_id,
 *     header | document, vendor_action | vendor.mode, vendor,
 *     po_action | po.createToggle, purchase_order | po,
 *     expense_action | expense.createToggle, expense, lines[] }
 *
 * Output: { extraction_id, note_id, vendor_id, purchase_order_id, expense_id,
 *           bom_updated, bom_failed, warnings }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { requirePrivilege } from '../../shared/requirePrivilege.ts';
import { normalizeCode, stripErpPrefix } from '../../shared/matchLine.ts';
import { deriveMaterialStatus } from '../../shared/podnApply.ts';

/** Drop undefined/null/'' keys, keeping 0 and false. */
function cleanObj(o: any): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(o || {})) {
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out;
}

const LEARN_TIERS = new Set(['tail', 'contains', 'description']);

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // ── Auth + privilege ──────────────────────────────────────────────────────
    let user: any = null;
    try { user = await base44.auth.me(); } catch (_) { user = null; }
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const denied = requirePrivilege(user, 'create');
    if (denied) return denied;

    const body = await req.json();
    // The modal sends { extraction_id, project_id, document_id, payload: draft }.
    // Normalize so the documented top-level shape also works.
    const payload = body.payload || body;
    const extraction_id = body.extraction_id ?? payload.extraction_id;
    const project_id = body.project_id ?? payload.project_id;
    const document_id = body.document_id ?? payload.document_id ?? null;

    if (!extraction_id || !project_id)
      return Response.json({ error: 'extraction_id and project_id are required' }, { status: 400 });

    const header: any = payload.header || payload.document || {};
    const vendor: any = payload.vendor || {};
    const vendor_action: string = payload.vendor_action || vendor.mode || (vendor.createToggle ? 'create' : 'skip');
    const purchase_order: any = payload.purchase_order || payload.po || {};
    const po_action: string = payload.po_action || (purchase_order.createToggle ? 'create' : 'skip');
    const expense: any = payload.expense || {};
    const expense_action: string = payload.expense_action || (expense.createToggle ? 'create' : 'skip');
    const lines: any[] = Array.isArray(payload.lines) ? payload.lines : [];
    const docType: string = header.type || header.document_type || (payload.document?.type) || 'po';
    const isPO = docType === 'po';

    const actor = user?.full_name || user?.email || 'system';
    const now = new Date().toISOString();
    const warnings: string[] = [];
    const refs: any[] = []; // R9 created_entity_refs

    // ── 1. VENDOR ─────────────────────────────────────────────────────────────
    let vendor_id: string | null = vendor.existingVendorId || null;
    let vendor_name = vendor.name || '';

    const vendorSupplied = cleanObj({
      name: vendor.name,
      type: vendor.type || 'supplier',
      contact_name: vendor.contact_name,
      email: vendor.email,
      phone: vendor.phone,
      address: vendor.address,
      country: vendor.country,
      supplier_code: vendor.supplier_code,
      tax_number: vendor.tax_number,
      payment_terms: vendor.payment_terms,
    });

    if (vendor_action === 'skip') {
      // resolve vendor_id from the payload, change nothing
      if (!vendor_id) {
        try {
          const sc = String(vendor.supplier_code || '').trim();
          const tn = String(vendor.tax_number || '').trim();
          let found: any = null;
          if (sc) found = (await base44.asServiceRole.entities.Vendor.filter({ supplier_code: sc }, '-created_date', 1))[0];
          if (!found && tn) found = (await base44.asServiceRole.entities.Vendor.filter({ tax_number: tn }, '-created_date', 1))[0];
          if (!found && vendor.name) found = (await base44.asServiceRole.entities.Vendor.filter({ name: vendor.name }, '-created_date', 1))[0];
          if (found) vendor_id = found.id;
        } catch (_) {}
      }
    } else if (vendor_action === 'create' || vendor_action === 'keep_both') {
      // R5 guard: never create a second vendor for the same identity.
      let existing: any = null;
      try {
        const sc = String(vendor.supplier_code || '').trim();
        const tn = String(vendor.tax_number || '').trim();
        if (sc) existing = (await base44.asServiceRole.entities.Vendor.filter({ supplier_code: sc }, '-created_date', 1))[0];
        if (!existing && tn) existing = (await base44.asServiceRole.entities.Vendor.filter({ tax_number: tn }, '-created_date', 1))[0];
        if (!existing && vendor.name) existing = (await base44.asServiceRole.entities.Vendor.filter({ name: vendor.name }, '-created_date', 1))[0];
      } catch (_) {}
      if (existing) {
        warnings.push(`Vendor already exists (${existing.name}) — updated in place instead of creating a duplicate.`);
        const before = cleanObj({
          name: existing.name, contact_name: existing.contact_name, email: existing.email, phone: existing.phone,
          address: existing.address, country: existing.country, supplier_code: existing.supplier_code,
          tax_number: existing.tax_number, payment_terms: existing.payment_terms,
        });
        const aliases = Array.isArray(existing.aliases) ? [...existing.aliases] : [];
        if (vendor.name && !aliases.some((a: string) => String(a).toLowerCase() === String(vendor.name).toLowerCase())) {
          aliases.push(vendor.name);
        }
        const updated = await base44.asServiceRole.entities.Vendor.update(existing.id, { ...vendorSupplied, aliases });
        vendor_id = existing.id;
        vendor_name = updated.name || existing.name;
        refs.push({ entity_type: 'Vendor', entity_id: existing.id, action: 'updated', before, applied_updated_date: updated?.updated_date });
      } else {
        const created = await base44.asServiceRole.entities.Vendor.create({
          ...vendorSupplied,
          aliases: vendor.name ? [vendor.name] : [],
          created_from_document_id: document_id,
        });
        vendor_id = created.id;
        vendor_name = created.name || vendor.name;
        refs.push({ entity_type: 'Vendor', entity_id: created.id, action: 'created', before: {}, applied_updated_date: created?.updated_date });
      }
    } else if (vendor_action === 'update' || vendor_action === 'overwrite') {
      // resolve the existing vendor id
      if (!vendor_id) {
        try {
          const sc = String(vendor.supplier_code || '').trim();
          const tn = String(vendor.tax_number || '').trim();
          if (sc) vendor_id = (await base44.asServiceRole.entities.Vendor.filter({ supplier_code: sc }, '-created_date', 1))[0]?.id || null;
          if (!vendor_id && tn) vendor_id = (await base44.asServiceRole.entities.Vendor.filter({ tax_number: tn }, '-created_date', 1))[0]?.id || null;
          if (!vendor_id && vendor.name) vendor_id = (await base44.asServiceRole.entities.Vendor.filter({ name: vendor.name }, '-created_date', 1))[0]?.id || null;
        } catch (_) {}
      }
      if (!vendor_id) {
        warnings.push('Vendor update requested but no existing vendor found — skipped.');
      } else {
        const existing: any = await base44.asServiceRole.entities.Vendor.get(vendor_id);
        const before = cleanObj({
          name: existing?.name, contact_name: existing?.contact_name, email: existing?.email, phone: existing?.phone,
          address: existing?.address, country: existing?.country, supplier_code: existing?.supplier_code,
          tax_number: existing?.tax_number, payment_terms: existing?.payment_terms,
        });
        const aliases = Array.isArray(existing?.aliases) ? [...existing.aliases] : [];
        if (vendor.name && !aliases.some((a: string) => String(a).toLowerCase() === String(vendor.name).toLowerCase())) {
          aliases.push(vendor.name);
        }
        // update = patch only present fields (+ alias); overwrite = replace all supplied fields (+ alias)
        const patch = vendor_action === 'overwrite' ? vendorSupplied : cleanObj({ ...vendorSupplied });
        const updated = await base44.asServiceRole.entities.Vendor.update(vendor_id, { ...patch, aliases });
        vendor_name = updated.name || vendor.name;
        refs.push({ entity_type: 'Vendor', entity_id: vendor_id, action: 'updated', before, applied_updated_date: updated?.updated_date });
      }
    }

    // ── 2. PURCHASE ORDER (R5 idempotency, R7 delivery date, R8 payment schedule)
    let purchase_order_id: string | null = null;
    const po_number = purchase_order.po_number || header.document_number || '';
    const po_issue_date = purchase_order.issue_date || header.document_date || '';
    const selectedLines = lines.filter((l) => l && l.selected);

    // R7 — earliest non-null supplier_delivery_date across selected lines.
    const earliestDelivery = selectedLines
      .map((l) => l.supplier_delivery_date)
      .filter(Boolean)
      .sort()[0] || '';
    const expected_delivery_date = purchase_order.expected_delivery_date || earliestDelivery || '';

    // R8 — payment_schedule as edited + verbatim payment_terms.
    const payment_schedule = Array.isArray(purchase_order.payment_schedule) ? purchase_order.payment_schedule : [];

    // items[] from selected lines
    const poItems = selectedLines.map((li) => ({
      line_no: li.line_no ?? undefined,
      description: li.description || '',
      quantity: Number(li.qty) || 0,
      unit: li.uom || '',
      unit_price: Number(li.unit_price) || 0,
      net_amount: Number(li.net_amount) || 0,
      part_number: li.part_number || '',
      erp_item_code: li.erp_item_code || '',
      bom_item_id: li.bom_item_id || undefined,
      supplier_delivery_date: li.supplier_delivery_date || '',
      quoted_unit_price: li.quoted_unit_price ?? undefined,
      price_variance_pct: li.price_variance_pct ?? undefined,
    }));

    const lineNetSum = poItems.reduce((s, it) => s + (Number(it.net_amount) || 0), 0);
    const poAmount = Number(purchase_order.amount) || lineNetSum || 0;
    const subtotal_net = poAmount;

    const poData = {
      project_id,
      vendor_id: vendor_id || undefined,
      vendor_name,
      po_number,
      description: purchase_order.description || '',
      type: purchase_order.type || 'equipment',
      status: purchase_order.status || 'issued',
      priority: purchase_order.priority || 'medium',
      amount: poAmount,
      currency: purchase_order.currency || header.currency || 'SAR',
      issue_date: po_issue_date,
      expected_delivery_date,
      delivery_location: purchase_order.delivery_location || '',
      payment_terms: purchase_order.payment_terms || '',
      payment_schedule,
      incoterm: purchase_order.incoterm || '',
      mode_of_shipping: purchase_order.mode_of_shipping || '',
      warehouse_code: purchase_order.warehouse_code || '',
      supplier_ref: purchase_order.supplier_ref || '',
      pr_number: purchase_order.pr_number || '',
      purchaser: purchase_order.purchaser || '',
      requested_by: purchase_order.requested_by || '',
      subtotal_net,
      items: poItems,
      source_document_id: document_id || undefined,
      extraction_id,
      notes: purchase_order.notes || '',
    };

    if (po_action !== 'skip' && isPO) {
      // R5 — find existing PO by project_id + po_number
      let existingPO: any = null;
      if (po_number) {
        try {
          existingPO = (await base44.asServiceRole.entities.PurchaseOrder.filter({ project_id, po_number }, '-created_date', 1))[0];
        } catch (_) {}
      }
      if (existingPO) {
        if (po_action === 'create') {
          warnings.push(`PO ${po_number} already exists on this project — updated in place instead of creating a duplicate.`);
        }
        // Replace items[] wholesale (re-extracting a corrected doc converges).
        const before = cleanObj({
          vendor_id: existingPO.vendor_id, vendor_name: existingPO.vendor_name, amount: existingPO.amount,
          subtotal_net: existingPO.subtotal_net, status: existingPO.status, expected_delivery_date: existingPO.expected_delivery_date,
          payment_schedule: existingPO.payment_schedule, items: existingPO.items, expense_id: existingPO.expense_id,
        });
        const updated = await base44.asServiceRole.entities.PurchaseOrder.update(existingPO.id, poData);
        purchase_order_id = existingPO.id;
        refs.push({ entity_type: 'PurchaseOrder', entity_id: existingPO.id, action: 'updated', before, applied_updated_date: updated?.updated_date });
      } else {
        const created = await base44.asServiceRole.entities.PurchaseOrder.create(poData);
        purchase_order_id = created.id;
        refs.push({ entity_type: 'PurchaseOrder', entity_id: created.id, action: 'created', before: {}, applied_updated_date: created?.updated_date });
      }
    } else if (po_action === 'skip' && isPO) {
      // resolve from duplicates if present
      purchase_order_id = payload.duplicates?.purchase_order_id || null;
    }

    // ── 3. BOM LINES (only selected) ───────────────────────────────────────────
    const processLine = async (li: any) => {
      const bom_item_id = li.bom_item_id;
      const createNew = li.create_new_bom || li._create;

      if (createNew) {
        // create a BOMItem, then treat as matched
        const created = await base44.asServiceRole.entities.BOMItem.create({
          project_id,
          description: li.description || '',
          erp_item_code: li.erp_item_code || '',
          manufacturer_part_number: li.part_number || '',
          quantity: Number(li.qty) || 0,
          unit: li.uom || 'pcs',
          category: 'other',
          ordered_qty: Number(li.qty) || 0,
          po_unit_price: Number(li.unit_price) || 0,
          po_line_net_amount: Number(li.net_amount) || 0,
          po_currency: purchase_order.currency || header.currency || 'SAR',
          actual_cost_price: Number(li.unit_price) || 0,
          po_number,
          po_date: po_issue_date,
          purchase_order_id: purchase_order_id || undefined,
          expected_delivery_date: li.supplier_delivery_date || expected_delivery_date || '',
          order_status: 'ordered',
          ordered: true,
          material_status: 'ordered',
        });
        await base44.asServiceRole.entities.AuditLog.create({
          project_id,
          entity_type: 'BOMItem',
          entity_id: created.id,
          action: 'updated',
          actor,
          summary: `Created & marked ordered per ${po_number}`,
          metadata: { source_document: po_number, match_tier: li.match_tier || 'none', unit_price: Number(li.unit_price) || 0, ordered_qty: Number(li.qty) || 0 },
        });
        refs.push({ entity_type: 'BOMItem', entity_id: created.id, action: 'created', before: {}, applied_updated_date: created?.updated_date });
        return { bom: created, bomId: created.id, li, appliedStatus: 'Ordered' };
      }

      if (!bom_item_id) {
        throw new Error(`Line ${li.line_no ?? '?'}: no BOM target and create_new_bom not set`);
      }

      const bom: any = await base44.asServiceRole.entities.BOMItem.get(bom_item_id);
      if (!bom) throw new Error(`BOM item ${bom_item_id} not found`);

      // R9 before snapshot — only the fields this apply changes (incl. actual_cost_price).
      // Explicit defaults (0 / '' / false) so JSON keeps every key and revert can
      // restore po_number, ordered_qty, material_status etc. to pre-apply values
      // even when they were absent before the apply.
      const before = {
        actual_cost_price: Number(bom.actual_cost_price) || 0,
        ordered_qty: bom.ordered_qty != null ? Number(bom.ordered_qty) : 0,
        po_unit_price: bom.po_unit_price != null ? Number(bom.po_unit_price) : 0,
        po_line_net_amount: bom.po_line_net_amount != null ? Number(bom.po_line_net_amount) : 0,
        po_currency: bom.po_currency || '',
        po_number: bom.po_number || '',
        po_date: bom.po_date || '',
        purchase_order_id: bom.purchase_order_id || '',
        expected_delivery_date: bom.expected_delivery_date || '',
        erp_item_code: bom.erp_item_code || '',
        material_status: bom.material_status || 'not_ordered',
        order_status: bom.order_status || 'not_ordered',
        ordered: !!bom.ordered,
      };

      const update: any = {
        ordered_qty: Number(li.qty) || 0,
        po_unit_price: Number(li.unit_price) || 0,
        po_line_net_amount: Number(li.net_amount) || 0,
        po_currency: purchase_order.currency || header.currency || 'SAR',
        actual_cost_price: Number(li.unit_price) || 0,
        po_number,
        po_date: po_issue_date,
        purchase_order_id: purchase_order_id || undefined,
      };
      // erp_item_code only when currently empty
      if (!bom.erp_item_code && li.erp_item_code) update.erp_item_code = li.erp_item_code;
      // expected_delivery_date when currently empty or earlier than the document date
      if (li.supplier_delivery_date) {
        if (!bom.expected_delivery_date || bom.expected_delivery_date < po_issue_date) {
          update.expected_delivery_date = li.supplier_delivery_date;
        }
      }

      // Material-status transition (PO) — never downgrade received/delivered.
      let appliedStatus = '';
      if (isPO) {
        const curStatus = deriveMaterialStatus(bom);
        if (curStatus !== 'received' && curStatus !== 'delivered') {
          update.order_status = 'ordered';
          update.ordered = true;
          update.material_status = 'ordered';
          appliedStatus = 'Ordered';
        } else {
          appliedStatus = curStatus === 'received' ? 'Already Received' : 'Already Delivered';
        }
      }

      const updated = await base44.asServiceRole.entities.BOMItem.update(bom_item_id, update);
      await base44.asServiceRole.entities.AuditLog.create({
        project_id,
        entity_type: 'BOMItem',
        entity_id: bom_item_id,
        action: 'updated',
        actor,
        summary: `Marked ordered per ${po_number}`,
        metadata: { source_document: po_number, match_tier: li.match_tier || 'none', unit_price: Number(li.unit_price) || 0, ordered_qty: Number(li.qty) || 0 },
      });
      refs.push({ entity_type: 'BOMItem', entity_id: bom_item_id, action: 'updated', before, applied_updated_date: updated?.updated_date });
      return { bom: updated || bom, bomId: bom_item_id, li, appliedStatus };
    };

    const lineResults = await Promise.allSettled(selectedLines.map(processLine));
    const bom_updated: any[] = [];
    const bom_failed: any[] = [];
    for (let i = 0; i < lineResults.length; i++) {
      const r: any = lineResults[i];
      if (r.status === 'fulfilled') {
        bom_updated.push(r.value);
      } else {
        bom_failed.push({ line_no: selectedLines[i]?.line_no, error: r.reason?.message || String(r.reason) });
      }
    }

    // ── 4. EXPENSE (R5) ─────────────────────────────────────────────────────────
    let expense_id: string | null = null;
    if (expense_action !== 'skip') {
      const expenseData = cleanObj({
        project_id,
        description: expense.description || '',
        category: expense.category || 'material',
        status: expense.status || 'committed',
        vendor: vendor_name,
        reference_number: expense.reference_number || po_number,
        planned_date: expense.planned_date || po_issue_date,
        planned_amount: Number(expense.planned_amount) || poAmount,
        purchase_order_id: purchase_order_id || undefined,
        source_document_id: document_id || undefined,
        notes: expense.notes || '',
      });
      const refNum = expenseData.reference_number;
      let existingExp: any = null;
      if (refNum) {
        try {
          existingExp = (await base44.asServiceRole.entities.Expense.filter({ project_id, reference_number: refNum }, '-created_date', 1))[0];
        } catch (_) {}
      }
      if (existingExp) {
        if (expense_action === 'create') {
          warnings.push(`Expense ${refNum} already exists — updated in place instead of creating a duplicate.`);
        }
        const before = cleanObj({
          description: existingExp.description, category: existingExp.category, status: existingExp.status,
          vendor: existingExp.vendor, reference_number: existingExp.reference_number, planned_date: existingExp.planned_date,
          planned_amount: existingExp.planned_amount, purchase_order_id: existingExp.purchase_order_id,
        });
        const updated = await base44.asServiceRole.entities.Expense.update(existingExp.id, expenseData);
        expense_id = existingExp.id;
        refs.push({ entity_type: 'Expense', entity_id: existingExp.id, action: 'updated', before, applied_updated_date: updated?.updated_date });
      } else {
        const created = await base44.asServiceRole.entities.Expense.create(expenseData);
        expense_id = created.id;
        refs.push({ entity_type: 'Expense', entity_id: created.id, action: 'created', before: {}, applied_updated_date: created?.updated_date });
      }
      // Patch the PO's expense_id
      if (purchase_order_id && expense_id) {
        try {
          await base44.asServiceRole.entities.PurchaseOrder.update(purchase_order_id, { expense_id });
        } catch (_) {}
      }
    } else if (payload.duplicates?.expense_id) {
      expense_id = payload.duplicates.expense_id;
    }

    // ── 5. LEARNING — PartAlias upsert for tail/contains/description & user-reassigned
    for (const r of bom_updated) {
      const li = r.li;
      const bom = r.bom;
      const bomId = r.bomId;
      const tier = li.match_tier || 'none';
      const reassigned = li.user_reassigned === true;
      if (!LEARN_TIERS.has(tier) && !reassigned) continue;
      const norm = normalizeCode(stripErpPrefix(li.part_number || bom?.manufacturer_part_number || ''));
      if (!norm || !bomId) continue;
      try {
        const existing = await base44.asServiceRole.entities.PartAlias.filter({ normalized_code: norm, bom_item_id: bomId }, '-created_date', 1);
        if (existing && existing.length) {
          await base44.asServiceRole.entities.PartAlias.update(existing[0].id, {
            hit_count: (Number(existing[0].hit_count) || 1) + 1,
            last_used: now,
          });
        } else {
          await base44.asServiceRole.entities.PartAlias.create({
            project_id,
            normalized_code: norm,
            raw_code: li.part_number || '',
            erp_item_code: li.erp_item_code || bom?.erp_item_code || '',
            bom_item_id: bomId,
            manufacturer_part_number: bom?.manufacturer_part_number || '',
            description_sample: li.description || '',
            source: 'user_confirmed',
            hit_count: 1,
            last_used: now,
          });
        }
        // Append normalized code to the BOM row's match_aliases[] if absent.
        const aliases = Array.isArray(bom?.match_aliases) ? bom.match_aliases : [];
        if (!aliases.includes(norm)) {
          await base44.asServiceRole.entities.BOMItem.update(bomId, { match_aliases: [...aliases, norm] });
        }
      } catch (_) {}
    }

    // ── 6. SUMMARY NOTE ─────────────────────────────────────────────────────────
    const noteRows = bom_updated.map((r) => {
      const li = r.li;
      return {
        bom_item_id: r.bomId,
        bom_description: r.bom?.description || '',
        part_number: li.part_number || '',
        erp_item_code: li.erp_item_code || '',
        description: li.description || '',
        qty: Number(li.qty) || 0,
        unit_price: Number(li.unit_price) || 0,
        net_amount: Number(li.net_amount) || 0,
        quoted_unit_price: li.quoted_unit_price ?? undefined,
        price_variance_pct: li.price_variance_pct ?? undefined,
        matched: !!r.bomId,
        match_confidence: li.match_confidence ?? undefined,
        match_tier: li.match_tier || undefined,
        applied_status: r.appliedStatus || '',
        ocr_uncertain: !!li.ocr_uncertain,
        ordered_qty: Number(li.qty) || 0,
        action: r.appliedStatus || '',
      };
    });

    const note = await base44.asServiceRole.entities.Note.create({
      project_id,
      author: actor,
      body: `${isPO ? 'PO' : 'DN'} ${po_number} — ${bom_updated.length} line(s) applied`,
      note_type: isPO ? 'po_summary' : 'dn_summary',
      table_data: {
        document_type: isPO ? 'po' : 'dn',
        document_number: po_number,
        document_date: po_issue_date,
        vendor_name,
        extraction_id,
        rows: noteRows,
      },
    });
    refs.push({ entity_type: 'Note', entity_id: note.id, action: 'created', before: {}, applied_updated_date: note?.updated_date });

    // ── 7. R9 — close the extraction ─────────────────────────────────────────────
    await base44.asServiceRole.entities.Extraction.update(extraction_id, {
      status: 'completed',
      applied_at: now,
      applied_by: actor,
      created_entity_refs: refs,
    });

    return Response.json({
      extraction_id,
      note_id: note.id,
      vendor_id,
      purchase_order_id,
      expense_id,
      bom_updated: bom_updated.length,
      bom_failed,
      warnings,
    });
  } catch (error) {
    return Response.json({ error: (error as any)?.message || 'Apply failed' }, { status: 500 });
  }
});