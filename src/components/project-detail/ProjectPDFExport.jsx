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
    ]);

    const cur = project.currency || 'SAR';

    // Financial calcs
    const plannedInvoiced = invoices.filter(i => i.status !== 'cancelled').reduce((s, i) => s + (i.planned_amount || 0), 0);
    const actualInvoiced = invoices.filter(i => ['invoiced','paid','partial','overdue'].includes(i.status)).reduce((s, i) => s + (i.actual_amount || i.planned_amount || 0), 0);
    const totalReceived = collections.reduce((s, c) => s + (c.amount || 0), 0);
    const plannedExpenses = expenses.filter(e => e.status !== 'cancelled').reduce((s, e) => s + (e.planned_amount || 0), 0);
    const actualExpenses = expenses.filter(e => ['committed','paid'].includes(e.status)).reduce((s, e) => s + (e.actual_amount || e.planned_amount || 0), 0);
    const netCash = totalReceived - actualExpenses;

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = 210;
    const margin = 14;
    const colW = W - margin * 2;
    let y = 0;

    function checkPage(needed = 12) {
      if (y + needed > 275) { doc.addPage(); y = 20; }
    }

    // ── Header band ────────────────────────────────────────────────────────
    doc.setFillColor(15, 23, 42); // slate-900
    doc.rect(0, 0, W, 28, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont(undefined, 'bold');
    doc.text('Project Report', margin, 11);
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.text(`Generated: ${new Date().toLocaleDateString('en-GB')}`, margin, 18);
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text(`${project.code}  —  ${project.name}`, margin, 25);
    doc.setTextColor(0, 0, 0);
    y = 36;

    // ── Project info row ──────────────────────────────────────────────────
    doc.setFontSize(8);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(100, 116, 139);
    const infoItems = [
      ['Client', project.client || '—'],
      ['Type', TYPE_LABELS[project.project_type] || project.project_type],
      ['Status', STATUS_LABELS[project.status] || project.status],
      ['Priority', PRIORITY_LABELS[project.priority] || project.priority],
      ['Start', formatDate(project.start_date)],
      ['Due', formatDate(project.target_completion_date)],
      ['Location', project.location || '—'],
      ['PM', project.project_manager || '—'],
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
    y += Math.ceil(infoItems.length / colCount) * 10 + 6;

    // ── Progress ──────────────────────────────────────────────────────────
    checkPage(20);
    sectionTitle(doc, 'Progress', margin, y);
    y += 7;
    const progress = project.progress || 0;
    doc.setFillColor(226, 232, 240);
    doc.roundedRect(margin, y, colW, 5, 2, 2, 'F');
    doc.setFillColor(245, 158, 11); // amber-500
    doc.roundedRect(margin, y, colW * progress / 100, 5, 2, 2, 'F');
    doc.setFontSize(8);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(30, 41, 59);
    doc.text(`${progress}% complete`, margin + colW + 2, y + 4);
    y += 12;

    // ── Financial Summary ─────────────────────────────────────────────────
    checkPage(50);
    sectionTitle(doc, 'Financial Summary', margin, y);
    y += 7;

    const finRows = [
      ['Contract Value',    formatCurrency(project.contract_value, cur)],
      ['Planned Invoiced',  formatCurrency(plannedInvoiced, cur)],
      ['Actual Invoiced',   formatCurrency(actualInvoiced, cur)],
      ['Total Received',    formatCurrency(totalReceived, cur)],
      ['Planned Expenses',  formatCurrency(plannedExpenses, cur)],
      ['Actual Expenses',   formatCurrency(actualExpenses, cur)],
      ['Net Cash',          formatCurrency(netCash, cur)],
    ];

    finRows.forEach(([label, val], i) => {
      checkPage(8);
      const bg = i % 2 === 0;
      if (bg) {
        doc.setFillColor(248, 250, 252);
        doc.rect(margin, y - 4, colW, 7, 'F');
      }
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

    // ── Milestones ────────────────────────────────────────────────────────
    if (milestones.length > 0) {
      checkPage(20);
      sectionTitle(doc, `Milestones (${milestones.length})`, margin, y);
      y += 7;

      tableHeader(doc, margin, y, colW, ['Title', 'Planned Date', 'Completed Date', 'Status', 'Progress']);
      y += 7;

      milestones.forEach((m, i) => {
        checkPage(8);
        if (i % 2 === 0) { doc.setFillColor(248, 250, 252); doc.rect(margin, y - 4, colW, 7, 'F'); }
        const cols = [0.38, 0.17, 0.17, 0.15, 0.13];
        const vals = [
          truncate(m.title, 35),
          formatDate(m.planned_date),
          m.completed_date ? formatDate(m.completed_date) : '—',
          m.status?.replace(/_/g, ' ') || '—',
          `${m.progress || 0}%`,
        ];
        renderTableRow(doc, margin, y, colW, cols, vals);
        y += 7;
      });
      y += 4;
    }

    // ── Invoice list ──────────────────────────────────────────────────────
    if (invoices.length > 0) {
      checkPage(20);
      sectionTitle(doc, `Invoices (${invoices.length})`, margin, y);
      y += 7;

      tableHeader(doc, margin, y, colW, ['Description', 'Planned Date', 'Planned Amt', 'Actual Amt', 'Status']);
      y += 7;

      invoices.forEach((inv, i) => {
        checkPage(8);
        if (i % 2 === 0) { doc.setFillColor(248, 250, 252); doc.rect(margin, y - 4, colW, 7, 'F'); }
        const cols = [0.35, 0.15, 0.17, 0.17, 0.16];
        const vals = [
          truncate(inv.description, 30),
          formatDate(inv.planned_date),
          formatCurrency(inv.planned_amount, cur),
          inv.actual_amount != null ? formatCurrency(inv.actual_amount, cur) : '—',
          inv.status || '—',
        ];
        renderTableRow(doc, margin, y, colW, cols, vals);
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

function tableHeader(doc, x, y, colW, labels) {
  doc.setFillColor(15, 23, 42);
  doc.rect(x, y - 5, colW, 7, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(7.5);
  doc.setFont(undefined, 'bold');
  const colFracs = Array(labels.length).fill(1 / labels.length);
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