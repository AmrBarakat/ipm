import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { FileText, Loader2 } from 'lucide-react';

/**
 * Small document icon that opens the source file, with a tooltip naming the
 * document and its date. Resolves either a direct source_document_id, or a
 * purchase_order_id (by looking up the PO's source_document_id). Uses a
 * module-level cache so repeated badges across rows don't re-fetch.
 */
const docCache = new Map();
const poCache = new Map();

async function resolveDocIdFromPO(poId) {
  if (poCache.has(poId)) return poCache.get(poId);
  try {
    const po = await base44.entities.PurchaseOrder.get(poId);
    const docId = po?.source_document_id || null;
    poCache.set(poId, docId);
    return docId;
  } catch (_) {
    poCache.set(poId, null);
    return null;
  }
}

async function fetchDoc(docId) {
  if (docCache.has(docId)) return docCache.get(docId);
  try {
    const d = await base44.entities.Document.get(docId);
    docCache.set(docId, d);
    return d;
  } catch (_) {
    docCache.set(docId, null);
    return null;
  }
}

export default function SourceDocumentBadge({ sourceDocumentId, purchaseOrderId }) {
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    async function run() {
      if (!sourceDocumentId && !purchaseOrderId) { setDoc(null); return; }
      setLoading(true);
      let docId = sourceDocumentId;
      if (!docId && purchaseOrderId) docId = await resolveDocIdFromPO(purchaseOrderId);
      if (!docId) { if (alive) setDoc(null); setLoading(false); return; }
      const d = await fetchDoc(docId);
      if (alive) setDoc(d);
      setLoading(false);
    }
    run();
    return () => { alive = false; };
  }, [sourceDocumentId, purchaseOrderId]);

  if (!sourceDocumentId && !purchaseOrderId) return null;
  if (loading) return <Loader2 className="w-3 h-3 text-slate-300 animate-spin inline-block align-middle" />;
  if (!doc || !doc.file_url) return null;
  const tip = `Source: ${doc.title || 'document'}${doc.document_date ? ' · ' + doc.document_date : ''}`;
  return (
    <a href={doc.file_url} target="_blank" rel="noopener noreferrer" title={tip}
      className="inline-flex items-center text-slate-400 hover:text-amber-600">
      <FileText className="w-3.5 h-3.5" />
    </a>
  );
}