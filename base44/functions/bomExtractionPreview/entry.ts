/**
 * BOM Extraction Preview — Production-Grade
 * Spec: BOM_Base44_Complete_Specification_v2.md (v2.0 — 2026-05-14)
 *
 * Architecture:
 *  1. Receive plain_text (CSV representation of the workbook from frontend XLSX parser)
 *  2. Run column header detection (dynamic resolver → static fallback)
 *  3. Classify every row: EMPTY | HEADER | SUMMARY | SECTION | SERVICE | MATERIAL | NOTES | UNKNOWN
 *  4. Pre-aggregate PANEL sections into single aggregate rows with children[]
 *  5. Deduplicate non-panel items by part_no + description (first-occurrence wins)
 *  6. Validate & score confidence per item
 *  7. Return BOMExtractionResponse envelope
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ─── Utility helpers ──────────────────────────────────────────────────────────

function cleanText(val) {
  return String(val ?? '').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
}

function toNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  let s = String(value)
    .replace(/SAR|USD|EUR|AED/gi, '')
    .replace(/,/g, '')
    .replace(/\s+/g, '')
    .trim();
  if (/^\([\d.]+\)$/.test(s)) s = '-' + s.slice(1, -1);
  if (s.endsWith('%')) {
    const p = Number(s.slice(0, -1));
    return Number.isFinite(p) ? p / 100 : fallback;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

// ─── B3. Header synonym map ───────────────────────────────────────────────────

const HEADER_SYNONYMS = {
  part_no:       ['PART NO','PART NUMBER','P/N','ITEM CODE','MODEL','MODEL NUMBER','ARTICLE NO'],
  description:   ['DESCRIPTION','ITEM DESCRIPTION','DETAILS','MATERIAL DESCRIPTION'],
  manufacturer:  ['BRAND','MANUFACTURER','MAKE','VENDOR EQUIPMENT'],
  supplier:      ['SUPPLIER'],
  vendor:        ['VENDOR','SUPPLIER','MAKE','MANUFACTURER'],
  qty:           ['QTY','QUANTITY','T.QTY','TOTAL QTY'],
  lead_time_days:    ['LEAD TIME','VENDOR LEAD TIME','DELIVERY DAYS','LEAD TIME CALENDAR DAYS'],
  total_lead_time:   ['TOTAL LEAD TIME','TOTAL DELIVERY DAYS'],
  warranty_years:    ['WARRANTY','WARRANTY YEARS','WARRANTY PERIOD'],
  unit_cost_sar:     ['UNIT PRICE EQUIPMENT SAR','UNIT COST','BUYING PRICE','UNIT PRICE'],
  total_cost_sar:    ['TOTAL EQUIPMENT SAR','TOTAL COST','EXTENDED COST'],
  unit_install_sar:  ['UNIT PRICE INSTALLATION SAR','UNIT INSTALL COST'],
  total_install_sar: ['TOTAL INSTALLATION','TOTAL INSTALL SAR'],
  list_price_usd:    ['LIST PRICE EQUIPMENT USD','LIST PRICE USD AND SAR'],
  unit_selling_sar:  ['LIST PRICE EQUIPMENT SAR','LIST PRICE SAR','NET PRICE','UNIT SELLING','CUSTOMER PRICE'],
  total_selling_sar: ['TOTAL SELLING','TOTAL SALES','CUSTOMER TOTAL'],
  material_markup:   ['MATERIALS MARKUP TO CUSTOMER','MATERIAL MARKUP'],
  install_markup:    ['INSTALLATION MARKUP TO CUSTOMER','INSTALL MARKUP'],
  discount_ehs_material: ['DISCOUNT TO EHS MATERIAL','MATERIAL DISCOUNT'],
  discount_ehs_install:  ['DISCOUNT TO EHS INSTALLATION','INSTALL DISCOUNT'],
  net_price_unit:    ['NET PRICE TL PER UNIT EQUIPMENT','NET PRICE UNIT'],
  transport_per_unit:['TRANSPORT AND CUSTOMS PER UNIT','TRANSPORT UNIT'],
  total_transport:   ['TOTAL TRANSPORT','TRANSPORT TOTAL'],
  cost_unit_price_sar:  ['COST UNIT PRICE EQUIPMENT SAR'],
  total_cost_equip_sar: ['TOTAL COST EQUIPMENT SAR','TOTAL COST USD'],
};

// B4. Static fallback column indices
const STATIC_COL = {
  part_no: 3, description: 4, manufacturer: 1, supplier: 30,
  qty: 6, lead_time_days: 7, total_lead_time: 8, warranty_years: 9,
  unit_cost_sar: 10, total_cost_sar: 11,
  unit_install_sar: 12, total_install_sar: 13,
  list_price_usd: 14, unit_selling_sar: 15,
  list_price_install_sar: 16, material_markup: 17, install_markup: 18,
  discount_ehs_material: 19, discount_ehs_install: 20,
  net_price_unit: 21, transport_per_unit: 22, total_transport: 23,
  cost_unit_price_sar: 24, total_cost_equip_sar: 25,
  cost_unit_install_usd: 26, total_cost_install_usd: 27,
  vendor_equipment: 28, install_company: 29,
};

// R1. Dynamic column resolver
function resolveColumnIndices(headerLine) {
  const cols = headerLine.split(',').map(c =>
    c.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase()
  );
  const resolved = {};
  for (const [field, synonyms] of Object.entries(HEADER_SYNONYMS)) {
    const idx = cols.findIndex(c => synonyms.some(s => c.includes(s)));
    if (idx !== -1) resolved[field] = idx;
  }
  return resolved; // merged with STATIC_COL as fallback in getCol()
}

function getCol(resolved, field) {
  return resolved[field] !== undefined ? resolved[field] : (STATIC_COL[field] ?? -1);
}

// ─── E1. Category auto-detection ─────────────────────────────────────────────

const CATEGORY_RULES = [
  ['plc',              /PLC|M580|M340|M221|MODICON|CPU|RTU|SAITEL|BMXP|BMEH|BMENOC|TM221|TM3|SAITEL HUE|BMEX/i],
  ['hmi',              /HMI|DISPLAY|TOUCH PANEL|HMIDT|HMIG|PANEL SERVER|PAS600/i],
  ['drive_vfd',        /VFD|DRIVE|INVERTER|ATV|VARIABLE FREQUENCY/i],
  ['sensor_instrument',/SENSOR|TRANSMITTER|PROBE|LEVEL|FLOW|PRESSURE|TEMPERATURE|INSTRUMENT/i],
  ['meter',            /METER|PM8000|APM|POWER QUALITY|SAITEL DR|ENERGY/i],
  ['panel_enclosure',  /PANEL|ENCLOSURE|CABINET|NSY|NSYSM|OUTDOOR PANEL|INDOOR PANEL|BOX|RACK/i],
  ['cable_wiring',     /CABLE|WIRE|FCW|TWDF|WIRING|CONDUIT|BMXFCW|TWDFCW|BMXFTW/i],
  ['network_comms',    /SWITCH|ETHERNET|COMMS|NOC|SFP|NETWORK|MOXA|FIBER|BMENOC|8-PORT/i],
  ['software_license', /SOFTWARE|LICENSE|LICENCE|PSCADA|SQL|PSA1|SCADA|EAM|REPORTING MODULE/i],
  ['service_labor',    /ENGINEERING|INSTALLATION|COMMISSIONING|DESIGN|LABOR|LABOUR|ASS\.HOUR|TESTING|FAT|SAT|DELIVERY/i],
  ['it_hardware',      /SERVER|WORKSTATION|UPS|MONITOR|PRINTER|KEYBOARD|MOUSE|\bPC\b|LAPTOP/i],
];

function autoDetectCategory(description, partNo) {
  const text = `${description || ''} ${partNo || ''}`.toUpperCase();
  for (const [cat, re] of CATEGORY_RULES) {
    if (re.test(text)) return cat;
  }
  return 'other';
}

// ─── C2. Section header detection keywords ────────────────────────────────────

const SECTION_KEYWORDS = /\b(PLC|MAIN PLC|RTU|PANEL|SCADA|SERVER|SWITCH|NETWORK|SOFTWARE|HARDWARE|CABINET|ENGINEERING|SERVICES|HMI|INSTRUMENTATION|METER|DRIVE|FIBER|UPS)\b/i;

// A4. Summary/exclusion row keywords
const SUMMARY_KEYWORDS = /^\s*(SUBTOTAL|GRAND TOTAL|TOTAL PROJECT|REVENUE|DIRECT COST|INDIRECT COST|PROFIT|TOTAL EQUIPMENT|TOTAL INSTALLATION|TOTAL COST|TOTAL SELLING|TOTAL|PAGE|REVISION|PROJECT NAME|CUSTOMER|DATE|TITLE|BOMIF)/i;

// Page-header patterns (repeated table headers)
const PAGE_HEADER_KEYWORDS = /^\s*(S\.?NO|PART NO|DESCRIPTION|BRAND|MANUFACTURER|QTY|TOTAL QTY|UNIT|ITEM|NO\.)/i;

// C5. Service row detection
const SERVICE_KEYWORDS_RE = /ENGINEERING|COMMISSIONING|TESTING|INSTALLATION|ASS\.HOUR|DELIVERY|DESIGN|PROGRAMMING|FAT|SAT|LABOR|LABOUR/i;

// C3. Panel section detection & normalization
function normalizePanelKey(rawName) {
  return rawName
    .replace(/\s+/g, ' ')
    .replace(/\s*(Outdoor|Indoor|External|Remote|Field)\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isPanelSection(name) {
  return /PANEL/i.test(name);
}

// ─── D4. Parse a single CSV row using resolved column indices ─────────────────

function parseItemRow(cols, resolved) {
  const c = (field) => {
    const idx = getCol(resolved, field);
    return (idx >= 0 && idx < cols.length) ? cols[idx] : '';
  };

  const partNo      = cleanText(c('part_no'));
  const description = cleanText(c('description') || c('part_no'));
  const manufacturer= cleanText(c('manufacturer'));
  const supplier    = cleanText(c('supplier') || c('vendor'));
  const qty         = toNumber(c('qty'), 1) || 1;

  // CRITICAL: Always use explicit column indices — never blind-scan
  const unitCost    = toNumber(c('unit_cost_sar'), null);
  const totalCostRaw= toNumber(c('total_cost_sar'), null);
  const totalCost   = totalCostRaw ?? (unitCost != null ? unitCost * qty : null);

  const unitSell    = toNumber(c('unit_selling_sar'), null)
                   ?? toNumber(c('list_price_usd'), null);
  const totalSell   = unitSell != null ? unitSell * qty : null;

  const leadTime      = toNumber(c('lead_time_days'), null);
  const totalLeadTime = toNumber(c('total_lead_time'), null);
  const warrantyYears = toNumber(c('warranty_years'), null);
  const materialMarkup= toNumber(c('material_markup'), null);
  const discountMat   = toNumber(c('discount_ehs_material'), null);
  const transportUnit = toNumber(c('transport_per_unit'), null);
  const costUnitSAR   = toNumber(c('cost_unit_price_sar'), null);
  const totalCostSAR  = toNumber(c('total_cost_equip_sar'), null);

  // Profitability — G1
  const grossProfit = (totalSell != null && totalCost != null) ? totalSell - totalCost : null;
  const marginPct   = (grossProfit != null && totalSell && totalSell > 0) ? grossProfit / totalSell : null;
  const markupPct   = (grossProfit != null && totalCost && totalCost > 0) ? grossProfit / totalCost : null;

  return {
    part_no: partNo, description, manufacturer, supplier, qty,
    unit_cost_sar: unitCost,
    total_cost_sar: totalCost,
    unit_selling_sar: unitSell,
    total_selling_sar: totalSell,
    gross_profit_sar: grossProfit,
    margin_pct: marginPct,
    markup_pct: markupPct,
    lead_time_days: leadTime,
    total_lead_time: totalLeadTime,
    warranty_years: warrantyYears,
    material_markup: materialMarkup,
    discount_ehs_material: discountMat,
    transport_per_unit: transportUnit,
    cost_unit_price_sar: costUnitSAR,
    total_cost_equip_sar: totalCostSAR,
  };
}

// ─── I2. Confidence scoring ───────────────────────────────────────────────────

function computeConfidence(item, hasHeaders) {
  let score = 40;
  if (hasHeaders) score += 10;
  if (item.part_no) score += 15;
  if (item.description && item.description.length > 4) score += 10;
  if (item.qty && item.qty > 0) score += 10;
  if (item.unit_cost_sar != null && item.unit_cost_sar > 0) score += 10;
  if (item.unit_selling_sar != null && item.unit_selling_sar > 0) score += 5;
  if (item.section) score += 5;
  if (item.review_notes && item.review_notes.length > 0) score -= 20;
  return Math.max(0, Math.min(100, score));
}

// ─── H2-H5. Validate a raw item and return review flags ──────────────────────

function validateItem(item) {
  const notes = [];
  if (!item.part_no) notes.push('NO_PART_NUMBER');
  if (!item.description) notes.push('MISSING_DESCRIPTION');
  if (!item.qty || item.qty <= 0) notes.push('ZERO_QUANTITY');
  if (item.unit_cost_sar == null && item.unit_selling_sar == null) notes.push('MISSING_PRICING');
  if (item.unit_selling_sar != null && item.unit_cost_sar != null && item.unit_selling_sar < item.unit_cost_sar) {
    notes.push('SELLING_BELOW_COST');
  }
  return notes;
}

// ─── F1. Panel pre-aggregation ────────────────────────────────────────────────

function buildPanelAggregate(normalizedKey, members, panelIdx) {
  const totalCostAgg = members.reduce((s, i) => s + (i.total_cost_sar ?? 0), 0);
  const totalSellAgg = members.reduce((s, i) => s + (i.total_selling_sar ?? 0), 0);
  const grossProfit  = totalSellAgg > 0 ? totalSellAgg - totalCostAgg : null;
  const marginPct    = (grossProfit != null && totalSellAgg > 0) ? grossProfit / totalSellAgg : null;
  const panelKey     = `panel_agg_${panelIdx}_${normalizedKey.replace(/\s+/g, '_').slice(0, 40)}`;

  const children = members.map((m, idx) => ({
    child_id:         `${panelKey}_child_${idx}`,
    part_no:          m.part_no || '',
    description:      m.description,
    category:         autoDetectCategory(m.description, m.part_no),
    manufacturer:     m.manufacturer || '',
    supplier:         m.supplier || '',
    qty:              m.qty,
    unit:             'pcs',
    unit_cost_sar:    m.unit_cost_sar,
    total_cost_sar:   m.total_cost_sar,
    unit_selling_sar: m.unit_selling_sar,
    total_selling_sar:m.total_selling_sar,
    gross_profit:     (m.total_selling_sar != null && m.total_cost_sar != null)
                        ? m.total_selling_sar - m.total_cost_sar : null,
    margin_pct:       null, // computed in UI
    parent_panel_id:  panelKey,
    section:          normalizedKey,
  }));

  return {
    preview_id:         panelKey,
    part_no:            '',
    description:        normalizedKey,
    category:           'panel_enclosure',
    manufacturer:       '',
    supplier:           '',
    qty:                1,
    unit:               'set',
    // Bug Fix: use > 0 guard (not || null)
    unit_cost_sar:      totalCostAgg > 0 ? totalCostAgg : null,
    total_cost_sar:     totalCostAgg > 0 ? totalCostAgg : null,
    unit_selling_sar:   totalSellAgg > 0 ? totalSellAgg : null,
    total_selling_sar:  totalSellAgg > 0 ? totalSellAgg : null,
    gross_profit_sar:   grossProfit,
    margin_pct:         marginPct,
    markup_pct:         (grossProfit != null && totalCostAgg > 0) ? grossProfit / totalCostAgg : null,
    section:            normalizedKey,
    notes:              `Aggregated from ${members.length} item(s)`,
    expected_delivery_date: '',
    order_status:       'Not Ordered',
    delivery_status:    'Pending',
    review_notes:       '',
    confidence_score:   85,
    review_required:    false,
    is_panel_aggregate: true,
    panel_item_count:   members.length,
    children,
    stock:              0,
    order_qty:          1,
    actual_cost_sar:    totalCostAgg > 0 ? totalCostAgg : null,
    worksheet:          '',
    source_row:         -1,
    lead_time_days:     null,
    warranty_years:     null,
  };
}

// ─── Main workbook parser ─────────────────────────────────────────────────────

function parseWorkbookText(plainText, tplPanelKeyword, tplDefaultSupplier, tplDefaultCategory) {
  const allLines = plainText.split('\n');
  const extractedItems  = [];  // non-panel material/service rows
  const panelGroups     = new Map(); // normalizedKey → { originalName, members[] }
  const panelOrder      = [];  // preserve insertion order for panel keys

  let currentSection    = '';
  let currentWorksheet  = '';
  let resolvedCols      = {};
  let hasHeaders        = false;
  let panelActive       = false; // true when inside a panel section
  let activePanelKey    = null;
  let rowIndex          = 0;
  let rowsSkipped       = 0;
  const seenPartNos     = new Map(); // for duplicate detection: partNo → section

  // Track TOTAL rows for reconciliation
  let workbookTotal     = null;

  for (const rawLine of allLines) {
    rowIndex++;
    const trimmed = rawLine.trim();

    // Sheet boundary
    if (trimmed.startsWith('=== SHEET:')) {
      currentWorksheet = trimmed.replace('=== SHEET:', '').replace(/=/g, '').trim();
      resolvedCols = {};
      hasHeaders = false;
      panelActive = false;
      activePanelKey = null;
      currentSection = '';
      continue;
    }

    if (!trimmed) { rowsSkipped++; continue; } // A3: empty row — skip

    const cols = rawLine.split(',').map(c => cleanText(c));
    const upperTrimmed = trimmed.toUpperCase();
    const colsUpper = cols.map(c => c.toUpperCase());

    // A4 / B2: detect & record column header row (first 10 non-empty rows of each sheet)
    if (!hasHeaders) {
      const knownHeaders = Object.values(HEADER_SYNONYMS).flat();
      const matchCount = colsUpper.filter(c =>
        knownHeaders.some(h => c.includes(h))
      ).length;
      if (matchCount >= 3) {
        resolvedCols = resolveColumnIndices(rawLine);
        hasHeaders = true;
        rowsSkipped++;
        continue; // header row — do not emit as item
      }
    }

    // A4: repeated page headers (column header repeated mid-document)
    const firstFewUpper = colsUpper.slice(0, 5).join(' ');
    if (PAGE_HEADER_KEYWORDS.test(firstFewUpper) && colsUpper.filter(c => c.length > 2).length >= 3) {
      rowsSkipped++;
      continue;
    }

    // A4: summary/grand-total rows — extract workbook total for reconciliation
    if (SUMMARY_KEYWORDS.test(trimmed)) {
      // Try to capture the grand total value
      const nums = cols.map(c => toNumber(c, null)).filter(n => n !== null && n > 1000);
      if (nums.length > 0 && /TOTAL/i.test(trimmed)) workbookTotal = nums[0];
      rowsSkipped++;
      continue;
    }

    // C2: Section header detection
    // A section header: has keyword AND no significant commercial values AND very few columns with data
    const nonEmptyCols = cols.filter(c => c.length > 0);
    const numericCols = cols.map(c => toNumber(c, null)).filter(n => n !== null);
    const looksLikeSectionHeader = (
      nonEmptyCols.length <= 3 ||
      (SECTION_KEYWORDS.test(trimmed) && numericCols.length === 0)
    ) && !(/^\s*\d+[\s,]/.test(trimmed)); // serial lines are not headers

    if (looksLikeSectionHeader && nonEmptyCols.length >= 1) {
      const rawSectionName = nonEmptyCols[0] || trimmed;
      currentSection = rawSectionName;

      // C3: is it a panel section?
      const normalizedKey = normalizePanelKey(rawSectionName);
      if (isPanelSection(normalizedKey) ||
          (tplPanelKeyword && new RegExp(tplPanelKeyword, 'i').test(rawSectionName))) {
        panelActive = true;
        activePanelKey = normalizedKey;
        if (!panelGroups.has(normalizedKey)) {
          panelGroups.set(normalizedKey, { originalName: rawSectionName, members: [] });
          panelOrder.push(normalizedKey);
        }
      } else {
        panelActive = false;
        activePanelKey = null;
      }
      rowsSkipped++;
      continue;
    }

    // Must have some content to be a BOM item (C4/C6)
    if (nonEmptyCols.length < 2) { rowsSkipped++; continue; }

    // Parse the item row using resolved/fallback column indices
    const parsed = parseItemRow(cols, resolvedCols);

    // Need at least description
    if (!parsed.description && !parsed.part_no) { rowsSkipped++; continue; }

    // C5: service row detection
    const isService = SERVICE_KEYWORDS_RE.test(parsed.description);
    const category = isService ? 'service_labor' : autoDetectCategory(parsed.description, parsed.part_no);

    // H4: duplicate detection
    let reviewNotes = [];
    const partNoKey = (parsed.part_no || '').toLowerCase();
    const descKey   = parsed.description.toLowerCase();
    if (partNoKey && partNoKey !== 'no_part_number') {
      const dupKey = `${partNoKey}||${currentSection}`;
      if (seenPartNos.has(dupKey)) {
        reviewNotes.push('POSSIBLE_DUPLICATE');
      } else {
        seenPartNos.set(dupKey, true);
      }
    }

    // H2-H5: validation
    reviewNotes = [...reviewNotes, ...validateItem(parsed)];

    // Resolve supplier & category from template defaults
    const resolvedSupplier = (tplDefaultSupplier && !parsed.supplier) ? tplDefaultSupplier : parsed.supplier;
    const resolvedCategory = (tplDefaultCategory && (category === 'other')) ? tplDefaultCategory : category;

    const itemObj = {
      ...parsed,
      category: resolvedCategory,
      supplier: resolvedSupplier,
      section: currentSection,
      worksheet: currentWorksheet,
      source_row: rowIndex,
      review_notes: reviewNotes.join(', '),
      stock: 0,
      order_qty: parsed.qty,
      actual_cost_sar: parsed.unit_cost_sar,
      order_status: 'Not Ordered',
      delivery_status: 'Pending',
      expected_delivery_date: '',
      notes: '',
      unit: parsed.unit || (isService ? 'hr' : 'pcs'),
    };

    // Route to panel group or regular items
    if (panelActive && activePanelKey) {
      panelGroups.get(activePanelKey).members.push(itemObj);
    } else {
      extractedItems.push(itemObj);
    }
  }

  return { extractedItems, panelGroups, panelOrder, hasHeaders, workbookTotal, totalRows: rowIndex, rowsSkipped };
}

// ─── Main Deno handler ────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const startTime = Date.now();
  try {
    const base44 = createClientFromRequest(req);
    // Auth is lenient — asServiceRole covers data access
    try { await base44.auth.me(); } catch (_) {}

    const { plain_text, project_id, document_id, file_name, template } = await req.json();
    if (!plain_text || !project_id) {
      return Response.json({ error: 'plain_text and project_id are required' }, { status: 400 });
    }

    // Template settings
    const tplPanelKeyword   = template?.panel_keyword || 'Panel';
    const tplDefaultSupplier= template?.default_supplier || '';
    const tplDefaultCategory= template?.default_category || '';
    const tplCurrency       = template?.default_currency || 'SAR';
    const tplExtraInstructions = template?.extra_instructions || '';

    // Mark document as processing
    if (document_id) {
      await base44.asServiceRole.entities.Document.update(document_id, {
        bom_extraction_status: 'processing',
        bom_extraction_error: '',
      }).catch(() => {});
    }

    // ── Step 1: Parse workbook text ─────────────────────────────────────────
    const { extractedItems, panelGroups, panelOrder, hasHeaders, workbookTotal, totalRows, rowsSkipped } =
      parseWorkbookText(plain_text, tplPanelKeyword, tplDefaultSupplier, tplDefaultCategory);

    // ── Step 2: Build panel aggregate rows (F1) ─────────────────────────────
    const panelPreviewItems = [];
    let panelIdx = 0;
    for (const key of panelOrder) {
      const { members } = panelGroups.get(key);
      if (members.length === 0) continue;
      panelPreviewItems.push(buildPanelAggregate(key, members, panelIdx++));
    }

    // ── Step 3: Deduplicate non-panel items (H4 — first-occurrence wins) ───
    // Also handle items from summary sheet that repeat: same part_no + description → skip duplicates
    const dedupMap = new Map();
    for (const item of extractedItems) {
      const key = `${(item.part_no || '').toLowerCase()}||${item.description.toLowerCase()}`;
      if (!dedupMap.has(key)) {
        dedupMap.set(key, item);
      }
      // Subsequent occurrences silently skipped — they are summary-sheet or chunk-overlap repeats
    }
    const dedupedItems = [...dedupMap.values()];

    // ── Step 4: Score confidence and finalize ──────────────────────────────
    const finalItems = dedupedItems.map((item, index) => {
      const confidence = computeConfidence(item, hasHeaders);
      return {
        ...item,
        preview_id: `item_${index}`,
        confidence_score: confidence,
        review_required:  confidence < 60 || (item.review_notes && item.review_notes.length > 0),
        currency: tplCurrency,
      };
    });

    // ── Step 5: If parser extracted 0 items, fall back to LLM ──────────────
    // This handles PDF/image-based or unusual formats the regex parser can't handle
    let llmFallbackUsed = false;
    let llmItems = [];
    if (finalItems.length === 0 && panelPreviewItems.length === 0) {
      llmFallbackUsed = true;
      const chunkSize = 12000;
      const chunks = [];
      const lines = plain_text.split('\n');
      let cur = '';
      for (const line of lines) {
        if (cur.length + line.length > chunkSize && cur.length > 0) {
          chunks.push(cur.trim());
          cur = '';
        }
        cur += line + '\n';
      }
      if (cur.trim()) chunks.push(cur.trim());

      const LLM_SCHEMA = {
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
                section: { type: 'string' },
                review_notes: { type: 'string' },
              }
            }
          }
        }
      };

      const categoryList = CATEGORY_RULES.map(r => r[0]).join(', ');
      const batchResults = await Promise.all(
        chunks.map((chunkText, idx) =>
          base44.asServiceRole.integrations.Core.InvokeLLM({
            model: 'gpt_5_4',
            prompt: `You are a BOM extraction engine for industrial automation projects.
File: ${file_name || 'BOM document'} — chunk ${idx + 1} of ${chunks.length}.
Extract every BOM line item. Use explicit column values for costs — never guess from nearby numbers.
INCLUDE: rows with part_no OR (description + qty + pricing). Service rows (ENGINEERING, COMMISSIONING, etc.).
EXCLUDE: section headers, summary rows (SUBTOTAL, GRAND TOTAL, TOTAL), empty rows, page headers.
Categories: ${categoryList}.
Strip SAR/USD from numbers. Set null for missing values.
${tplExtraInstructions ? `Extra: ${tplExtraInstructions}` : ''}
CONTENT:
${chunkText}`,
            response_json_schema: LLM_SCHEMA,
          })
          .then(r => (r?.response || r)?.items || [])
          .catch(() => [])
        )
      );

      const llmRaw = batchResults.flat();
      const llmDedupMap = new Map();
      llmRaw.filter(r => r.description || r.part_no).forEach((row, index) => {
        const description = cleanText(row.description || row.part_no || '');
        const partNo      = cleanText(row.part_no || '');
        const key = `${partNo.toLowerCase()}||${description.toLowerCase()}`;
        if (llmDedupMap.has(key)) return;
        const qty         = toNumber(row.qty, 1) || 1;
        const unitCost    = toNumber(row.unit_cost_sar, null);
        const totalCost   = toNumber(row.total_cost_sar, null) ?? (unitCost != null ? unitCost * qty : null);
        const unitSell    = toNumber(row.unit_selling_sar, null);
        const totalSell   = toNumber(row.total_selling_sar, null) ?? (unitSell != null ? unitSell * qty : null);
        const grossProfit = (totalSell != null && totalCost != null) ? totalSell - totalCost : null;
        const marginPct   = (grossProfit != null && totalSell > 0) ? grossProfit / totalSell : null;
        const category    = autoDetectCategory(description, partNo);
        const reviewNotes = validateItem({ part_no: partNo, description, qty, unit_cost_sar: unitCost, unit_selling_sar: unitSell });
        const confidence  = computeConfidence({ part_no: partNo, description, qty, unit_cost_sar: unitCost, section: row.section, review_notes: reviewNotes.join(',') }, false);
        const resolvedSupplier = (tplDefaultSupplier && !cleanText(row.supplier || '')) ? tplDefaultSupplier : cleanText(row.supplier || '');
        const resolvedCategory = (tplDefaultCategory && category === 'other') ? tplDefaultCategory : category;
        llmDedupMap.set(key, {
          preview_id: `item_${index}`,
          part_no: partNo,
          description,
          category: resolvedCategory,
          manufacturer: cleanText(row.manufacturer || ''),
          supplier: resolvedSupplier,
          qty,
          unit: row.unit || 'pcs',
          unit_cost_sar: unitCost,
          total_cost_sar: totalCost,
          unit_selling_sar: unitSell,
          total_selling_sar: totalSell,
          gross_profit_sar: grossProfit,
          margin_pct: marginPct,
          markup_pct: (grossProfit != null && totalCost > 0) ? grossProfit / totalCost : null,
          section: cleanText(row.section || ''),
          worksheet: '',
          source_row: -1,
          review_notes: [...reviewNotes, ...(row.review_notes ? [row.review_notes] : [])].join(', '),
          confidence_score: confidence,
          review_required: confidence < 60 || reviewNotes.length > 0,
          stock: 0,
          order_qty: qty,
          actual_cost_sar: unitCost,
          order_status: 'Not Ordered',
          delivery_status: 'Pending',
          expected_delivery_date: '',
          notes: '',
          currency: tplCurrency,
          lead_time_days: null,
          warranty_years: null,
        });
      });
      llmItems = [...llmDedupMap.values()].map((item, i) => ({ ...item, preview_id: `item_${i}` }));
    }

    // ── Step 6: Compose final output ────────────────────────────────────────
    const allItems = [...panelPreviewItems, ...(llmFallbackUsed ? llmItems : finalItems)];

    // ── Step 7: Reconciliation (J1) ─────────────────────────────────────────
    const sumCost = allItems.reduce((s, i) => s + (i.total_cost_sar ?? 0), 0);
    let reconciliationStatus = 'UNVERIFIED';
    if (workbookTotal != null) {
      const diff = Math.abs(sumCost - workbookTotal);
      if (diff / (workbookTotal || 1) < 0.01) reconciliationStatus = 'OK';
      else if (sumCost < workbookTotal) reconciliationStatus = 'MISSING_ROWS';
      else reconciliationStatus = 'DOUBLE_COUNTED_ROWS';
    }

    // ── Step 8: Build totals envelope ───────────────────────────────────────
    const totalPlannedCost  = allItems.reduce((s, i) => s + (i.total_cost_sar ?? 0), 0);
    const totalSell         = allItems.reduce((s, i) => s + (i.total_selling_sar ?? 0), 0);
    const totalGP           = totalSell > 0 ? totalSell - totalPlannedCost : 0;
    const totalMarginPct    = (totalGP > 0 && totalSell > 0) ? totalGP / totalSell : 0;
    const panelCount        = allItems.filter(i => i.is_panel_aggregate).length;
    const serviceCount      = allItems.filter(i => i.category === 'service_labor').length;
    const reviewCount       = allItems.filter(i => i.review_required).length;
    const autoSelected      = allItems.filter(i => !i.review_required).length;

    const response = {
      items: allItems,
      totals: {
        total_planned_cost_sar:  totalPlannedCost,
        total_actual_cost_sar:   totalPlannedCost,
        total_sell_value_sar:    totalSell,
        total_gross_profit_sar:  totalGP,
        total_margin_pct:        totalMarginPct,
        item_count:              allItems.length,
        panel_count:             panelCount,
        service_count:           serviceCount,
        review_required_count:   reviewCount,
      },
      meta: {
        source_file:             file_name || '',
        worksheets_processed:    1,
        rows_extracted:          allItems.length,
        rows_skipped:            rowsSkipped,
        errors_detected:         reviewCount,
        extraction_timestamp:    new Date().toISOString(),
        reconciliation_status:   reconciliationStatus,
        extraction_duration_ms:  Date.now() - startTime,
        llm_fallback_used:       llmFallbackUsed,
      },
      // Legacy summary field for backwards compat with modal
      summary: {
        total:          allItems.length,
        auto_selected:  autoSelected,
        review_required:reviewCount,
        sheet_name:     '',
        batches:        1,
      },
    };

    return Response.json(response);

  } catch (error) {
    return Response.json({ error: error?.message || 'BOM extraction failed' }, { status: 500 });
  }
});