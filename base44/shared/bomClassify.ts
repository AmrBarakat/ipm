/**
 * Shared BOM classification + panel-allocation helpers used by both
 * bomSkillExtract and bomRecognizer so the two extraction paths stay in
 * lock-step for the hierarchical vendor BOM format (paired component/panel
 * sections, mixed SCADA sections, engineering/services lines).
 */

const NETWORK_RE = /\bswitch\b|\brouter\b|\bfirewall\b|ethernet switch/;
const SOFTWARE_RE = /(?:^|\W)software(?:\W|$)|sql server|scada expert|dashboards module|billing module/;
const SOFTWARE_MODULE_RE = /\blicense\b|\bmodule\b/;
const IT_HW_RE = /\bserver\b|\bworkstation\b|\bups\b|\bmonitor\b|\bprinter\b|\brack\b/;
const SERVICE_DESC_RE = /commissioning|engineering|testing/;

/**
 * Classify a BOM line by description + part number + section name.
 * Priority order: network → software_license → it_hardware → service → plc.
 */
export function classifyItem(description, partNo, sectionName) {
  const desc = `${description || ''} ${partNo || ''}`.toLowerCase();
  const sec = (sectionName || '').toLowerCase();
  const pn = (partNo || '').trim();

  if (NETWORK_RE.test(desc)) return 'network';

  if (pn && pn.toUpperCase().startsWith('PSA')) return 'software_license';
  if (SOFTWARE_RE.test(desc)) return 'software_license';
  if ((sec.includes('scada') || sec.includes('software')) && SOFTWARE_MODULE_RE.test(desc)) return 'software_license';

  if (IT_HW_RE.test(desc)) return 'it_hardware';

  const hasPartCode = /\d/.test(pn);
  if (sec.includes('engineering') || sec.includes('services')) return 'service';
  if (SERVICE_DESC_RE.test(desc) && !hasPartCode) return 'service';

  return 'plc';
}

/** Lowercase panel-group name → actual name, for section pairing. */
export function buildPanelLookup(groups) {
  const lookup = {};
  for (const g of groups) {
    if (g.isPanel && g.name) lookup[g.name.toLowerCase()] = g.name;
  }
  return lookup;
}

/**
 * For a non-panel component group, the panel name its items are allocated to.
 *  - if a "<name> <panelKeyword>" group exists → that panel's actual name
 *  - else the group's own name (if named)
 *  - else null (unnamed → omit from allocations)
 */
export function allocationPanelName(group, panelLookup, panelKeyword) {
  if (group.isPanel) return null;
  const n = group.name;
  if (!n) return null;
  const candidate = `${n} ${panelKeyword}`.toLowerCase();
  return panelLookup[candidate] || n;
}

/** Append/increment a panel allocation entry (mutates the array). */
export function addAllocation(allocations, panelName, qty) {
  if (!panelName) return;
  const existing = allocations.find(a => a.panel_name === panelName);
  if (existing) existing.qty += qty;
  else allocations.push({ panel_name: panelName, qty });
}

// ─── Section header row detection (shared) ───────────────────────────────────

function _gToNumber(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function _gIsNumbery(v) { return _gToNumber(v) !== null; }

const _SEP_RE = /^[\.\-_—–\\/|]*$/;

function _isLoneSeparator(v) {
  const s = String(v ?? '').trim();
  return s === '' || _SEP_RE.test(s);
}

/**
 * Build a group-row (section header) detector for a resolved field map.
 *
 * A row is a section header when ALL of these hold:
 *  a. The description column is empty (or the field is unmapped).
 *  b. The quantity column AND the unit-cost column are BOTH empty, OR the row
 *     has no value in any mapped price column.  (Section headers may carry a
 *     roll-up total in an unmapped column — that must not disqualify them.)
 *  c. At least one cell holds text that is not purely numeric and not a lone
 *     separator character (".", "-", "_").
 *  d. At most 2 cells look like free text.
 *
 * Guard (inverse regression): a row with a real part number AND a description
 * AND a quantity is never classified as a header, whatever text it contains.
 *
 * Keep isNumbery rejection of numeric first cells, but treat "." and "-" as
 * separators rather than as names.
 */
export function buildGroupRowDetector(fieldMap) {
  const descIdx = fieldMap?.description?.col_idx;
  const partIdx = fieldMap?.part_no?.col_idx;
  const qtyIdx = fieldMap?.qty?.col_idx;
  const unitCostIdx = fieldMap?.planned_cost_unit?.col_idx ?? fieldMap?.unit_cost_sar?.col_idx;
  const priceFields = ['planned_cost_unit', 'unit_sell', 'unit_cost_sar', 'total_cost_sar'];
  const priceIdxs = priceFields
    .map(f => fieldMap?.[f]?.col_idx)
    .filter(i => i != null);

  return function isGroupRow(row) {
    if (!row || !Array.isArray(row)) return false;

    // Guard: real part + description + quantity → never a header
    const hasPart = partIdx != null && row[partIdx] != null && String(row[partIdx]).trim() !== '';
    const hasDesc = descIdx != null && row[descIdx] != null && String(row[descIdx]).trim() !== '';
    const hasQty = qtyIdx != null && row[qtyIdx] != null && String(row[qtyIdx]).trim() !== '' && _gIsNumbery(row[qtyIdx]);
    if (hasPart && hasDesc && hasQty) return false;

    // (a) description column empty or unmapped
    if (descIdx != null && row[descIdx] != null && String(row[descIdx]).trim() !== '') return false;

    // (b) qty AND unit-cost both empty, OR no mapped price column has a value
    const qtyEmpty = qtyIdx == null || row[qtyIdx] == null || String(row[qtyIdx]).trim() === '';
    const unitCostEmpty = unitCostIdx == null || row[unitCostIdx] == null || String(row[unitCostIdx]).trim() === '';
    const anyPriceHasValue = priceIdxs.some(i => row[i] != null && String(row[i]).trim() !== '');
    if (!((qtyEmpty && unitCostEmpty) || !anyPriceHasValue)) return false;

    // Collect meaningful (non-separator) cells
    const meaningful = row
      .map(v => String(v ?? '').trim())
      .filter(s => s !== '' && !_isLoneSeparator(s));
    if (meaningful.length === 0) return false;

    // Keep isNumbery rejection of numeric first cells (separators already skipped)
    if (_gIsNumbery(meaningful[0])) return false;

    // (c) at least one non-numeric text cell
    const textCells = meaningful.filter(s => !_gIsNumbery(s));
    if (textCells.length === 0) return false;

    // (d) at most 2 free-text cells
    if (textCells.length > 2) return false;

    return true;
  };
}

/**
 * Resolve the section name as the longest text cell in the row that is not a
 * lone separator — not the first non-empty cell.  On this format the first
 * non-empty cell may be "." and the name sits in the part-number column.
 */
export function resolveSectionName(row) {
  const candidates = row
    .map(v => String(v ?? '').trim())
    .filter(s => s !== '' && !_isLoneSeparator(s) && !_gIsNumbery(s));
  if (candidates.length > 0) {
    return candidates.reduce((a, b) => b.length > a.length ? b : a, '');
  }
  // Fallback: first non-empty non-separator cell
  const fb = row
    .map(v => String(v ?? '').trim())
    .filter(s => s !== '' && !_isLoneSeparator(s));
  return fb[0] || '';
}