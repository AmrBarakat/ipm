export const STATUS_LABELS = {
  planning: 'Planning',
  in_progress: 'In Progress',
  commissioning: 'Commissioning',
  completed: 'Completed',
  closed: 'Closed',
  on_hold: 'On Hold',
};

export const TYPE_LABELS = {
  plc: 'PLC',
  plc_scada: 'PLC & SCADA',
  pme: 'PME',
  service: 'Service',
  other: 'Other',
};

export const PRIORITY_LABELS = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

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

export const CATEGORY_LABELS = {
  charter: 'Project Charter',
  contract: 'Contract',
  po: 'Purchase Order',
  offer: 'Offer / Quotation',
  delivery_note: 'Delivery Note',
  engineering: 'Engineering Document',
  drawing: 'Drawing (DWG / CAD)',
  submittal: 'Submittal',
  bom: 'Bill of Materials (BOM)',
  project_plan: 'Project Plan',
  report: 'Report',
  invoice: 'Invoice',
  other: 'Other',
};

export const DELIVERABLE_TYPE_LABELS = {
  hardware: 'Hardware',
  software: 'Software',
  document: 'Document',
  service: 'Service',
  training: 'Training',
  other: 'Other',
};

export const DELIVERABLE_STATUS_LABELS = {
  pending: 'Pending',
  in_progress: 'In Progress',
  delivered: 'Delivered',
  accepted: 'Accepted',
  rejected: 'Rejected',
};

export const INVOICE_STATUS_LABELS = {
  planned: 'Planned',
  invoiced: 'Invoiced',
  paid: 'Paid',
  partial: 'Partial',
  overdue: 'Overdue',
  cancelled: 'Cancelled',
};

export const EXPENSE_STATUS_LABELS = {
  planned: 'Planned',
  committed: 'Committed',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

export const EXPENSE_CATEGORY_LABELS = {
  material: 'Material',
  labor: 'Labor',
  subcontract: 'Subcontract',
  travel: 'Travel',
  other: 'Other',
};

export const WBS_STATUS_LABELS = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  completed: 'Completed',
  blocked: 'Blocked',
};

export const BOM_CATEGORY_LABELS = {
  plc: 'PLC',
  hmi: 'HMI',
  drive: 'Drive / VFD',
  sensor: 'Sensor / Instrument',
  meter: 'Meter',
  panel: 'Panel / Enclosure',
  cable: 'Cable / Wiring',
  network: 'Network / Comms',
  software: 'Software / License',
  service: 'Service / Labor',
  'IT-HW': 'IT Hardware',
  other: 'Other',
};

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