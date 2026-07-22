import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp'];
const SHEET_EXTS = ['.xlsx', '.xls', '.csv', '.html', '.json'];
const UNSUPPORTED_EXTS = ['.xlsm', '.xlsb', '.doc', '.docx', '.ppt', '.pptx'];

const TEXT_EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    raw_text: { type: 'string', description: 'Full text content of the document' }
  }
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { file_url, document_category } = await req.json();
    if (!file_url) return Response.json({ error: 'file_url is required' }, { status: 400 });

    const urlLower = file_url.toLowerCase().split('?')[0];
    const ext = urlLower.match(/\.[^.]+$/)?.[0] || '';
    if (UNSUPPORTED_EXTS.includes(ext)) {
      return Response.json({
        error: `File type "${ext}" is not supported for extraction. Please use PDF, Excel (.xlsx/.xls), CSV, or image files.`
      }, { status: 400 });
    }

    const isImage = IMAGE_EXTS.includes(ext);
    const isSheet = SHEET_EXTS.includes(ext);
    // pdf or unknown → text-then-vision fallback

    // --- Step 1: obtain text content (where applicable) ---
    let docText = '';
    let extractionMethod = 'text'; // text | vision | text+vision
    let attachFile = false;

    if (isImage) {
      // Images: skip text extraction entirely, go straight to vision.
      extractionMethod = 'vision';
    } else if (isSheet) {
      // Spreadsheets/CSV/HTML/JSON: text path only (exactly as before).
      const extracted = await base44.asServiceRole.integrations.Core.ExtractDataFromUploadedFile({
        file_url,
        json_schema: TEXT_EXTRACT_SCHEMA
      });
      docText = extracted?.output?.raw_text
        || (typeof extracted?.output === 'string' ? extracted.output : JSON.stringify(extracted?.output || ''));
      if (!docText || docText.trim().length < 10) {
        return Response.json({ suggestions: {} });
      }
      extractionMethod = 'text';
    } else {
      // PDF (or unknown): attempt text extraction, fall back to vision if thin/failed.
      try {
        const extracted = await base44.asServiceRole.integrations.Core.ExtractDataFromUploadedFile({
          file_url,
          json_schema: TEXT_EXTRACT_SCHEMA
        });
        docText = extracted?.output?.raw_text
          || (typeof extracted?.output === 'string' ? extracted.output : JSON.stringify(extracted?.output || ''));
      } catch (_e) {
        docText = '';
      }
      if (!docText || docText.trim().length < 200) {
        // Scanned/image-only PDF → vision call, no text block.
        docText = '';
        extractionMethod = 'vision';
      } else {
        // Substantial text — keep it AND attach the file (vision fills gaps like
        // stamps, handwriting, and table structure that text extraction mangles).
        attachFile = true;
        extractionMethod = 'text+vision';
      }
    }

    const useVision = extractionMethod !== 'text';

    const docBlock = docText
      ? `DOCUMENT TEXT:\n${docText.slice(0, 8000)}${attachFile ? '\n\nThe document is also attached as a file. Cross-check the text above against it, paying attention to stamps, handwritten quantities, signatures, and table structure that the text extraction may have missed.' : ''}`
      : `The document is attached as a file. Read it carefully, including any stamps, handwritten quantities, signatures, and table structure. Perform accurate OCR on all line items.`;

    // Step 2: Use LLM to extract structured data from the document
    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      model: 'claude_sonnet_4_6',
      ...(useVision ? { file_urls: [file_url] } : {}),
      prompt: `You are an expert at parsing industrial project documents (invoices, contracts, purchase orders, delivery notes).

Analyze the following document and extract ALL relevant fields you can find.

DOCUMENT CATEGORY: ${document_category || 'unknown'}

${docBlock}

Extract the following fields if present. Return null for fields not found.

For INVOICE documents extract:
- invoice_number: string
- description: string (short summary of what is being invoiced)
- planned_amount: number (invoice total amount)
- actual_amount: number (if different from planned)
- planned_date: date string YYYY-MM-DD (invoice date or due date)
- status: one of: planned, invoiced, paid, partial, overdue, cancelled
- notes: any relevant notes

For CONTRACT documents extract:
- contract_value: number
- start_date: date string YYYY-MM-DD
- end_date: date string YYYY-MM-DD
- client: string
- description: string
- scope: string (scope of work summary)
- notes: string

For PURCHASE ORDER documents extract:
- po_number: string
- vendor_name: string
- description: string
- amount: number
- issue_date: date string YYYY-MM-DD
- expected_delivery_date: date string YYYY-MM-DD
- status: one of: draft, issued, acknowledged, in_transit, partially_delivered, delivered, cancelled
- notes: string

For DELIVERY NOTE / PACKING SLIP / PACKING LIST documents extract:
- dn_number: string (the packing slip or delivery note number, e.g. PCKS-00002655)
- received_date: date string YYYY-MM-DD
- received_by: string
- condition: one of: good, damaged, partial
- notes: string
IMPORTANT: Documents titled "Packing slip" or "Packing list" are delivery documents — classify them as delivery_note, NOT "other".

Also extract these general fields that apply to all document types:
- document_title: string
- document_date: date string YYYY-MM-DD
- reference_number: string (any reference/document number found)
- parties: array of strings (company names, parties involved)
- currency: string (e.g. SAR, USD)
- total_amount: number (any total amount found)
- line_items: array of objects with these fields:
  - item_number: string (the supplier's internal warehouse/item number if present — NOT the real part number)
  - part_number: string (the real manufacturer part code, usually embedded in the description inside square brackets like [TQ.TWDFCW30K] or [ES.TQ.TM221CE40T]; extract the code inside the brackets)
  - description: string (full line description including any bracketed code)
  - ordered_qty: number (quantity ordered)
  - delivered_qty: number (quantity delivered/received on this slip)
  - remaining_qty: number (remaining to deliver, if shown)
  - quantity: number (same as ordered_qty for POs, delivered_qty for delivery notes)
  - unit: string
  - unit_price: number
  - total: number
  - ocr_uncertain: boolean (true when you are not confident you read this line's numbers correctly)

OCR ACCURACY RULES:
- Quantities may be handwritten or stamped over printed text; prefer the handwritten correction when both appear.
- If a quantity, date, or number is not clearly legible, omit it (return null) rather than guessing.
- For multi-page documents, extract line items from ALL pages and continue the same line_items array.

Return a JSON object with:
- document_type: detected type (invoice, contract, po, delivery_note, other). Packing slips and packing lists are delivery_note.
- confidence: number 0-1 how confident you are in the extraction
- general: object with general fields above
- specific: object with type-specific fields above
- line_items: array of line items if found`,
      response_json_schema: {
        type: 'object',
        properties: {
          document_type: { type: 'string' },
          confidence: { type: 'number' },
          general: {
            type: 'object',
            properties: {
              document_title: { type: 'string' },
              document_date: { type: 'string' },
              reference_number: { type: 'string' },
              parties: { type: 'array', items: { type: 'string' } },
              currency: { type: 'string' },
              total_amount: { type: 'number' }
            }
          },
          specific: { type: 'object' },
          line_items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                part_number: { type: 'string' },
                item_number: { type: 'string' },
                description: { type: 'string' },
                ordered_qty: { type: 'number' },
                delivered_qty: { type: 'number' },
                remaining_qty: { type: 'number' },
                quantity: { type: 'number' },
                unit: { type: 'string' },
                unit_price: { type: 'number' },
                total: { type: 'number' },
                ocr_uncertain: { type: 'boolean' }
              }
            }
          }
        }
      }
    });

    return Response.json({ result: { ...result, extraction_method: extractionMethod } });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});