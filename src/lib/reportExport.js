// Reusable PDF / Excel generation helpers + report data helpers.
// Detached from the old per-tab export buttons so the Reports hub can reuse them.
import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx-js-style';
import { formatCurrency, formatDate } from '@/lib/constants';

export { formatCurrency, formatDate };

// ── Small shared helpers ─────────────────────────────────────────────────────
export function truncate(str, max) {
  if (str == null) return '—';
  const s = String(str);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export function isOverdue(date, status) {
  if (!date) return false;
  if (status === 'completed' || status === 'delivered' || status === 'cancelled' || status === 'accepted') return false;
  const d = new Date(date); d.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return d < today;
}

export function daysOverdue(date, status) {
  if (!isOverdue(date, status)) return 0;
  const d = new Date(date); d.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((today - d) / 86400000);
}

// ── WBS weighted rollup ──────────────────────────────────────────────────────
export function wbsRollup(wbsItems) {
  const byId = Object.fromEntries((wbsItems || []).map(i => [i.id, i]));
  const tree = {};
  (wbsItems || []).forEach(i => {
    const pid = i.parent_id || '__root__';
    if (!tree[pid]) tree[pid] = [];
    tree[pid].push(i);
  });
  function rollup(id) {
    const children = tree[id] || [];
    if (children.length === 0) return byId[id]?.progress || 0;
    const cp = children.map(c => ({ p: rollup(c.id), w: c.weight || 1 }));
    const tw = cp.reduce((s, c) => s + c.w, 0);
    return Math.round(cp.reduce((s, c) => s + c.p * c.w, 0) / (tw || 1));
  }
  const roots = tree['__root__'] || [];
  const overall = roots.length === 0 ? 0 : (() => {
    const tw = roots.reduce((s, r) => s + (r.weight || 1), 0);
    return Math.round(roots.reduce((s, r) => s + rollup(r.id) * (r.weight || 1), 0) / (tw || 1));
  })();
  return { byId, tree, rollup, overall };
}

// ── Financial helpers ───────────────────────────────────────────────────────
export function revisedContractValue(project, changeOrders) {
  const original = Number(project?.contract_value) || 0;
  const coImpact = (changeOrders || [])
    .filter(co => ['approved', 'implemented', 'submitted'].includes(co.status))
    .reduce((s, co) => s + (Number(co.impact_cost) || 0), 0);
  const coScheduleDays = (changeOrders || [])
    .filter(co => ['approved', 'implemented', 'submitted'].includes(co.status))
    .reduce((s, co) => s + (Number(co.impact_days) || 0), 0);
  return { original, coImpact, revised: original + coImpact, coScheduleDays };
}

export function projectMargin(invoices, expenses, collections) {
  const invoiced = (invoices || [])
    .filter(i => ['invoiced', 'paid', 'partial', 'overdue'].includes(i.status))
    .reduce((s, i) => s + (Number(i.actual_amount) || Number(i.planned_amount) || 0), 0);
  const collected = (collections || []).reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const spent = (expenses || [])
    .filter(e => ['committed', 'paid'].includes(e.status))
    .reduce((s, e) => s + (Number(e.actual_amount) || Number(e.planned_amount) || 0), 0);
  const budget = (expenses || []).reduce((s, e) => s + (Number(e.planned_amount) || 0), 0);
  const outstanding = invoiced - collected;
  const margin = collected - spent;
  const marginPct = collected > 0 ? Math.round((margin / collected) * 100) : null;
  return { invoiced, collected, spent, budget, outstanding, margin, marginPct };
}

// ── Project health (RAG) ─────────────────────────────────────────────────────
export function projectHealth(project, overdueCount = 0) {
  if (!project) return 'green';
  if (project.status === 'completed' || project.status === 'closed') return 'green';
  if (project.status === 'on_hold') return 'amber';
  const progress = Number(project.progress) || 0;
  let expected = 50;
  if (project.start_date && project.target_completion_date) {
    const start = new Date(project.start_date).getTime();
    const end = new Date(project.target_completion_date).getTime();
    const now = Date.now();
    if (now <= start) expected = 0;
    else if (now >= end) expected = 100;
    else expected = Math.round(((now - start) / (end - start)) * 100);
  }
  if (overdueCount >= 3 || progress < expected - 25) return 'red';
  if (progress < expected - 10 || overdueCount > 0) return 'amber';
  return 'green';
}

export const HEALTH_LABELS = { green: 'On Track', amber: 'At Risk', red: 'Critical' };

// ══════════════════════════════════════════════════════════════════════════════
// PDF typography & palette (defined once, reused everywhere)
// ══════════════════════════════════════════════════════════════════════════════
export const FONT = 'helvetica';
export const SIZES = { title: 18, subtitle: 11, section: 10.5, th: 8, body: 8, footer: 7, meta: 9 };
export const LINE_FACTOR = 1.15;
export const PT_TO_MM = 25.4 / 72;

export const C = {
  ink: [15, 23, 42],
  subInk: [71, 85, 105],
  muted: [148, 163, 184],
  hairline: [226, 232, 240],
  headerFill: [15, 23, 42],
  zebra: [248, 250, 252],
  accent: [245, 158, 11],
  totals: [241, 245, 249],
  white: [255, 255, 255],
  bandSub: [203, 213, 225],
};

export const PAD_X = 1.5;     // horizontal cell padding (mm)
export const PAD_Y = 1.1;     // vertical cell padding (mm)
export const MIN_ROW = 7;     // minimum row height (mm)
export const MIN_COL_W = 16;   // minimum readable column width (mm)

export const lineMm = (size) => size * LINE_FACTOR * PT_TO_MM;
export const ascentMm = (size) => size * 0.8 * PT_TO_MM;

export function setColor(doc, [r, g, b], kind) {
  if (kind === 'fill') doc.setFillColor(r, g, b);
  else if (kind === 'draw') doc.setDrawColor(r, g, b);
  else doc.setTextColor(r, g, b);
}

// Wrap text to a width, then hard-slice any line (long unbroken token) that still
// overflows, appending an ellipsis so nothing ever spills outside the cell.
export function wrap(doc, value, innerW, size, style = 'normal') {
  doc.setFont(FONT, style);
  doc.setFontSize(size);
  const max = Math.max(innerW, 4);
  const lines = doc.splitTextToSize(String(value ?? '—'), max);
  return lines.map((ln) => {
    if (doc.getTextWidth(ln) <= max) return ln;
    let s = String(ln);
    while (s.length > 1 && doc.getTextWidth(s + '…') > max) s = s.slice(0, -1);
    return s + '…';
  });
}

// Draw pre-wrapped lines top-aligned within a cell box.
export function drawLines(doc, lines, x, topY, size, align, rightX) {
  const asc = ascentMm(size);
  const lh = lineMm(size);
  lines.forEach((ln, i) => {
    const baseY = topY + asc + i * lh;
    if (align === 'right') doc.text(ln, rightX, baseY, { align: 'right' });
    else doc.text(ln, x, baseY);
  });
}

// Convert column width fractions to absolute widths, guarding a minimum.
export function colWidths(fracs, totalW) {
  let widths = fracs.map((f) => Math.max(MIN_COL_W, f * totalW));
  const sum = widths.reduce((a, b) => a + b, 0);
  if (sum > totalW) widths = widths.map((w) => (w * totalW) / sum);
  return widths;
}

export function colFracs(columns) {
  const ws = columns.map((c) => c.width);
  const hasW = ws.some((w) => w != null);
  if (!hasW) return columns.map(() => 1 / columns.length);
  const sum = ws.reduce((s, w) => s + (w || 0), 0) || 1;
  return ws.map((w) => (w || 0) / sum);
}

// Measure a data row's height (max of wrapped cells), never below MIN_ROW.
export function measureRow(doc, row, columns, widths, size) {
  let maxH = 0;
  columns.forEach((c, i) => {
    const inner = widths[i] - 2 * PAD_X;
    const lines = wrap(doc, row[c.key], inner, size, 'normal');
    const h = lines.length * lineMm(size) + 2 * PAD_Y;
    if (h > maxH) maxH = h;
  });
  return Math.max(maxH, MIN_ROW);
}

// Draw a data row's cells inside the computed rowHeight. Returns nothing.
// A column may declare cellColor(row) → [r,g,b] to override the cell's text
// color (e.g. overdue dates in red); defaults to ink.
export function drawRow(doc, x, topY, widths, columns, row, size) {
  columns.forEach((c, i) => {
    const cw = widths[i];
    const inner = cw - 2 * PAD_X;
    const lines = wrap(doc, row[c.key], inner, size, 'normal');
    const align = c.align === 'right' ? 'right' : 'left';
    const cellColor = c.cellColor ? c.cellColor(row) : null;
    setColor(doc, cellColor || C.ink, 'text');
    drawLines(doc, lines, x + PAD_X, topY + PAD_Y, size, align, x + cw - PAD_X);
  });
}

// Measure + draw the header row. Returns the measured header height.
export function drawHeaderRow(doc, x, topY, totalW, widths, columns) {
  const size = SIZES.th;
  let h = MIN_ROW;
  const cellLines = columns.map((c, i) => {
    const lines = wrap(doc, c.header, widths[i] - 2 * PAD_X, size, 'bold');
    const ch = lines.length * lineMm(size) + 2 * PAD_Y;
    if (ch > h) h = ch;
    return lines;
  });
  setColor(doc, C.headerFill, 'fill');
  doc.rect(x, topY, totalW, h, 'F');
  setColor(doc, C.white, 'text');
  cellLines.forEach((lines, i) => {
    const cw = widths[i];
    drawLines(doc, lines, x + PAD_X, topY + PAD_Y, size, 'left', x + cw - PAD_X);
  });
  // Accent underline beneath the header band.
  setColor(doc, C.accent, 'draw');
  doc.setLineWidth(0.6);
  doc.line(x, topY + h, x + totalW, topY + h);
  return h;
}

// Draw vertical column separators (dense tables only).
export function drawVLines(doc, x, topY, totalW, widths, h) {
  setColor(doc, C.hairline, 'draw');
  doc.setLineWidth(0.1);
  let cx = x;
  widths.forEach((w) => { doc.line(cx, topY, cx, topY + h); cx += w; });
  doc.line(x + totalW, topY, x + totalW, topY + h);
}

// ── Public PDF primitives (signatures preserved for external callers) ─────────
export function sectionTitle(doc, text, x, y) {
  setColor(doc, C.accent, 'fill');
  doc.rect(x, y - 5, 3, 6, 'F');
  doc.setFontSize(SIZES.section);
  doc.setFont(FONT, 'bold');
  setColor(doc, C.ink, 'text');
  doc.text(String(text ?? ''), x + 5, y);
}

export function tableHeader(doc, x, y, colW, fracs, labels) {
  const widths = colWidths(fracs, colW);
  setColor(doc, C.headerFill, 'fill');
  doc.rect(x, y - 5, colW, 7, 'F');
  setColor(doc, C.white, 'text');
  doc.setFontSize(SIZES.th);
  doc.setFont(FONT, 'bold');
  let cx = x;
  labels.forEach((l, i) => {
    const lines = wrap(doc, l, widths[i] - 2 * PAD_X, SIZES.th, 'bold');
    drawLines(doc, lines, cx + PAD_X, y - 5 + PAD_Y, SIZES.th, 'left', cx + widths[i] - PAD_X);
    cx += widths[i];
  });
  setColor(doc, C.ink, 'text');
}

// ── Generic section-based exporters ──────────────────────────────────────────
// A "section" is { title, type:'table'|'summary',
//   columns?:[{header,key,align?,width?}], rows?:[{key:value}],
//   summary?:[{label,value}] }
export function exportSectionsPDF(filename, reportTitle, sections, opts = {}) {
  // Auto-suggest landscape for wide tables when orientation not specified.
  let orientation = opts.orientation;
  if (!orientation) {
    const maxCols = sections.reduce((m, s) => Math.max(m, s.columns?.length || 0), 0);
    orientation = maxCols > 6 ? 'landscape' : 'portrait';
  }

  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
  const W = orientation === 'landscape' ? 297 : 210;
  const pageH = orientation === 'landscape' ? 210 : 297;
  const margin = 14;
  const colW = W - margin * 2;
  const topMargin = 20;
  const maxY = pageH - 22; // reserve room for footer + hairline
  let y = 0;

  // ── Cover band (height grows with wrapped title) ────────────────────────────
  doc.setFont(FONT, 'bold');
  const titleLines = wrap(doc, reportTitle, W - 2 * margin, SIZES.title, 'bold');
  const titleH = titleLines.length * lineMm(SIZES.title);
  const padTop = 8;
  const genTop = padTop + titleH + 3;
  const genLine = `Generated: ${new Date().toLocaleDateString('en-GB')}`;
  let subTop = genTop;
  let subLines = [];
  let subH = 0;
  if (opts.subtitle) {
    subTop = genTop + lineMm(SIZES.subtitle) + 3;
    subLines = wrap(doc, opts.subtitle, W - 2 * margin, SIZES.subtitle, 'bold');
    subH = subLines.length * lineMm(SIZES.subtitle);
  }
  const bandContentBottom = opts.subtitle ? subTop + subH : genTop + lineMm(SIZES.subtitle);
  const bandHeight = Math.max(30, bandContentBottom + 8);

  setColor(doc, C.ink, 'fill');
  doc.rect(0, 0, W, bandHeight, 'F');
  setColor(doc, C.accent, 'fill');
  doc.rect(0, bandHeight - 1.2, W, 1.2, 'F');

  setColor(doc, C.white, 'text');
  drawLines(doc, titleLines, margin, padTop, SIZES.title, 'left', W - margin);
  setColor(doc, C.bandSub, 'text');
  doc.setFont(FONT, 'normal');
  doc.setFontSize(SIZES.subtitle);
  drawLines(doc, [genLine], margin, genTop, SIZES.subtitle, 'left', W - margin);
  if (opts.subtitle) {
    setColor(doc, C.white, 'text');
    drawLines(doc, subLines, margin, subTop, SIZES.subtitle, 'left', W - margin);
  }

  // Optional right-aligned metadata block inside the band.
  if (Array.isArray(opts.meta) && opts.meta.length) {
    setColor(doc, C.bandSub, 'text');
    doc.setFont(FONT, 'normal');
    opts.meta.forEach((m, i) => {
      const line = `${m.label}: ${m.value ?? '—'}`;
      drawLines(doc, wrap(doc, line, W * 0.4, SIZES.meta, 'normal'),
        W - margin, padTop + i * lineMm(SIZES.meta), SIZES.meta, 'right', W - margin);
    });
  }

  y = bandHeight + 10;

  // ── Section rendering ───────────────────────────────────────────────────────
  function newPage() { doc.addPage(); y = topMargin; }

  function ensureSpace(needed) { if (y + needed > maxY) newPage(); }

  function renderSummaryRows(rows, startY, totalsStyle) {
    let yy = startY;
    const size = SIZES.body;
    const labelInner = colW * 0.6 - 2 * PAD_X;
    const valueInner = colW * 0.4 - 2 * PAD_X;
    rows.forEach((row, i) => {
      const labelLines = wrap(doc, row.label, labelInner, size, totalsStyle ? 'bold' : 'normal');
      const valueLines = wrap(doc, row.value, valueInner, size, totalsStyle ? 'bold' : 'normal');
      const rh = Math.max(
        labelLines.length * lineMm(size) + 2 * PAD_Y,
        valueLines.length * lineMm(size) + 2 * PAD_Y,
        MIN_ROW,
      );
      if (yy + rh > maxY) { doc.addPage(); yy = topMargin; }
      // Alternating fill by computed height (totals use a single slate fill).
      if (totalsStyle) { setColor(doc, C.totals, 'fill'); doc.rect(margin, yy, colW, rh, 'F'); }
      else if (i % 2 === 0) { setColor(doc, C.zebra, 'fill'); doc.rect(margin, yy, colW, rh, 'F'); }
      setColor(doc, totalsStyle ? C.ink : C.subInk, 'text');
      drawLines(doc, labelLines, margin + PAD_X, yy + PAD_Y, size, 'left', margin + colW * 0.6);
      setColor(doc, C.ink, 'text');
      drawLines(doc, valueLines, margin + colW * 0.6, yy + PAD_Y, size, 'right', margin + colW - PAD_X);
      setColor(doc, C.hairline, 'draw'); doc.setLineWidth(0.1);
      doc.line(margin, yy + rh, margin + colW, yy + rh);
      yy += rh;
    });
    return yy;
  }

  function renderTable(section) {
    const fracs = colFracs(section.columns);
    const widths = colWidths(fracs, colW);
    const size = SIZES.body;
    const dense = section.columns.length > 6;

    // Header (drawn first, then re-drawn at the top of every overflow page).
    if (y + MIN_ROW > maxY) newPage();
    let headerH = drawHeaderRow(doc, margin, y, colW, widths, section.columns);
    let rowTop = y + headerH;

    if (!section.rows || section.rows.length === 0) {
      // Empty table → single "No data" row spanning the table.
      const rh = MIN_ROW;
      if (rowTop + rh > maxY) { doc.addPage(); rowTop = topMargin; headerH = drawHeaderRow(doc, margin, rowTop, colW, widths, section.columns); rowTop += headerH; }
      setColor(doc, C.zebra, 'fill'); doc.rect(margin, rowTop, colW, rh, 'F');
      setColor(doc, C.muted, 'text'); doc.setFontSize(size); doc.setFont(FONT, 'italic');
      doc.text('No data', margin + PAD_X, rowTop + PAD_Y + ascentMm(size));
      setColor(doc, C.hairline, 'draw'); doc.setLineWidth(0.1);
      doc.line(margin, rowTop + rh, margin + colW, rowTop + rh);
      rowTop += rh;
      y = rowTop + 4;
      return;
    }

    section.rows.forEach((row, i) => {
      const rh = measureRow(doc, row, section.columns, widths, size);
      // Page-break before drawing a row that doesn't fit; re-draw header first.
      if (rowTop + rh > maxY) {
        doc.addPage();
        rowTop = topMargin;
        headerH = drawHeaderRow(doc, margin, rowTop, colW, widths, section.columns);
        rowTop += headerH;
      }
      if (i % 2 === 0) { setColor(doc, C.zebra, 'fill'); doc.rect(margin, rowTop, colW, rh, 'F'); }
      drawRow(doc, margin, rowTop, widths, section.columns, row, size);
      // Horizontal hairline under each row; vertical separators for dense tables.
      setColor(doc, C.hairline, 'draw'); doc.setLineWidth(0.1);
      doc.line(margin, rowTop + rh, margin + colW, rowTop + rh);
      if (dense) drawVLines(doc, margin, rowTop, colW, widths, rh);
      rowTop += rh;
    });

    // Totals / summary rows directly under the table.
    if (section.summary && section.summary.length) {
      rowTop = renderSummaryRows(section.summary, rowTop, true);
    }
    y = rowTop + 4;
  }

  sections.forEach((s) => {
    ensureSpace(14);
    sectionTitle(doc, s.title, margin, y);
    y += 8;

    if (s.type === 'summary' && s.summary) {
      if (s.summary.length === 0) {
        // No data summary row.
        renderSummaryRows([{ label: 'No data', value: '—' }], y, false);
      } else {
        y = renderSummaryRows(s.summary, y, false);
      }
      y += 3;
    } else if (s.columns && (s.rows || s.summary)) {
      renderTable(s);
    } else {
      // Unknown / empty section → placeholder row.
      y = renderSummaryRows([{ label: 'No data', value: '—' }], y, false);
      y += 3;
    }
  });

  // ── Footer (hairline + centered page count + optional Confidential) ─────────
  const pc = doc.getNumberOfPages();
  for (let p = 1; p <= pc; p++) {
    doc.setPage(p);
    setColor(doc, C.hairline, 'draw');
    doc.setLineWidth(0.1);
    doc.line(margin, pageH - 14, W - margin, pageH - 14);
    doc.setFontSize(SIZES.footer);
    doc.setFont(FONT, 'normal');
    setColor(doc, C.muted, 'text');
    doc.text(`${reportTitle}  ·  Page ${p} of ${pc}`, W / 2, pageH - 8, { align: 'center' });
    if (opts.confidential) doc.text('Confidential', margin, pageH - 8);
  }

  doc.save(filename);
}

// ── Excel styling (xlsx-js-style drop-in) ────────────────────────────────────
// The community `xlsx` build cannot style cells; xlsx-js-style is a drop-in fork
// that adds cell.s (font/fill/numFmt/alignment). This shared helper applies the
// app's report look — bold white header on dark fill, frozen top row, autofilter,
// auto column widths, and number formats on numeric columns — to any sheet.
const HEADER_FILL = '0F172A'; // C.headerFill → hex (no #)

function numFmtForHeader(header) {
  const s = String(header || '').toLowerCase();
  if (s.includes('%') || s.includes('progress') || s.includes('margin')) return '0"%"';
  if (/(cost|price|amount|total|value|planned|actual|selling|budget|revenue|spent|outstanding)/.test(s)) return '#,##0.00';
  return null;
}

function wsColWidths(ws, range) {
  const cols = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    let max = 10;
    for (let r = range.s.r; r <= range.e.r; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      const v = cell ? (cell.w ?? (cell.v != null ? String(cell.v) : '')) : '';
      const len = String(v).length;
      if (len > max) max = len;
    }
    cols.push({ wch: Math.min(max + 2, 60) });
  }
  return cols;
}

export function styleSheet(ws, opts = {}) {
  const headerRows = opts.headerRows ?? [0];
  const freezeRow = opts.freezeRow ?? 1;
  const columns = opts.columns || null;
  const ref = ws['!ref'];
  if (!ref) return ws;
  const range = XLSX.utils.decode_range(ref);
  const colCount = range.e.c - range.s.c + 1;

  // Bold white text on dark fill for every header row.
  const headerStyle = {
    font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 },
    fill: { patternType: 'solid', fgColor: { rgb: HEADER_FILL } },
    alignment: { horizontal: 'left', vertical: 'center' },
  };
  headerRows.forEach((ri) => {
    for (let ci = 0; ci < colCount; ci++) {
      const cell = ws[XLSX.utils.encode_cell({ r: ri, c: ci })];
      if (cell) cell.s = { ...headerStyle };
    }
  });

  // Number formats on numeric cells, per column.
  if (columns) {
    for (let ci = 0; ci < colCount; ci++) {
      const fmt = columns[ci]?.fmt || numFmtForHeader(columns[ci]?.header);
      if (!fmt) continue;
      for (let ri = range.s.r; ri <= range.e.r; ri++) {
        if (headerRows.includes(ri)) continue;
        const cell = ws[XLSX.utils.encode_cell({ r: ri, c: ci })];
        if (cell && typeof cell.v === 'number') cell.s = { ...(cell.s || {}), numFmt: fmt };
      }
    }
  }

  // Auto column widths from cell content.
  ws['!cols'] = wsColWidths(ws, range);

  // Freeze the top row(s).
  if (freezeRow > 0) {
    ws['!freeze'] = {
      xSplit: 0, ySplit: freezeRow,
      topLeftCell: XLSX.utils.encode_cell({ r: freezeRow, c: 0 }),
      activePane: 'bottomLeft', state: 'frozen',
    };
  }

  // Autofilter across the whole used range.
  if (opts.autoFilter !== false && headerRows.length) {
    ws['!autofilter'] = { ref };
  }
  return ws;
}

function sanitizeSheetName(s) {
  return (String(s?.title || s || 'Sheet').slice(0, 31) || 'Sheet').replace(/[\\/?*[\]:]/g, '');
}

export function exportSectionsExcel(filename, sections) {
  const wb = XLSX.utils.book_new();
  sections.forEach((s) => {
    const name = sanitizeSheetName(s.title);
    let sheetRows, columns;
    if (s.type === 'summary' && s.summary) {
      sheetRows = s.summary.map((r) => ({ Item: r.label, Value: r.value }));
      columns = [{ header: 'Item' }, { header: 'Value' }];
    } else if (s.columns && s.rows) {
      sheetRows = s.rows.map((r) => {
        const o = {};
        s.columns.forEach((c) => { o[c.header] = r[c.key] != null ? r[c.key] : ''; });
        return o;
      });
      columns = s.columns.map((c) => ({ header: c.header, fmt: c.fmt }));
    } else {
      sheetRows = [{ Note: 'No data' }];
      columns = [{ header: 'Note' }];
    }
    if (!sheetRows.length) sheetRows = [{ Note: 'No data' }];
    const ws = XLSX.utils.json_to_sheet(sheetRows);
    styleSheet(ws, { headerRows: [0], freezeRow: 1, columns });
    XLSX.utils.book_append_sheet(wb, ws, name || 'Sheet');
  });
  XLSX.writeFile(wb, filename);
}