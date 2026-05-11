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

// Split text into chunks at line boundaries, keeping sheet headers
function splitIntoChunks(text, chunkSize = 10000) {
  const lines = text.split('\n');
  const chunks = [];
  let current = '';
  let currentSheet = '';

  for (const line of lines) {
    // Track current sheet header so each chunk knows its context
    if (line.startsWith('=== SHEET:')) currentSheet = line;

    if (current.length + line.length > chunkSize && current.length > 0) {
      chunks.push(current.trim());
      // Start new chunk with sheet context
      current = currentSheet ? currentSheet + '\n' : '';
    }
    current += line + '\n';
  }
  if (current.trim().length > 0) chunks.push(current.trim());
  return chunks;
}

const PROMPT_TEMPLATE = (chunkIndex, totalChunks, fileName, chunkText) => `You are a BOM extraction engine for industrial automation projects.
This is chunk ${chunkIndex + 1} of ${totalChunks} from file: ${fileName || 'BOM document'}.
Extract EVERY BOM line item from this portion. Context carries over across chunks.

## INCLUDE:
- Rows with part number OR description + quantity + pricing
- Service rows (ENGINEERING, COMMISSIONING, INSTALLATION, FAT, SAT, LABOR, etc.)

## EXCLUDE:
- Section headers — use them to set the "section" field on items
- Summary rows (SUBTOTAL, GRAND TOTAL, TOTAL)
- Empty rows, page headers, notes with no data

## HEADER SYNONYMS:
- Part No: PART NO, P/N, ITEM CODE, MODEL, ARTICLE NO
- Description: DESCRIPTION, ITEM DESCRIPTION, MATERIAL DESCRIPTION
- Qty: QTY, QUANTITY, T.QTY
- Vendor: VENDOR, SUPPLIER, MAKE, MANUFACTURER
- Unit Cost: UNIT COST, UNIT PRICE, BUYING PRICE
- Total Cost: TOTAL COST, EXTENDED COST
- Unit Selling: LIST PRICE, UNIT SELLING, SELLING PRICE
- Total Selling: TOTAL SELLING, CUSTOMER TOTAL

## CATEGORIES:
plc, hmi, drive, sensor, meter, panel, cable, network, software, service, other

## NUMBERS: strip SAR/USD/EUR/AED, remove commas, null for missing values.

## CONTENT:
${chunkText}`;

const ITEM_SCHEMA = {
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
  }
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { plain_text, project_id, document_id, file_name } = await req.json();
    if (!plain_text || !project_id) {
      return Response.json({ error: 'plain_text and project_id are required' }, { status: 400 });
    }

    if (document_id) {
      await base44.asServiceRole.entities.Document.update(document_id, {
        bom_extraction_status: 'processing',
        bom_extraction_error: '',
      });
    }

    // Split into ~10k char chunks and process in parallel
    const chunks = splitIntoChunks(plain_text, 10000);

    const batchResults = await Promise.all(
      chunks.map((chunkText, idx) =>
        base44.asServiceRole.integrations.Core.InvokeLLM({
          model: 'gpt_5_4',
          prompt: PROMPT_TEMPLATE(idx, chunks.length, file_name, chunkText),
          response_json_schema: ITEM_SCHEMA,
        }).then(r => (r?.response || r)?.items || [])
         .catch(() => []) // if one batch fails, skip it rather than killing everything
      )
    );

    // Merge all batch results
    const rawItems = batchResults.flat();
    const sheetName = '';

    if (!rawItems.length) {
      return Response.json({
        items: [],
        summary: { total: 0, auto_selected: 0, review_required: 0, sheet_name: '' }
      });
    }

    // Normalize and enrich
    const normalizedItems = rawItems
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
          part_no: row.part_no, description, qty, unit_cost_sar: unitCost,
          section: row.section, review_notes: row.review_notes,
        });
        return {
          preview_id: `item_${index}`,
          part_no: cleanText(row.part_no || ''),
          description,
          category: normalizeCategory(row.category, description),
          manufacturer: cleanText(row.manufacturer || '').replace(/^<UNKNOWN>$/i, ''),
          supplier: cleanText(row.supplier || '').replace(/^<UNKNOWN>$/i, ''),
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

    // Panel aggregation: sections whose header contains "Panel"
    const PANEL_REGEX = /panel/i;
    const panelSections = new Set(
      normalizedItems.map(i => i.section).filter(s => s && PANEL_REGEX.test(s))
    );

    const previewItems = [];
    const consumedSections = new Set();

    panelSections.forEach(sectionName => {
      const members = normalizedItems.filter(i => i.section === sectionName);
      if (!members.length) return;
      consumedSections.add(sectionName);
      const totalCostAgg = members.reduce((s, i) => s + (i.total_cost_sar ?? 0), 0);
      const totalSellAgg = members.reduce((s, i) => s + (i.total_selling_sar ?? 0), 0);
      const grossProfitAgg = totalSellAgg > 0 ? totalSellAgg - totalCostAgg : null;
      const marginPctAgg = (grossProfitAgg != null && totalSellAgg > 0) ? grossProfitAgg / totalSellAgg : null;
      const subItemNotes = members.map(i => `${i.description}${i.qty > 1 ? ` (×${i.qty})` : ''}`).join('; ');
      previewItems.push({
        preview_id: `panel_agg_${sectionName.replace(/\s+/g, '_')}`,
        part_no: '',
        description: sectionName,
        category: 'panel',
        manufacturer: members[0]?.manufacturer || '',
        supplier: members[0]?.supplier || '',
        qty: 1,
        unit: 'set',
        unit_cost_sar: totalCostAgg || null,
        total_cost_sar: totalCostAgg || null,
        unit_selling_sar: totalSellAgg || null,
        total_selling_sar: totalSellAgg || null,
        gross_profit: grossProfitAgg,
        margin_pct: marginPctAgg,
        section: sectionName,
        notes: `Aggregated from ${members.length} item(s): ${subItemNotes}`,
        expected_delivery_date: '',
        review_notes: '',
        confidence_score: 85,
        review_required: false,
        is_panel_aggregate: true,
        panel_item_count: members.length,
      });
    });

    normalizedItems
      .filter(i => !consumedSections.has(i.section))
      .forEach(i => previewItems.push(i));

    const autoSelected = previewItems.filter(i => !i.review_required).length;

    return Response.json({
      items: previewItems,
      summary: {
        total: previewItems.length,
        auto_selected: autoSelected,
        review_required: previewItems.length - autoSelected,
        sheet_name: sheetName,
        batches: chunks.length,
      }
    });

  } catch (error) {
    return Response.json({ error: error?.message || 'Preview extraction failed' }, { status: 500 });
  }
});