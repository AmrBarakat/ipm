/**
 * BOM Import — converts selected preview items into BOMItem records
 * Spec: BOM_Base44_Complete_Specification_v2.md — Part K (schema) + Part O (workflow fields)
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : fallback;
}

function toDateOrUndefined(value) {
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  // Accept ISO date or mm/dd/yyyy
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(text)) {
    const [m, d, y] = text.split('/');
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return undefined;
}

// Map category values from new spec to BOMItem entity enum
function normalizeCategory(cat) {
  const MAP = {
    'drive_vfd':        'drive',
    'sensor_instrument':'sensor',
    'panel_enclosure':  'panel',
    'cable_wiring':     'cable',
    'network_comms':    'network',
    'software_license': 'software',
    'service_labor':    'service',
    'it_hardware':      'IT-HW',
    // pass-through
    'plc': 'plc', 'hmi': 'hmi', 'meter': 'meter', 'other': 'other',
    // legacy values already valid
    'drive': 'drive', 'sensor': 'sensor', 'panel': 'panel',
    'cable': 'cable', 'network': 'network', 'software': 'software',
    'service': 'service',
  };
  return MAP[cat] || 'other';
}

function normalizeOrderStatus(val) {
  const v = String(val || '').toLowerCase();
  if (v.includes('ordered') || v === 'ordered') return 'ordered';
  return 'not_ordered';
}

function normalizeDeliveryStatus(val) {
  const v = String(val || '').toLowerCase();
  if (v.includes('received') || v.includes('delivered')) return 'delivered';
  if (v.includes('partial')) return 'partially_delivered';
  return 'not_delivered';
}

function mapItemToBOMRecord(item, projectId, documentId) {
  const qty       = toNumber(item.qty, 1) || 1;
  const unitCost  = toNumber(item.planned_cost_unit ?? item.planned_cost_price ?? item.unit_cost_sar ?? item.cost_price, 0);
  const marginPct = item.margin != null ? toNumber(item.margin, 0) : (item.margin_pct != null ? toNumber(item.margin_pct, 0) : null);
  let unitSell    = toNumber(item.unit_sell ?? item.selling_price ?? item.unit_selling_sar, 0);
  // Source provides final cost & selling; only derive sell from cost×(1+margin) when missing.
  if ((!unitSell || unitSell === 0) && unitCost > 0 && marginPct != null) {
    unitSell = unitCost * (1 + marginPct);
  }
  const stockQty  = toNumber(item.stock ?? item.stock_qty, 0);

  const notesParts = [
    item.section ? `Section: ${item.section}` : '',
    item.worksheet ? `Sheet: ${item.worksheet}` : '',
    item.notes || '',
    item.review_notes ? `Review: ${item.review_notes}` : '',
    item.confidence_score != null ? `Confidence: ${item.confidence_score}%` : '',
  ].filter(Boolean);

  return {
    project_id:               projectId,
    source_document_id:       documentId || '',
    item_code:                item.part_no || item.item_code || '',
    description:              item.description || item.part_no || 'Imported BOM item',
    category:                 normalizeCategory(item.category),
    manufacturer:             item.manufacturer || '',
    manufacturer_part_number: item.part_no || item.manufacturer_part_number || '',
    supplier:                 item.supplier || '',
    quantity:                 qty,
    stock_qty:                stockQty,
    unit:                     item.unit || 'pcs',
    planned_cost_price:       unitCost,
    actual_cost_price:        unitCost,
    cost_price:               unitCost,
    selling_price:            unitSell,
    margin_pct:               marginPct != null ? marginPct : undefined,
    currency:                 item.currency || 'SAR',
    stock_status:             stockQty > 0 ? 'stock' : 'non_stock',
    order_status:             normalizeOrderStatus(item.order_status),
    ordered:                  normalizeOrderStatus(item.order_status) === 'ordered',
    delivery_status:          normalizeDeliveryStatus(item.delivery_status),
    expected_delivery_date:   toDateOrUndefined(item.expected_delivery_date),
    notes:                    notesParts.join(' | '),
    panel_allocations:        Array.isArray(item.panel_allocations) ? item.panel_allocations : [],
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

    const rows = [];

    for (const item of selected_items) {
      if (!item) continue;

      if (item.is_panel_aggregate) {
        // Panel aggregate: create one BOMItem for the panel summary
        if (item.description || item.part_no || item.item_code) {
          rows.push(mapItemToBOMRecord(item, project_id, document_id));
        }
        // Also create individual child BOMItems if children are attached
        if (Array.isArray(item.children) && item.children.length > 0) {
          for (const child of item.children) {
            if (!child || (!child.description && !child.part_no)) continue;
            rows.push(mapItemToBOMRecord({
              ...child,
              section: item.description || item.section,
              worksheet: item.worksheet || '',
              order_status: item.order_status,
              delivery_status: item.delivery_status,
              expected_delivery_date: item.expected_delivery_date,
              currency: item.currency || 'SAR',
            }, project_id, document_id));
          }
        }
      } else {
        if (item.description || item.part_no || item.item_code) {
          rows.push(mapItemToBOMRecord(item, project_id, document_id));
        }
      }
    }

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