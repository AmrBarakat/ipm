export const VENDOR_TYPES = [
  { value: 'supplier', label: 'Supplier' },
  { value: 'subcontractor', label: 'Subcontractor' },
  { value: 'logistics', label: 'Logistics' },
  { value: 'other', label: 'Other' },
];

export const RATINGS = [
  { value: 'preferred', label: 'Preferred' },
  { value: 'approved', label: 'Approved' },
  { value: 'conditional', label: 'Conditional' },
  { value: 'blacklisted', label: 'Blacklisted' },
];

export const RATING_STYLES = {
  preferred: 'bg-emerald-100 text-emerald-700',
  approved: 'bg-blue-100 text-blue-700',
  conditional: 'bg-amber-100 text-amber-700',
  blacklisted: 'bg-red-100 text-red-700',
};

export const RATING_DOT = {
  preferred: 'bg-emerald-500',
  approved: 'bg-blue-500',
  conditional: 'bg-amber-500',
  blacklisted: 'bg-red-500',
};

export const TYPE_LABELS = {
  supplier: 'Supplier',
  subcontractor: 'Subcontractor',
  logistics: 'Logistics',
  other: 'Other',
};

export const ratingLabel = (r) => RATINGS.find(x => x.value === r)?.label || r;