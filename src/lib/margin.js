// Effective unit cost for margin: the real cost once known, else the plan.
export function effectiveCostUnit(item) {
  const actual  = Number(item?.actual_cost_price) || 0;
  const planned = Number(item?.planned_cost_price) || Number(item?.cost_price) || 0;
  return actual > 0 ? actual : planned;
}

// Margin on revenue: (sell - cost) / sell. Set MARKUP_MODE true to switch the
// whole app to markup on cost: (sell - cost) / cost.
export const MARKUP_MODE = false;

export function marginPct(costUnit, sellUnit) {
  const c = Number(costUnit) || 0;
  const s = Number(sellUnit) || 0;
  if (MARKUP_MODE) return c > 0 ? (s - c) / c : null;
  return s > 0 ? (s - c) / s : null;
}

export function costBasis(item) {
  return (Number(item?.actual_cost_price) || 0) > 0 ? 'actual' : 'planned';
}