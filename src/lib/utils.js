import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { format } from 'date-fns'

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

/**
 * Safe division: returns 0 when the divisor is 0 (or non-finite) instead of
 * NaN/Infinity. Use for percentage / average math where a zero divisor is possible.
 */
export function safeDiv(a, b) {
  const divisor = Number(b);
  if (!divisor || !Number.isFinite(divisor)) return 0;
  const result = Number(a) / divisor;
  return Number.isFinite(result) ? result : 0;
}

/**
 * Today's date in the user's local timezone as yyyy-MM-dd. date-fns `format` uses
 * the runtime's local time, so Saudi (UTC+3) users get the correct calendar day
 * instead of the UTC day (which is still "yesterday" late in the local evening).
 */
export function todayLocal() {
  return format(new Date(), 'yyyy-MM-dd');
}

/** Format any date value as a local yyyy-MM-dd string (replaces UTC slicing). */
export function toLocalDate(date) {
  return format(new Date(date), 'yyyy-MM-dd');
}

export const isIframe = window.self !== window.top;

/**
 * Sort milestones by planned_date ascending (nulls last), tie-break by title.
 * Used everywhere milestones are listed so display order is stable regardless
 * of fetch order.
 */
export function sortMilestones(list) {
  return [...(list || [])].sort((a, b) => {
    const ad = a?.planned_date, bd = b?.planned_date;
    if (ad && bd) return ad < bd ? -1 : ad > bd ? 1 : (a.title || '').localeCompare(b.title || '');
    if (ad && !bd) return -1;
    if (!ad && bd) return 1;
    return (a.title || '').localeCompare(b.title || '');
  });
}