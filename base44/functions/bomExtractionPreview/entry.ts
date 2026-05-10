import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CATEGORIES = ['plc','hmi','drive','sensor','meter','panel','cable','network','software','service','other'];

const SERVICE_KEYWORDS = [
  'ENGINEERING','COMMISSIONING','TESTING','INSTALLATION','ASS.HOUR','DELIVERY',
  'DESIGN','PROGRAMMING','FAT','SAT','SERVICE','SERVICES','LABOR','LABOUR',
  'TRAINING','SUPPORT','MAINTENANCE','INSPECTION','SUPERVISION'
];

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
  if (cleaned.endsWith('%')) {
    const pct = Number(cleaned.slice(0, -1));
    return Number.isFinite(pct) ? pct / 100 : fallback;
  }
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeCategory(categoryHint, description) {
  const cat = cleanText(categoryHint).toLowerCase();
  const desc = (description || '').toUpperCase();
  if (CATEGORIES.includes(cat)) return cat;
  if (SERVICE_KEYWORDS.some(k => desc.includes(k))) return 'service';
  if (desc.includes('PLC') || desc.includes('CPU') || /\bI\/O\b/.test(desc) || desc.includes('CODESYS')) return 'plc';
  if (desc.includes('HMI') || desc.includes('TOUCH') || desc.includes('PANEL PC')) return 'hmi';
  if (desc.includes('DRIVE') || desc.includes('VFD') || desc.includes('INVERTER') || desc.includes('FREQUENCY')) return 'drive';
  if (desc.includes('SENSOR') || desc.includes('TRANSMITTER') || desc.includes('DETECTOR')) return 'sensor';
  if (desc.includes('METER') || desc.includes('ANALYSER') || desc.includes('ANALYZER')) return 'meter';
  if (desc.includes('PANEL') || desc.includes('CABINET') || desc.includes('ENCLOSURE') || desc.includes('MCC')) return 'panel';
  if (desc.includes('CABLE') || desc.includes('WIRE') || desc.includes('CONDUIT')) return 'cable';
  if (desc.includes('SWITCH') || desc.includes('NETWORK') || desc.includes('ETHERNET') || desc.includes('ROUTER') || desc.includes('MODEM')) return 'network';
  if (desc.includes('SCADA') || desc.includes('SOFTWARE') || desc.includes('LICENSE') || desc.includes('LICENCE')) return 'software';
  return 'other';
}

function computeConfidence(item) {
  let score = 40;
  if (item.part_no) score += 20;
  if (item.description && item.description.length > 5) score += 15;
  if (item.qty && item.qty > 0) score += 10;
  if (item.unit_cost_sar != null && item.unit_cost_sar > 0) score += 10;
  if (item.section) score += 5;
  if (item.review_notes && item.review_notes.length > 0) score -= 15;
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
    const ext = urlLower.match(/\.[^.]+$/)?.[0] || '';
    const unsupported = ['.doc', '.docx', '.ppt', '.pptx', '.xlsb'];
    if (unsupported.includes(ext)) {
      return Response.json({
        error: `File type "${ext}" is not supported. Please use PDF, Excel (.xlsx/.xls/.xlsm), or CSV.`
      }, { status: 400 });
    }

    // Mark document as processing
    if (document_id) {
      await base44.asServiceRole.entities.Document.update(document_id, {
        bom_extraction_status: 'processing',
        bom_extraction_error: '',
      });
    }

    // Step 1: Extract raw content from the file
    const extracted = await base44.asServiceRole.integrations.Core.ExtractDataFromUploadedFile({
      file_url,
      json_schema: {
        type: 'object',
        properties: {
          raw_text: { type: 'string', description: 'Full raw text and tabular content of the document, preserving all rows, columns, and numeric values' }
        }
      }
    });

    const rawContent = extracted?.output?.raw_text
      || (typeof extracted?.output === 'string' ? extracted.output : JSON.stringify(extracted?.output || ''));

    if (!rawContent || rawContent.trim().length < 30) {
      if (document_id) {
        await base44.asServiceRole.entities.Document.update(document_id, {
          bom_extraction_status: 'failed',
          bom_extraction_error: 'Could not read content from this file.',
        });
      }
      return Response.json({ items: [], summary: { total: 0, auto_selected: 0, review_required: 0 } });
    }

    // Step 2: Use LLM to extract structured BOM items following production-grade spec
    const llmResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
      model: 'claude_sonnet_4_6',
      prompt: `You are a production-grade BOM (Bill of Materials) extraction engine for industrial automation projects. 
Your task is to extract ALL BOM line items from the document content below.

## EXTRACTION RULES:

### What to INCLUDE as BOM items:
- Material rows: rows with a part number OR description + quantity + pricing
- Service rows: rows with service keywords (ENGINEERING, COMMISSIONING, TESTING, INSTALLATION, PROGRAMMING, FAT, SAT, DELIVERY, LABOR, DESIGN, etc.) + quantity/pricing
- Any row representing a purchasable or billable item

### What to EXCLUDE:
- Section headers (e.g. "PLC SECTION", "PANEL SECTION") — but USE them to set the "section" field on subsequent items
- Summary rows (SUBTOTAL, GRAND TOTAL, TOTAL PROJECT, REVENUE, PROFIT)
- Repeated page headers (PAGE, REVISION, PROJECT NAME, CUSTOMER, TITLE)
- Completely empty rows
- Notes or comment rows with no commercial data

### Header synonym mapping — recognize these as equivalent:
- Part Number: PART NO, PART NUMBER, P/N, ITEM CODE, MODEL, MODEL NUMBER, ARTICLE NO
- Description: DESCRIPTION, ITEM DESCRIPTION, DETAILS, MATERIAL DESCRIPTION
- Quantity: QTY, QUANTITY, T.QTY, TOTAL QTY
- Vendor/Manufacturer: VENDOR, SUPPLIER, MAKE, MANUFACTURER
- Unit Cost: UNIT COST, UNIT PRICE, UNIT PRICE EQUIPMENT SAR, BUYING PRICE
- Total Cost: TOTAL COST, TOTAL EQUIPMENT SAR, EXTENDED COST
- Unit Selling: LIST PRICE, NET PRICE, UNIT SELLING, CUSTOMER PRICE, SELLING PRICE
- Total Selling: TOTAL SELLING, TOTAL SALES, CUSTOMER TOTAL

### Category mapping:
- plc: PLC, CPU, I/O, CODESYS, RTU
- hmi: HMI, TOUCH, PANEL PC
- drive: DRIVE, VFD, INVERTER, FREQUENCY CONVERTER
- sensor: SENSOR, TRANSMITTER, DETECTOR
- meter: METER, ANALYSER, ANALYZER
- panel: PANEL, CABINET, ENCLOSURE, MCC
- cable: CABLE, WIRE, CONDUIT
- network: SWITCH, NETWORK, ETHERNET, ROUTER, MODEM
- software: SCADA, SOFTWARE, LICENSE, LICENCE
- service: ENGINEERING, COMMISSIONING, TESTING, INSTALLATION, PROGRAMMING, FAT, SAT, LABOR, DELIVERY, TRAINING
- other: anything else

### Numeric normalization:
- Strip currency symbols (SAR, USD, EUR, AED)
- Remove commas from numbers
- Convert (500) to -500
- Convert percentages to decimals (15% → 0.15)
- Blank/missing numeric values → use null

### Section inheritance:
- When you detect a section header row, use that section name for ALL subsequent items until the next section header
- Preserve hierarchy: section → subsection → item

### Profitability fields (compute if cost and selling are available):
- total_cost_sar = qty × unit_cost_sar
- total_selling_sar = qty × unit_selling_sar  
- gross_profit = total_selling_sar - total_cost_sar
- margin_pct = gross_profit / total_selling_sar (if total_selling_sar > 0)

## DOCUMENT CONTENT:
${rawContent.slice(0, 12000)}

## OUTPUT:
Return a JSON object with:
- items: array of all extracted BOM items (as many as exist in the document)
- sheet_name: name of the worksheet/sheet if detectable
- total_rows_scanned: how many rows were processed

Each item must have these fields:
- part_no: string (part number / model number, empty string if not found)
- description: string (required, non-empty)
- category: one of: plc, hmi, drive, sensor, meter, panel, cable, network, software, service, other
- manufacturer: string
- supplier: string
- qty: number (default 1)
- unit: string (pcs, m, set, lot, hr, etc.)
- unit_cost_sar: number or null
- total_cost_sar: number or null
- unit_selling_sar: number or null
- total_selling_sar: number or null
- gross_profit: number or null
- margin_pct: number or null
- section: string (section header this item belongs to)
- notes: string (any extra info)
- expected_delivery_date: string YYYY-MM-DD or empty string
- review_notes: string (reason this item needs review, empty if ok)`,
      response_json_schema: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                part_no: { type: 'string' },
                description: { type: 'string' },
                category: { type: 'string' },
                manufacturer: { type: 'string' },
                supplier: { type: 'string' },
                qty: { type: 'number' },
                unit: { type: 'string' },
                unit_cost_sar: { type: 'number' },
                total_cost_sar: { type: 'number' },
                unit_selling_sar: { type: 'number' },
                total_selling_sar: { type: 'number' },
                gross_profit: { type: 'number' },
                margin_pct: { type: 'number' },
                section: { type: 'string' },
                notes: { type: 'string' },
                expected_delivery_date: { type: 'string' },
                review_notes: { type: 'string' },
              }
            }
          },
          sheet_name: { type: 'string' },
          total_rows_scanned: { type: 'number' }
        }
      }
    });

    const rawItems = llmResult?.items || [];

    if (!rawItems.length) {
      if (document_id) {
        await base44.asServiceRole.entities.Document.update(document_id, {
          bom_extraction_status: 'failed',
          bom_extraction_error: 'No BOM items detected in this document.',
        });
      }
      return Response.json({
        items: [],
        summary: { total: 0, auto_selected: 0, review_required: 0, sheet_name: llmResult?.sheet_name || '' }
      });
    }

    // Step 3: Normalize and enrich each item
    const previewItems = rawItems
      .filter(row => row.description || row.part_no)
      .map((row, index) => {
        const description = cleanText(row.description || row.part_no || '');
        const qty = toNumber(row.qty, 1) || 1;
        const unitCost = toNumber(row.unit_cost_sar, null);
        const totalCost = toNumber(row.total_cost_sar, null) ?? (unitCost != null ? unitCost * qty : null);
        const unitSelling = toNumber(row.unit_selling_sar, null);
        const totalSelling = toNumber(row.total_selling_sar, null) ?? (unitSelling != null ? unitSelling * qty : null);
        const grossProfit = (totalSelling != null && totalCost != null) ? (totalSelling - totalCost) : null;
        const marginPct = (grossProfit != null && totalSelling && totalSelling > 0) ? grossProfit / totalSelling : null;

        const confidence = computeConfidence({
          part_no: row.part_no,
          description,
          qty,
          unit_cost_sar: unitCost,
          section: row.section,
          review_notes: row.review_notes,
        });

        return {
          preview_id: `item_${index}`,
          part_no: cleanText(row.part_no || ''),
          description,
          category: normalizeCategory(row.category, description),
          manufacturer: cleanText(row.manufacturer || ''),
          supplier: cleanText(row.supplier || ''),
          qty,
          unit: row.unit || 'pcs',
          unit_cost_sar: unitCost,
          total_cost_sar: totalCost,
          unit_selling_sar: unitSelling,
          total_selling_sar: totalSelling,
          gross_profit: grossProfit,
          margin_pct: marginPct,
          section: cleanText(row.section || ''),
          notes: cleanText(row.notes || ''),
          expected_delivery_date: row.expected_delivery_date || '',
          review_notes: cleanText(row.review_notes || ''),
          confidence_score: confidence,
          review_required: confidence < 60 || (row.review_notes && row.review_notes.length > 0),
        };
      });

    const autoSelected = previewItems.filter(i => !i.review_required).length;

    return Response.json({
      items: previewItems,
      summary: {
        total: previewItems.length,
        auto_selected: autoSelected,
        review_required: previewItems.length - autoSelected,
        sheet_name: llmResult?.sheet_name || '',
        rows_scanned: llmResult?.total_rows_scanned || 0,
      }
    });

  } catch (error) {
    if (req.body) {
      try {
        const { document_id } = await req.clone().json().catch(() => ({}));
        if (document_id) {
          const base44 = createClientFromRequest(req);
          await base44.asServiceRole.entities.Document.update(document_id, {
            bom_extraction_status: 'failed',
            bom_extraction_error: error?.message || 'Extraction failed',
          }).catch(() => {});
        }
      } catch (_) {}
    }
    return Response.json({ error: error?.message || 'Preview extraction failed' }, { status: 500 });
  }
});