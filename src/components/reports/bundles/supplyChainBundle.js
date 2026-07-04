import {
  isOverdue, daysOverdue, truncate, formatCurrency, formatDate,
} from '@/lib/reportExport';
import { BOM_CATEGORY_LABELS, isTopLevelBOM } from '@/lib/constants';

const PO_STATUS_LABELS = {
  draft: 'Draft', issued: 'Issued', acknowledged: 'Acknowledged', in_transit: 'In Transit',
  partially_delivered: 'Partially Delivered', delivered: 'Delivered', cancelled: 'Cancelled',
};

export default {
  id: 'supplyChain',
  audience: 'Supply Chain Department',
  title: 'Procurement Report',
  description: 'Procurement only — purchase orders by vendor and status, overdue POs, BOM reconciliation, and material tracking.',
  accent: 'blue',
  contents: ['Purchase orders by vendor & status', 'Overdue POs', 'BOM reconciliation status', 'Material tracking'],
  buildSections(data) {
    const { project, pos = [], bomItems = [] } = data;
    const cur = project?.currency || 'SAR';
    const overduePOs = (pos || []).filter(po => isOverdue(po.expected_delivery_date, po.status));

    const sections = [];

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
        { label: 'Total PO Value', value: formatCurrency((pos || []).reduce((s, po) => s + (Number(po.amount) || 0), 0), cur) },
      ],
    });

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

    // BOM reconciliation by category: ordered vs not-ordered vs received.
    // Exclude panel child rows so a panel is counted once.
    const byCat = {};
    (bomItems || []).filter(isTopLevelBOM).forEach(i => {
      const cat = BOM_CATEGORY_LABELS[i.category] || i.category || 'Other';
      if (!byCat[cat]) byCat[cat] = { total: 0, ordered: 0, notOrdered: 0, received: 0, pending: 0, value: 0 };
      byCat[cat].total++;
      const ordered = (i.order_status || (i.ordered ? 'ordered' : 'not_ordered')) === 'ordered';
      if (ordered) byCat[cat].ordered++; else byCat[cat].notOrdered++;
      if (i.delivery_status === 'delivered') byCat[cat].received++;
      else if (ordered) byCat[cat].pending++;
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