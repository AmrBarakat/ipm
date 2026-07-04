import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const cleaned = String(value).replace(/,/g, '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeCategory(value) {
  const allowed = [
    'plc',
    'hmi',
    'drive',
    'sensor',
    'meter',
    'panel',
    'cable',
    'network',
    'software',
    'service',
    'other',
  ];

  const normalized = String(value || '').toLowerCase().trim();
  return allowed.includes(normalized) ? normalized : 'other';
}

function normalizeDeliveryStatus(value) {
  const normalized = String(value || '').toLowerCase().trim();

  if (normalized.includes('received')) return 'delivered';
  if (normalized.includes('partial')) return 'partially_delivered';

  return 'not_delivered';
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { file_url, project_id } = await req.json();

    if (!file_url || !project_id) {
      return Response.json(
        { error: 'file_url and project_id are required' },
        { status: 400 }
      );
    }

    const extracted = await base44.asServiceRole.integrations.Core.ExtractDataFromUploadedFile({
      file_url,
      json_schema: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                item_code: { type: 'string' },
                description: { type: 'string' },
                category: { type: 'string' },
                manufacturer: { type: 'string' },
                manufacturer_part_number: { type: 'string' },
                supplier: { type: 'string' },
                quantity: { type: 'number' },
                stock_qty: { type: 'number' },
                unit: { type: 'string' },
                planned_cost_price: { type: 'number' },
                actual_cost_price: { type: 'number' },
                cost_price: { type: 'number' },
                selling_price: { type: 'number' },
                expected_delivery_date: { type: 'string' },
                notes: { type: 'string' }
              }
            }
          }
        }
      }
    });

    const items = extracted?.output?.items || [];

    const bomRows = items
      .filter((item) => item.description || item.item_code || item.manufacturer_part_number)
      .map((item) => ({
        project_id,

        item_code: item.item_code || '',
        description: item.description || item.item_code || 'Imported BOM item',
        category: normalizeCategory(item.category),

        manufacturer: item.manufacturer || '',
        manufacturer_part_number: item.manufacturer_part_number || '',
        supplier: item.supplier || '',

        quantity: toNumber(item.quantity, 1),
        stock_qty: toNumber(item.stock_qty, 0),
        unit: item.unit || 'pcs',

        planned_cost_price: toNumber(item.planned_cost_price),
        actual_cost_price: toNumber(item.actual_cost_price),
        cost_price: toNumber(item.cost_price || item.planned_cost_price),
        selling_price: toNumber(item.selling_price),

        currency: 'SAR',
        stock_status: toNumber(item.stock_qty, 0) > 0 ? 'stock' : 'non_stock',

        order_status: 'ordered',
        ordered: true,
        delivery_status: normalizeDeliveryStatus(item.delivery_status),

        expected_delivery_date: item.expected_delivery_date || undefined,
        notes: item.notes || ''
      }));

    if (!bomRows.length) {
      return Response.json({ created: 0, items: [] });
    }

    const created = await base44.asServiceRole.entities.BOMItem.bulkCreate(bomRows);

    return Response.json({
      created: created.length,
      items: created
    });
  } catch (error) {
    return Response.json(
      { error: error?.message || 'Failed to extract BOM' },
      { status: 500 }
    );
  }
});