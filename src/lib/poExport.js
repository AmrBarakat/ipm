// Detached vendor Purchase Order PDF generator (previously inline in
// TabProcurement / TabVendors). Pure function — pass project, supplier, items.
// Reuses the shared report palette/typography + measure-then-draw table engine so
// POs match the report style: wrapped vendor/ship-to blocks, line-item rows that
// grow to fit wrapped descriptions, a right-aligned totals band, and a repeating
// table header across page breaks.
import { jsPDF } from 'jspdf';
import { formatCurrency, BOM_CATEGORY_LABELS } from '@/lib/constants';
import {
  C, SIZES, FONT, wrap, drawLines, setColor, lineMm, ascentMm,
  PAD_X, colWidths, drawHeaderRow, measureRow, drawRow,
} from '@/lib/reportExport';

export function generateVendorPOPDF(project, supplier, items, currency = 'SAR') {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210;
  const pageH = 297;
  const margin = 14;
  const colW = W - margin * 2;
  const cur = currency || project?.currency || 'SAR';
  const supName = supplier === '(No Supplier)' ? 'TBD' : (supplier || 'TBD');
  let y = 0;

  // ── Header band (shared style) ─────────────────────────────────────────────
  const bandH = 30;
  setColor(doc, C.ink, 'fill'); doc.rect(0, 0, W, bandH, 'F');
  setColor(doc, C.accent, 'fill'); doc.rect(0, bandH - 1.2, W, 1.2, 'F');
  setColor(doc, C.white, 'text');
  doc.setFont(FONT, 'bold'); doc.setFontSize(SIZES.title);
  drawLines(doc, ['PURCHASE ORDER'], margin, 8, SIZES.title, 'left', W - margin);
  setColor(doc, C.bandSub, 'text'); doc.setFont(FONT, 'normal'); doc.setFontSize(SIZES.meta);
  const metaTop = 8 + lineMm(SIZES.title) + 1;
  drawLines(doc, [`Date: ${new Date().toLocaleDateString('en-GB')}`], margin, metaTop, SIZES.meta, 'left', W - margin);
  drawLines(doc, [`Project: ${project?.code || ''} — ${project?.name || ''}`], margin, metaTop + lineMm(SIZES.meta), SIZES.meta, 'left', W - margin);
  drawLines(doc, [`Currency: ${cur}`], W - margin, metaTop, SIZES.meta, 'right', W - margin);
  y = bandH + 8;

  // ── Vendor / Ship-to blocks (measured, wrapped) ─────────────────────────────
  const gap = colW * 0.03;
  const vW = colW * 0.45;
  const sW = colW * 0.52;
  const sx = margin + vW + gap;
  const pad = 3;
  const vInner = vW - 2 * pad;
  const sInner = sW - 2 * pad;

  const vNameLines = wrap(doc, supName, vInner, 10, 'bold');
  const vSubLines = wrap(doc, 'Supplier / Vendor', vInner, 8, 'normal');
  const vContentBottom = pad + lineMm(7) + 1 + vNameLines.length * lineMm(10) + vSubLines.length * lineMm(8) + pad;

  const sNameLines = wrap(doc, project?.name || '', sInner, 9, 'bold');
  const sClientLines = wrap(doc, project?.client || '', sInner, 8, 'normal');
  const sLocLines = wrap(doc, project?.location || '', sInner, 8, 'normal');
  const sContentBottom = pad + lineMm(7) + 1 + sNameLines.length * lineMm(9)
    + sClientLines.length * lineMm(8) + sLocLines.length * lineMm(8) + pad;

  const blockH = Math.max(22, vContentBottom, sContentBottom);

  // Vendor box
  setColor(doc, C.zebra, 'fill'); doc.roundedRect(margin, y, vW, blockH, 2, 2, 'F');
  setColor(doc, C.muted, 'text'); doc.setFont(FONT, 'bold'); doc.setFontSize(7);
  doc.text('VENDOR', margin + pad, y + pad + ascentMm(7));
  setColor(doc, C.ink, 'text'); doc.setFont(FONT, 'bold'); doc.setFontSize(10);
  drawLines(doc, vNameLines, margin + pad, y + pad + lineMm(7) + 1, 10, 'left', margin + vW - pad);
  setColor(doc, C.subInk, 'text'); doc.setFont(FONT, 'normal'); doc.setFontSize(8);
  drawLines(doc, vSubLines, margin + pad, y + pad + lineMm(7) + 1 + vNameLines.length * lineMm(10), 8, 'left', margin + vW - pad);

  // Ship-to / Project box
  setColor(doc, C.zebra, 'fill'); doc.roundedRect(sx, y, sW, blockH, 2, 2, 'F');
  setColor(doc, C.muted, 'text'); doc.setFont(FONT, 'bold'); doc.setFontSize(7);
  doc.text('SHIP TO / PROJECT', sx + pad, y + pad + ascentMm(7));
  setColor(doc, C.ink, 'text'); doc.setFont(FONT, 'bold'); doc.setFontSize(9);
  let sRowTop = y + pad + lineMm(7) + 1;
  drawLines(doc, sNameLines, sx + pad, sRowTop, 9, 'left', sx + sW - pad);
  sRowTop += sNameLines.length * lineMm(9);
  setColor(doc, C.subInk, 'text'); doc.setFont(FONT, 'normal'); doc.setFontSize(8);
  drawLines(doc, sClientLines, sx + pad, sRowTop, 8, 'left', sx + sW - pad);
  sRowTop += sClientLines.length * lineMm(8);
  drawLines(doc, sLocLines, sx + pad, sRowTop, 8, 'left', sx + sW - pad);

  y += blockH + 6;

  // ── Line-items table (measured rows, repeating header) ──────────────────────
  const columns = [
    { header: '#', key: 'idx', align: 'right', width: 0.04 },
    { header: 'Part No.', key: 'part', align: 'left', width: 0.15 },
    { header: 'Description', key: 'desc', align: 'left', width: 0.42 },
    { header: 'Category', key: 'cat', align: 'left', width: 0.13 },
    { header: 'Qty', key: 'qty', align: 'right', width: 0.07 },
    { header: 'Unit Cost', key: 'unit', align: 'right', width: 0.09 },
    { header: 'Total', key: 'total', align: 'right', width: 0.10 },
  ];
  const widths = colWidths(columns.map((c) => c.width), colW);
  const size = 7.5;
  const maxY = pageH - 22;       // reserve footer
  const topMargin = 18;

  let headerH = drawHeaderRow(doc, margin, y, colW, widths, columns);
  let rowTop = y + headerH;

  let grandTotal = 0;
  const rows = items.map((item, idx) => {
    const unitCost = Number(item.planned_cost_price) || Number(item.cost_price) || 0;
    const qty = Number(item.quantity) || 1;
    const total = unitCost * qty;
    grandTotal += total;
    return {
      idx: String(idx + 1),
      part: item.manufacturer_part_number || '—',
      desc: item.description || '—',
      cat: BOM_CATEGORY_LABELS[item.category] || item.category || '—',
      qty: String(qty),
      unit: unitCost > 0 ? formatCurrency(unitCost, cur) : '—',
      total: total > 0 ? formatCurrency(total, cur) : '—',
    };
  });

  rows.forEach((row, i) => {
    const rh = measureRow(doc, row, columns, widths, size);
    if (rowTop + rh > maxY) {
      doc.addPage();
      rowTop = topMargin;
      headerH = drawHeaderRow(doc, margin, rowTop, colW, widths, columns);
      rowTop += headerH;
    }
    if (i % 2 === 0) { setColor(doc, C.zebra, 'fill'); doc.rect(margin, rowTop, colW, rh, 'F'); }
    drawRow(doc, margin, rowTop, widths, columns, row, size);
    setColor(doc, C.hairline, 'draw'); doc.setLineWidth(0.1);
    doc.line(margin, rowTop + rh, margin + colW, rowTop + rh);
    rowTop += rh;
  });

  // ── Totals (right-aligned accent band) ─────────────────────────────────────
  if (rowTop + 10 > maxY) { doc.addPage(); rowTop = topMargin; }
  rowTop += 3;
  setColor(doc, C.accent, 'fill');
  doc.rect(margin + colW * 0.6, rowTop, colW * 0.4, 9, 'F');
  setColor(doc, C.ink, 'text'); doc.setFont(FONT, 'bold'); doc.setFontSize(10);
  const tBase = rowTop + ascentMm(10) + 1.5;
  doc.text('TOTAL:', margin + colW * 0.62, tBase);
  doc.text(formatCurrency(grandTotal, cur), margin + colW - PAD_X, tBase, { align: 'right' });
  rowTop += 16;

  // ── Signatures ─────────────────────────────────────────────────────────────
  if (rowTop + 8 < maxY) {
    setColor(doc, C.hairline, 'draw'); doc.setLineWidth(0.3);
    doc.line(margin, rowTop, margin + colW * 0.45, rowTop);
    doc.line(margin + colW * 0.55, rowTop, margin + colW, rowTop);
    setColor(doc, C.muted, 'text'); doc.setFont(FONT, 'normal'); doc.setFontSize(7);
    doc.text('Prepared by', margin, rowTop + 4);
    doc.text('Approved by', margin + colW * 0.55, rowTop + 4);
  }

  // ── Footer (hairline + centered page count) ──────────────────────────────────
  const pc = doc.getNumberOfPages();
  for (let p = 1; p <= pc; p++) {
    doc.setPage(p);
    setColor(doc, C.hairline, 'draw'); doc.setLineWidth(0.1);
    doc.line(margin, pageH - 14, W - margin, pageH - 14);
    setColor(doc, C.muted, 'text'); doc.setFont(FONT, 'normal'); doc.setFontSize(SIZES.footer);
    doc.text(`Purchase Order · ${project?.name || ''} · Page ${p} of ${pc}`, W / 2, pageH - 8, { align: 'center' });
  }

  doc.save(`PO_${project?.code || 'PRJ'}_${new Date().toISOString().slice(0, 10)}.pdf`);
}