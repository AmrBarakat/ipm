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