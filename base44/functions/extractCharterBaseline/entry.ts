/**
 * extractCharterBaseline — reads a charter workbook with xlsx (no InvokeLLM),
 * selects the "Charter" sheet (or the first whose B3 contains "INITIAL CHARTER"),
 * parses the identity block + six totals, creates a CharterBaseline record, an
 * Extraction (extraction_kind "charter", status "review") whose proposals hold
 * the BaselineLine rows, and an AuditLog entry (action "baseline_imported").
 *
 * The Extraction follows the same created_entity_refs / proposals contract as
 * the PO/DN pipeline, so the existing review and revert plumbing applies.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import * as XLSX from 'npm:xlsx@0.18.5';
import { requirePrivilege } from '../../shared/requirePrivilege.ts';

// ─── Normalization ────────────────────────────────────────────────────────────

function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/\r?\n/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toNumber(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/,/g, '').replace(/[^\d.\-]/g, '').trim();
  if (s === '' || s === '-' || s === '.') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function isNumbery(v) { return toNumber(v) !== null; }

// ─── Sheet selection ──────────────────────────────────────────────────────────
// Do NOT reuse pickBestSheet — it scores on BOM header synonyms and would return
// the wrong sheet for a charter file. Select by name "Charter", falling back to
// the first sheet whose B3 cell contains "INITIAL CHARTER".

function selectCharterSheet(workbook) {
  if (workbook.SheetNames.includes('Charter')) return 'Charter';
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    const b3 = sheet['B3'];
    const v = b3 ? (b3.v ?? b3.w) : null;
    if (v && String(v).toUpperCase().includes('INITIAL CHARTER')) return name;
  }
  return workbook.SheetNames[0];
}

// ─── Identity block scanner ───────────────────────────────────────────────────
// Scans for labeled cells (label in one cell, value in the adjacent cell to the
// right or below) and returns { field: rawValue }.

const IDENTITY_SYNONYMS = {
  project_name:      ['project name', 'project title', 'project'],
  client:            ['client', 'customer', 'client name'],
  document_date:     ['document date', 'charter date', 'date'],
  currency:          ['currency'],
  revision_label:   ['revision', 'revision label', 'rev'],
  project_manager:   ['project manager', 'prepared by', 'manager'],
  target_markup_pct: ['target markup', 'markup', 'target margin', 'margin'],
  planned_manhours:  ['planned manhours', 'total manhours', 'manhours', 'man hours', 'planned hours'],
  manhour_rate:      ['manhour rate', 'man hour rate', 'hourly rate', 'blended rate'],
  fx_usd:            ['fx usd', 'usd rate', 'usd exchange', 'usd to sar'],
  fx_eur:            ['fx eur', 'eur rate', 'eur exchange', 'eur to sar'],
};

function findAdjacentValue(rows, r, c) {
  // Try cells to the right in the same row
  const row = rows[r] || [];
  for (let cc = c + 1; cc < row.length; cc++) {
    const v = row[cc];
    if (v != null && v !== '') return v;
  }
  // Try cell directly below
  if (r + 1 < rows.length) {
    const below = rows[r + 1] || [];
    if (below[c] != null && below[c] !== '') return below[c];
  }
  return null;
}

function scanIdentity(rows) {
  const result = {};
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] || [];
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (cell == null || cell === '') continue;
      const n = norm(cell);
      if (!n || n.length > 60) continue; // skip long text (descriptions/notes)

      for (const [field, syns] of Object.entries(IDENTITY_SYNONYMS)) {
        if (result[field] !== undefined) continue;
        const matched = syns.some(s => n === s || n.startsWith(s + ' ') || n === s + 's');
        if (!matched) continue;
        const val = findAdjacentValue(rows, r, c);
        if (val != null) result[field] = val;
      }
    }
  }
  return result;
}

// ─── Six totals scanner ──────────────────────────────────────────────────────
// Scans for cells whose text identifies a stream (goods/services/support) AND a
// type (revenue/direct_cost/indirect_cost), then takes the adjacent numeric value.

const STREAM_KEYWORDS = [
  { stream: 'goods',    words: ['goods', 'equipment', 'material'] },
  { stream: 'services', words: ['service', 'engineering', 'service '] },
  { stream: 'support',  words: ['support', 'maintenance', 'spare'] },
];

const TYPE_KEYWORDS = [
  { type: 'revenue',       words: ['revenue', 'selling', 'sale'] },
  { type: 'indirect_cost', words: ['indirect', 'overhead'] },
  { type: 'direct_cost',   words: ['direct cost', 'direct costs', 'cost of goods', 'cost of service', 'cost of support', 'direct'] },
];

function classifyStream(n) {
  for (const { stream, words } of STREAM_KEYWORDS) {
    if (words.some(w => n.includes(w))) return stream;
  }
  return null;
}

function classifyType(n) {
  for (const { type, words } of TYPE_KEYWORDS) {
    if (words.some(w => n.includes(w))) return type;
  }
  return null;
}

function findAdjacentNumber(rows, r, c) {
  const row = rows[r] || [];
  // Try cells to the right
  for (let cc = c + 1; cc < row.length; cc++) {
    const v = row[cc];
    if (v != null && v !== '') {
      const n = toNumber(v);
      if (n !== null) return n;
    }
  }
  // Try cell below
  if (r + 1 < rows.length) {
    const below = rows[r + 1] || [];
    if (below[c] != null && below[c] !== '') {
      const n = toNumber(below[c]);
      if (n !== null) return n;
    }
  }
  return null;
}

function scanTotals(rows) {
  const result = {};
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] || [];
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (cell == null || cell === '') continue;
      const n = norm(cell);
      if (!n) continue;

      const stream = classifyStream(n);
      const type = classifyType(n);
      if (!stream || !type) continue;

      const field = `${type}_${stream}`;
      if (result[field] !== undefined) continue;

      const val = findAdjacentNumber(rows, r, c);
      if (val !== null) result[field] = val;
    }
  }
  return result;
}

// ─── Line items table extractor ──────────────────────────────────────────────
// Detects a header row containing a description column and an amount column,
// then parses data rows. Section headers above the table provide stream/type
// context when the table has no explicit stream/type columns.

function extractLineItems(rows, defaultCurrency) {
  let headerRow = -1;
  let descCol = -1;
  let amountCol = -1;
  let streamCol = -1;
  let typeCol = -1;

  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const row = rows[r] || [];
    let dCol = -1, aCol = -1, sCol = -1, tCol = -1;
    for (let c = 0; c < row.length; c++) {
      const n = norm(row[c]);
      if (!n) continue;
      if (dCol < 0 && (n.includes('description') || n.includes('particulars') || n.includes('item description') || n.includes('details'))) dCol = c;
      if (aCol < 0 && (n === 'amount' || n.includes('amount') || n.includes('value') || n.includes('total') || n.includes('price') || n.includes('net'))) aCol = c;
      if (sCol < 0 && (n.includes('stream') || n === 'category' || n.includes('category'))) sCol = c;
      if (tCol < 0 && (n.includes('line type') || n === 'type' || n.includes('cost type') || n.includes('revenue type'))) tCol = c;
    }
    if (dCol >= 0 && aCol >= 0 && dCol !== aCol) {
      headerRow = r; descCol = dCol; amountCol = aCol; streamCol = sCol; typeCol = tCol;
      break;
    }
  }

  if (headerRow < 0) return [];

  const items = [];
  let currentStream = null;
  let currentType = null;

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    if (row.every(v => v == null || v === '')) continue;

    const descRaw = row[descCol];
    const amt = toNumber(row[amountCol]);
    const nonEmptyCount = row.filter(v => v != null && v !== '').length;

    // Section header: description present, no amount, few non-empty cells
    if (descRaw != null && String(descRaw).trim() !== '' && amt == null && nonEmptyCount <= 3) {
      const n = norm(descRaw);
      const s = classifyStream(n);
      const t = classifyType(n);
      if (s) currentStream = s;
      if (t) currentType = t;
      continue;
    }

    if (descRaw == null || String(descRaw).trim() === '' || amt == null) continue;

    let stream = currentStream || 'goods';
    let lineType = currentType || 'revenue';
    if (streamCol >= 0 && row[streamCol]) stream = classifyStream(norm(row[streamCol])) || stream;
    if (typeCol >= 0 && row[typeCol]) {
      const t = classifyType(norm(row[typeCol]));
      if (t) lineType = t;
    }

    items.push({
      description: String(descRaw).trim(),
      amount: amt,
      currency: defaultCurrency,
      stream,
      line_type: lineType,
      source_ref: `Row ${r + 1}`,
    });
  }

  return items;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // ── Auth + privilege ──────────────────────────────────────────────────
    let user = null;
    try { user = await base44.auth.me(); } catch (_) { user = null; }
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const denied = requirePrivilege(user, 'create');
    if (denied) return denied;

    const body = await req.json();
    const { file_url, project_id, document_id, revision_label } = body;
    if (!file_url || !project_id)
      return Response.json({ error: 'file_url and project_id are required' }, { status: 400 });

    const actor = user?.full_name || user?.email || 'system';
    const source_file = decodeURIComponent(file_url.split('/').pop() || file_url);

    // ── Fetch and read workbook ─────────────────────────────────────────────
    const resp = await fetch(file_url);
    if (!resp.ok) return Response.json({ error: `Failed to fetch file: ${resp.status}` }, { status: 502 });
    const buf = await resp.arrayBuffer();
    const workbook = XLSX.read(new Uint8Array(buf), { type: 'array' });

    // ── Select sheet (by name "Charter", else B3 contains "INITIAL CHARTER") ──
    const sheetName = selectCharterSheet(workbook);
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

    // ── Parse identity block + six totals + line items ─────────────────────
    const identity = scanIdentity(rows);
    const totals = scanTotals(rows);
    const currency = String(identity.currency || 'SAR').trim().toUpperCase();
    const lineItems = extractLineItems(rows, currency);

    // ── Integrity warnings ──────────────────────────────────────────────────
    const warnings = [];
    const SIX_TOTALS = [
      'revenue_goods', 'revenue_services', 'revenue_support',
      'direct_cost_goods', 'direct_cost_services', 'direct_cost_support',
    ];
    for (const f of SIX_TOTALS) {
      if (totals[f] === undefined) warnings.push(`${f} not found in charter`);
    }
    // Warn if direct cost exceeds revenue for any stream
    for (const stream of ['goods', 'services', 'support']) {
      const rev = totals[`revenue_${stream}`];
      const cost = totals[`direct_cost_${stream}`];
      if (rev != null && cost != null && cost > rev) {
        warnings.push(`direct_cost_${stream} (${cost}) exceeds revenue_${stream} (${rev})`);
      }
    }
    if (lineItems.length === 0) warnings.push('No BaselineLine rows detected — proposals will be empty');

    // ── Reconciliation ──────────────────────────────────────────────────────
    const revSum = (totals.revenue_goods || 0) + (totals.revenue_services || 0) + (totals.revenue_support || 0);
    const costSum = (totals.direct_cost_goods || 0) + (totals.direct_cost_services || 0) + (totals.direct_cost_support || 0);
    const source_total = revSum - costSum;
    const calculated_total = lineItems.reduce((s, li) =>
      s + (li.line_type === 'revenue' ? li.amount : -li.amount), 0
    );
    const variance = source_total - calculated_total;
    const variance_pct = calculated_total !== 0 ? (variance / Math.abs(calculated_total)) : 0;
    let reconStatus = 'unverified';
    if (lineItems.length > 0 && revSum > 0) {
      reconStatus = Math.abs(variance_pct) < 0.01 ? 'ok' : Math.abs(variance_pct) < 0.05 ? 'warning' : 'error';
    }

    // ── 1. Create CharterBaseline ──────────────────────────────────────────
    const baseline = await base44.asServiceRole.entities.CharterBaseline.create({
      project_id,
      revision_label: revision_label || `Rev 0`,
      status: 'draft',
      source_document_id: document_id || undefined,
      revenue_goods: toNumber(totals.revenue_goods) || 0,
      revenue_services: toNumber(totals.revenue_services) || 0,
      revenue_support: toNumber(totals.revenue_support) || 0,
      direct_cost_goods: toNumber(totals.direct_cost_goods) || 0,
      direct_cost_services: toNumber(totals.direct_cost_services) || 0,
      direct_cost_support: toNumber(totals.direct_cost_support) || 0,
      indirect_cost_goods: toNumber(totals.indirect_cost_goods) || 0,
      indirect_cost_services: toNumber(totals.indirect_cost_services) || 0,
      indirect_cost_support: toNumber(totals.indirect_cost_support) || 0,
      target_markup_pct: toNumber(identity.target_markup_pct) || 0,
      planned_manhours: toNumber(identity.planned_manhours) || 0,
      manhour_rate: toNumber(identity.manhour_rate) || 0,
      fx_usd: toNumber(identity.fx_usd) || 0,
      fx_eur: toNumber(identity.fx_eur) || 0,
      integrity_warnings: warnings,
      reconciliation: {
        source_total,
        calculated_total,
        variance,
        variance_pct,
        status: reconStatus,
      },
      notes: `Imported from ${source_file}`,
    });

    // ── 2. Build BaselineLine proposals ─────────────────────────────────────
    const proposals = lineItems.map((li, idx) => ({
      id: `bl-line-${idx + 1}`,
      target_table: 'BaselineLine',
      target_action: 'create',
      display_label: li.description || `${li.stream} ${li.line_type}`,
      payload: {
        baseline_id: baseline.id,
        project_id,
        stream: li.stream,
        line_type: li.line_type,
        description: li.description,
        amount: li.amount,
        currency: li.currency,
        sort_order: idx + 1,
        source_ref: li.source_ref,
      },
      status: 'pending',
      confidence: 0.9,
    }));

    // ── 3. Create Extraction (extraction_kind "charter", status "review") ────
    const extraction = await base44.asServiceRole.entities.Extraction.create({
      project_id,
      document_id: document_id || undefined,
      document_title: source_file,
      status: 'review',
      extraction_kind: 'charter',
      header: {
        sheet: sheetName,
        identity: {
          project_name: identity.project_name || '',
          client: identity.client || '',
          document_date: identity.document_date || '',
          currency,
          revision_label: identity.revision_label || revision_label || '',
          project_manager: identity.project_manager || '',
          target_markup_pct: toNumber(identity.target_markup_pct) || 0,
          planned_manhours: toNumber(identity.planned_manhours) || 0,
          manhour_rate: toNumber(identity.manhour_rate) || 0,
          fx_usd: toNumber(identity.fx_usd) || 0,
          fx_eur: toNumber(identity.fx_eur) || 0,
        },
        totals: {
          revenue_goods: toNumber(totals.revenue_goods) || 0,
          revenue_services: toNumber(totals.revenue_services) || 0,
          revenue_support: toNumber(totals.revenue_support) || 0,
          direct_cost_goods: toNumber(totals.direct_cost_goods) || 0,
          direct_cost_services: toNumber(totals.direct_cost_services) || 0,
          direct_cost_support: toNumber(totals.direct_cost_support) || 0,
        },
      },
      proposals,
      created_entity_refs: [{
        entity_type: 'CharterBaseline',
        entity_id: baseline.id,
        action: 'created',
        before: {},
        applied_updated_date: baseline.updated_date,
      }],
    });

    // ── 4. AuditLog — action "baseline_imported" ────────────────────────────
    // All six required fields: project_id, entity_type, entity_id, action, actor, summary.
    await base44.asServiceRole.entities.AuditLog.create({
      project_id,
      entity_type: 'CharterBaseline',
      entity_id: baseline.id,
      action: 'baseline_imported',
      actor,
      summary: `Charter baseline "${baseline.revision_label}" imported from ${source_file}`,
      metadata: {
        extraction_id: extraction.id,
        sheet: sheetName,
        line_count: proposals.length,
        reconciliation_status: reconStatus,
      },
    });

    return Response.json({
      baseline_id: baseline.id,
      extraction_id: extraction.id,
      sheet: sheetName,
      identity,
      totals: {
        revenue_goods: toNumber(totals.revenue_goods) || 0,
        revenue_services: toNumber(totals.revenue_services) || 0,
        revenue_support: toNumber(totals.revenue_support) || 0,
        direct_cost_goods: toNumber(totals.direct_cost_goods) || 0,
        direct_cost_services: toNumber(totals.direct_cost_services) || 0,
        direct_cost_support: toNumber(totals.direct_cost_support) || 0,
      },
      line_count: proposals.length,
      reconciliation: { source_total, calculated_total, variance, variance_pct, status: reconStatus },
      warnings,
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Charter baseline import failed' }, { status: 500 });
  }
});