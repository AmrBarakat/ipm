/**
 * extractPODN — R1: EXTRACT ONLY. Writes a staging Extraction record (status
 * "review") and returns structured data for the review screen. Does NOT update
 * BOMItem, does NOT create a Note, does NOT call applyLine.
 *
 * Returns: { extraction_id, header, line_items, secondary_document,
 *            payment_schedule, duplicates, warnings }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { matchLine } from '../../shared/matchLine.ts';

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp'];
const SHEET_EXTS = ['.xlsx', '.xls', '.csv', '.html', '.json'];
const UNSUPPORTED_EXTS = ['.xlsm', '.xlsb', '.doc', '.docx', '.ppt', '.pptx'];

const TEXT_EXTRACT_SCHEMA = {
  type: 'object',
  properties: { raw_text: { type: 'string', description: 'Full text content of the document' } },
};

// ── Widened extraction schema (R1) ────────────────────────────────────────────
const PODN_SCHEMA = {
  type: 'object',
  properties: {
    document_type: { type: 'string', enum: ['po', 'delivery_note'] },
    document_number: { type: 'string' },
    document_date: { type: 'string' },
    currency: { type: 'string' },
    subtotal_net: { type: 'number' },
    total_amount: { type: 'number' },
    total_quantity: { type: 'number' },
    vendor: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        supplier_code: { type: 'string' },
        tax_number: { type: 'string' },
        contact_name: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        address: { type: 'string' },
        country: { type: 'string' },
      },
    },
    terms: {
      type: 'object',
      properties: {
        payment_terms: { type: 'string' },
        incoterm: { type: 'string' },
        mode_of_shipping: { type: 'string' },
        warehouse_code: { type: 'string' },
        supplier_ref: { type: 'string' },
        pr_number: { type: 'string' },
        purchaser: { type: 'string' },
        requested_by: { type: 'string' },
      },
    },
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

  // "X% advance - Y% on delivery" (or similar)
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

  // "100% advance"
  if (/100%\s+advance/i.test(s)) {
    return [{ label: 'Advance', percent_due: 100, amount_due: +subtotalNet.toFixed(2), trigger: 'on_order', offset_days: 0 }];
  }

  // "Net 30" / "30 Days Credit" / "30 Days" etc.
  const netDays = s.match(/(?:net|credit)?\s*(\d+)\s*days?\s*(?:credit)?/i);
  if (netDays) {
    const days = Number(netDays[1]);
    return [{ label: `Net ${days}`, percent_due: 100, amount_due: +subtotalNet.toFixed(2), trigger: 'days_after_invoice', offset_days: days }];
  }

  // "30 days credit"
  const daysCredit = s.match(/(\d+)\s+days?\s+credit/i);
  if (daysCredit) {
    const days = Number(daysCredit[1]);
    return [{ label: `Net ${days}`, percent_due: 100, amount_due: +subtotalNet.toFixed(2), trigger: 'days_after_invoice', offset_days: days }];
  }

  // fallback: verbatim
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

  // Tax guard: if line sum ÷ 1.15 ≈ reported total (within 0.5%), likely tax-inclusive
  if (docTotal != null && docTotal > 0) {
    const ratio = lineSum / docTotal;
    if (Math.abs(ratio - 1.15) / 1.15 < 0.005) {
      warnings.push(
        'Extracted figures appear to include 15% tax — this system stores net prices only. Confirm the unit prices before applying.'
      );
    }
  }

  return warnings;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // ── Auth guard ──────────────────────────────────────────────────────────
    let user: any = null;
    try { user = await base44.auth.me(); } catch (_) { user = null; }
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { file_url, project_id, doc_hint, document_id, document_title } = body;
    if (!file_url || !project_id)
      return Response.json({ error: 'file_url and project_id are required' }, { status: 400 });
    if (doc_hint && !['po', 'delivery_note', 'auto'].includes(doc_hint))
      return Response.json({ error: "doc_hint must be 'po', 'delivery_note', or 'auto'" }, { status: 400 });

    const debugMode = new URL(req.url).searchParams.get('debug') === '1';

    const urlLower = file_url.toLowerCase().split('?')[0];
    const ext = urlLower.match(/\.[^.]+$/)?.[0] || '';
    if (UNSUPPORTED_EXTS.includes(ext))
      return Response.json({ error: `File type "${ext}" is not supported for extraction.` }, { status: 400 });

    const isImage = IMAGE_EXTS.includes(ext);
    const isSheet = SHEET_EXTS.includes(ext);

    // ── a. READ (preserved exactly) ─────────────────────────────────────────
    let docText = '';
    let useVision = false;
    if (isImage) {
      useVision = true;
    } else if (isSheet) {
      const extracted = await base44.asServiceRole.integrations.Core.ExtractDataFromUploadedFile({ file_url, json_schema: TEXT_EXTRACT_SCHEMA });
      docText = extracted?.output?.raw_text
        || (typeof extracted?.output === 'string' ? extracted.output : JSON.stringify(extracted?.output || ''));
    } else {
      // PDF / unknown: try text, fall back to vision if thin.
      try {
        const extracted = await base44.asServiceRole.integrations.Core.ExtractDataFromUploadedFile({ file_url, json_schema: TEXT_EXTRACT_SCHEMA });
        docText = extracted?.output?.raw_text
          || (typeof extracted?.output === 'string' ? extracted.output : JSON.stringify(extracted?.output || ''));
      } catch (_) { docText = ''; }
      if (!docText || docText.trim().length < 200) {
        docText = '';
        useVision = true;
      } else {
        useVision = true; // substantial text + attach file (vision cross-checks stamps/handwriting)
      }
    }

    const hint = doc_hint === 'po' ? 'This document is a Purchase Order.'
      : doc_hint === 'delivery_note' ? 'This document is a Delivery Note / Packing Slip.'
      : 'Detect whether this document is a Purchase Order or a Delivery Note / Packing Slip.';

    const docBlock = docText
      ? `DOCUMENT TEXT:\n${docText.slice(0, 8000)}\n\nThe document is also attached as a file. Cross-check the text against it, paying attention to stamps, handwritten quantities, signatures, and table structure.`
      : `The document is attached as a file. Read it carefully, including any stamps, handwritten quantities, signatures, and table structure. Perform accurate OCR on all line items.`;

    // ── b. EXTRACT (widened schema) ─────────────────────────────────────────
    const _raw = await base44.asServiceRole.integrations.Core.InvokeLLM({
      model: 'claude_sonnet_4_6',
      ...(useVision ? { file_urls: [file_url] } : {}),
      prompt: `You are an expert at parsing Purchase Orders, Delivery Notes, and Packing Slips for industrial automation projects.

${hint}

${docBlock}

Extract a complete, accurate result. Return null for any field you cannot read clearly.

RULES:
- document_type: "po" (Purchase Order) or "delivery_note" (Delivery Note / Packing Slip / Packing List).
- document_number: the PO number or delivery note number.
- document_date: YYYY-MM-DD.
- currency: 3-letter ISO code, e.g. "SAR".
- subtotal_net: the document's sub-total / net amount before tax. Numbers only, no currency symbols.
- total_amount: grand total including any tax. Numbers only.
- total_quantity: sum of all line quantities printed on the document.

VENDOR BLOCK:
- vendor.name: the supplier / vendor company name.
- vendor.supplier_code: the "Supplier Code" field on the document, e.g. SUP03-00000010.
- vendor.tax_number: the supplier's TRN / VAT registration number (identity only — never used for price arithmetic).
- vendor.contact_name, email, phone, address, country: extract if present.

TERMS BLOCK:
- terms.payment_terms: verbatim text of the Payment Condition / Payment Terms field.
- terms.incoterm: Incoterm field, e.g. "Delivery at point".
- terms.mode_of_shipping: Mode of Shipping / Delivery field.
- terms.warehouse_code: Warehouse Code field.
- terms.supplier_ref: Supplier Ref / Quotation number quoted on the PO header.
- terms.pr_number: PR No. field. The value after the colon but BEFORE any " : " bank/account reference — e.g. for "SA03-000501 : Al INMAA BANK" extract just "SA03-000501".
- terms.purchaser: Purchaser field.
- terms.requested_by: Requested by / Requested By field.

LINE ITEMS (primary document only):
- line_no: the Sr. No. / line number.
- erp_item_code: the value in the "Item" / "Item No." / "Material" column — a plain internal number such as 243038.
- part_number: the code embedded in SQUARE BRACKETS inside the Description column, e.g. [ES.P78087-425] or [ES.Dell.KM3322W]. Return the code EXACTLY as printed inside the brackets, including all dots, hyphens, and prefixes. Do NOT strip anything.
- description: the full line description text.
- uom: the UOM / unit column (e.g. "EA").
- qty: the quantity ordered (PO) or delivered (delivery note).
- unit_price: from the "Unit Price" column — numbers only, no currency symbols, no thousands separators.
- net_amount: from the "Net Amount" column — numbers only.
- supplier_delivery_date: the per-line "Supplier Delivery Date" column, converted to YYYY-MM-DD (dates are DAY/MONTH/YEAR format — 09/07/2026 means 9 July 2026).
- ocr_uncertain: true when you are not confident about any number on this line.

ALL PRICES ARE NET OF TAX. Extract unit_price and net_amount from the columns that exclude tax. Never compute a net price by dividing a tax-inclusive figure. If a document shows only tax-inclusive amounts, return those figures as printed and set ocr_uncertain true on affected lines.

DATES ARE DAY/MONTH/YEAR. A date printed 02/07/2026 is 2 July 2026, not 7 February. Convert every date to YYYY-MM-DD. If a date is genuinely ambiguous, return null rather than guessing.

OCR ACCURACY:
- Quantities may be handwritten or stamped over printed text; prefer the handwritten correction when both appear.
- If a quantity is not clearly legible, return null rather than guessing.
- Extract line items from ALL pages of the PRIMARY document only.

MULTIPLE DOCUMENTS IN ONE FILE: These files frequently contain the purchase order on page 1 followed by the supplier's quotation or estimate on later pages.
- The PRIMARY document is the one whose header says "Purchase Order" (or "Delivery Note" / "Packing Slip"). Extract line_items ONLY from the primary document.
- If a supplier quotation, estimate, or second document is also present:
  - Set secondary_document.present = true.
  - Set secondary_document.kind to "quotation", "estimate", "invoice", or "" as appropriate.
  - Set secondary_document.reference to its reference/quote number.
  - Set secondary_document.prices_include_tax = true if its amounts include VAT/tax.
  - List its lines in secondary_document.lines (description, part_number, qty, unit_price using the Rate/Unit Price column).
  - Do NOT merge secondary document lines into line_items.

Return JSON matching the schema exactly.`,
      response_json_schema: PODN_SCHEMA,
    });
    // InvokeLLM may return the parsed object directly OR nested under `.response` (preserved).
    const extracted = (_raw as any)?.response || _raw || {};

    const document_type: string = extracted?.document_type === 'po' ? 'po' : 'delivery_note';
    const document_number: string = extracted?.document_number || '';
    const document_date: string = extracted?.document_date || '';
    const currency: string = extracted?.currency || 'SAR';
    const subtotal_net: number | null = extracted?.subtotal_net ?? null;
    const total_amount: number | null = extracted?.total_amount ?? null;
    const total_quantity: number | null = extracted?.total_quantity ?? null;
    const vendor: any = extracted?.vendor || {};
    const terms: any = extracted?.terms || {};
    const secondary_document: any = extracted?.secondary_document || { present: false };
    let line_items: any[] = Array.isArray(extracted?.line_items) ? extracted.line_items : [];

    // ── D: Validation warnings ──────────────────────────────────────────────
    const warnings = validateExtraction(line_items, subtotal_net, total_amount, total_quantity);

    // ── E: R4 Quotation variance ────────────────────────────────────────────
    line_items = attachQuotationVariance(line_items, secondary_document);

    // ── C: R8 Parse payment terms ───────────────────────────────────────────
    const effectiveNet = subtotal_net ?? total_amount ?? 0;
    const payment_schedule = parsePaymentTerms(terms.payment_terms || '', effectiveNet);

    // ── C: Tiered match (R6) — load BOMItems + PartAliases, match per line ───
    let bomItems: any[] = [];
    let aliases: any[] = [];
    try {
      bomItems = await base44.asServiceRole.entities.BOMItem.filter({ project_id }, '-created_date', 1000);
    } catch (_) {}
    try {
      const projAliases = await base44.asServiceRole.entities.PartAlias.filter({ project_id }, '-created_date', 1000);
      const globalAliases = await base44.asServiceRole.entities.PartAlias.filter({ project_id: '' }, '-created_date', 1000);
      aliases = [...(projAliases || []), ...(globalAliases || [])];
    } catch (_) {}

    let auto_selected = 0;
    let needs_review = 0;
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

    // ── F: R5 Duplicate detection ───────────────────────────────────────────
    const duplicates: any = {};
    if (document_number && document_type === 'po') {
      try {
        const existingPOs = await base44.asServiceRole.entities.PurchaseOrder.filter({ project_id, po_number: document_number }, '-created_date', 1);
        if (existingPOs.length > 0) {
          duplicates.purchase_order_id = existingPOs[0].id;
          duplicates.purchase_order_status = existingPOs[0].status;
        }
      } catch (_) {}
    }
    if (document_number) {
      try {
        const existingExpenses = await base44.asServiceRole.entities.Expense.filter({ project_id, reference_number: document_number }, '-created_date', 1);
        if (existingExpenses.length > 0) {
          duplicates.expense_id = existingExpenses[0].id;
        }
      } catch (_) {}
    }

    // ── G: Write staging Extraction record ──────────────────────────────────
    const header = {
      document_number,
      document_date,
      currency,
      subtotal_net,
      total_amount,
      total_quantity,
      vendor,
      terms,
    };

    const extraction = await base44.asServiceRole.entities.Extraction.create({
      project_id,
      document_id: document_id || null,
      document_title: document_title || document_number || 'Untitled',
      status: 'review',
      extraction_kind: document_type === 'po' ? 'po' : 'delivery_note',
      header,
      proposals: [],
      summary: `${document_type === 'po' ? 'PO' : 'DN'} ${document_number} — ${line_items.length} line(s), ${auto_selected} auto-selected, ${needs_review} need review`,
    });

    // ── Return ──────────────────────────────────────────────────────────────
    const response: any = {
      extraction_id: extraction.id,
      header,
      line_items,
      secondary_document,
      payment_schedule,
      duplicates,
      warnings,
      counts: { auto_selected, needs_review },
    };

    if (debugMode) {
      response.debug = {
        used_vision: useVision,
        text_len: docText.length,
        raw_had_response_key: !!(_raw && (_raw as any).response),
        line_item_count: line_items.length,
      };
    }

    return Response.json(response);
  } catch (error) {
    return Response.json({ error: (error as any)?.message || 'Extraction failed' }, { status: 500 });
  }
});