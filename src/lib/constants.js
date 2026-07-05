import en from '@/locales/en';

// Label maps are sourced from the English locale (src/locales/en.js) so all
// display strings live in one place. Adding a language = adding a locale file.
export const STATUS_LABELS = en.projects.status;
export const TYPE_LABELS = en.projects.type;
export const PRIORITY_LABELS = en.projects.priority;

export const STATUS_COLORS = {
  planning: 'bg-slate-100 text-slate-700',
  in_progress: 'bg-blue-100 text-blue-700',
  commissioning: 'bg-amber-100 text-amber-800',
  completed: 'bg-emerald-100 text-emerald-700',
  closed: 'bg-slate-200 text-slate-600',
  on_hold: 'bg-orange-100 text-orange-700',
};

export const PRIORITY_COLORS = {
  low: 'bg-slate-100 text-slate-600',
  medium: 'bg-blue-100 text-blue-700',
  high: 'bg-amber-100 text-amber-800',
  critical: 'bg-red-100 text-red-700',
};

export const RAG_COLORS = {
  green: { bg: 'bg-emerald-500', text: 'text-emerald-600', badge: 'bg-emerald-100 text-emerald-700 border-emerald-300', label: 'On Track' },
  amber: { bg: 'bg-amber-500',   text: 'text-amber-600',   badge: 'bg-amber-100 text-amber-700 border-amber-300',     label: 'At Risk'  },
  red:   { bg: 'bg-red-500',     text: 'text-red-600',     badge: 'bg-red-100 text-red-700 border-red-300',           label: 'Critical' },
};

export const CATEGORY_LABELS = en.documents.category;
export const DELIVERABLE_TYPE_LABELS = en.deliverables.type;
export const DELIVERABLE_STATUS_LABELS = en.deliverables.status;
export const INVOICE_STATUS_LABELS = en.financials.invoiceStatus;
export const EXPENSE_STATUS_LABELS = en.financials.expenseStatus;
export const EXPENSE_CATEGORY_LABELS = en.financials.expenseCategory;
export const WBS_STATUS_LABELS = en.wbs.status;
export const BOM_CATEGORY_LABELS = en.bom.category;

// Canonical category options for dropdowns — one entry per entity enum value,
// unique labels (no aliases). BOM_CATEGORY_LABELS stays as the full display
// lookup (incl. import-pipeline alias keys like drive_vfd) so imported items
// still render their label, but selects never show duplicates.
export const BOM_CATEGORY_OPTIONS = [
  { value: 'plc', label: en.bom.category.plc },
  { value: 'hmi', label: en.bom.category.hmi },
  { value: 'drive', label: en.bom.category.drive },
  { value: 'sensor', label: en.bom.category.sensor },
  { value: 'meter', label: en.bom.category.meter },
  { value: 'panel', label: en.bom.category.panel },
  { value: 'network', label: en.bom.category.network },
  { value: 'software_license', label: en.bom.category.software_license },
  { value: 'service', label: en.bom.category.service },
  { value: 'it_hardware', label: en.bom.category.it_hardware },
  { value: 'other', label: en.bom.category.other },
];

// A BOMItem with a parent_id is a panel component (child row). Outside the BOM
// tab a panel is treated as ONE complete item, so child rows are invisible to
// every section except the BOM tab. Use this to exclude children from any
// count, total, rollup, or list outside the BOM tab — the panel parent already
// carries the panel's own cost/price/quantity as a single item.
export const isTopLevelBOM = (i) => !!i && !i.parent_id;

export const CURRENCIES = ['SAR', 'AED', 'USD', 'EUR', 'GBP', 'EGP', 'JPY', 'CNY'];

export function formatCurrency(value, currency = 'SAR') {
  if (value == null) return '—';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'SAR',
      currencyDisplay: 'code',
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return (currency || 'SAR') + ' ' + Number(value).toLocaleString();
  }
}

export function formatDate(d) {
  if (!d) return '—';
  return d.slice(0, 10);
}

export function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

export function formatNumber(v, digits = 0) {
  if (v == null || v === '') return '—';
  return Number(v).toLocaleString('en-US', { maximumFractionDigits: digits });
}

export function pct(num, denom) {
  if (!denom) return 0;
  return Math.round((Number(num) / Number(denom)) * 100);
}