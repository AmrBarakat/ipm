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

// Normalize panel section names: collapse extra whitespace only.
// Keep location qualifiers (Outdoor, Indoor, etc.) so different panels stay separate.
function normalizePanelKey(rawName) {
  return rawName.replace(/\s+/g, ' ').trim();
}

// Detect panel sections in raw CSV text and pre-aggregate them before sending to LLM.
// A "Panel" header = a line that contains "panel" (case-insensitive) but does NOT start with a number.
// Its items = all consecutive lines that start with a serial number (digits), until the next non-serial line.
function preAggregatePanels(text, panelKeyword = 'Panel') {
  const lines = text.split('\n');
  const panelGroups = {}; // sectionName -> [ ...item lines ]
  let currentPanel = null;

  const SERIAL_LINE = /^\s*\d+[\s,]/;
  const PANEL_HEADER = new RegExp(panelKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const isSerial = SERIAL_LINE.test(trimmed);

    if (!isSerial && PANEL_HEADER.test(trimmed)) {
      // This is a new Panel header — normalize key to merge variants (e.g. Outdoor/Indoor)
      const normalizedKey = normalizePanelKey(trimmed);
      currentPanel = normalizedKey;
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

const PROMPT_TEMPLATE = (chunkIndex, totalChunks, fileName, chunkText, extraInstructions = '', columnHints = '') => `You are a BOM extraction engine for industrial automation projects.
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
${chunkText}${columnHints ? `\n\n## COLUMN HINTS:\n${columnHints}` : ''}${extraInstructions ? `\n\n## EXTRA INSTRUCTIONS:\n${extraInstructions}` : ''}`;

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
    // Auth check — tolerate public-app sessions where token may not be present
    let user;
    try { user = await base44.auth.me(); } catch (_) { user = null; }
    // Continue regardless — asServiceRole handles all data/integration access

    const { plain_text, project_id, document_id, file_name, template } = await req.json();
    if (!plain_text || !project_id) {
      return Response.json({ error: 'plain_text and project_id are required' }, { status: 400 });
    }

    // Apply template settings
    const tplPanelKeyword = template?.panel_keyword || 'Panel';
    const tplDefaultSupplier = template?.default_supplier || '';
    const tplDefaultCategory = template?.default_category || '';
    const tplAggregateDuplicates = template?.aggregate_duplicates !== false; // default true
    const tplExtraInstructions = template?.extra_instructions || '';
    const tplColumnMappings = template?.column_mappings || {};
    const tplCurrency = template?.default_currency || 'SAR';

    if (document_id) {
      await base44.asServiceRole.entities.Document.update(document_id, {
        bom_extraction_status: 'processing',
        bom_extraction_error: '',
      });
    }

    // Step 1: Pre-aggregate Panel sections directly from raw text structure
    const panelGroups = preAggregatePanels(plain_text, tplPanelKeyword);
    const panelPreviewItems = [];

    // Build a set of trimmed lines to exclude from LLM batches.
    // We must store the normalized section name AND every raw item line (already trimmed).
    // Also store the original raw lines from the source text to ensure the filter catches them.
    const panelLineSet = new Set();
    // First pass: collect all raw lines that belong to panels from the original text
    const rawLines = plain_text.split('\n');
    let _curPanel = null;
    const SERIAL_RE = /^\s*\d+[\s,]/;
    const PANEL_RE = new RegExp(tplPanelKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    for (const rawLine of rawLines) {
      const t = rawLine.trim();
      if (!t) continue;
      if (!SERIAL_RE.test(t) && PANEL_RE.test(t)) { _curPanel = t; panelLineSet.add(t); }
      else if (!SERIAL_RE.test(t)) { _curPanel = null; }
      else if (_curPanel) { panelLineSet.add(t); }
    }

    // Detect header row from plain_text to build a column-name → index map.
    // This makes parsing robust regardless of exact column order or count.
    const headerRow = plain_text.split('\n').find(l => {
      const u = l.toUpperCase();
      return (u.includes('DESCRIPTION') || u.includes('DESC')) && (u.includes('QTY') || u.includes('QUANTITY'));
    });
    const headerCols = headerRow ? headerRow.split(',').map(c => c.trim().toUpperCase()) : [];
    function hIdx(...candidates) {
      for (const c of candidates) {
        const i = headerCols.findIndex(h => h.includes(c.toUpperCase()));
        if (i >= 0) return i;
      }
      return -1;
    }
    // Column index lookups — fallback to known fixed indices if header not found
    const iDesc    = hIdx('DESCRIPTION', 'DESC')                          !== -1 ? hIdx('DESCRIPTION', 'DESC')                         : 1;
    const iQty     = hIdx('T.QTY', 'TQTY', 'TOTAL QTY', 'QTY', 'QUANTITY') !== -1 ? hIdx('T.QTY', 'TQTY', 'TOTAL QTY', 'QTY', 'QUANTITY') : 3;
    const iUCost   = hIdx('UNIT PRICE EQUIPMENT', 'UNIT COST', 'UNIT PRICE') !== -1 ? hIdx('UNIT PRICE EQUIPMENT', 'UNIT COST', 'UNIT PRICE') : 6;
    const iTCost   = hIdx('TOTAL EQUIPMENT', 'TOTAL COST', 'EXTENDED COST') !== -1 ? hIdx('TOTAL EQUIPMENT', 'TOTAL COST', 'EXTENDED COST') : 9;
    const iUSell   = hIdx('LIST PRICE SAR', 'LIST PRICE', 'UNIT SELLING', 'SELLING PRICE') !== -1 ? hIdx('LIST PRICE SAR', 'LIST PRICE', 'UNIT SELLING', 'SELLING PRICE') : 14;
    const iTSell   = hIdx('CUSTOMER TOTAL SAR', 'CUSTOMER TOTAL', 'TOTAL SELLING') !== -1 ? hIdx('CUSTOMER TOTAL SAR', 'CUSTOMER TOTAL', 'TOTAL SELLING') : 16;

    Object.entries(panelGroups).forEach(([sectionName, itemLines]) => {
      const members = itemLines.map(line => {
        const cols = line.split(',').map(c => c.trim());
        const description = cleanText(cols[iDesc] || cols[0] || '');
        const qty = toNumber(cols[iQty], null) || 1;

        const unitCost  = toNumber(cols[iUCost], null);
        const totalCost = toNumber(cols[iTCost], null) ?? (unitCost != null ? unitCost * qty : null);
        const unitSell  = toNumber(cols[iUSell], null);
        const totalSell = toNumber(cols[iTSell], null) ?? (unitSell != null ? unitSell * qty : null);

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
        child_items: members.map((m, idx) => ({
          child_id: `${sectionName.replace(/\s+/g,'_').slice(0,30)}_child_${idx}`,
          description: m.description,
          qty: m.qty,
          unit_cost_sar: m.unit_cost_sar,
          total_cost_sar: m.total_cost_sar,
          unit_selling_sar: m.unit_selling_sar,
          total_selling_sar: m.total_selling_sar,
        })),
      });
    });

    // Step 2: Strip panel lines from text before sending to LLM, then batch-process remaining
    const strippedText = plain_text
      .split('\n')
      .filter(line => !panelLineSet.has(line.trim()))
      .join('\n');

    const chunks = splitIntoChunks(strippedText, 10000);

    // Build column hints string from template
    const colHintsStr = Object.entries(tplColumnMappings)
      .filter(([, v]) => v && v.trim())
      .map(([k, v]) => `- ${k}: "${v}"`)
      .join('\n');

    const batchResults = await Promise.all(
      chunks.map((chunkText, idx) =>
        base44.asServiceRole.integrations.Core.InvokeLLM({
          model: 'gpt_5_4',
          prompt: PROMPT_TEMPLATE(idx, chunks.length, file_name, chunkText, tplExtraInstructions, colHintsStr),
          response_json_schema: ITEM_SCHEMA,
        }).then(r => {
            // SDK returns data directly (not wrapped in .response)
            const d = r?.items ? r : (r?.response ?? r);
            return Array.isArray(d?.items) ? d.items : [];
          })
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
        const rawSupplier = cleanText(row.supplier || '').replace(/^<UNKNOWN>$/i, '');
        const resolvedSupplier = (tplDefaultSupplier && !rawSupplier) ? tplDefaultSupplier : rawSupplier;
        const resolvedCategory = (() => {
          const cat = normalizeCategory(row.category, description);
          return (tplDefaultCategory && cat === 'other') ? tplDefaultCategory : cat;
        })();
        return {
          preview_id: `item_${index}`,
          part_no: cleanText(row.part_no || ''),
          description,
          category: resolvedCategory,
          manufacturer: cleanText(row.manufacturer || '').replace(/^<UNKNOWN>$/i, ''),
          supplier: resolvedSupplier,
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
          currency: tplCurrency,
        };
      });

    // Deduplicate: aggregate items with same part_no + description (if enabled)
    if (!tplAggregateDuplicates) {
      const previewItems = [...panelPreviewItems, ...normalizedItems.map((item, i) => ({ ...item, preview_id: `item_${i}` }))];
      const autoSelected = previewItems.filter(i => !i.review_required).length;
      return Response.json({
        items: previewItems,
        summary: { total: previewItems.length, auto_selected: autoSelected, review_required: previewItems.length - autoSelected, sheet_name: sheetName, batches: chunks.length }
      });
    }

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