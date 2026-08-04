/**
 * Shared helpers for the PODN review-and-confirm modal.
 * No VAT logic anywhere — all figures are net.
 */

export function confidenceBadge(conf) {
  if (conf >= 0.85) return { cls: 'bg-emerald-100 text-emerald-700', label: `${Math.round(conf * 100)}%` };
  if (conf >= 0.55) return { cls: 'bg-amber-100 text-amber-700', label: `${Math.round(conf * 100)}%` };
  if (conf > 0) return { cls: 'bg-red-100 text-red-700', label: `${Math.round(conf * 100)}%` };
  return { cls: 'bg-slate-100 text-slate-400', label: '—' };
}

export function tierLabel(tier) {
  switch (tier) {
    case 'erp': return 'matched on ERP item code';
    case 'alias': return 'matched on learned alias';
    case 'exact': return 'matched on part number';
    case 'raw': return 'matched on full ERP code';
    case 'tail': return 'matched on trailing model segment';
    case 'contains': return 'matched on substring';
    case 'description': return 'matched on description similarity';
    default: return 'not matched';
  }
}

export function normalizeCode(s) {
  return String(s || '').toUpperCase().trim().replace(/[^A-Z0-9]/g, '');
}

export function fmt(n, cur = 'SAR') {
  if (n == null || n === '' || isNaN(Number(n))) return '—';
  return `${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
}

export function fmtPct(frac) {
  if (frac == null || isNaN(Number(frac))) return '—';
  return `${(Number(frac) * 100).toFixed(2)}%`;
}

export function addDays(iso, days) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

/** R8 — expected cash-flow date from a payment-schedule row + the PO dates. */
export function expectedDateFor(row, po) {
  const issue = po.issue_date || '';
  const del = po.expected_delivery_date || '';
  switch (row.trigger) {
    case 'on_order': return issue;
    case 'on_delivery': return del;
    case 'days_after_invoice': return addDays(issue, row.offset_days || 0);
    case 'days_after_delivery': return addDays(del, row.offset_days || 0);
    default: return '';
  }
}

/** Step-1 reconciliation: line sum vs document total. */
export function reconcile(lines, subtotalNet, totalAmount) {
  const sumNet = lines.reduce((s, l) => s + (Number(l.net_amount) || 0), 0);
  const sumQty = lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
  const docTotal = subtotalNet != null ? subtotalNet : totalAmount;
  const ok = docTotal == null ? true : Math.abs(sumNet - docTotal) <= 0.05;
  return { sumNet: +sumNet.toFixed(2), sumQty, docTotal, ok };
}

// ── Vendor matching (Step 2) ────────────────────────────────────────────────
function collapse(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function vendorTokens(s) {
  return String(s || '').toLowerCase().split(/[\s/()[\],;&.-]+/).filter((t) => t.length >= 3);
}

export function matchVendor(vendors, v) {
  if (!v || !vendors) return null;
  const sc = String(v.supplier_code || '').trim();
  if (sc) {
    const m = vendors.find((x) => String(x.supplier_code || '').trim() === sc);
    if (m) return m;
  }
  const tn = String(v.tax_number || '').trim();
  if (tn) {
    const m = vendors.find((x) => String(x.tax_number || '').trim() === tn);
    if (m) return m;
  }
  const name = collapse(v.name);
  if (name) {
    const m = vendors.find((x) => collapse(x.name) === name);
    if (m) return m;
  }
  if (name) {
    const m = vendors.find((x) => (x.aliases || []).some((a) => collapse(a) === name));
    if (m) return m;
  }
  if (name) {
    const lt = vendorTokens(v.name);
    let best = null;
    let bestScore = 0;
    for (const x of vendors) {
      const xt = vendorTokens(x.name);
      if (!xt.length) continue;
      const set = new Set(xt);
      let shared = 0;
      for (const t of lt) if (set.has(t)) shared++;
      const score = shared / Math.min(lt.length, xt.length);
      if (score > bestScore) { bestScore = score; best = x; }
    }
    if (best && bestScore >= 0.6) return best;
  }
  return null;
}

export function vendorDiffFields() {
  return ['name', 'contact_name', 'email', 'phone', 'address', 'country', 'supplier_code', 'tax_number', 'payment_terms'];
}

// ── Draft builders ────────────────────────────────────────────────────────────
function computeInitialPaymentSchedule(sched, po) {
  return (sched || []).map((row) => ({
    ...row,
    amount_due: row.amount_due != null ? row.amount_due : +(((row.percent_due || 0) / 100) * (po.amount || 0)).toFixed(2),
    expected_date: row.expected_date || expectedDateFor(row, po),
  }));
}

export function buildInitialDraft(result) {
  const h = result.header || {};
  const lines = (result.line_items || []).map((li) => ({ ...li }));
  const earliestDelivery = lines.map((l) => l.supplier_delivery_date).filter(Boolean).sort()[0] || '';
  const vendorName = h.vendor?.name || '';
  const docNumber = h.document_number || '';
  const docType = (result.extraction_kind || '') === 'po' ? 'po' : 'delivery_note';

  const po = {
    po_number: docNumber,
    description: vendorName ? `${vendorName} — ${lines.length} items` : `${lines.length} items`,
    type: 'equipment',
    status: 'issued',
    priority: 'medium',
    amount: h.subtotal_net != null ? h.subtotal_net : h.total_amount || 0,
    currency: h.currency || 'SAR',
    issue_date: h.document_date || '',
    expected_delivery_date: earliestDelivery,
    delivery_location: '',
    payment_terms: h.terms?.payment_terms || '',
    incoterm: h.terms?.incoterm || '',
    mode_of_shipping: h.terms?.mode_of_shipping || '',
    warehouse_code: h.terms?.warehouse_code || '',
    supplier_ref: h.terms?.supplier_ref || '',
    pr_number: h.terms?.pr_number || '',
    purchaser: h.terms?.purchaser || '',
    requested_by: h.terms?.requested_by || '',
    notes: '',
    createToggle: true,
  };
  po.payment_schedule = computeInitialPaymentSchedule(result.payment_schedule, po);

  const duplicates = result.duplicates || {};
  const expense = {
    description: docNumber ? `${docNumber} — ${vendorName}` : vendorName || 'Extraction',
    category: 'material',
    status: 'committed',
    vendor: vendorName,
    reference_number: docNumber,
    planned_date: h.document_date || '',
    planned_amount: po.amount,
    notes: '',
    createToggle: !duplicates.expense_id,
  };

  return {
    extraction_id: result.extraction_id,
    document: {
      type: docType,
      number: docNumber,
      date: h.document_date || '',
      currency: h.currency || 'SAR',
      subtotal_net: h.subtotal_net != null ? h.subtotal_net : null,
      total_amount: h.total_amount != null ? h.total_amount : null,
      total_quantity: h.total_quantity != null ? h.total_quantity : null,
    },
    vendor: {
      name: vendorName,
      supplier_code: h.vendor?.supplier_code || '',
      tax_number: h.vendor?.tax_number || '',
      contact_name: h.vendor?.contact_name || '',
      email: h.vendor?.email && h.vendor.email !== '<UNKNOWN>' ? h.vendor.email : '',
      phone: h.vendor?.phone && h.vendor.phone !== '<UNKNOWN>' ? h.vendor.phone : '',
      address: h.vendor?.address || '',
      country: h.vendor?.country || '',
      payment_terms: h.terms?.payment_terms || '',
      type: 'supplier',
      mode: 'create',
      createToggle: true,
      existingVendorId: null,
      fieldOverwrites: {},
    },
    lines,
    po,
    expense,
    secondary: result.secondary_document || { present: false },
    duplicates,
    warnings: result.warnings || [],
    counts: result.counts || { auto_selected: lines.filter((l) => l.selected).length, needs_review: lines.filter((l) => !l.selected).length },
  };
}

export function liveSummary(draft) {
  const parts = [];
  if (draft.vendor?.name) parts.push('1 vendor');
  if (draft.po?.createToggle) parts.push('1 PO');
  const sel = draft.lines.filter((l) => l.selected).length;
  parts.push(`${sel} BOM line${sel !== 1 ? 's' : ''}`);
  if (draft.expense?.createToggle) parts.push('1 expense');
  return parts.join(', ');
}