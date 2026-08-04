import { AlertTriangle, Link2 } from 'lucide-react';

/**
 * R5 duplicate banner. Shown at the top of every step when extractPODN detected
 * an existing PurchaseOrder (same project + po_number) or Expense (same reference).
 */
export default function DuplicateBanner({ duplicates, documentNumber, projectId }) {
  if (!duplicates) return null;
  const hasPO = !!duplicates.purchase_order_id;
  const hasExp = !!duplicates.expense_id;
  if (!hasPO && !hasExp) return null;

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 space-y-1">
      {hasPO && (
        <div className="flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            <span className="font-semibold">{documentNumber || 'This document'}</span> already exists on this project
            (status: {duplicates.purchase_order_status || '—'}). Applying will <b>UPDATE</b> it, not create a duplicate.
          </span>
          <a
            href={`/projects/${projectId}`}
            className="ml-auto flex items-center gap-1 text-xs text-amber-700 hover:text-amber-900 underline shrink-0"
          >
            <Link2 className="w-3 h-3" /> Open PO
          </a>
        </div>
      )}
      {hasExp && (
        <div className="flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            An expense with reference <span className="font-mono font-semibold">{documentNumber}</span> already exists on
            this project — the expense step will link to it instead of creating a new one.
          </span>
        </div>
      )}
    </div>
  );
}