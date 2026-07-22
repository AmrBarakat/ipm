/**
 * extractPODN — single-purpose PO / Delivery-Note pipeline.
 *
 * Replaces the PO/DN branch of extractDocumentData. In one server-side call it:
 *   a. reads the document (image → vision; Excel/CSV → text; PDF → text then
 *      vision if the text is thin),
 *   b. extracts a narrow { document_type, document_number, document_date,
 *      vendor_name, line_items[{ part_number, description, qty, ocr_uncertain }] },
 *   c. matches each line to the project's BOMItems by normalized part number
 *      (manufacturer_part_number, then item_code) — exact match only,
 *   d. applies matched lines (PO → ordered; delivery note → received_qty += qty
 *      with material_status / delivery_status recompute), writing an AuditLog
 *      per changed item,
 *   e. saves a summary Note (po_summary / dn_summary) with the full row table,
 *   f. returns the result rows for the results panel.
 *
 * Auth: 401 if not logged in (pattern from applyWBSBatch).
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { normalizePart, applyLine } from '../../shared/podnApply.ts';

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp'];
const SHEET_EXTS = ['.xlsx', '.xls', '.csv', '.html', '.json'];
const UNSUPPORTED_EXTS = ['.xlsm', '.xlsb', '.doc', '.docx', '.ppt', '.pptx'];

const TEXT_EXTRACT_SCHEMA = {
  type: 'object',
  properties: { raw_text: { type: 'string', description: 'Full text content of the document' } },
};

/** If the model placed the part code only inside the description (in [brackets]),
 *  re-extract it so normalizePart can match. Mirrors the frontend fallback. */
function extractBracketCode(description) {
  if (!description) return '';
  const m = String(description).match(/\[([^\]]+)\]/);
  return m ? m[1] : '';
}

const PODN_SCHEMA = {
  type: 'object',
  properties: {
    document_type: { type: 'string', enum: ['po', 'delivery_note'] },
    document_number: { type: 'string' },
    document_date: { type: 'string' },
    vendor_name: { type: 'string' },
    line_items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          part_number: { type: 'string' },
          description: { type: 'string' },
          qty: { type: 'number' },
          ocr_uncertain: { type: 'boolean' },
        },
      },
    },
  },
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    let user = null;
    try { user = await base44.auth.me(); } catch (_) { user = null; }
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { file_url, project_id, doc_hint } = await req.json();
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

    // --- a. READ ---
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
        useVision = true; // scanned/image-only PDF
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

    // --- b. EXTRACT (narrow schema) ---
    const _raw = await base44.asServiceRole.integrations.Core.InvokeLLM({
      model: 'claude_sonnet_4_6',
      ...(useVision ? { file_urls: [file_url] } : {}),
      prompt: `You are an expert at parsing Purchase Orders, Delivery Notes, and Packing Slips for industrial automation projects.

${hint}

${docBlock}

Extract a STRICT, NARROW result. Return null for any field you cannot read clearly.

RULES:
- document_type: "po" (Purchase Order) or "delivery_note" (Delivery Note / Packing Slip / Packing List). Documents titled "Packing slip" or "Packing list" are delivery_note.
- document_number: the PO number, or the packing-slip / delivery-note number (e.g. PCKS-00002655).
- document_date: YYYY-MM-DD.
- vendor_name: the supplier / vendor issuing or shipping the document.
- line_items: array of objects with:
  - part_number: the REAL manufacturer part code. It is embedded INSIDE SQUARE BRACKETS in the Description column, e.g. [TQ.TWDFCW30K] or [ES.TQ.TM221CE40T]. Strip the vendor prefixes TQ., ES., ES.TQ. and return the BARE code (e.g. TWDFCW30K, TM221CE40T). The supplier's "Item Number" / "Item No." column is NEVER the part number — ignore it entirely.
  - description: the full line description including the bracketed code.
  - qty: for POs the ORDERED quantity; for delivery notes / packing slips the quantity delivered ON THIS slip.
  - ocr_uncertain: true when you are not confident you read this line's numbers correctly.

OCR ACCURACY:
- Quantities may be handwritten or stamped over printed text; prefer the handwritten correction when both appear.
- If a quantity is not clearly legible, return null rather than guessing.
- Extract line items from ALL pages and continue the same line_items array.

Return JSON: { document_type, document_number, document_date, vendor_name, line_items: [...] }`,
      response_json_schema: PODN_SCHEMA,
    });
    // InvokeLLM may return the parsed object directly OR nested under `.response`.
    const extracted = _raw?.response || _raw || {};

    const document_type = extracted?.document_type === 'po' ? 'po' : 'delivery_note';
    const document_number = extracted?.document_number || '';
    const document_date = extracted?.document_date || '';
    const vendor_name = extracted?.vendor_name || '';
    const line_items = Array.isArray(extracted?.line_items) ? extracted.line_items : [];

    // --- c. MATCH (exact normalized part number) ---
    const bomItems = await base44.asServiceRole.entities.BOMItem.filter({ project_id }, '-created_date', 1000);
    const byPart = new Map();
    const byCode = new Map();
    for (const b of bomItems) {
      const mp = normalizePart(b.manufacturer_part_number);
      if (mp && !byPart.has(mp)) byPart.set(mp, b);
      const mc = normalizePart(b.item_code);
      if (mc && !byCode.has(mc)) byCode.set(mc, b);
    }

    const actor = user?.full_name || user?.email || 'system';
    const rows = [];
    let appliedCount = 0;
    let unmatchedCount = 0;
    let uncertainCount = 0;

    // --- d. APPLY matched lines ---
    for (const li of line_items) {
      const part_number = li.part_number || '';
      const description = li.description || '';
      const qty = li.qty;
      const ocr_uncertain = !!li.ocr_uncertain;
      if (ocr_uncertain) uncertainCount++;

      // Fallback: if the model omitted part_number, re-extract the bracketed
      // code from the description before normalizing.
      const code = part_number || extractBracketCode(description);
      const norm = normalizePart(code);
      const bom = norm ? (byPart.get(norm) || byCode.get(norm)) : null;

      if (bom) {
        const res = await applyLine({ base44, bom, document_type, document_number, document_date, qty, actor, project_id });
        rows.push({ part_number, description, qty, matched: true, bom_item_id: res.bom_item_id, applied_status: res.applied_status, ocr_uncertain });
        appliedCount++;
      } else {
        rows.push({ part_number, description, qty, matched: false, bom_item_id: null, applied_status: 'Unmatched', ocr_uncertain });
        unmatchedCount++;
      }
    }

    // --- e. SAVE SUMMARY NOTE ---
    const note_type = document_type === 'po' ? 'po_summary' : 'dn_summary';
    const emptyExtraction = line_items.length === 0;
    const warning = emptyExtraction
      ? 'Document may be low quality or unsupported — no line items could be read.'
      : undefined;
    const title = document_type === 'po'
      ? `${document_number || 'PO'} — ${appliedCount} item${appliedCount !== 1 ? 's' : ''} marked Ordered`
      : `${document_number || 'Delivery note'} — ${appliedCount} item${appliedCount !== 1 ? 's' : ''} updated to Received`;
    const noteBody = emptyExtraction
      ? `${document_number || 'Document'} — no line items could be read (check document quality)`
      : title;
    const note = await base44.asServiceRole.entities.Note.create({
      project_id,
      author: actor,
      body: noteBody,
      note_type,
      table_data: { document_type, document_number, document_date, vendor_name, rows },
    });

    // --- f. RETURN ---
    const response: any = {
      note_id: note.id,
      document_type,
      document_number,
      document_date,
      vendor_name,
      applied_count: appliedCount,
      unmatched_count: unmatchedCount,
      uncertain_count: uncertainCount,
      rows,
    };
    if (warning) response.warning = warning;
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
    return Response.json({ error: error?.message || 'Extraction failed' }, { status: 500 });
  }
});