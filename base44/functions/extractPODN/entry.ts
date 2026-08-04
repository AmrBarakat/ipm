/**
 * extractPODN — R1: EXTRACT ONLY. Writes a staging Extraction record (status
 * "review") and returns structured data for the review screen. Does NOT update
 * BOMItem, does NOT create a Note, does NOT call applyLine.
 *
 * Performance hardened:
 * - Text-first, vision only when the text is thin or the file is an image.
 *   force_vision: true overrides to vision on demand.
 * - Entity lookups (BOMItem, PartAlias, PurchaseOrder, Expense, DocumentProfile)
 *   are fired BEFORE the file read and LLM call, then awaited with
 *   Promise.allSettled after the LLM returns. Duplicate PO/Expense detection is
 *   done in memory against the project-wide fetch.
 * - DocumentProfile assertions are pre-filtered on docText (max 3, 1500 chars)
 *   and skipped entirely on the vision path.
 * - The LLM schema is flat (no nested vendor/terms/observed_conventions) — the
 *   safer contract that stabilised ProjectChat. Nested shapes are reassembled
 *   server-side. observed_conventions are derived server-side.
 * - Every phase sets a `stage`; a staging Extraction is created early so failed
 *   runs are visible; InvokeLLM is retried schema-less if the typed call fails.
 *
 * Returns: { extraction_id, header, line_items, secondary_document,
 *            observed_conventions, payment_schedule, duplicates, warnings,
 *            counts, used_vision, llm_attempt, stage? }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { matchLine } from '../../shared/matchLine.ts';
import { buildProfileAssertions } from '../../shared/documentProfile.ts';

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

Deno.serve(async (req) => {
  let stage = 'init';
  let extractionId = '';
  let base44: any;
  try {
    base44 = createClientFromRequest(req);

    // ── auth ──────────────────────────────────────────────────────────────
    stage = 'auth';
    let user: any = null;
    try { user = await base44.auth.me(); } catch (_) { user = null; }
    if (!user) return Response.json({ error: 'Unauthorized', stage, partial: true }, { status: 401 });

    // ── input ─────────────────────────────────────────────────────────────
    stage = 'input';
    const body = await req.json();
    const { file_url, project_id, doc_hint, document_id, document_title, force_vision } = body;
    if (!file_url || !project_id)
      return Response.json({ error: 'file_url and project_id are required', stage, partial: true }, { status: 400 });
    if (doc_hint && !['po', 'delivery_note', 'auto'].includes(doc_hint))
      return Response.json({ error: "doc_hint must be 'po', 'delivery_note', or 'auto'", stage, partial: true }, { status: 400 });

    const debugMode = new URL(req.url).searchParams.get('debug') === '1';

    const urlLower = file_url.toLowerCase().split('?')[0];
    const ext = urlLower.match(/\.[^.]+$/)?.[0] || '';
    if (UNSUPPORTED_EXTS.includes(ext))
      return Response.json({ error: `File type "${ext}" is not supported for extraction.`, stage, partial: true }, { status: 400 });

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
    } catch (_) { extraction = null; }

    // Fire ALL entity lookups BEFORE the file read + LLM so they run
    // concurrently with the slow integration calls. Awaited later via
    // Promise.allSettled. Duplicate PO/Expense detection is done in memory
    // against the project-wide fetch (no per-document filter call).
    const bomP = base44.asServiceRole.entities.BOMItem.filter({ project_id }, '-created_date', 1000);
    const aliasesProjP = base44.asServiceRole.entities.PartAlias.filter({ project_id }, '-created_date', 1000);
    const aliasesGlobalP = base44.asServiceRole.entities.PartAlias.filter({ project_id: '' }, '-created_date', 1000);
    const posP = base44.asServiceRole.entities.PurchaseOrder.filter({ project_id }, '-created_date', 200);
    const expensesP = base44.asServiceRole.entities.Expense.filter({ project_id }, '-created_date', 200);
    const profilesP = base44.asServiceRole.entities.DocumentProfile.list('-last_seen', 20);

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
      try {
        const profiles: any[] = await profilesP;
        if (profiles && profiles.length) {
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
      } catch (e) {
        profileWarning = `Document profiles could not be loaded — issuer conventions were not applied: ${(e as any)?.message || 'unknown error'}`;
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
          { extraction_id: extractionId, error: (e2 as any)?.message || 'LLM invocation failed on both attempts', stage, partial: true },
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

    const [bomRes, aliasesProjRes, aliasesGlobalRes, posRes, expensesRes] = await Promise.allSettled([
      bomP, aliasesProjP, aliasesGlobalP, posP, expensesP,
    ]);
    if (bomRes.status === 'fulfilled') bomItems = bomRes.value || [];
    else sideWarnings.push(`BOM could not be loaded — line matching was skipped: ${(bomRes as any).reason?.message || 'unknown error'}`);
    if (aliasesProjRes.status === 'fulfilled' && aliasesGlobalRes.status === 'fulfilled') {
      aliases = [...(aliasesProjRes.value || []), ...(aliasesGlobalRes.value || [])];
    } else {
      sideWarnings.push(`Part aliases could not be loaded — matching may be incomplete.`);
    }
    if (posRes.status === 'fulfilled') projectPOs = posRes.value || [];
    if (expensesRes.status === 'fulfilled') projectExpenses = expensesRes.value || [];

    const bomLoadFailed = bomRes.status !== 'fulfilled';
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
      } catch (_) { /* nothing more we can do */ }
    }

    // ── Return ──────────────────────────────────────────────────────────────
    const response: any = {
      extraction_id: extractionId,
      header,
      line_items,
      secondary_document,
      observed_conventions,
      payment_schedule,
      duplicates,
      warnings: allWarnings,
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
      { extraction_id: extractionId, error: (error as any)?.message || 'Extraction failed', stage, partial: true },
      { status: 200 },
    );
  }
});