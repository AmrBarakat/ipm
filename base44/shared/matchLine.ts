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

export function stripErpPrefix(s: string): string {
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

export function normalizeCode(s: string): string {
  return String(s || '').toUpperCase().trim().replace(/[^A-Z0-9]/g, '');
}

export function tailSegment(s: string): string {
  const stripped = stripErpPrefix(s);
  // Split on "." and "-" and take the final non-empty segment.
  const parts = stripped.split(/[.\-]/).map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : stripped;
}

// ── B. Tiered match ──────────────────────────────────────────────────────────
export interface LineInput {
  erp_item_code?: string | null;
  part_number?: string | null;
  description?: string | null;
  ocr_uncertain?: boolean | null;
  qty?: number | null;
  unit_price?: number | null;
}

export interface BomItemLike {
  id: string;
  manufacturer_part_number?: string | null;
  item_code?: string | null;
  erp_item_code?: string | null;
  match_aliases?: string[] | null;
  description?: string | null;
}

export interface AliasLike {
  normalized_code?: string | null;
  bom_item_id?: string | null;
  project_id?: string | null;
}

export interface MatchCandidate {
  bom_item_id: string;
  score: number;
  tier: string;
}

export interface MatchResult {
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

export function matchLine({
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