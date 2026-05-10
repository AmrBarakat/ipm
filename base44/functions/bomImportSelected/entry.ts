import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : fallback;
}

function toDateOrUndefined(value) {
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined;
}

function mapPreviewItemToBOMItem(item, projectId, documentId) {
  const qty = toNumber(item.qty, 1);
  const unitCost = toNumber(item.unit_cost_sar ?? item.planned_cost_price ?? item.cost_price, 0);
  const unitSelling = toNumber(item.unit_selling_sar ?? item.selling_price, 0);

  return {
    project_id: projectId,
    source_document_id: documentId || '',
    item_code: item.part_no || item.item_code || '',
    description: item.description || item.part_no || 'Imported BOM item',
    category: item.category || 'other',
    manufacturer: item.manufacturer || item.vendor || '',
    manufacturer_part_number: item.part_no || '',
    supplier: item.supplier || item.vendor || '',
    quantity: qty,
    stock_qty: toNumber(item.stock_qty, 0),
    unit: item.unit || 'pcs',
    planned_cost_price: unitCost,
    actual_cost_price: toNumber(item.actual_cost_price, unitCost),
    cost_price: unitCost,
    selling_price: unitSelling,
    currency: 'SAR',
    stock_status: toNumber(item.stock_qty, 0) > 0 ? 'stock' : 'non_stock',
    order_status: 'not_ordered',
    ordered: false,
    delivery_status: 'pending',
    expected_delivery_date: toDateOrUndefined(item.expected_delivery_date),
    notes: [
      item.section ? `Section: ${item.section}` : '',
      item.notes || '',
      item.review_notes ? `Review note: ${item.review_notes}` : '',
      item.confidence_score !== undefined ? `Confidence: ${item.confidence_score}%` : '',
    ].filter(Boolean).join(' | '),
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { project_id, document_id, selected_items } = await req.json();
    if (!project_id || !Array.isArray(selected_items)) {
      return Response.json({ error: 'project_id and selected_items are required' }, { status: 400 });
    }

    const rows = selected_items
      .filter(item => item && (item.description || item.part_no || item.item_code))
      .map(item => mapPreviewItemToBOMItem(item, project_id, document_id));

    if (!rows.length) {
      return Response.json({ created: 0, items: [] });
    }

    const created = await base44.asServiceRole.entities.BOMItem.bulkCreate(rows);

    if (document_id) {
      await base44.asServiceRole.entities.Document.update(document_id, {
        bom_extraction_status: 'completed',
        bom_items_created: created.length,
        bom_extracted_at: new Date().toISOString(),
        bom_extraction_error: '',
      });
    }

    return Response.json({ created: created.length, items: created });
  } catch (error) {
    return Response.json({ error: error?.message || 'BOM import failed' }, { status: 500 });
  }
});