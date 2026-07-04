/**
 * BOM Skill Extract — applies a confirmed mapping profile to produce preview rows.
 * Called after the user confirms/adjusts the mapping in Step 2.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import * as XLSX from 'npm:xlsx@0.18.5';

function toNumber(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function normalizeHeader(raw) {
  return String(raw ?? '').toLowerCase().replace(/\r?\n/g, ' ').replace(/\s*\(.*?\)\s*/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function isNumbery(v) { return toNumber(v) !== null; }

function isGroupRow(row, fieldMap) {
  const keyFields = ['supplier', 'part_no', 'description'].filter(f => fieldMap[f]);
  const firstNonEmpty = row.find(v => v != null && v !== '');
  if (firstNonEmpty == null || isNumbery(firstNonEmpty)) return false;
  return keyFields.every(f => {
    const idx = fieldMap[f]?.col_idx;
    return idx == null || row[idx] == null || row[idx] === '';
  });
}

function isSubtotalRow(row, fieldMap) {
  const hasTotal = row.some(v => v != null && /total|subtotal|grand/i.test(String(v)));
  if (!hasTotal) return false;
  const qtyIdx = fieldMap.qty?.col_idx;
  const partIdx = fieldMap.part_no?.col_idx;
  return (qtyIdx == null || !row[qtyIdx]) && (partIdx == null || !row[partIdx]);
}

function get(row, field, fieldMap) {
  const info = fieldMap[field];
  if (!info) return null;
  return row[info.col_idx] ?? null;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    try { await base44.auth.me(); } catch (_) {}

    const { file_url, profile, project_id } = await req.json();
    if (!file_url || !profile) return Response.json({ error: 'file_url and profile required' }, { status: 400 });

    // Load config
    let config = {};
    try {
      const configs = await base44.asServiceRole.entities.BOMImportConfig.filter({ is_default: true }, '-created_date', 1);
      config = configs[0] || {};
    } catch (_) {}

    const panelKeyword = config.panel_keyword || 'panel';
    const networkKeywords = config.networking_keywords || ['switch', 'router', 'firewall', 'fiber', 'sfp', 'ethernet', 'patch panel'];
    const softwareKeywords = config.software_keywords || ['license', 'licence', 'sql', 'scada', 'software'];
    const defaultMarkup = config.default_markup_factor || 1.37;
    const shouldAggregate = config.aggregate_by_category || {};

    // Fetch and parse file
    const resp = await fetch(file_url);
    const buf = await resp.arrayBuffer();
    const workbook = XLSX.read(new Uint8Array(buf), { type: 'array' });
    const sheetName = profile.sheet || workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const allRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
    const dataRows = allRows.slice(profile.data_start_row || 1);
    const fieldMap = profile.field_map || {};

    const warnings = [];
    const groups = [];
    let currentGroup = null;

    for (const row of dataRows) {
      if (row.every(v => v == null || v === '')) continue;
      if (isSubtotalRow(row, fieldMap)) continue;

      if (isGroupRow(row, fieldMap)) {
        const groupName = String(row.find(v => v != null && v !== '') ?? '').trim();
        const lastWord = (groupName.split(/\s+/).pop() || '').toLowerCase();
        const isPanel = lastWord === panelKeyword.toLowerCase() || new RegExp(panelKeyword, 'i').test(groupName);
        currentGroup = { name: groupName, isPanel, items: [] };
        groups.push(currentGroup);
        continue;
      }

      const descRaw = get(row, 'description', fieldMap);
      const partNoRaw = get(row, 'part_no', fieldMap);
      if (!descRaw && !partNoRaw) continue;

      const description = String(descRaw ?? partNoRaw ?? '').trim();
      const partNo = String(partNoRaw ?? description).trim();
      const supplier = String(get(row, 'supplier', fieldMap) ?? '').trim();
      const qty = toNumber(get(row, 'qty', fieldMap)) ?? 1;
      const unit = String(get(row, 'unit', fieldMap) ?? 'pcs').trim() || 'pcs';
      const unitCost = toNumber(get(row, 'unit_cost', fieldMap));
      const totalCostRaw = toNumber(get(row, 'total_cost', fieldMap));
      const totalCost = totalCostRaw ?? (unitCost != null ? unitCost * qty : null);
      let unitSell = toNumber(get(row, 'unit_sell', fieldMap));
      const totalSellRaw = toNumber(get(row, 'total_sell', fieldMap));
      const markupPct = toNumber(get(row, 'markup_pct', fieldMap));

      let markupUsed = false;
      if (unitSell == null && unitCost != null) {
        const factor = markupPct != null ? 1 + markupPct : defaultMarkup;
        unitSell = unitCost * factor;
        markupUsed = true;
        if (!fieldMap.unit_sell) warnings.push(`"${description}": sell price defaulted from cost × ${factor.toFixed(2)} (not in file)`);
      }
      const totalSell = totalSellRaw ?? (unitSell != null ? unitSell * qty : null);

      // Classify
      const descLower = `${description} ${partNo}`.toLowerCase();
      const noSupplier = !supplier || ['', '-', 'n/a', 'na'].includes(supplier.toLowerCase());
      let category;
      if (noSupplier && networkKeywords.some(kw => descLower.includes(kw.toLowerCase()))) {
        category = 'network';
      } else if (noSupplier) {
        category = 'it_hardware';
      } else if (softwareKeywords.some(kw => descLower.includes(kw.toLowerCase()))) {
        category = 'software_license';
      } else {
        category = 'plc';
      }

      const item = { description, partNo, supplier, qty, unit, unitCost, totalCost, unitSell, totalSell, totalSellRaw, category, markupUsed };

      if (!currentGroup) { currentGroup = { name: '', isPanel: false, items: [] }; groups.push(currentGroup); }
      currentGroup.items.push(item);
    }

    // Build preview rows
    const previewRows = [];
    const panelParents = [];

    for (const group of groups) {
      if (group.isPanel && group.items.length > 0) {
        const totalCost = group.items.reduce((s, i) => s + (i.totalCost ?? 0), 0);
        const totalSell = group.items.reduce((s, i) => s + (i.totalSell ?? (i.totalCost ?? 0) * defaultMarkup), 0);
        const parent = {
          preview_id: `panel_${previewRows.length}`,
          description: group.name,
          category: 'panel',
          supplier: '',
          manufacturer_part_number: '',
          quantity: 1,
          unit: 'set',
          planned_cost_price: totalCost,
          actual_cost_price: totalCost,
          selling_price: totalSell > 0 ? totalSell / 1 : null,
          stock_qty: 0,
          order_status: 'not_ordered',
          delivery_status: 'not_delivered',
          is_panel: true,
          _group_name: group.name,
        };
        panelParents.push({ preview_id: parent.preview_id, group_name: group.name });
        previewRows.push(parent);

        // Children
        group.items.forEach((c, idx) => {
          previewRows.push({
            preview_id: `child_${previewRows.length}`,
            _parent_preview_id: parent.preview_id,
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

      // Non-panel: aggregate by part_no within category
      for (const item of group.items) {
        const agg = shouldAggregate[item.category] !== false;
        if (agg && item.partNo && item.partNo !== item.description) {
          const existing = previewRows.find(r =>
            !r.is_panel && !r.is_child &&
            r.manufacturer_part_number === item.partNo &&
            r.category === item.category
          );
          if (existing) {
            const newQty = existing.quantity + item.qty;
            if (existing.planned_cost_price != null && item.unitCost != null) {
              // Weighted average unit cost
              existing.planned_cost_price = ((existing.planned_cost_price * existing.quantity) + (item.unitCost * item.qty)) / newQty;
              existing.actual_cost_price = existing.planned_cost_price;
            }
            existing.quantity = newQty;
            continue;
          }
        }
        previewRows.push({
          preview_id: `item_${previewRows.length}`,
          description: item.description,
          category: item.category,
          supplier: item.supplier,
          manufacturer_part_number: item.partNo,
          quantity: item.qty,
          unit: item.unit,
          planned_cost_price: item.unitCost,
          actual_cost_price: item.unitCost,
          selling_price: item.unitSell,
          stock_qty: 0,
          order_status: 'not_ordered',
          delivery_status: 'not_delivered',
          is_panel: false,
          is_child: false,
        });
      }
    }

    // Summary
    const topLevel = previewRows.filter(r => !r.is_child);
    const totalPlanned = topLevel.reduce((s, r) => s + ((r.planned_cost_price ?? 0) * (r.quantity ?? 1)), 0);
    const totalSell = topLevel.reduce((s, r) => s + ((r.selling_price ?? 0) * (r.quantity ?? 1)), 0);

    return Response.json({
      preview_rows: previewRows,
      warnings,
      summary: {
        total_rows: topLevel.length,
        panel_count: topLevel.filter(r => r.is_panel).length,
        child_count: previewRows.filter(r => r.is_child).length,
        total_planned_cost: totalPlanned,
        total_sell_value: totalSell,
      },
    });

  } catch (err) {
    return Response.json({ error: err.message || 'Extraction failed' }, { status: 500 });
  }
});