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

// Detect panel sections in raw CSV text and pre-aggregate them before sending to LLM.
// A "Panel" header = a line that contains "panel" (case-insensitive) but does NOT start with a number.
// Its items = all consecutive lines that start with a serial number (digits), until the next non-serial line.
function preAggregatePanels(text) {
  const lines = text.split('\n');
  const panelGroups = {}; // sectionName -> [ ...item lines ]
  let currentPanel = null;

  // Regex: line starts with optional whitespace then 1+ digits (serial number)
  const SERIAL_LINE = /^\s*\d+[\s,]/;
  const PANEL_HEADER = /panel/i;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const isSerial = SERIAL_LINE.test(trimmed);

    if (!isSerial && PANEL_HEADER.test(trimmed)) {
      // This is a new Panel header
      currentPanel = trimmed;
      if (!panelGroups[currentPanel]) panelGroups[currentPanel] = [];
    } else if (!isSerial) {
      // A non-serial, non-panel line ends any active panel group
      currentPanel = null;
    } else if (isSerial && currentPanel) {
      // Serial item inside a panel section
      panelGroups[currentPanel].push(trimmed);
    }
  }

  return panelGroups; // { "Panel Name": ["1, desc, ...", "2, desc, ..."], ... }
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

    // Step 1: Pre-aggregate Panel sections directly from raw text structure
    // (no LLM needed for these — structure is deterministic)
    const panelGroups = preAggregatePanels(plain_text);
    const panelPreviewItems = [];

    // Build a set of line prefixes to exclude from LLM batches
    const panelLineSet = new Set();
    Object.entries(panelGroups).forEach(([sectionName, itemLines]) => {
      panelLineSet.add(sectionName);
      itemLines.forEach(l => panelLineSet.add(l));

      // Parse each item line: try to extract numbers from CSV fields
      // Format expected: serial, description, ..., unit_cost, total_cost, unit_sell, total_sell
      const members = itemLines.map(line => {
        const cols = line.split(',').map(c => c.trim());
        // serial is cols[0], description is cols[1]
        const description = cleanText(cols[1] || cols[0] || '');
        const qty = toNumber(cols[2], 1) || 1;
        // Try to find cost/selling from later columns
        const nums = cols.slice(3).map(c => toNumber(c, null)).filter(n => n !== null && n > 0);
        const unitCost = nums[0] ?? null;
        const totalCost = nums[1] ?? (unitCost != null ? unitCost * qty : null);
        const unitSell = nums[2] ?? null;
        const totalSell = nums[3] ?? (unitSell != null ? unitSell * qty : null);
        return { description, qty, unit_cost_sar: unitCost, total_cost_sar: totalCost, unit_selling_sar: unitSell, total_selling_sar: totalSell };
      });

      const totalCostAgg = members.reduce((s, i) => s + (i.total_cost_sar ?? 0), 0);
      const totalSellAgg = members.reduce((s, i) => s + (i.total_selling_sar ?? 0), 0);
      const grossProfitAgg = totalSellAgg > 0 ? totalSellAgg - totalCostAgg : null;
      const marginPctAgg = (grossProfitAgg != null && totalSellAgg > 0) ? grossProfitAgg / totalSellAgg : null;
      const subItemNotes = members.map(i => `${i.description}${i.qty > 1 ? ` (×${i.qty})` : ''}`).join('; ');

      panelPreviewItems.push({
        preview_id: `panel_agg_${sectionName.replace(/\s+/g, '_').slice(0, 40)}`,
        part_no: '',
        description: sectionName,
        category: 'panel',
        manufacturer: '',
        supplier: '',
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

    // Step 2: Strip panel lines from text before sending to LLM, then batch-process remaining
    const strippedText = plain_text
      .split('\n')
      .filter(line => !panelLineSet.has(line.trim()))
      .join('\n');

    const chunks = splitIntoChunks(strippedText, 10000);

    const batchResults = await Promise.all(
      chunks.map((chunkText, idx) =>
        base44.asServiceRole.integrations.Core.InvokeLLM({
          model: 'gpt_5_4',
          prompt: PROMPT_TEMPLATE(idx, chunks.length, file_name, chunkText),
          response_json_schema: ITEM_SCHEMA,
        }).then(r => (r?.response || r)?.items || [])
         .catch(() => [])
      )
    );

    const rawItems = batchResults.flat();
    const sheetName = '';

    // Normalize non-panel items
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

    // Deduplicate: aggregate items with same part_no + description by summing qty and total costs
    const dedupMap = new Map();
    for (const item of normalizedItems) {
      const key = `${item.part_no.toLowerCase().trim()}||${item.description.toLowerCase().trim()}`;
      if (dedupMap.has(key)) {
        const existing = dedupMap.get(key);
        const newQty = existing.qty + item.qty;
        const newTotalCost = (existing.total_cost_sar ?? 0) + (item.total_cost_sar ?? 0) || null;
        const newTotalSell = (existing.total_selling_sar ?? 0) + (item.total_selling_sar ?? 0) || null;
        const grossProfit = (newTotalSell != null && newTotalCost != null) ? newTotalSell - newTotalCost : null;
        const marginPct = (grossProfit != null && newTotalSell > 0) ? grossProfit / newTotalSell : null;
        dedupMap.set(key, {
          ...existing,
          qty: newQty,
          total_cost_sar: newTotalCost,
          total_selling_sar: newTotalSell,
          gross_profit: grossProfit,
          margin_pct: marginPct,
        });
      } else {
        dedupMap.set(key, item);
      }
    }
    const deduplicatedItems = [...dedupMap.values()].map((item, index) => ({
      ...item,
      preview_id: `item_${index}`,
    }));

    // Merge: panel aggregates first, then deduplicated regular items
    const previewItems = [...panelPreviewItems, ...deduplicatedItems];

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