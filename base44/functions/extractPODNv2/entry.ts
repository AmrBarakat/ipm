/**
 * extractPODNv2 — a republish of extractPODN with all shared helper code
 * inlined directly into this file. Zero relative imports. The only external
 * dependency is createClientFromRequest from @base44/sdk.
 *
 * This is a republish, not a rewrite: the logic, prompts, schemas, stage
 * names, and response fields are identical to extractPODN. The only
 * differences are the BUILD_ID value and the fact that matchLine +
 * buildProfileAssertions now live in this file.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// BUILD_ID — bump the date suffix on every edit to this function so it is
// always provable which build is live.
const BUILD_ID = 'podnv2-2026-08-04-a';

// ═══════════════════════════════════════════════════════════════════════════
// INLINED: base44/shared/matchLine.ts (exports removed — local only)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * matchLine — tiered PO/DN line → BOMItem matcher (R6).
 *
 * Replaces the single-tier exact match from podnApply.ts. Shared between
 * extractPODN (read-only) and the apply step. Never mutates BOMItems.
 */

// ── A. ERP prefix rule ───────────────────────────────────────────────────────
// The ONLY vendor prefixes are ES. / TQ. / ES.TQ. / TQ.ES. Everything after the
// prefix is the part number and must be preserved intact (no further stripping
// of manufacturer names or category words).

const ERP_PREFIXES = ['es.tq.', 'tq.es.', 'es.', 'tq.'];

function stripErpPrefix(s: string): string {
  if (!s) return '';
  let current = String(s).trim();
  let guard = 0;
  // Repeatedly remove a leading prefix until none remains.
  while (guard++ < 10) {
    const lower = current.toLowerCase();
    const hit = ERP_PREFIXES.find((p) => lower.startsWith(p));
    if (!hit) break;
    current = current.slice(hit.length);
  }
  // If stripping would leave an empty string, return the original.
  return current.trim() || String(s).trim();
}

function normalizeCode(s: string): string {
  return String(s || '').toUpperCase().trim().replace(/[^A-Z0-9]/g, '');
}

function tailSegment(s: string): string {
  const stripped = stripErpPrefix(s);
  // Split on "." and "-" and take the final non-empty segment.
  const parts = stripped.split(/[.\-]/).map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : stripped;
}

// ── B. Tiered match ──────────────────────────────────────────────────────────
interface LineInput {
  erp_item_code?: string | null;
  part_number?: string | null;
  description?: string | null;
  ocr_uncertain?: boolean | null;
  qty?: number | null;
  unit_price?: number | null;
}

interface BomItemLike {
  id: string;
  manufacturer_part_number?: string | null;
  item_code?: string | null;
  erp_item_code?: string | null;
  match_aliases?: string[] | null;
  description?: string | null;
}

interface AliasLike {
  normalized_code?: string | null;
  bom_item_id?: string | null;
  project_id?: string | null;
}

interface MatchCandidate {
  bom_item_id: string;
  score: number;
  tier: string;
}

interface MatchResult {
  bom_item_id: string | null;
  confidence: number;
  tier: string;
  candidates: MatchCandidate[];
  selected: boolean;
}

// Tokenize a description for the description tier.
function tokenize(s: string): string[] {
  return String(s || '')
    .toLowerCase()
    .split(/[\s/()[\],;:]+/)
    .map((t) => t.replace(/[^a-z0-9]/g, ''))
    .filter((t) => t.length >= 3);
}

function descriptionScore(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  const smaller = Math.min(ta.size, tb.size);
  return shared / smaller;
}

function matchLine({
  line,
  bomItems,
  aliases,
}: {
  line: LineInput;
  bomItems: BomItemLike[];
  aliases?: AliasLike[];
}): MatchResult {
  const erp = (line.erp_item_code || '').trim();
  const rawPart = (line.part_number || '').trim();
  const strippedPart = stripErpPrefix(rawPart);
  const normStripped = normalizeCode(strippedPart);
  const normRaw = normalizeCode(rawPart);
  const tail = tailSegment(rawPart);
  const normTail = normalizeCode(tail);

  // Build alias lookup keyed by normalized_code.
  const aliasByNorm = new Map<string, string>(); // normalized_code -> bom_item_id
  for (const a of aliases || []) {
    const k = normalizeCode(a.normalized_code || '');
    if (k && a.bom_item_id && !aliasByNorm.has(k)) aliasByNorm.set(k, a.bom_item_id);
  }

  // Precompute per-BOM normalized keys once.
  const bomKeys = bomItems.map((b) => {
    const mfgStripped = stripErpPrefix(b.manufacturer_part_number || '');
    return {
      b,
      mfgStrippedNorm: normalizeCode(mfgStripped),
      mfgRawNorm: normalizeCode(b.manufacturer_part_number || ''),
      codeNorm: normalizeCode(b.item_code || ''),
      erpNorm: normalizeCode(b.erp_item_code || ''),
      aliases: Array.isArray(b.match_aliases) ? b.match_aliases.map(normalizeCode).filter(Boolean) : [],
    };
  });

  let best: { bom_item_id: string; score: number; tier: string } | null = null;

  // tier "erp" — 1.00
  if (erp) {
    const erpNorm = normalizeCode(erp);
    const hit = bomKeys.find((k) => k.erpNorm && k.erpNorm === erpNorm);
    if (hit) best = { bom_item_id: hit.b.id, score: 1.0, tier: 'erp' };
  }

  // tier "alias" — 0.98
  if (!best && normStripped) {
    const aliasBomId = aliasByNorm.get(normStripped);
    if (aliasBomId) {
      best = { bom_item_id: aliasBomId, score: 0.98, tier: 'alias' };
    }
    if (!best) {
      const hit = bomKeys.find((k) => k.aliases.includes(normStripped));
      if (hit) best = { bom_item_id: hit.b.id, score: 0.98, tier: 'alias' };
    }
  }

  // tier "exact" — 0.95 (primary; implements the ERP-prefix rule directly)
  if (!best && normStripped) {
    const hit = bomKeys.find(
      (k) => (k.mfgStrippedNorm && k.mfgStrippedNorm === normStripped) || (k.codeNorm && k.codeNorm === normStripped)
    );
    if (hit) best = { bom_item_id: hit.b.id, score: 0.95, tier: 'exact' };
  }

  // tier "raw" — 0.90 (prefix still attached)
  if (!best && normRaw) {
    const hit = bomKeys.find(
      (k) => (k.mfgRawNorm && k.mfgRawNorm === normRaw) || (k.codeNorm && k.codeNorm === normRaw)
    );
    if (hit) best = { bom_item_id: hit.b.id, score: 0.9, tier: 'raw' };
  }

  // tier "tail" — 0.75 (tail ≥ 5 chars, exactly ONE BOM item)
  if (!best && normTail && normTail.length >= 5) {
    const tailHits = bomKeys.filter(
      (k) => (k.mfgStrippedNorm && k.mfgStrippedNorm.endsWith(normTail)) || (k.codeNorm && k.codeNorm === normTail) || (k.mfgStrippedNorm && k.mfgStrippedNorm === normTail)
    );
    // Deduplicate by bom id.
    const byId = new Map<string, typeof tailHits[number]>();
    for (const t of tailHits) if (!byId.has(t.b.id)) byId.set(t.b.id, t);
    if (byId.size === 1) {
      const only = byId.values().next().value;
      best = { bom_item_id: only.b.id, score: 0.75, tier: 'tail' };
    }
  }

  // tier "contains" — 0.70 (shorter ≥ 5 chars, exactly ONE BOM item)
  if (!best && normStripped && normStripped.length >= 5) {
    const containHits: { b: BomItemLike }[] = [];
    for (const k of bomKeys) {
      const mfg = k.mfgStrippedNorm || k.mfgRawNorm;
      if (!mfg) continue;
      if (mfg.includes(normStripped) || normStripped.includes(mfg)) {
        containHits.push({ b: k.b });
      }
    }
    const byId = new Map<string, BomItemLike>();
    for (const c of containHits) if (!byId.has(c.b.id)) byId.set(c.b.id, c.b);
    if (byId.size === 1) {
      const only = byId.values().next().value;
      best = { bom_item_id: only.id, score: 0.7, tier: 'contains' };
    }
  }

  // tier "description" — 0.55 (token overlap ≥ 0.5, beats runner-up by 0.15)
  if (!best && line.description) {
    const scored = bomItems
      .map((b) => ({ b, score: descriptionScore(line.description || '', b.description || '') }))
      .filter((x) => x.score >= 0.5)
      .sort((a, b) => b.score - a.score);
    if (scored.length) {
      const top = scored[0];
      const runner = scored[1];
      if (top.score >= 0.5 && (!runner || top.score - runner.score >= 0.15)) {
        best = { bom_item_id: top.b.id, score: 0.55, tier: 'description' };
      }
    }
  }

  // ── Build ranked candidates[] (top 5) ──────────────────────────────────────
  const all: MatchCandidate[] = bomItems.map((b) => {
    const mfgStripped = stripErpPrefix(b.manufacturer_part_number || '');
    const mfgStrippedNorm = normalizeCode(mfgStripped);
    const codeNorm = normalizeCode(b.item_code || '');
    const erpNorm = normalizeCode(b.erp_item_code || '');

    let score = 0;
    let tier = 'none';
    if (erp && erpNorm === erpNorm && normalizeCode(erp) === erpNorm) {
      score = 1.0;
      tier = 'erp';
    }
    if (normStripped) {
      if (score < 0.98 && aliasByNorm.get(normStripped) === b.id) { score = 0.98; tier = 'alias'; }
      if (score < 0.95 && (mfgStrippedNorm === normStripped || codeNorm === normStripped)) { score = 0.95; tier = 'exact'; }
      if (score < 0.9) {
        const mfgRawNorm = normalizeCode(b.manufacturer_part_number || '');
        if (mfgRawNorm === normStripped || codeNorm === normStripped) { score = 0.9; tier = 'raw'; }
      }
      if (score < 0.75 && normTail.length >= 5 && (mfgStrippedNorm === normTail || mfgStrippedNorm?.endsWith(normTail) || codeNorm === normTail)) {
        score = 0.75;
        tier = 'tail';
      }
      if (score < 0.7 && normStripped.length >= 5 && mfgStrippedNorm && (mfgStrippedNorm.includes(normStripped) || normStripped.includes(mfgStripped))) {
        score = 0.7;
        tier = 'contains';
      }
    }
    if (score < 0.55 && line.description) {
      const ds = descriptionScore(line.description, b.description || '');
      if (ds >= 0.5) { score = 0.55; tier = 'description'; }
    }
    return { bom_item_id: b.id, score, tier };
  });

  all.sort((a, b) => b.score - a.score);
  const candidates = all.slice(0, 5);

  // ── R6: auto-select ─────────────────────────────────────────────────────────
  const confidence = best ? best.score : 0;
  const tier = best ? best.tier : 'none';
  const bom_item_id = best ? best.bom_item_id : null;
  const ocrUncertain = !!line.ocr_uncertain;
  const hasQtyAndPrice = line.qty != null && line.qty !== 0 && line.unit_price != null;
  const selected = !!best && confidence >= 0.85 && !ocrUncertain && hasQtyAndPrice;

  return { bom_item_id, confidence, tier, candidates, selected };
}

// ═══════════════════════════════════════════════════════════════════════════
// INLINED: buildProfileAssertions from base44/shared/documentProfile.ts
// (export removed — local only)
// ═══════════════════════════════════════════════════════════════════════════

/** Build the assertion text injected into the extraction LLM prompt. */
function buildProfileAssertions(profiles: any[]): string {
  if (!profiles || !profiles.length) return '';
  const lines: string[] = [];
  for (const p of profiles) {
    if (!p?.issuer_key) continue;
    const head = p.issuer_display_name ? `Issuer '${p.issuer_key}' (${p.issuer_display_name})` : `Issuer '${p.issuer_key}'`;
    const facts: string[] = [];
    if (p.date_format) facts.push(`dates are ${p.date_format}`);
    if (p.prices_are_net) facts.push('prices are net of tax');
    if (p.part_code_pattern === 'bracketed_in_description') {
      const prefs = Array.isArray(p.known_prefixes) && p.known_prefixes.length ? ` prefixed with ${p.known_prefixes.join(' or ')}` : '';
      facts.push(`part codes appear bracketed inside the Description column${prefs}`);
    } else if (p.part_code_pattern === 'separate_column') {
      facts.push('part codes appear in a dedicated column');
    }
    if (p.currency) facts.push(`currency is ${p.currency}`);
    const ch = p.column_hints || {};
    const cols: string[] = [];
    if (ch.qty) cols.push(`quantity column is labeled "${ch.qty}"`);
    if (ch.unit_price) cols.push(`unit price column is labeled "${ch.unit_price}"`);
    if (ch.net_amount) cols.push(`net amount column is labeled "${ch.net_amount}"`);
    if (ch.delivery_date) cols.push(`delivery date column is labeled "${ch.delivery_date}"`);
    if (ch.erp_code) cols.push(`ERP/item code column is labeled "${ch.erp_code}"`);
    if (cols.length) facts.push(cols.join('; '));
    if (Array.isArray(p.payment_terms_seen) && p.payment_terms_seen.length) {
      facts.push(`payment terms seen: ${p.payment_terms_seen.slice(0, 5).join('; ')}`);
    }
    if (facts.length) lines.push(`- ${head}: ${facts.join('; ')}.`);
  }
  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// extractPODNv2 — main function body (identical logic to extractPODN)
// ═══════════════════════════════════════════════════════════════════════════

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp'];
const SHEET_EXTS = ['.xlsx', '.xls', '.csv', '.html', '.json'];
const UNSUPPORTED_EXTS = ['.xlsm', '.xlsb', '.doc', '.docx', '.ppt', '.pptx'];

const TEXT_EXTRACT_SCHEMA = {
  type: 'object',
  properties: { raw_text: { type: 'string', description: 'Full text content of the document' } },
};

// ── Flat extraction schema (vendor + terms flattened — no nested objects) ────
const FLAT_PODN_SCHEMA = {
  type: 'object',
  properties: {
    document_type: { type: 'string', enum: ['po', 'delivery_note'] },
    document_number: { type: 'string' },
    document_date: { type: 'string' },
    currency: { type: 'string' },
    subtotal_net: { type: 'number' },
    total_amount: { type: 'number' },
    total_quantity: { type: 'number' },
    vendor_name: { type: 'string' },
    vendor_supplier_code: { type: 'string' },
    vendor_tax_number: { type: 'string' },
    vendor_contact_name: { type: 'string' },
    vendor_email: { type: 'string' },
    vendor_phone: { type: 'string' },
    vendor_address: { type: 'string' },
    vendor_country: { type: 'string' },
    payment_terms: { type: 'string' },
    incoterm: { type: 'string' },
    mode_of_shipping: { type: 'string' },
    warehouse_code: { type: 'string' },
    supplier_ref: { type: 'string' },
    pr_number: { type: 'string' },
    purchaser: { type: 'string' },
    requested_by: { type: 'string' },
    line_items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          line_no: { type: 'number' },
          erp_item_code: { type: 'string' },
          part_number: { type: 'string' },
          description: { type: 'string' },
          uom: { type: 'string' },
          qty: { type: 'number' },
          unit_price: { type: 'number' },
          net_amount: { type: 'number' },
          supplier_delivery_date: { type: 'string' },
          ocr_uncertain: { type: 'boolean' },
        },
      },
    },
    secondary_document: {
      type: 'object',
      properties: {
        present: { type: 'boolean' },
        kind: { type: 'string' },
        reference: { type: 'string' },
        prices_include_tax: { type: 'boolean' },
        lines: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string' },
              part_number: { type: 'string' },
              qty: { type: 'number' },
              unit_price: { type: 'number' },
            },
          },
        },
      },
    },
  },
};

// ── R8: parse payment terms into a cash-flow schedule ────────────────────────
function parsePaymentTerms(raw: string, subtotalNet: number): any[] {
  if (!raw) return [{ label: '', percent_due: 100, trigger: 'unknown', offset_days: 0 }];
  const s = raw.trim().toLowerCase();

  const splitAdvanceDel = s.match(/(\d+)%\s+advance[^-]*[-–]\s*(\d+)%\s+on\s+delivery/i);
  if (splitAdvanceDel) {
    const p1 = Number(splitAdvanceDel[1]);
    const p2 = Number(splitAdvanceDel[2]);
    const unit = subtotalNet / 100;
    return [
      { label: 'Advance', percent_due: p1, amount_due: +(p1 * unit).toFixed(2), trigger: 'on_order', offset_days: 0 },
      { label: 'On delivery', percent_due: p2, amount_due: +(p2 * unit).toFixed(2), trigger: 'on_delivery', offset_days: 0 },
    ];
  }

  if (/100%\s+advance/i.test(s)) {
    return [{ label: 'Advance', percent_due: 100, amount_due: +subtotalNet.toFixed(2), trigger: 'on_order', offset_days: 0 }];
  }

  const netDays = s.match(/(?:net|credit)?\s*(\d+)\s*days?\s*(?:credit)?/i);
  if (netDays) {
    const days = Number(netDays[1]);
    return [{ label: `Net ${days}`, percent_due: 100, amount_due: +subtotalNet.toFixed(2), trigger: 'days_after_invoice', offset_days: days }];
  }

  const daysCredit = s.match(/(\d+)\s+days?\s+credit/i);
  if (daysCredit) {
    const days = Number(daysCredit[1]);
    return [{ label: `Net ${days}`, percent_due: 100, amount_due: +subtotalNet.toFixed(2), trigger: 'days_after_invoice', offset_days: days }];
  }

  return [{ label: raw, percent_due: 100, amount_due: +subtotalNet.toFixed(2), trigger: 'unknown', offset_days: 0 }];
}

// ── Simple description/part normalizer for R4 quotation matching ──────────────
function normalizeDesc(s: string): string {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ── R4: attach quoted_unit_price + price_variance_pct to primary lines ────────
function attachQuotationVariance(lineItems: any[], secondary: any): any[] {
  if (!secondary?.present || !Array.isArray(secondary.lines) || !secondary.lines.length) return lineItems;
  const pricesIncludeTax = !!secondary.prices_include_tax;
  return lineItems.map((li) => {
    const liDesc = normalizeDesc(li.description);
    const liPart = normalizeDesc(li.part_number);
    const match = secondary.lines.find((sl: any) => {
      const slDesc = normalizeDesc(sl.description);
      const slPart = normalizeDesc(sl.part_number);
      if (liPart && slPart && liPart === slPart) return true;
      if (liDesc && slDesc && liDesc.length > 6 && (liDesc.includes(slDesc) || slDesc.includes(liDesc))) return true;
      return false;
    });
    if (!match || match.unit_price == null) return li;
    const quoted = match.unit_price;
    const variance = li.unit_price != null && quoted !== 0
      ? +((li.unit_price - quoted) / quoted).toFixed(6)
      : null;
    return {
      ...li,
      quoted_unit_price: quoted,
      price_variance_pct: pricesIncludeTax ? null : variance,
      variance_comparable: !pricesIncludeTax,
    };
  });
}

// ── D: server-side validation — warnings only, never fatal ───────────────────
function validateExtraction(lineItems: any[], subtotalNet: number | null, totalAmount: number | null, totalQty: number | null): string[] {
  const warnings: string[] = [];
  let lineSum = 0;
  let qtySum = 0;
  for (const li of lineItems) {
    if (li.qty != null && li.unit_price != null && li.net_amount != null) {
      const computed = +(li.qty * li.unit_price).toFixed(4);
      const diff = Math.abs(computed - li.net_amount);
      if (diff > 0.02) {
        li.ocr_uncertain = true;
        warnings.push(`Line ${li.line_no ?? '?'}: ${li.qty} × ${li.unit_price} = ${computed}, document says ${li.net_amount}`);
      }
    }
    if (li.net_amount != null) lineSum += li.net_amount;
    if (li.qty != null) qtySum += li.qty;
  }
  lineSum = +lineSum.toFixed(4);
  const docTotal = subtotalNet ?? totalAmount;
  if (docTotal != null && Math.abs(lineSum - docTotal) > 0.05) {
    warnings.push(`Line total ${lineSum} does not match document total ${docTotal}`);
  }
  if (totalQty != null && Math.abs(qtySum - totalQty) > 0.01) {
    warnings.push(`Quantity total ${qtySum} does not match document total_quantity ${totalQty}`);
  }
  if (docTotal != null && docTotal > 0) {
    const ratio = lineSum / docTotal;
    if (Math.abs(ratio - 1.15) / 1.15 < 0.005) {
      warnings.push('Extracted figures appear to include 15% tax — this system stores net prices only. Confirm the unit prices before applying.');
    }
  }
  return warnings;
}

// ── Schema-less retry: parse a string/obj LLM reply into a flat object ────────
function coerceRetryResult(raw: any): any {
  let obj: any = raw;
  if (typeof raw === 'string') {
    let s = raw.trim();
    s = s.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    try { obj = JSON.parse(s); } catch (_) { obj = {}; }
  }
  if (!obj || typeof obj !== 'object') obj = {};
  return obj;
}

// ── Reassemble the nested vendor/terms shapes the downstream expects ────────
function reassembleVendorTerms(extracted: any): { vendor: any; terms: any } {
  return {
    vendor: {
      name: extracted?.vendor_name || '',
      supplier_code: extracted?.vendor_supplier_code || '',
      tax_number: extracted?.vendor_tax_number || '',
      contact_name: extracted?.vendor_contact_name || '',
      email: extracted?.vendor_email || '',
      phone: extracted?.vendor_phone || '',
      address: extracted?.vendor_address || '',
      country: extracted?.vendor_country || '',
    },
    terms: {
      payment_terms: extracted?.payment_terms || '',
      incoterm: extracted?.incoterm || '',
      mode_of_shipping: extracted?.mode_of_shipping || '',
      warehouse_code: extracted?.warehouse_code || '',
      supplier_ref: extracted?.supplier_ref || '',
      pr_number: extracted?.pr_number || '',
      purchaser: extracted?.purchaser || '',
      requested_by: extracted?.requested_by || '',
    },
  };
}

// ── Derive observed_conventions server-side (no longer in the LLM schema) ─────
function deriveObservedConventions(docText: string, currency: string, subtotalNet: number | null, lineItems: any[]): any {
  const oc: any = {};
  if (docText) {
    if (/\b\d{2}\/\d{2}\/\d{4}\b/.test(docText)) oc.date_format = 'DD/MM/YYYY';
    else if (/\b\d{4}-\d{2}-\d{2}\b/.test(docText)) oc.date_format = 'YYYY-MM-DD';
  }
  oc.currency = currency || '';
  oc.prices_appear_net = subtotalNet != null;
  oc.part_code_location = lineItems.some((li) => /\[[^\]]+\]/.test(li?.description || '')) ? 'bracketed_in_description' : 'none';
  return oc;
}

// ── safe: wrap a promise so it can never reject (Deno kills unhandled rejections) ──
const safe = <T,>(p: Promise<T>, label: string) =>
  p.then((v) => ({ ok: true as const, value: v }))
   .catch((e: any) => ({ ok: false as const, label, error: e?.message || String(e) }));

Deno.serve(async (req) => {
  let stage = 'init';
  let extractionId = '';
  let extractionPersistError = '';
  let base44: any;
  try {
    base44 = createClientFromRequest(req);

    // ── auth ──────────────────────────────────────────────────────────────
    stage = 'auth';
    let user: any = null;
    try { user = await base44.auth.me(); } catch (_) { user = null; }
    if (!user) return Response.json({ build_id: BUILD_ID, error: 'Unauthorized', stage, partial: true }, { status: 401 });

    // ── input ─────────────────────────────────────────────────────────────
    stage = 'input';
    const body = await req.json();
    const { file_url, project_id, doc_hint, document_id, document_title, force_vision } = body;
    if (!file_url || !project_id)
      return Response.json({ build_id: BUILD_ID, error: 'file_url and project_id are required', stage, partial: true }, { status: 400 });
    if (doc_hint && !['po', 'delivery_note', 'auto'].includes(doc_hint))
      return Response.json({ build_id: BUILD_ID, error: "doc_hint must be 'po', 'delivery_note', or 'auto'", stage, partial: true }, { status: 400 });

    const debugMode = new URL(req.url).searchParams.get('debug') === '1';

    const urlLower = file_url.toLowerCase().split('?')[0];
    const ext = urlLower.match(/\.[^.]+$/)?.[0] || '';
    if (UNSUPPORTED_EXTS.includes(ext))
      return Response.json({ build_id: BUILD_ID, error: `File type "${ext}" is not supported for extraction.`, stage, partial: true }, { status: 400 });

    const isImage = IMAGE_EXTS.includes(ext);
    const isSheet = SHEET_EXTS.includes(ext);

    // Create the Extraction record EARLY with status 'processing'.
    let extraction: any = null;
    try {
      extraction = await base44.asServiceRole.entities.Extraction.create({
        project_id,
        document_id: document_id || '',
        document_title: document_title || 'Untitled',
        status: 'processing',
        extraction_kind: 'other',
        header: {},
        proposals: [],
        input_text: JSON.stringify({ stage, file_url, project_id, doc_hint, force_vision: !!force_vision }),
        summary: `Processing — stage: ${stage}`,
      });
      extractionId = extraction.id;
    } catch (e: any) { extraction = null; extractionPersistError = e?.message || String(e); }

    // Fire ALL entity lookups BEFORE the file read + LLM so they run
    // concurrently with the slow integration calls. Awaited later via
    // Promise.allSettled. Duplicate PO/Expense detection is done in memory
    // against the project-wide fetch (no per-document filter call).
    // Fire ALL entity lookups BEFORE the file read + LLM so they run
    // concurrently with the slow integration calls. Each is wrapped with `safe`
    // so an unhandled rejection can never kill the Deno isolate — failures are
    // surfaced as warnings after the LLM returns. Duplicate PO/Expense detection
    // is done in memory against the project-wide fetch (no per-document call).
    const bomP = safe(base44.asServiceRole.entities.BOMItem.filter({ project_id }, '-created_date', 1000), 'BOMItem');
    const aliasesProjP = safe(base44.asServiceRole.entities.PartAlias.filter({ project_id }, '-created_date', 1000), 'PartAlias(project)');
    const aliasesGlobalP = safe(base44.asServiceRole.entities.PartAlias.filter({ project_id: '' }, '-created_date', 1000), 'PartAlias(global)');
    const posP = safe(base44.asServiceRole.entities.PurchaseOrder.filter({ project_id }, '-created_date', 200), 'PurchaseOrder');
    const expensesP = safe(base44.asServiceRole.entities.Expense.filter({ project_id }, '-created_date', 200), 'Expense');
    const profilesP = safe(base44.asServiceRole.entities.DocumentProfile.list('-last_seen', 20), 'DocumentProfile');

    // ── read_file (text-first, vision only when needed) ────────────────────
    stage = 'read_file';
    let docText = '';
    let useVision = false;
    const extractText = () => base44.asServiceRole.integrations.Core.ExtractDataFromUploadedFile({ file_url, json_schema: TEXT_EXTRACT_SCHEMA });
    if (isImage) {
      useVision = true;
    } else if (isSheet) {
      try {
        const e: any = await extractText();
        docText = e?.output?.raw_text || (typeof e?.output === 'string' ? e.output : JSON.stringify(e?.output || ''));
      } catch (_) { docText = ''; }
      // Sheets: text only. (force_vision overrides below.)
    } else {
      // PDF / unknown: extract text, decide vision by text quality.
      try {
        const e: any = await extractText();
        docText = e?.output?.raw_text || (typeof e?.output === 'string' ? e.output : JSON.stringify(e?.output || ''));
      } catch (_) { docText = ''; }
      const hasTableRow = docText.length >= 200 && docText.split('\n').some((l) => /\d+\s+\S/.test(l));
      useVision = !(docText.length >= 200 && hasTableRow);
    }
    if (force_vision) useVision = true;

    // ── load_profiles (pre-filter on docText, cap 3 / 1500 chars) ───────────
    stage = 'load_profiles';
    let profileBlock = '';
    let profileWarning = '';
    if (docText) {
      const profilesRes = await profilesP;
      if (profilesRes.ok) {
        const profiles: any[] = profilesRes.value || [];
        if (profiles.length) {
          const dtLower = docText.toLowerCase();
          const relevant = profiles.filter((p) =>
            (p?.issuer_key && docText.includes(p.issuer_key)) ||
            (p?.issuer_display_name && dtLower.includes(String(p.issuer_display_name).toLowerCase())),
          ).slice(0, 3);
          if (relevant.length) {
            const block = buildProfileAssertions(relevant);
            if (block) profileBlock = block.slice(0, 1500);
          }
        }
      } else {
        profileWarning = `DocumentProfile could not be loaded — issuer conventions were not applied: ${profilesRes.error}`;
      }
    }

    const hint = doc_hint === 'po' ? 'This document is a Purchase Order.'
      : doc_hint === 'delivery_note' ? 'This document is a Delivery Note / Packing Slip.'
      : 'Detect whether this document is a Purchase Order or a Delivery Note / Packing Slip.';

    const docBlock = docText
      ? `DOCUMENT TEXT:\n${docText.slice(0, 6000)}\n\n${useVision ? 'The document is also attached as a file — cross-check the text against it for stamps, handwritten quantities, and table structure.' : ''}`
      : `The document is attached as a file. Read it carefully, including any stamps, handwritten quantities, signatures, and table structure. Perform accurate OCR on all line items.`;

    const fullPrompt = `You are an expert at parsing Purchase Orders, Delivery Notes, and Packing Slips for industrial automation projects.

${hint}

${docBlock}
${profileBlock ? `\nKNOWN ISSUER PROFILES (conventions learned from previously processed documents):\n${profileBlock}\n\nIf the vendor matches one of these issuers, apply that issuer's conventions as assertions. If the document plainly contradicts a profile, the document wins.\n` : ''}
Extract a complete, accurate result. Return null for any field you cannot read clearly.

FIELDS:
- document_type: "po" or "delivery_note".
- document_number: the PO or delivery note number.
- document_date: YYYY-MM-DD.
- currency: 3-letter ISO code, e.g. "SAR".
- subtotal_net: sub-total before tax. Numbers only, no symbols.
- total_amount: grand total including tax. Numbers only.
- total_quantity: sum of all line quantities.

VENDOR (flat fields):
- vendor_name: supplier company name.
- vendor_supplier_code: e.g. SUP03-00000010.
- vendor_tax_number: TRN / VAT registration (identity only — never used for price arithmetic).
- vendor_contact_name, vendor_email, vendor_phone, vendor_address, vendor_country.

TERMS (flat fields):
- payment_terms: verbatim Payment Condition text.
- incoterm, mode_of_shipping, warehouse_code.
- supplier_ref: Supplier Ref / quotation number.
- pr_number: PR No. (value before any " : " bank/account reference).
- purchaser, requested_by.

LINE ITEMS (primary document only):
- line_no: Sr. No.
- erp_item_code: the Item/Material column value, e.g. 243038.
- part_number: the code inside [brackets] in the Description column, returned verbatim including dots/hyphens/prefixes.
- description: full line description.
- uom: e.g. "EA".
- qty: quantity ordered (PO) or delivered (DN).
- unit_price: net Unit Price, numbers only.
- net_amount: Net Amount, numbers only.
- supplier_delivery_date: YYYY-MM-DD. Dates are DAY/MONTH/YEAR — 09/07/2026 = 9 July 2026.
- ocr_uncertain: true when any number on the line is uncertain.

ALL PRICES ARE NET OF TAX. Never compute a net price by dividing a tax-inclusive figure. If only tax-inclusive amounts are shown, return them as printed and set ocr_uncertain true on those lines. If a date is ambiguous, return null.

OCR: prefer handwritten/stamped quantity corrections over printed text. Return null for illegible quantities. Extract from ALL pages of the PRIMARY document only.

MULTIPLE DOCUMENTS: these files often contain the PO on page 1 and the supplier quotation on later pages. Extract line_items from the primary (PO/DN) only. If a secondary document (quotation/estimate/invoice) is present, set secondary_document.present=true with kind, reference, prices_include_tax, and lines [{description, part_number, qty, unit_price}].

Return JSON matching the schema exactly.`;

    // ── invoke_llm (schema-less retry on failure or non-array line_items) ──
    stage = 'invoke_llm';
    let llm_attempt: 1 | 2 = 1;
    let extracted: any = {};

    const llmCall = (withSchema: boolean) => base44.asServiceRole.integrations.Core.InvokeLLM({
      model: 'claude_sonnet_4_6',
      ...(useVision ? { file_urls: [file_url] } : {}),
      prompt: withSchema
        ? fullPrompt
        : `${fullPrompt}\n\nReturn ONLY a JSON object matching this structure, with no markdown fences and no commentary: { document_type, document_number, document_date, currency, subtotal_net, total_amount, total_quantity, vendor_name, vendor_supplier_code, vendor_tax_number, vendor_contact_name, vendor_email, vendor_phone, vendor_address, vendor_country, payment_terms, incoterm, mode_of_shipping, warehouse_code, supplier_ref, pr_number, purchaser, requested_by, line_items: [{ line_no, erp_item_code, part_number, description, uom, qty, unit_price, net_amount, supplier_delivery_date, ocr_uncertain }], secondary_document: { present, kind, reference, prices_include_tax, lines: [{ description, part_number, qty, unit_price }] } }`,
      ...(withSchema ? { response_json_schema: FLAT_PODN_SCHEMA } : {}),
    });

    let attempt1Ok = false;
    let _raw1: any;
    try {
      _raw1 = await llmCall(true);
      extracted = (_raw1 as any)?.response || _raw1 || {};
      if (Array.isArray(extracted?.line_items)) attempt1Ok = true;
    } catch (_) { attempt1Ok = false; }

    if (!attempt1Ok) {
      llm_attempt = 2;
      let _raw2: any;
      try {
        _raw2 = await llmCall(false);
        extracted = coerceRetryResult((_raw2 as any)?.response || _raw2 || {});
      } catch (e2) {
        if (extraction) {
          try { await base44.asServiceRole.entities.Extraction.update(extraction.id, { status: 'failed', summary: `Failed at stage: ${stage}` }); } catch (_) {}
        }
        return Response.json(
          { build_id: BUILD_ID, extraction_id: extractionId || null, error: (e2 as any)?.message || 'LLM invocation failed on both attempts', stage, partial: true },
          { status: 200 },
        );
      }
    }

    // ── parse (reassemble nested vendor/terms from the flat fields) ────────
    stage = 'parse';
    const document_type: string = extracted?.document_type === 'po' ? 'po' : 'delivery_note';
    const document_number: string = extracted?.document_number || '';
    const document_date: string = extracted?.document_date || '';
    const currency: string = extracted?.currency || 'SAR';
    const subtotal_net: number | null = extracted?.subtotal_net ?? null;
    const total_amount: number | null = extracted?.total_amount ?? null;
    const total_quantity: number | null = extracted?.total_quantity ?? null;
    const { vendor, terms } = reassembleVendorTerms(extracted);
    const secondary_document: any = extracted?.secondary_document || { present: false };
    let line_items: any[] = Array.isArray(extracted?.line_items) ? extracted.line_items : [];

    // ── validate ───────────────────────────────────────────────────────────
    stage = 'validate';
    const warnings = validateExtraction(line_items, subtotal_net, total_amount, total_quantity);
    line_items = attachQuotationVariance(line_items, secondary_document);

    // Derive observed_conventions server-side (no longer in the LLM schema).
    const observed_conventions = deriveObservedConventions(docText, currency, subtotal_net, line_items);

    // R8 payment schedule.
    const effectiveNet = subtotal_net ?? total_amount ?? 0;
    const payment_schedule = parsePaymentTerms(terms.payment_terms || '', effectiveNet);

    // ── Await the lookups that were fired before the file read + LLM ──────
    stage = 'match';
    const sideWarnings: string[] = [];
    if (profileWarning) sideWarnings.push(profileWarning);

    let bomItems: any[] = [];
    let aliases: any[] = [];
    let projectPOs: any[] = [];
    let projectExpenses: any[] = [];

    const bomRes = await bomP;
    const aliasesProjRes = await aliasesProjP;
    const aliasesGlobalRes = await aliasesGlobalP;
    const posRes = await posP;
    const expensesRes = await expensesP;

    if (bomRes.ok) bomItems = bomRes.value || [];
    else sideWarnings.push(`${bomRes.label} could not be loaded: ${bomRes.error}`);
    if (aliasesProjRes.ok) aliases = aliases.concat(aliasesProjRes.value || []);
    else sideWarnings.push(`${aliasesProjRes.label} could not be loaded: ${aliasesProjRes.error}`);
    if (aliasesGlobalRes.ok) aliases = aliases.concat(aliasesGlobalRes.value || []);
    else sideWarnings.push(`${aliasesGlobalRes.label} could not be loaded: ${aliasesGlobalRes.error}`);
    if (posRes.ok) projectPOs = posRes.value || [];
    else sideWarnings.push(`${posRes.label} could not be loaded: ${posRes.error}`);
    if (expensesRes.ok) projectExpenses = expensesRes.value || [];
    else sideWarnings.push(`${expensesRes.label} could not be loaded: ${expensesRes.error}`);

    const bomLoadFailed = !bomRes.ok;
    let auto_selected = 0;
    let needs_review = 0;
    if (bomLoadFailed) {
      line_items = line_items.map((li) => {
        needs_review++;
        return { ...li, bom_item_id: null, match_confidence: 0, match_tier: 'skipped', candidates: [], selected: false };
      });
    } else {
      line_items = line_items.map((li) => {
        const m = matchLine({
          line: {
            erp_item_code: li.erp_item_code,
            part_number: li.part_number,
            description: li.description,
            ocr_uncertain: li.ocr_uncertain,
            qty: li.qty,
            unit_price: li.unit_price,
          },
          bomItems,
          aliases,
        });
        if (m.selected) auto_selected++;
        else needs_review++;
        return {
          ...li,
          bom_item_id: m.bom_item_id,
          match_confidence: m.confidence,
          match_tier: m.tier,
          candidates: m.candidates,
          selected: m.selected,
        };
      });
    }

    // ── duplicates (in-memory match against the project-wide fetch) ────────
    stage = 'duplicates';
    const duplicates: any = {};
    if (document_number) {
      if (document_type === 'po') {
        const po = projectPOs.find((p) => p.po_number === document_number);
        if (po) {
          duplicates.purchase_order_id = po.id;
          duplicates.purchase_order_status = po.status;
        }
      }
      const exp = projectExpenses.find((e) => e.reference_number === document_number);
      if (exp) duplicates.expense_id = exp.id;
    }

    // ── create_extraction: patch the staging record to 'review' ───────────
    stage = 'create_extraction';
    const header = { document_number, document_date, currency, subtotal_net, total_amount, total_quantity, vendor, terms };
    const allWarnings = [...warnings, ...sideWarnings];
    const storable = {
      header,
      line_items,
      secondary_document,
      observed_conventions,
      payment_schedule,
      duplicates,
      warnings: allWarnings,
      counts: { auto_selected, needs_review },
      extraction_kind: document_type,
      used_vision: useVision,
      llm_attempt,
    };

    if (extraction) {
      try {
        await base44.asServiceRole.entities.Extraction.update(extraction.id, {
          document_title: document_title || document_number || 'Untitled',
          status: 'review',
          extraction_kind: document_type === 'po' ? 'po' : 'delivery_note',
          header,
          proposals: [],
          input_text: JSON.stringify(storable),
          summary: `${document_type === 'po' ? 'PO' : 'DN'} ${document_number} — ${line_items.length} line(s), ${auto_selected} auto-selected, ${needs_review} need review`,
        });
        extractionId = extraction.id;
      } catch (_) { /* keep the early id; response still carries everything */ }
    } else {
      try {
        const ext = await base44.asServiceRole.entities.Extraction.create({
          project_id,
          document_id: document_id || '',
          document_title: document_title || document_number || 'Untitled',
          status: 'review',
          extraction_kind: document_type === 'po' ? 'po' : 'delivery_note',
          header,
          proposals: [],
          input_text: JSON.stringify(storable),
          summary: `${document_type === 'po' ? 'PO' : 'DN'} ${document_number} — ${line_items.length} line(s), ${auto_selected} auto-selected, ${needs_review} need review`,
        });
        extractionId = ext.id;
      } catch (e: any) { extractionPersistError = e?.message || String(e); }
    }

    // ── Return ──────────────────────────────────────────────────────────────
    const responseExtractionId: string | null = extractionId || null;
    const responseWarnings = [...allWarnings];
    if (!responseExtractionId) {
      responseWarnings.push(
        `This extraction could not be saved for later review (${extractionPersistError || 'unknown persistence error'}). You can still apply it now, but you will not be able to resume or revert it.`,
      );
    }
    const response: any = {
      build_id: BUILD_ID,
      extraction_id: responseExtractionId,
      header,
      line_items,
      secondary_document,
      observed_conventions,
      payment_schedule,
      duplicates,
      warnings: responseWarnings,
      counts: { auto_selected, needs_review },
      used_vision: useVision,
      llm_attempt,
    };

    if (debugMode) {
      response.debug = {
        used_vision: useVision,
        text_len: docText.length,
        llm_attempt,
        line_item_count: line_items.length,
        stage,
      };
    }

    return Response.json(response);
  } catch (error) {
    if (base44 && extractionId) {
      try { await base44.asServiceRole.entities.Extraction.update(extractionId, { status: 'failed', summary: `Failed at stage: ${stage}` }); } catch (_) {}
    }
    return Response.json(
      { build_id: BUILD_ID, extraction_id: extractionId || null, error: (error as any)?.message || 'Extraction failed', stage, partial: true },
      { status: 200 },
    );
  }
});