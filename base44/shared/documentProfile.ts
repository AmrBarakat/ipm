/**
 * DocumentProfile — learned conventions per document issuer.
 *
 * extractPODN loads profiles and injects them as LLM assertions so repeat POs
 * from the same vendor extract more accurately. applyPODNExtraction upserts the
 * profile on every successful apply. The document always wins over the profile;
 * the profile is updated to match what the document actually showed.
 */

/** Stable issuer key: supplier_code → tax_number → normalized vendor name. */
export function computeIssuerKey(vendor: { supplier_code?: string; tax_number?: string; name?: string }): string {
  const sc = String(vendor?.supplier_code || '').trim();
  if (sc) return sc;
  const tn = String(vendor?.tax_number || '').trim();
  if (tn) return tn;
  return String(vendor?.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Build the assertion text injected into the extraction LLM prompt. */
export function buildProfileAssertions(profiles: any[]): string {
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

function cleanHints(labels: any): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ['qty', 'unit_price', 'net_amount', 'delivery_date', 'erp_code']) {
    if (labels?.[k]) out[k] = String(labels[k]);
  }
  return out;
}

/**
 * Upsert the DocumentProfile for an issuer after a successful apply.
 * Increments sample_count and merges payment terms + column hints. Facts that
 * the document contradicted (date_format, prices_are_net, part_code_pattern) are
 * overwritten with what the document actually showed.
 */
export async function upsertProfile(client: any, args: {
  vendor: { supplier_code?: string; tax_number?: string; name?: string };
  document_kind: string;
  observed: any;
  payment_terms?: string;
  currency?: string;
  now: string;
}): Promise<void> {
  const { vendor, document_kind, observed, payment_terms, currency, now } = args;
  const issuer_key = computeIssuerKey(vendor);
  if (!issuer_key) return;

  let existing: any = null;
  try {
    existing = (await client.asServiceRole.entities.DocumentProfile.filter(
      { issuer_key, document_kind }, '-created_date', 1,
    ))[0];
  } catch (_) { existing = null; }

  const oc = observed || {};
  const colLabels = oc.column_labels || {};
  const paymentTermsSeen: string[] = Array.from(new Set<string>([
    ...((existing?.payment_terms_seen as string[]) || []),
    ...(payment_terms ? [String(payment_terms)] : []),
  ]));

  const data: any = {
    issuer_key,
    issuer_display_name: vendor?.name || existing?.issuer_display_name || '',
    document_kind,
    date_format: oc.date_format || existing?.date_format || '',
    currency: oc.currency || currency || existing?.currency || '',
    prices_are_net: oc.prices_appear_net != null ? !!oc.prices_appear_net : (existing?.prices_are_net != null ? existing.prices_are_net : true),
    column_hints: { ...(existing?.column_hints || {}), ...cleanHints(colLabels) },
    part_code_pattern: oc.part_code_location || existing?.part_code_pattern || '',
    known_prefixes: Array.isArray(existing?.known_prefixes) && existing.known_prefixes.length
      ? existing.known_prefixes : ['ES.', 'TQ.', 'ES.TQ.', 'TQ.ES.'],
    payment_terms_seen: paymentTermsSeen,
    sample_count: (Number(existing?.sample_count) || 0) + 1,
    last_seen: now,
  };

  if (existing) {
    await client.asServiceRole.entities.DocumentProfile.update(existing.id, data);
  } else {
    await client.asServiceRole.entities.DocumentProfile.create(data);
  }
}