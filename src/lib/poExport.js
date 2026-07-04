// Detached vendor Purchase Order PDF generator (previously inline in
// TabProcurement / TabVendors). Pure function — pass project, supplier, items.
import { jsPDF } from 'jspdf';
import { formatCurrency, BOM_CATEGORY_LABELS } from '@/lib/constants';

export function generateVendorPOPDF(project, supplier, items, currency = 'SAR') {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210;
  const margin = 14;
  const colW = W - margin * 2;
  const cur = currency || project?.currency || 'SAR';
  let y = 0;

  // Header band
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, W, 32, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont(undefined, 'bold');
  doc.text('PURCHASE ORDER', margin, 13);
  doc.setFontSize(9);
  doc.setFont(undefined, 'normal');
  doc.text(`Date: ${new Date().toLocaleDateString('en-GB')}`, margin, 20);
  doc.text(`Project: ${project?.code || ''} — ${project?.name || ''}`, margin, 26);
  doc.setTextColor(0, 0, 0);
  y = 40;

  // Vendor / Project boxes
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(margin, y, colW * 0.45, 28, 2, 2, 'F');
  doc.setFontSize(7);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(100, 116, 139);
  doc.text('VENDOR', margin + 3, y + 6);
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text(supplier === '(No Supplier)' ? 'TBD' : supplier, margin + 3, y + 13);
  doc.setFontSize(8);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text('Supplier / Vendor', margin + 3, y + 19);

  const px = margin + colW * 0.48;
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(px, y, colW * 0.52, 28, 2, 2, 'F');
  doc.setFontSize(7);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(100, 116, 139);
  doc.text('SHIP TO / PROJECT', px + 3, y + 6);
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text(project?.name || '', px + 3, y + 13, { maxWidth: colW * 0.5 });
  doc.setFontSize(8);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text(project?.client || '', px + 3, y + 19);
  doc.text(project?.location || '', px + 3, y + 24);
  y += 36;

  const cols = [
    { label: '#', w: 0.04, align: 'left' },
    { label: 'Part No.', w: 0.14, align: 'left' },
    { label: 'Description', w: 0.35, align: 'left' },
    { label: 'Category', w: 0.13, align: 'left' },
    { label: 'Qty', w: 0.06, align: 'right' },
    { label: 'Unit', w: 0.07, align: 'left' },
    { label: 'Unit Cost', w: 0.10, align: 'right' },
    { label: 'Total', w: 0.11, align: 'right' },
  ];

  function drawTableRow(rowData, isHeader = false, isAlt = false) {
    if (isHeader) {
      doc.setFillColor(15, 23, 42);
      doc.rect(margin, y - 5, colW, 8, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont(undefined, 'bold');
    } else {
      if (isAlt) { doc.setFillColor(248, 250, 252); doc.rect(margin, y - 5, colW, 7, 'F'); }
      doc.setTextColor(30, 41, 59);
      doc.setFont(undefined, 'normal');
    }
    doc.setFontSize(7.5);
    let x = margin + 2;
    rowData.forEach((val, i) => {
      const c = cols[i];
      const cw = colW * c.w;
      if (c.align === 'right') doc.text(String(val), x + cw - 4, y, { align: 'right', maxWidth: cw - 2 });
      else doc.text(String(val), x, y, { maxWidth: cw - 2 });
      x += cw;
    });
  }

  drawTableRow(cols.map(c => c.label), true);
  y += 8;

  let grandTotal = 0;
  items.forEach((item, idx) => {
    if (y > 265) { doc.addPage(); y = 20; }
    const unitCost = Number(item.planned_cost_price) || Number(item.cost_price) || 0;
    const qty = Number(item.quantity) || 1;
    const total = unitCost * qty;
    grandTotal += total;
    drawTableRow([
      idx + 1,
      item.manufacturer_part_number || '—',
      item.description || '—',
      BOM_CATEGORY_LABELS[item.category] || item.category || '—',
      qty,
      item.unit || 'pcs',
      unitCost > 0 ? formatCurrency(unitCost, cur) : '—',
      total > 0 ? formatCurrency(total, cur) : '—',
    ], false, idx % 2 === 1);
    y += 7;
  });

  // Total
  y += 4;
  doc.setFillColor(245, 158, 11);
  doc.rect(margin + colW * 0.6, y - 4, colW * 0.4, 8, 'F');
  doc.setTextColor(15, 23, 42);
  doc.setFont(undefined, 'bold');
  doc.setFontSize(9);
  doc.text('TOTAL:', margin + colW * 0.62, y);
  doc.text(formatCurrency(grandTotal, cur), margin + colW - 2, y, { align: 'right' });
  y += 14;

  // Signatures
  if (y < 240) {
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(margin, y, margin + colW * 0.45, y);
    doc.line(margin + colW * 0.55, y, margin + colW, y);
    doc.setFontSize(7);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(148, 163, 184);
    doc.text('Prepared by', margin, y + 4);
    doc.text('Approved by', margin + colW * 0.55, y + 4);
  }

  // Footer
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.setFont(undefined, 'normal');
    doc.text(`${project?.name || ''} · PO for ${supplier} · Page ${p} of ${pageCount}`, W / 2, 290, { align: 'center' });
  }

  const safeSupplier = String(supplier).replace(/[^a-z0-9]/gi, '_').slice(0, 30);
  doc.save(`PO_${project?.code || 'PRJ'}_${safeSupplier}_${new Date().toISOString().slice(0, 10)}.pdf`);
}