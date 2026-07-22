import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp'];
const SHEET_EXTS = ['.xlsx', '.xls', '.csv', '.html', '.json'];

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

const BOM_ITEM_SCHEMA = {
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
};

/** Vision path: read a scanned/image-only BOM via InvokeLLM with file_urls. */
async function extractBomViaVision(base44, file_url) {
  const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
    model: 'claude_sonnet_4_6',
    file_urls: [file_url],
    prompt: `You are an expert at reading Bill of Materials (BOM) documents — spreadsheets, PDFs, and scanned images.

The document is attached as a file. Read it carefully, including any stamps, handwritten quantities, and table structure. Perform accurate OCR on all line items.

Extract EVERY line item in the BOM as an array of objects with these fields:
- item_code: string
- description: string
- category: string (one of: plc, hmi, drive, sensor, meter, panel, cable, network, software, service, other)
- manufacturer: string
- manufacturer_part_number: string
- supplier: string
- quantity: number
- stock_qty: number
- unit: string
- planned_cost_price: number (per-unit cost)
- actual_cost_price: number
- cost_price: number
- selling_price: number (per-unit selling price)
- expected_delivery_date: string YYYY-MM-DD
- notes: string

OCR ACCURACY RULES:
- Quantities may be handwritten or stamped over printed text; prefer the handwritten correction when both appear.
- If a quantity, date, or number is not clearly legible, omit it (return null) rather than guessing.
- For multi-page documents, extract line items from ALL pages and continue the same array.

Return a JSON object: { items: [...] }`,
    response_json_schema: BOM_ITEM_SCHEMA
  });

  return result?.items || [];
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

    const urlLower = file_url.toLowerCase().split('?')[0];
    const ext = urlLower.match(/\.[^.]+$/)?.[0] || '';
    const isImage = IMAGE_EXTS.includes(ext);
    const isSheet = SHEET_EXTS.includes(ext);
    // pdf or unknown → text-then-vision fallback

    let items = [];
    let extractionMethod = 'text';

    if (isImage) {
      // Images: skip text extraction, go straight to vision.
      items = await extractBomViaVision(base44, file_url);
      extractionMethod = 'vision';
    } else if (isSheet) {
      // Spreadsheets/CSV/HTML/JSON: text path only (exactly as before).
      const extracted = await base44.asServiceRole.integrations.Core.ExtractDataFromUploadedFile({
        file_url,
        json_schema: BOM_ITEM_SCHEMA
      });
      items = extracted?.output?.items || [];
      extractionMethod = 'text';
    } else {
      // PDF (or unknown): attempt text extraction, fall back to vision if it yields nothing or throws.
      try {
        const extracted = await base44.asServiceRole.integrations.Core.ExtractDataFromUploadedFile({
          file_url,
          json_schema: BOM_ITEM_SCHEMA
        });
        items = extracted?.output?.items || [];
      } catch (_e) {
        items = [];
      }
      if (!items.length) {
        items = await extractBomViaVision(base44, file_url);
        extractionMethod = 'vision';
      }
    }

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
      return Response.json({ created: 0, items: [], extraction_method: extractionMethod });
    }

    const created = await base44.asServiceRole.entities.BOMItem.bulkCreate(bomRows);

    return Response.json({
      created: created.length,
      items: created,
      extraction_method: extractionMethod
    });
  } catch (error) {
    return Response.json(
      { error: error?.message || 'Failed to extract BOM' },
      { status: 500 }
    );
  }
});