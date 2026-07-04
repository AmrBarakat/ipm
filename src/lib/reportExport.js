// Reusable PDF / Excel generation helpers + report data helpers.
// Detached from the old per-tab export buttons so the Reports hub can reuse them.
import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
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

// ── PDF primitives (reused from the old ProjectPDFExport / ProgressReportModal) ─
export function sectionTitle(doc, text, x, y) {
  doc.setFillColor(245, 158, 11);
  doc.rect(x, y - 5, 3, 6, 'F');
  doc.setFontSize(10);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(text, x + 5, y);
}

export function tableHeader(doc, x, y, colW, fracs, labels) {
  doc.setFillColor(15, 23, 42);
  doc.rect(x, y - 5, colW, 7, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(7.5);
  doc.setFont(undefined, 'bold');
  let cx = x + 2;
  labels.forEach((l, i) => { doc.text(String(l), cx, y, { maxWidth: colW * fracs[i] - 2 }); cx += colW * fracs[i]; });
  doc.setTextColor(30, 41, 59);
}

function colFracs(columns) {
  const ws = columns.map(c => c.width);
  const hasW = ws.some(w => w != null);
  if (!hasW) return columns.map(() => 1 / columns.length);
  const sum = ws.reduce((s, w) => s + (w || 0), 0) || 1;
  return ws.map(w => (w || 0) / sum);
}

function drawRow(doc, x, y, colW, fracs, columns, row) {
  doc.setFontSize(7.5);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(30, 41, 59);
  let cx = x;
  fracs.forEach((f, i) => {
    const c = columns[i];
    const cw = colW * f;
    const val = row[c.key] != null ? String(row[c.key]) : '—';
    if (c.align === 'right') {
      doc.text(val, cx + cw - 2, y, { align: 'right', maxWidth: cw - 3 });
    } else {
      doc.text(val, cx + 2, y, { maxWidth: cw - 3 });
    }
    cx += cw;
  });
}

// ── Generic section-based exporters ──────────────────────────────────────────
// A "section" is { title, type:'table'|'summary',
//   columns?:[{header,key,align?,width?}], rows?:[{key:value}],
//   summary?:[{label,value}] }
export function exportSectionsPDF(filename, reportTitle, sections, opts = {}) {
  const orientation = opts.orientation || 'portrait';
  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
  const W = orientation === 'landscape' ? 297 : 210;
  const pageH = orientation === 'landscape' ? 210 : 297;
  const margin = 14;
  const colW = W - margin * 2;
  const maxY = pageH - 18;
  let y = 0;

  // Cover band
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, W, 30, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont(undefined, 'bold');
  doc.text(reportTitle, margin, 12);
  doc.setFontSize(9);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(203, 213, 225);
  doc.text(`Generated: ${new Date().toLocaleDateString('en-GB')}`, margin, 19);
  if (opts.subtitle) {
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text(opts.subtitle, margin, 26);
  }
  doc.setTextColor(0, 0, 0);
  y = 38;

  function checkPage(needed = 12) {
    if (y + needed > maxY) { doc.addPage(); y = 20; }
  }

  sections.forEach(s => {
    checkPage(14);
    sectionTitle(doc, s.title, margin, y);
    y += 8;

    if (s.type === 'summary' && s.summary) {
      s.summary.forEach((row, i) => {
        checkPage(8);
        if (i % 2 === 0) { doc.setFillColor(248, 250, 252); doc.rect(margin, y - 4, colW, 7, 'F'); }
        doc.setFontSize(8.5);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(71, 85, 105);
        doc.text(String(row.label), margin + 2, y);
        doc.setFont(undefined, 'bold');
        doc.setTextColor(15, 23, 42);
        doc.text(String(row.value), margin + colW - 2, y, { align: 'right' });
        y += 7;
      });
      y += 3;
    } else if (s.columns && s.rows) {
      const fracs = colFracs(s.columns);
      tableHeader(doc, margin, y, colW, fracs, s.columns.map(c => c.header));
      y += 7;
      s.rows.forEach((row, i) => {
        checkPage(8);
        if (i % 2 === 0) { doc.setFillColor(248, 250, 252); doc.rect(margin, y - 4, colW, 7, 'F'); }
        drawRow(doc, margin, y, colW, fracs, s.columns, row);
        y += 7;
      });
      if (s.summary) {
        s.summary.forEach(row => {
          checkPage(8);
          doc.setFillColor(241, 245, 249);
          doc.rect(margin, y - 4, colW, 7, 'F');
          doc.setFontSize(8.5);
          doc.setFont(undefined, 'bold');
          doc.setTextColor(15, 23, 42);
          doc.text(String(row.label), margin + 2, y);
          doc.text(String(row.value), margin + colW - 2, y, { align: 'right' });
          y += 7;
        });
      }
      y += 4;
    }
  });

  const pc = doc.getNumberOfPages();
  for (let p = 1; p <= pc; p++) {
    doc.setPage(p);
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.setFont(undefined, 'normal');
    doc.text(`${reportTitle}  ·  Page ${p} of ${pc}`, W / 2, pageH - 8, { align: 'center' });
  }

  doc.save(filename);
}

function autoWidth(rows) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  return cols.map(col => ({
    wch: Math.max(col.length, ...rows.map(r => String(r[col] ?? '').length)) + 2,
  }));
}

export function exportSectionsExcel(filename, sections) {
  const wb = XLSX.utils.book_new();
  sections.forEach(s => {
    const name = (String(s.title || 'Sheet').slice(0, 31) || 'Sheet').replace(/[\\/?*[\]:]/g, '');
    let rows;
    if (s.type === 'summary' && s.summary) {
      rows = s.summary.map(r => ({ Item: r.label, Value: r.value }));
    } else if (s.columns && s.rows) {
      rows = s.rows.map(r => {
        const o = {};
        s.columns.forEach(c => { o[c.header] = r[c.key] != null ? r[c.key] : ''; });
        return o;
      });
    } else {
      rows = [];
    }
    const sheetRows = rows.length ? rows : [{ Note: 'No data' }];
    const ws = XLSX.utils.json_to_sheet(sheetRows);
    ws['!cols'] = autoWidth(sheetRows);
    XLSX.utils.book_append_sheet(wb, ws, name || 'Sheet');
  });
  XLSX.writeFile(wb, filename);
}