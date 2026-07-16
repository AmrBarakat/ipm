/**
 * BOM Recognizer — 4-Layer Column Recognition Engine
 * Takes raw sheet data (array of row arrays) + config and returns a mapping profile.
 * Called by bomImportSkill; also exported as a standalone function for testing.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import * as XLSX from 'npm:xlsx@0.18.5';

// ─── Normalization ─────────────────────────────────────────────────────────────

function normalizeHeader(raw) {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/\r?\n/g, ' ')
    .replace(/\s*\(.*?\)\s*/g, '') // strip units in parens
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toNumber(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function isNumbery(v) { return toNumber(v) !== null; }

// ─── Layer 1: Header synonym matching ─────────────────────────────────────────

function layer1Match(headers, synonymDict) {
  // headers: array of { col_idx, raw, normalized }
  // Returns { fieldName -> [{ col_idx, confidence, raw }] }
  const matches = {};
  for (const [field, synonyms] of Object.entries(synonymDict)) {
    matches[field] = [];
    for (const h of headers) {
      if (!h.normalized) continue;
      // Exact match
      if (synonyms.includes(h.normalized)) {
        matches[field].push({ col_idx: h.col_idx, confidence: 0.95, raw: h.raw, layer: 1 });
        continue;
      }
      // Partial match (header contains synonym or synonym contains header)
      for (const syn of synonyms) {
        if (h.normalized.includes(syn) || syn.includes(h.normalized)) {
          const conf = Math.min(0.85, 0.5 + (Math.min(h.normalized.length, syn.length) / Math.max(h.normalized.length, syn.length)) * 0.4);
          matches[field].push({ col_idx: h.col_idx, confidence: conf, raw: h.raw, layer: 1 });
          break;
        }
      }
    }
  }
  return matches;
}

// ─── Layer 2: Disambiguation by position & content ────────────────────────────

function layer2Disambiguate(candidates, dataRows, headers) {
  // candidates: result of layer1Match
  // For fields with multiple column candidates, use content heuristics to pick the best one

  const resolved = {};

  for (const [field, cols] of Object.entries(candidates)) {
    if (cols.length === 0) continue;
    if (cols.length === 1) {
      resolved[field] = { ...cols[0], layer: 1 };
      continue;
    }

    // Multiple candidates — score by content shape
    const scored = cols.map(c => {
      const values = dataRows.map(r => r[c.col_idx]).filter(v => v != null && v !== '');
      let score = c.confidence;

      if (field === 'qty') {
        // Prefer small positive integers
        const numericFrac = values.filter(isNumbery).length / Math.max(values.length, 1);
        const smallIntFrac = values.filter(v => { const n = toNumber(v); return n != null && Number.isInteger(n) && n > 0 && n < 1000; }).length / Math.max(values.length, 1);
        score += numericFrac * 0.1 + smallIntFrac * 0.15;
      }
      if (field === 'part_no') {
        // Prefer high uniqueness, alphanumeric mixed values
        const unique = new Set(values.map(v => String(v).trim().toLowerCase()));
        const uniqueFrac = unique.size / Math.max(values.length, 1);
        const alphanumFrac = values.filter(v => /[a-z]/i.test(String(v)) && /\d/.test(String(v))).length / Math.max(values.length, 1);
        score += uniqueFrac * 0.2 + alphanumFrac * 0.15;
        // Penalize if mostly small integers (likely S.No)
        const seqIntFrac = values.filter(v => { const n = toNumber(v); return n != null && Number.isInteger(n) && n > 0 && n <= 50; }).length / Math.max(values.length, 1);
        if (seqIntFrac > 0.7) score -= 0.4;
      }
      if (field === 'description') {
        // Prefer long free text, high uniqueness
        const avgLen = values.reduce((s, v) => s + String(v).length, 0) / Math.max(values.length, 1);
        const unique = new Set(values.map(v => String(v).trim().toLowerCase()));
        const uniqueFrac = unique.size / Math.max(values.length, 1);
        score += Math.min(avgLen / 60, 0.2) + uniqueFrac * 0.1;
      }
      if (field === 'supplier') {
        // Prefer low cardinality short repeated strings (vendor names)
        const unique = new Set(values.map(v => String(v).trim().toLowerCase()));
        const lowCardinality = unique.size < Math.max(values.length * 0.3, 5);
        const shortStrings = values.filter(v => String(v).length <= 20).length / Math.max(values.length, 1);
        if (lowCardinality) score += 0.15;
        score += shortStrings * 0.05;
        // Penalize if mostly small sequential integers
        const seqFrac = values.filter(v => { const n = toNumber(v); return n != null && Number.isInteger(n) && n <= 50; }).length / Math.max(values.length, 1);
        if (seqFrac > 0.7) score -= 0.5;
      }
      if (['unit_cost', 'total_cost', 'unit_sell', 'total_sell'].includes(field)) {
        // Prefer numeric, non-tiny values
        const numFrac = values.filter(isNumbery).length / Math.max(values.length, 1);
        const largeFrac = values.filter(v => { const n = toNumber(v); return n != null && n > 10; }).length / Math.max(values.length, 1);
        score += numFrac * 0.15 + largeFrac * 0.1;
      }

      return { ...c, score };
    });

    scored.sort((a, b) => b.score - a.score);
    resolved[field] = { ...scored[0], layer: 2, confidence: Math.min(0.9, scored[0].score) };
  }

  return resolved;
}

// ─── Layer 3: Content-shape inference for unresolved fields ───────────────────

function layer3Infer(resolved, headers, dataRows) {
  const usedCols = new Set(Object.values(resolved).map(v => v.col_idx));
  const unmapped = headers.filter(h => !usedCols.has(h.col_idx));

  const needed = ['description', 'part_no', 'supplier', 'qty', 'unit_cost', 'total_cost', 'unit_sell', 'total_sell']
    .filter(f => !resolved[f]);

  for (const h of unmapped) {
    const values = dataRows.map(r => r[h.col_idx]).filter(v => v != null && v !== '');
    if (values.length === 0) continue;

    const numericFrac = values.filter(isNumbery).length / values.length;
    const avgLen = values.reduce((s, v) => s + String(v).length, 0) / values.length;
    const unique = new Set(values.map(v => String(v).trim().toLowerCase()));
    const uniqueFrac = unique.size / values.length;
    const smallIntFrac = values.filter(v => { const n = toNumber(v); return n != null && Number.isInteger(n) && n > 0 && n < 1000; }).length / values.length;
    const largeFrac = values.filter(v => { const n = toNumber(v); return n != null && n > 50; }).length / values.length;

    if (needed.includes('qty') && numericFrac > 0.7 && smallIntFrac > 0.6 && !resolved.qty) {
      resolved.qty = { col_idx: h.col_idx, confidence: 0.55, raw: h.raw, layer: 3 };
    } else if (needed.includes('description') && numericFrac < 0.2 && avgLen > 15 && uniqueFrac > 0.6 && !resolved.description) {
      resolved.description = { col_idx: h.col_idx, confidence: 0.6, raw: h.raw, layer: 3 };
    } else if (needed.includes('part_no') && numericFrac < 0.3 && uniqueFrac > 0.7 && avgLen < 20 && !resolved.part_no) {
      resolved.part_no = { col_idx: h.col_idx, confidence: 0.55, raw: h.raw, layer: 3 };
    } else if (needed.includes('unit_cost') && numericFrac > 0.7 && largeFrac > 0.4 && !resolved.unit_cost) {
      resolved.unit_cost = { col_idx: h.col_idx, confidence: 0.5, raw: h.raw, layer: 3 };
    } else if (needed.includes('total_cost') && numericFrac > 0.7 && largeFrac > 0.5 && !resolved.total_cost) {
      resolved.total_cost = { col_idx: h.col_idx, confidence: 0.5, raw: h.raw, layer: 3 };
    }
  }

  return resolved;
}

// ─── Layer 4: Group/header row detection ─────────────────────────────────────

function buildGroupRowDetector(fieldMap) {
  const keyFields = ['supplier', 'part_no', 'description'].filter(f => fieldMap[f]);
  return function isGroupRow(row) {
    // First non-empty cell must be text
    const firstNonEmpty = row.find(v => v != null && v !== '');
    if (firstNonEmpty == null || isNumbery(firstNonEmpty)) return false;
    // All key field columns must be empty
    const keyEmpty = keyFields.every(f => {
      const idx = fieldMap[f]?.col_idx;
      return idx == null || row[idx] == null || row[idx] === '';
    });
    return keyEmpty;
  };
}

function isSubtotalRow(row, fieldMap) {
  const labelCols = row.filter(v => v != null && /total|subtotal|grand/i.test(String(v)));
  if (labelCols.length === 0) return false;
  const qtyIdx = fieldMap.qty?.col_idx;
  const partIdx = fieldMap.part_no?.col_idx;
  const noQty = qtyIdx == null || row[qtyIdx] == null || row[qtyIdx] === '';
  const noPart = partIdx == null || row[partIdx] == null || row[partIdx] === '';
  return noQty && noPart;
}

// ─── Main recognizer ──────────────────────────────────────────────────────────

function recognize(sheetData, synonymDict, sheetName) {
  if (!sheetData || sheetData.length < 2) {
    return { error: 'Sheet has insufficient data', fieldMap: {}, confidence: 0 };
  }

  // Find the header row: the row with the most synonym matches.
  // Also try merging consecutive rows to handle multi-row / merged-cell headers.
  let bestHeaderRow = 0;
  let bestScore = 0;
  let bestIsComposite = false;
  const allSynonyms = Object.values(synonymDict).flat();
  const SCAN = Math.min(10, sheetData.length);

  function scoreRow(normalizedCells) {
    return normalizedCells.filter(norm => norm && allSynonyms.some(s => norm.includes(s) || s.includes(norm))).length;
  }

  for (let r = 0; r < SCAN; r++) {
    const single = sheetData[r].map(c => normalizeHeader(c));
    const s1 = scoreRow(single);
    if (s1 > bestScore) { bestScore = s1; bestHeaderRow = r; bestIsComposite = false; }

    if (r + 1 < SCAN) {
      const merged = sheetData[r].map((c, ci) => {
        const a = normalizeHeader(c); const b = normalizeHeader(sheetData[r + 1][ci]);
        return (a || b) ? `${a} ${b}`.trim() : '';
      });
      const s2 = scoreRow(merged);
      if (s2 > bestScore) { bestScore = s2; bestHeaderRow = r; bestIsComposite = true; }
    }
  }

  let headers;
  let dataStartRow;
  if (bestIsComposite) {
    headers = sheetData[bestHeaderRow].map((raw, ci) => {
      const a = normalizeHeader(raw);
      const b = normalizeHeader(sheetData[bestHeaderRow + 1]?.[ci]);
      return {
        col_idx: ci,
        raw: raw || sheetData[bestHeaderRow + 1]?.[ci],
        normalized: (a || b) ? `${a} ${b}`.trim() : '',
      };
    });
    dataStartRow = bestHeaderRow + 2;
  } else {
    headers = sheetData[bestHeaderRow].map((raw, idx) => ({ col_idx: idx, raw, normalized: normalizeHeader(raw) }));
    dataStartRow = bestHeaderRow + 1;
  }

  const dataRows = sheetData.slice(dataStartRow);

  // Layer 1
  const l1 = layer1Match(headers, synonymDict);

  // Layer 2 disambiguation
  const fieldMap = layer2Disambiguate(l1, dataRows, headers);

  // Layer 3 for still-unresolved fields
  layer3Infer(fieldMap, headers, dataRows);

  // Detect S.No / excluded columns (sequential small ints, not mapped to any field)
  const usedCols = new Set(Object.values(fieldMap).map(v => v.col_idx));
  const excludedColumns = headers
    .filter(h => !usedCols.has(h.col_idx))
    .filter(h => {
      const vals = dataRows.map(r => r[h.col_idx]).filter(v => v != null && v !== '');
      const seqFrac = vals.filter(v => { const n = toNumber(v); return n != null && Number.isInteger(n) && n <= 100; }).length / Math.max(vals.length, 1);
      return seqFrac > 0.7;
    })
    .map(h => h.col_idx);

  // Build header signature for template matching
  const headerSignature = headers.map(h => h.normalized).filter(Boolean);

  // Overall confidence
  const requiredFields = ['description', 'part_no', 'qty'];
  const missingRequired = requiredFields.filter(f => !fieldMap[f]);
  const avgConf = Object.values(fieldMap).reduce((s, v) => s + (v.confidence || 0), 0) / Math.max(Object.values(fieldMap).length, 1);

  // Sample values for UI review (3 non-empty values per mapped field)
  const sampleValues = {};
  for (const [field, info] of Object.entries(fieldMap)) {
    const samples = dataRows
      .map(r => r[info.col_idx])
      .filter(v => v != null && v !== '')
      .slice(0, 3);
    sampleValues[field] = samples;
  }

  return {
    sheet: sheetName,
    header_row: bestHeaderRow,
    data_start_row: dataStartRow,
    header_signature: headerSignature,
    field_map: fieldMap,
    excluded_columns: excludedColumns,
    group_row_rule: 'first_cell_text_and_key_fields_empty',
    missing_required: missingRequired,
    overall_confidence: avgConf,
    sample_values: sampleValues,
    all_columns: headers.map(h => ({ col_idx: h.col_idx, raw: h.raw, normalized: h.normalized })),
  };
}

// ─── Data extraction using profile ────────────────────────────────────────────

function extractRows(sheetData, profile, config) {
  const { field_map, data_start_row } = profile;
  const dataRows = sheetData.slice(data_start_row);
  const isGroup = buildGroupRowDetector(field_map);
  const panelKeyword = config.panel_keyword || 'panel';
  const networkKeywords = config.networking_keywords || [];
  const softwareKeywords = config.software_keywords || [];
  const defaultMarkup = config.default_markup_factor || 1.37;
  const equipmentCategory = 'plc'; // enum value for fallback equipment

  const get = (row, field) => {
    const info = field_map[field];
    if (!info) return null;
    return row[info.col_idx] ?? null;
  };

  const groups = []; // { name, isPanel, items[] }
  let currentGroup = null;
  const warnings = [];

  for (const row of dataRows) {
    if (row.every(v => v == null || v === '')) continue;

    if (isSubtotalRow(row, field_map)) continue;

    if (isGroup(row)) {
      const groupName = String(row.find(v => v != null && v !== '') ?? '').trim();
      const isPanel = new RegExp(panelKeyword, 'i').test(groupName.split(' ').pop() || groupName);
      currentGroup = { name: groupName, isPanel, items: [] };
      groups.push(currentGroup);
      continue;
    }

    // Item row
    const descRaw = get(row, 'description');
    const partNoRaw = get(row, 'part_no');
    if (!descRaw && !partNoRaw) continue;

    const description = String(descRaw ?? partNoRaw ?? '').trim();
    const partNo = String(partNoRaw ?? '').trim();
    const supplier = String(get(row, 'supplier') ?? '').trim();
    const qty = toNumber(get(row, 'qty')) ?? 1;
    const unit = String(get(row, 'unit') ?? 'pcs').trim() || 'pcs';
    const unitCost = toNumber(get(row, 'unit_cost'));
    const totalCost = toNumber(get(row, 'total_cost')) ?? (unitCost != null ? unitCost * qty : null);
    let unitSell = toNumber(get(row, 'unit_sell'));
    const totalSell = toNumber(get(row, 'total_sell')) ?? (unitSell != null ? unitSell * qty : null);
    const markupPct = toNumber(get(row, 'markup_pct'));

    // Derive sell from cost if missing
    if (unitSell == null && unitCost != null) {
      const factor = markupPct != null ? 1 + markupPct : defaultMarkup;
      unitSell = unitCost * factor;
      warnings.push(`Selling price for "${description}" defaulted using markup factor ${factor.toFixed(2)} (not read from file)`);
    }

    // Classify
    const descLower = `${description} ${partNo}`.toLowerCase();
    let category;
    const noSupplier = !supplier || ['', '-', 'n/a', 'na'].includes(supplier.toLowerCase());
    if (noSupplier && networkKeywords.some(kw => descLower.includes(kw.toLowerCase()))) {
      category = 'network';
    } else if (noSupplier) {
      category = 'it_hardware';
    } else if (softwareKeywords.some(kw => descLower.includes(kw.toLowerCase()))) {
      category = 'software_license';
    } else {
      category = equipmentCategory;
    }

    const item = {
      description, partNo, supplier, qty, unit, unitCost, totalCost, unitSell, totalSell,
      category, raw_row: row,
    };

    if (!currentGroup) {
      currentGroup = { name: '', isPanel: false, items: [] };
      groups.push(currentGroup);
    }
    currentGroup.items.push(item);
  }

  return { groups, warnings };
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

function aggregateGroups(groups, config) {
  const shouldAggregate = config.aggregate_by_category || {};
  const defaultMarkup = config.default_markup_factor || 1.37;

  const topLevel = []; // final BOMItem rows (parents)
  const children = []; // Panel child rows

  // Panel groups → one aggregate parent + children
  for (const group of groups) {
    if (group.isPanel && group.items.length > 0) {
      const totalCost = group.items.reduce((s, i) => s + (i.totalCost ?? 0), 0);
      const totalSell = group.items.reduce((s, i) => s + (i.totalSell ?? (i.totalCost ?? 0) * defaultMarkup), 0);
      const parent = {
        description: group.name,
        category: 'panel',
        supplier: '',
        manufacturer_part_number: '',
        quantity: 1,
        unit: 'set',
        planned_cost_price: totalCost,
        actual_cost_price: totalCost,
        selling_price: totalSell,
        stock_qty: 0,
        order_status: 'not_ordered',
        delivery_status: 'not_delivered',
        is_panel: true,
        _children_raw: group.items,
      };
      topLevel.push(parent);
      group.items.forEach((c, idx) => {
        children.push({
          _parent_description: group.name,
          _seq: idx + 1,
          description: c.description,
          category: c.category,
          supplier: c.supplier,
          manufacturer_part_number: c.partNo,
          quantity: c.qty,
          unit: c.unit,
          planned_cost_price: c.unitCost,
          actual_cost_price: c.unitCost,
          selling_price: c.unitSell,
          stock_qty: 0,
          order_status: 'not_ordered',
          delivery_status: 'not_delivered',
          is_child: true,
        });
      });
      continue;
    }

    // Non-panel groups — aggregate by part_no within category if configured
    for (const item of group.items) {
      const agg = shouldAggregate[item.category] !== false;
      if (agg && item.partNo) {
        const existing = topLevel.find(t => t.manufacturer_part_number === item.partNo && t.category === item.category);
        if (existing) {
          existing.quantity += item.qty;
          if (item.totalCost != null) existing._total_cost_sum = (existing._total_cost_sum || 0) + item.totalCost;
          if (item.totalSell != null) existing._total_sell_sum = (existing._total_sell_sum || 0) + item.totalSell;
          continue;
        }
      }
      topLevel.push({
        description: item.description,
        category: item.category,
        supplier: item.supplier,
        manufacturer_part_number: item.partNo,
        quantity: item.qty,
        unit: item.unit,
        planned_cost_price: item.unitCost,
        actual_cost_price: item.unitCost,
        selling_price: item.unitSell,
        _total_cost_sum: item.totalCost,
        _total_sell_sum: item.totalSell,
        stock_qty: 0,
        order_status: 'not_ordered',
        delivery_status: 'not_delivered',
      });
    }
  }

  // Finalize aggregated rows: recompute unit cost from total/qty if qty was summed
  for (const row of topLevel) {
    if (row._total_cost_sum != null && row.quantity > 0 && !row.is_panel) {
      row.planned_cost_price = row._total_cost_sum / row.quantity;
      row.actual_cost_price = row.planned_cost_price;
    }
    delete row._total_cost_sum;
    delete row._total_sell_sum;
    delete row._children_raw;
  }

  return { topLevel, children };
}

// ─── Best sheet selection ─────────────────────────────────────────────────────

function pickBestSheet(workbook, synonymDict) {
  let bestSheet = workbook.SheetNames[0];
  let bestScore = 0;
  const allSynonyms = Object.values(synonymDict).flat();

  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
    const score = rows.slice(0, 10).reduce((s, row) =>
      s + row.filter(c => allSynonyms.some(syn => normalizeHeader(c).includes(syn))).length, 0
    );
    if (score > bestScore) { bestScore = score; bestSheet = name; }
  }
  return bestSheet;
}

// ─── Template signature matching ──────────────────────────────────────────────

function matchTemplateSignature(headerSignature, templates) {
  let best = null;
  let bestScore = 0;
  for (const tpl of templates) {
    const profile = tpl.recognition_profile;
    if (!profile?.header_signature) continue;
    const intersection = profile.header_signature.filter(h => headerSignature.includes(h));
    const score = intersection.length / Math.max(profile.header_signature.length, headerSignature.length, 1);
    if (score > 0.6 && score > bestScore) { bestScore = score; best = tpl; }
  }
  return best ? { template: best, similarity: bestScore } : null;
}

// ─── Deno handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    let user = null;
    try { user = await base44.auth.me(); } catch (_) { user = null; }
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { file_url, project_id, existing_profile } = await req.json();
    if (!file_url) return Response.json({ error: 'file_url required' }, { status: 400 });

    // Load config
    let config = null;
    try {
      const configs = await base44.asServiceRole.entities.BOMImportConfig.filter({ is_default: true }, '-created_date', 1);
      config = configs[0] || null;
    } catch (_) {}
    const synonymDict = config?.field_synonyms || {
      description: ['description', 'item description', 'material description', 'details'],
      part_no: ['part no', 'part number', 'model', 'p/n', 'material code'],
      supplier: ['supplier', 'vendor', 'manufacturer', 'make', 'brand'],
      qty: ['qty', 'quantity', 't.qty', 'total qty'],
      unit: ['unit', 'uom'],
      unit_cost: ['cost unit price', 'unit cost', 'buying price', 'net price tl per unit equipment', 'cost unit price equipment sar'],
      total_cost: ['total cost equipment', 'total cost', 'extended cost', 'total cost equipment sar'],
      unit_sell: ['unit price equipment', 'list price equipment sar', 'list price sar', 'unit price', 'list price'],
      total_sell: ['total equipment sar', 'total selling', 'total price', 'amount'],
      markup_pct: ['materials markup to customer', 'material markup', 'markup'],
    };

    // Fetch file
    const resp = await fetch(file_url);
    const buf = await resp.arrayBuffer();
    const workbook = XLSX.read(new Uint8Array(buf), { type: 'array' });

    // Load saved templates for auto-matching
    let templates = [];
    try {
      templates = await base44.asServiceRole.entities.BOMTemplate.filter({}, '-created_date', 50);
    } catch (_) {}

    // Use provided profile override, or recognize
    let profile = existing_profile || null;
    let templateMatch = null;

    if (!profile) {
      const sheetName = pickBestSheet(workbook, synonymDict);
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
      profile = recognize(rows, synonymDict, sheetName);
      profile._raw_rows = rows; // pass through for extraction step
      templateMatch = matchTemplateSignature(profile.header_signature, templates);
      if (templateMatch) {
        // Pre-apply template's field_map but still return for user review
        profile._suggested_template = templateMatch.template.id;
        profile._template_name = templateMatch.template.name;
        profile._template_similarity = templateMatch.similarity;
      }
    } else {
      // Re-read sheet for extraction
      const sheetName = profile.sheet || workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
      profile._raw_rows = rows;
    }

    // Return all sheets list for user override
    const sheet_names = workbook.SheetNames;

    return Response.json({
      profile,
      sheet_names,
      template_match: templateMatch,
      config_summary: {
        panel_keyword: config?.panel_keyword || 'panel',
        default_markup_factor: config?.default_markup_factor || 1.37,
        equipment_category_label: config?.equipment_category_label || 'Equipment',
      },
    });

  } catch (err) {
    return Response.json({ error: err.message || 'Recognition failed' }, { status: 500 });
  }
});