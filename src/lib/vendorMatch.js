/**
 * Shared vendor matching logic for BOM supplier reconciliation.
 *
 * Used by LinkSuppliersModal (bulk) and VendorLookup (single) to suggest the
 * best Vendor record for a free-text supplier string.
 *
 * Match tiers (in order):
 *   1. exact   — normalized name equality
 *   2. alias   — normalized alias equality
 *   3. fuzzy   — Jaccard token overlap >= 0.6
 */

export function normalizeSupplier(s) {
  return (s || '').toString().trim().replace(/\s+/g, ' ').toLowerCase();
}

function tokenize(s) {
  return new Set(
    normalizeSupplier(s)
      .split(/[\s,()./\-&_]+/)
      .filter(t => t.length > 1)
  );
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / new Set([...a, ...b]).size;
}

/**
 * Find the best vendor match for a supplier string.
 * Returns { vendor, tier, confidence } or null.
 */
export function suggestVendor(supplierString, vendors) {
  const target = normalizeSupplier(supplierString);
  if (!target || !vendors || vendors.length === 0) return null;

  // 1. Exact name match
  for (const v of vendors) {
    if (normalizeSupplier(v.name) === target)
      return { vendor: v, tier: 'exact', confidence: 1.0 };
  }

  // 2. Alias match
  for (const v of vendors) {
    const aliases = v.aliases || [];
    if (aliases.some(a => normalizeSupplier(a) === target))
      return { vendor: v, tier: 'alias', confidence: 0.95 };
  }

  // 3. Fuzzy token overlap
  const targetTokens = tokenize(supplierString);
  let best = null;
  for (const v of vendors) {
    const vendorTokens = tokenize(v.name);
    const score = jaccard(targetTokens, vendorTokens);
    if (score >= 0.6 && (!best || score > best.confidence)) {
      best = { vendor: v, tier: 'fuzzy', confidence: Math.round(score * 100) / 100 };
    }
    // Also check aliases for fuzzy matches
    for (const a of (v.aliases || [])) {
      const aliasTokens = tokenize(a);
      const aScore = jaccard(targetTokens, aliasTokens);
      if (aScore >= 0.6 && (!best || aScore > best.confidence)) {
        best = { vendor: v, tier: 'fuzzy', confidence: Math.round(aScore * 100) / 100 };
      }
    }
  }

  return best;
}

export const TIER_META = {
  exact:  { label: 'Exact name',  cls: 'bg-emerald-100 text-emerald-700' },
  alias:  { label: 'Alias match', cls: 'bg-blue-100 text-blue-700' },
  fuzzy:  { label: 'Fuzzy match', cls: 'bg-amber-100 text-amber-700' },
};