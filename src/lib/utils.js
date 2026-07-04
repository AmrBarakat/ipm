import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

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

export const isIframe = window.self !== window.top;