import {
  isOverdue, daysOverdue, truncate, formatCurrency, formatDate,
} from '@/lib/reportExport';
import { BOM_CATEGORY_LABELS, isTopLevelBOM } from '@/lib/constants';
import { resolveMaterialStatus } from '@/lib/materialStatus';

const PO_STATUS_LABELS = {
  draft: 'Draft', issued: 'Issued', acknowledged: 'Acknowledged', in_transit: 'In Transit',
  partially_delivered: 'Partially Delivered', delivered: 'Delivered', cancelled: 'Cancelled',
};

const MATERIAL_STATUS_COLOR = {
  not_ordered: 'grey', ordered: 'blue', received: 'indigo', delivered: 'green',
};

export default {
  id: 'supplyChain',
  audience: 'Supply Chain Department',
  title: 'Procurement Report',
  description: 'Procurement only — purchase orders by vendor and status, overdue POs, BOM reconciliation, and material tracking.',
  accent: 'blue',
  contents: ['KPI snapshot', 'Material status breakdown', 'PO receipt progress', 'Top suppliers', 'Purchase orders', 'Overdue POs', 'BOM reconciliation', 'Material tracking'],
  buildSections(data) {
    const { project, pos = [], bomItems = [] } = data;
    const cur = project?.currency || 'SAR';
    const overduePOs = (pos || []).filter(po => isOverdue(po.expected_delivery_date, po.status));

    const sections = [];

    // 1. KPI band
    const totalPOValue = (pos || []).reduce((s, po) => s + (Number(po.amount) || 0), 0);
    sections.push({
      title: 'Procurement Snapshot',
      type: 'kpis',
      cards: [
        { label: 'Total POs', value: String((pos || []).length), color: 'blue' },
        { label: 'Total PO Value', value: formatCurrency(totalPOValue, cur), color: 'indigo' },
        { label: 'Overdue POs', value: String(overduePOs.length), color: overduePOs.length > 0 ? 'red' : 'green' },
        { label: 'BOM Items', value: String(bomItems.length), color: 'amber' },
        { label: 'Delivered', value: String((pos || []).filter(p => p.status === 'delivered').length), color: 'green' },
      ],
    });

    // 2. Material status stacked bar (merged Material Status)
    const msCounts = { not_ordered: 0, ordered: 0, received: 0, delivered: 0 };
    (bomItems || []).filter(isTopLevelBOM).forEach(i => {
      const ms = resolveMaterialStatus(i);
      msCounts[ms] = (msCounts[ms] || 0) + 1;
    });
    sections.push({
      title: 'Material Status Breakdown',
      type: 'chart',
      chart: 'stacked',
      data: {
        segments: [
          { label: 'Not Ordered', value: msCounts.not_ordered || 0, color: 'grey' },
          { label: 'Ordered', value: msCounts.ordered || 0, color: 'blue' },
          { label: 'Received', value: msCounts.received || 0, color: 'indigo' },
          { label: 'Delivered', value: msCounts.delivered || 0, color: 'green' },
        ],
      },
      opts: { h: 6 },
    });

    // 3. PO receipt progress bars
    const poReceiptRows = (pos || []).filter(po => po.subtotal_net > 0).map(po => ({
      label: truncate(`${po.po_number || '—'} ${po.vendor_name || ''}`.trim(), 40),
      value: po.receipt_progress ?? 0,
      max: 100,
      color: po.receipt_progress >= 100 ? 'green' : po.receipt_progress > 0 ? 'blue' : 'grey',
    }));
    if (poReceiptRows.length) {
      sections.push({
        title: 'PO Receipt Progress',
        type: 'chart',
        chart: 'hbars',
        data: { rows: poReceiptRows },
        opts: { labelW: 45, barH: 5, gap: 3 },
      });
    }

    // 4. Top suppliers by value
    const byVendor = {};
    (pos || []).forEach(po => {
      const v = po.vendor_name || '—';
      if (!byVendor[v]) byVendor[v] = 0;
      byVendor[v] += Number(po.amount) || 0;
    });
    const maxVendor = Math.max(1, ...Object.values(byVendor));
    const vendorRows = Object.entries(byVendor).map(([name, amt]) => ({
      label: truncate(name, 35),
      value: amt,
      max: maxVendor,
      color: 'blue',
    })).sort((a, b) => b.value - a.value).slice(0, 8);
    if (vendorRows.length) {
      sections.push({
        title: 'Top Suppliers by Value',
        type: 'chart',
        chart: 'hbars',
        data: { rows: vendorRows },
        opts: { labelW: 40, barH: 5, gap: 3 },
      });
    }

    // 5. Purchase orders table
    sections.push({
      title: 'Purchase Orders by Vendor & Status',
      type: 'table',
      columns: [
        { header: 'Vendor', key: 'vendor', width: 0.26 },
        { header: 'PO #', key: 'po', width: 0.14 },
        { header: 'Status', key: 'status', width: 0.16 },
        { header: 'Type', key: 'type', width: 0.12 },
        { header: 'Amount', key: 'amount', align: 'right', width: 0.14 },
        { header: 'Expected Delivery', key: 'exp', width: 0.18 },
      ],
      rows: (pos || []).map(po => ({
        vendor: truncate(po.vendor_name || '—', 30),
        po: po.po_number || '—',
        status: PO_STATUS_LABELS[po.status] || po.status || '—',
        type: po.type || '—',
        amount: formatCurrency(po.amount, po.currency || cur),
        exp: formatDate(po.expected_delivery_date),
      })),
      summary: [
        { label: 'Total POs', value: String((pos || []).length) },
        { label: 'Total PO Value', value: formatCurrency(totalPOValue, cur) },
      ],
    });

    // 6. Overdue POs → callout when empty
    if (overduePOs.length === 0) {
      sections.push({
        title: 'Overdue POs',
        type: 'callout',
        tone: 'good',
        title: 'No overdue purchase orders',
        body: 'All purchase orders are on schedule.',
      });
    } else {
      sections.push({
        title: `Overdue POs (${overduePOs.length})`,
        type: 'table',
        columns: [
          { header: 'Vendor', key: 'vendor', width: 0.28 },
          { header: 'PO #', key: 'po', width: 0.14 },
          { header: 'Expected Delivery', key: 'exp', width: 0.18 },
          { header: 'Days Overdue', key: 'days', align: 'right', width: 0.12 },
          { header: 'Status', key: 'status', width: 0.14 },
          { header: 'Amount', key: 'amount', align: 'right', width: 0.14 },
        ],
        rows: overduePOs.map(po => ({
          vendor: truncate(po.vendor_name || '—', 30),
          po: po.po_number || '—',
          exp: formatDate(po.expected_delivery_date),
          days: String(daysOverdue(po.expected_delivery_date, po.status)),
          status: PO_STATUS_LABELS[po.status] || po.status || '—',
          amount: formatCurrency(po.amount, po.currency || cur),
        })),
      });
    }

    // 7. BOM reconciliation table
    const byCat = {};
    (bomItems || []).filter(isTopLevelBOM).forEach(i => {
      const cat = BOM_CATEGORY_LABELS[i.category] || i.category || 'Other';
      if (!byCat[cat]) byCat[cat] = { total: 0, ordered: 0, notOrdered: 0, received: 0, pending: 0, value: 0 };
      byCat[cat].total++;
      const ms = resolveMaterialStatus(i);
      if (ms === 'delivered') byCat[cat].received++;
      else if (ms === 'ordered' || ms === 'received') byCat[cat].pending++;
      else byCat[cat].notOrdered++;
      if (ms !== 'not_ordered') byCat[cat].ordered++;
      byCat[cat].value += (Number(i.planned_cost_price) || Number(i.cost_price) || 0) * (Number(i.quantity) || 1);
    });
    sections.push({
      title: 'BOM Reconciliation Status',
      type: 'table',
      columns: [
        { header: 'Category', key: 'cat', width: 0.22 },
        { header: 'Total Items', key: 'total', align: 'right', width: 0.12 },
        { header: 'Ordered', key: 'ordered', align: 'right', width: 0.12 },
        { header: 'Not Ordered', key: 'notOrdered', align: 'right', width: 0.13 },
        { header: 'Delivered', key: 'received', align: 'right', width: 0.12 },
        { header: 'Pending Delivery', key: 'pending', align: 'right', width: 0.13 },
        { header: 'Value', key: 'value', align: 'right', width: 0.16 },
      ],
      rows: Object.entries(byCat).map(([cat, v]) => ({
        cat, total: String(v.total), ordered: String(v.ordered), notOrdered: String(v.notOrdered),
        received: String(v.received), pending: String(v.pending), value: formatCurrency(v.value, cur),
      })),
    });

    // 8. Material tracking table
    sections.push({
      title: 'Material Tracking (Delivery)',
      type: 'table',
      columns: [
        { header: 'Vendor', key: 'vendor', width: 0.26 },
        { header: 'PO #', key: 'po', width: 0.14 },
        { header: 'Expected', key: 'exp', width: 0.14 },
        { header: 'Actual', key: 'actual', width: 0.14 },
        { header: 'Status', key: 'status', width: 0.16 },
        { header: 'Delay Days', key: 'delay', align: 'right', width: 0.16 },
      ],
      rows: (pos || []).map(po => ({
        vendor: truncate(po.vendor_name || '—', 30),
        po: po.po_number || '—',
        exp: formatDate(po.expected_delivery_date),
        actual: formatDate(po.actual_delivery_date),
        status: PO_STATUS_LABELS[po.status] || po.status || '—',
        delay: String(po.delay_days || daysOverdue(po.expected_delivery_date, po.status)),
      })),
    });

    return sections;
  },
};