import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CATEGORIES = ['plc','hmi','drive','sensor','meter','panel','cable','network','software','service','other'];

const SERVICE_KEYWORDS = ['ENGINEERING','COMMISSIONING','TESTING','INSTALLATION','ASS.HOUR','DELIVERY','DESIGN','PROGRAMMING','FAT','SAT','SERVICE','SERVICES','LABOR','LABOUR'];

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function toNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  let cleaned = String(value)
    .replace(/SAR|USD|EUR|AED/gi, '')
    .replace(/,/g, '')
    .replace(/\s+/g, '')
    .trim();
  if (/^\(.+\)$/.test(cleaned)) cleaned = `-${cleaned.slice(1, -1)}`;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeCategory(value, description) {
  const cat = cleanText(value).toLowerCase();
  const desc = description.toUpperCase();
  if (CATEGORIES.includes(cat)) return cat;
  if (SERVICE_KEYWORDS.some(k => desc.includes(k))) return 'service';
  if (desc.includes('PLC') || desc.includes('CPU') || desc.includes('I/O')) return 'plc';
  if (desc.includes('HMI') || desc.includes('TOUCH')) return 'hmi';
  if (desc.includes('DRIVE') || desc.includes('VFD')) return 'drive';
  if (desc.includes('SENSOR') || desc.includes('TRANSMITTER')) return 'sensor';
  if (desc.includes('PANEL') || desc.includes('CABINET')) return 'panel';
  if (desc.includes('CABLE')) return 'cable';
  if (desc.includes('SWITCH') || desc.includes('NETWORK')) return 'network';
  if (desc.includes('SCADA') || desc.includes('SOFTWARE')) return 'software';
  return 'other';
}

function computeConfidence(row) {
  let score = 50;
  if (row.part_no) score += 15;
  if (row.description) score += 15;
  if (row.qty && row.qty > 0) score += 10;
  if (row.section) score += 5;
  if (row.unit_cost_sar !== null || row.unit_selling_sar !== null) score += 10;
  if (row.review_notes?.length) score -= 10;
  return Math.max(0, Math.min(100, score));
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { file_url, project_id, document_id } = await req.json();
    if (!file_url || !project_id) {
      return Response.json({ error: 'file_url and project_id are required' }, { status: 400 });
    }

    // Check for unsupported file types
    const urlLower = file_url.toLowerCase().split('?')[0];
    const unsupported = ['.xlsm', '.xlsb', '.doc', '.docx', '.ppt', '.pptx'];
    const ext = urlLower.match(/\.[^.]+$/)?.[0] || '';
    if (unsupported.includes(ext)) {
      return Response.json({
        error: `File type "${ext}" is not supported. Please use PDF, Excel (.xlsx/.xls), or CSV.`
      }, { status: 400 });
    }

    // Mark document as processing
    if (document_id) {
      await base44.asServiceRole.entities.Document.update(document_id, {
        bom_extraction_status: 'processing',
        bom_extraction_error: '',
      });
    }

    // Step 1: Extract raw structured data from document using the platform extractor
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
                part_no:         { type: 'string' },
                description:     { type: 'string' },
                qty:             { type: 'number' },
                unit:            { type: 'string' },
                unit_cost_sar:   { type: 'number' },
                total_cost_sar:  { type: 'number' },
                unit_selling_sar:{ type: 'number' },
                total_selling_sar:{ type: 'number' },
                manufacturer:    { type: 'string' },
                supplier:        { type: 'string' },
                category:        { type: 'string' },
                section:         { type: 'string' },
                notes:           { type: 'string' },
                expected_delivery_date: { type: 'string' },
              }
            }
          },
          sheet_name: { type: 'string' },
          total_items: { type: 'number' },
        }
      }
    });

    const rawItems = extracted?.output?.items || [];

    if (!rawItems.length) {
      if (document_id) {
        await base44.asServiceRole.entities.Document.update(document_id, {
          bom_extraction_status: 'failed',
          bom_extraction_error: 'No items could be extracted from this document.',
        });
      }
      return Response.json({ items: [], summary: { total: 0, auto_selected: 0 } });
    }

    // Step 2: Normalize and enrich each row
    const previewItems = rawItems
      .filter(row => row.description || row.part_no)
      .map((row, index) => {
        const description = cleanText(row.description || row.part_no || '');
        const partNo = cleanText(row.part_no || '');
        const qty = toNumber(row.qty, 1);
        const unitCost = toNumber(row.unit_cost_sar, 0);
        const unitSelling = toNumber(row.unit_selling_sar, 0);
        const totalCost = toNumber(row.total_cost_sar, unitCost * qty);
        const confidence = computeConfidence({ ...row, description, part_no: partNo });

        return {
          preview_id: `item_${index}`,
          part_no: partNo,
          description,
          category: normalizeCategory(row.category, description),
          manufacturer: cleanText(row.manufacturer || ''),
          supplier: cleanText(row.supplier || ''),
          qty: qty,
          unit: row.unit || 'pcs',
          unit_cost_sar: unitCost,
          total_cost_sar: totalCost,
          unit_selling_sar: unitSelling,
          total_selling_sar: toNumber(row.total_selling_sar, unitSelling * qty),
          section: cleanText(row.section || ''),
          notes: cleanText(row.notes || ''),
          expected_delivery_date: row.expected_delivery_date || '',
          confidence_score: confidence,
          review_required: confidence < 60,
        };
      });

    const autoSelected = previewItems.filter(i => !i.review_required).length;

    return Response.json({
      items: previewItems,
      summary: {
        total: previewItems.length,
        auto_selected: autoSelected,
        review_required: previewItems.length - autoSelected,
        sheet_name: extracted?.output?.sheet_name || '',
      }
    });

  } catch (error) {
    return Response.json({ error: error?.message || 'Preview extraction failed' }, { status: 500 });
  }
});