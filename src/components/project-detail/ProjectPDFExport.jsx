import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { formatCurrency, formatDate, STATUS_LABELS, PRIORITY_LABELS, TYPE_LABELS } from '@/lib/constants';
import { FileDown, Loader2 } from 'lucide-react';
import { jsPDF } from 'jspdf';

export default function ProjectPDFExport({ project }) {
  const [loading, setLoading] = useState(false);

  async function generate() {
    setLoading(true);

    // Fetch data in parallel
    const [milestones, invoices, expenses, collections, wbsItems] = await Promise.all([
      base44.entities.Milestone.filter({ project_id: project.id }, 'planned_date', 100),
      base44.entities.Invoice.filter({ project_id: project.id }, 'planned_date', 100),
      base44.entities.Expense.filter({ project_id: project.id }, 'planned_date', 100),
      base44.entities.Collection.filter({ project_id: project.id }, '-received_date', 100),
      base44.entities.WBSItem.filter({ project_id: project.id }, 'wbs_code', 500),
    ]);

    // ── WBS weighted rollup ───────────────────────────────────────────────
    const wbsById = Object.fromEntries(wbsItems.map(i => [i.id, i]));
    const wbsTree = {};
    wbsItems.forEach(i => {
      const pid = i.parent_id || '__root__';
      if (!wbsTree[pid]) wbsTree[pid] = [];
      wbsTree[pid].push(i);
    });
    // Child progress weighted by each item's weight, rolled up to parents.
    function rollupProgress(id) {
      const children = wbsTree[id] || [];
      if (children.length === 0) return wbsById[id]?.progress || 0;
      const cp = children.map(c => ({ p: rollupProgress(c.id), w: c.weight || 1 }));
      const tw = cp.reduce((s, c) => s + c.w, 0);
      return Math.round(cp.reduce((s, c) => s + c.p * c.w, 0) / (tw || 1));
    }
    // Roots weighted-averaged for overall WBS progress.
    const roots = wbsTree['__root__'] || [];
    const rootOverall = (() => {
      if (roots.length === 0) return 0;
      const tw = roots.reduce((s, r) => s + (r.weight || 1), 0);
      return Math.round(roots.reduce((s, r) => s + rollupProgress(r.id) * (r.weight || 1), 0) / (tw || 1));
    })();

    const cur = project.currency || 'SAR';

    // ── Financial summary calcs ───────────────────────────────────────────
    const invoiced = invoices
      .filter(i => ['invoiced', 'paid', 'partial', 'overdue'].includes(i.status))
      .reduce((s, i) => s + (i.actual_amount || i.planned_amount || 0), 0);
    const collected = collections.reduce((s, c) => s + (c.amount || 0), 0);
    const spent = expenses
      .filter(e => ['committed', 'paid'].includes(e.status))
      .reduce((s, e) => s + (e.actual_amount || e.planned_amount || 0), 0);
    const remaining = collected - spent;
    const marginPct = invoiced > 0 ? Math.round(((invoiced - spent) / invoiced) * 100) : null;

    // ── PDF layout ───────────────────────────────────────────────────────
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = 210;
    const margin = 14;
    const colW = W - margin * 2;
    let y = 0;

    function checkPage(needed = 12) {
      if (y + needed > 275) { doc.addPage(); y = 20; }
    }

    // ── Cover header band ─────────────────────────────────────────────────
    doc.setFillColor(15, 23, 42); // slate-900
    doc.rect(0, 0, W, 30, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont(undefined, 'bold');
    doc.text('Project Report', margin, 12);
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.text(`Generated: ${new Date().toLocaleDateString('en-GB')}`, margin, 19);
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text(`${project.code}  —  ${project.name}`, margin, 26);
    doc.setTextColor(0, 0, 0);
    y = 38;

    // ── Cover: project name, client, status, overall progress, contract value ──
    doc.setFontSize(8);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(100, 116, 139);
    const infoItems = [
      ['Client', project.client || '—'],
      ['Status', STATUS_LABELS[project.status] || project.status],
      ['Type', TYPE_LABELS[project.project_type] || project.project_type],
      ['Priority', PRIORITY_LABELS[project.priority] || project.priority],
      ['Start', formatDate(project.start_date)],
      ['Due', formatDate(project.target_completion_date)],
      ['Location', project.location || '—'],
      ['Project Manager', project.project_manager || '—'],
    ];
    const colCount = 4;
    const iColW = colW / colCount;
    infoItems.forEach(([label, val], idx) => {
      const col = idx % colCount;
      const row = Math.floor(idx / colCount);
      const x = margin + col * iColW;
      const iy = y + row * 10;
      doc.setFont(undefined, 'bold');
      doc.setTextColor(71, 85, 105);
      doc.text(label, x, iy);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(30, 41, 59);
      doc.text(String(val), x, iy + 4.5);
    });
    y += Math.ceil(infoItems.length / colCount) * 10 + 4;

    // Overall progress bar
    checkPage(18);
    const progress = project.progress || 0;
    doc.setFontSize(8);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(71, 85, 105);
    doc.text('Overall Progress', margin, y);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(30, 41, 59);
    doc.text(`${progress}%`, margin + colW, y, { align: 'right' });
    y += 3;
    doc.setFillColor(226, 232, 240);
    doc.roundedRect(margin, y, colW, 5, 2, 2, 'F');
    doc.setFillColor(245, 158, 11); // amber-500
    doc.roundedRect(margin, y, colW * progress / 100, 5, 2, 2, 'F');
    y += 10;

    // Contract value highlight
    checkPage(12);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(margin, y - 4, colW, 10, 2, 2, 'F');
    doc.setFontSize(8);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(71, 85, 105);
    doc.text('Contract Value', margin + 2, y + 1);
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(formatCurrency(project.contract_value, cur), margin + colW - 2, y + 1, { align: 'right' });
    y += 14;

    // ── Milestones table ─────────────────────────────────────────────────
    if (milestones.length > 0) {
      checkPage(20);
      sectionTitle(doc, `Milestones (${milestones.length})`, margin, y);
      y += 7;

      const mCols = [0.40, 0.18, 0.18, 0.14, 0.10];
      tableHeader(doc, margin, y, colW, mCols, ['Title', 'Planned Date', 'Actual Date', 'Status', 'Progress']);
      y += 7;

      milestones.forEach((m, i) => {
        checkPage(8);
        if (i % 2 === 0) { doc.setFillColor(248, 250, 252); doc.rect(margin, y - 4, colW, 7, 'F'); }
        const vals = [
          truncate(m.title, 38),
          formatDate(m.planned_date),
          m.completed_date ? formatDate(m.completed_date) : '—',
          m.status ? m.status.replace(/_/g, ' ') : '—',
          `${m.progress ?? 0}%`,
        ];
        renderTableRow(doc, margin, y, colW, mCols, vals);
        y += 7;
      });
      y += 4;
    }

    // ── Financial summary: invoiced, collected, spent, remaining, margin ──
    checkPage(50);
    sectionTitle(doc, 'Financial Summary', margin, y);
    y += 7;

    const finRows = [
      ['Invoiced',   formatCurrency(invoiced, cur)],
      ['Collected',  formatCurrency(collected, cur)],
      ['Spent',      formatCurrency(spent, cur)],
      ['Remaining',  formatCurrency(remaining, cur)],
      ['Margin',     marginPct === null ? '—' : `${marginPct}%`],
    ];
    finRows.forEach(([label, val], i) => {
      checkPage(8);
      if (i % 2 === 0) { doc.setFillColor(248, 250, 252); doc.rect(margin, y - 4, colW, 7, 'F'); }
      doc.setFontSize(8.5);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(71, 85, 105);
      doc.text(label, margin + 2, y);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text(val, margin + colW - 2, y, { align: 'right' });
      y += 7;
    });
    y += 4;

    // ── WBS progress section (weighted rollup) ────────────────────────────
    if (wbsItems.length > 0) {
      checkPage(22);
      sectionTitle(doc, `WBS Progress  ·  Overall ${rootOverall}%`, margin, y);
      y += 7;

      const wCols = [0.16, 0.50, 0.16, 0.18];
      tableHeader(doc, margin, y, colW, wCols, ['WBS', 'Name', 'Weight', 'Progress']);
      y += 7;

      // Sort by wbs_code for stable hierarchy order
      const sortedWbs = [...wbsItems].sort((a, b) => (a.wbs_code || '').localeCompare(b.wbs_code || '', undefined, { numeric: true }));
      sortedWbs.forEach((item, i) => {
        checkPage(8);
        if (i % 2 === 0) { doc.setFillColor(248, 250, 252); doc.rect(margin, y - 4, colW, 7, 'F'); }
        const depth = (item.wbs_code || '').split('.').length - 1;
        const indent = Math.min(depth, 4) * 3;
        const rolled = rollupProgress(item.id);
        const vals = [
          item.wbs_code || '—',
          truncate(item.name, 46 - Math.min(depth, 4)),
          String(item.weight ?? 1),
          `${rolled}%`,
        ];
        // Render with indentation on the name column
        doc.setFontSize(7.5);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(30, 41, 59);
        let cx = margin + 2;
        doc.text(String(vals[0]), cx, y); cx += colW * wCols[0];
        doc.setFont(undefined, depth === 0 ? 'bold' : 'normal');
        doc.text(String(vals[1]), cx + indent, y); cx += colW * wCols[1];
        doc.setFont(undefined, 'normal');
        doc.text(String(vals[2]), cx, y); cx += colW * wCols[2];
        doc.setFont(undefined, 'bold');
        doc.text(String(vals[3]), cx, y);
        y += 7;
      });
      y += 4;
    }

    // ── Footer ────────────────────────────────────────────────────────────
    const pageCount = doc.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p);
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.setFont(undefined, 'normal');
      doc.text(`${project.name}  ·  Page ${p} of ${pageCount}`, W / 2, 290, { align: 'center' });
    }

    doc.save(`${project.code}_Report_${new Date().toISOString().slice(0, 10)}.pdf`);
    setLoading(false);
  }

  return (
    <button
      onClick={generate}
      disabled={loading}
      className="flex items-center gap-2 px-4 py-2 rounded border border-slate-300 hover:bg-slate-100 text-sm text-slate-700 font-medium transition disabled:opacity-60"
    >
      {loading
        ? <Loader2 className="w-4 h-4 animate-spin" />
        : <FileDown className="w-4 h-4" />}
      {loading ? 'Generating…' : 'Export PDF'}
    </button>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────
function sectionTitle(doc, text, x, y) {
  doc.setFillColor(245, 158, 11);
  doc.rect(x, y - 5, 3, 6, 'F');
  doc.setFontSize(10);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(text, x + 5, y);
}

function tableHeader(doc, x, y, colW, colFracs, labels) {
  doc.setFillColor(15, 23, 42);
  doc.rect(x, y - 5, colW, 7, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(7.5);
  doc.setFont(undefined, 'bold');
  let cx = x + 2;
  labels.forEach((l, i) => {
    doc.text(l, cx, y);
    cx += colW * colFracs[i];
  });
  doc.setTextColor(30, 41, 59);
}

function renderTableRow(doc, x, y, colW, colFracs, vals) {
  doc.setFontSize(7.5);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(30, 41, 59);
  let cx = x + 2;
  vals.forEach((v, i) => {
    doc.text(String(v), cx, y);
    cx += colW * colFracs[i];
  });
}

function truncate(str, max) {
  if (!str) return '—';
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}