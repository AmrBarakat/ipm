import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { formatDate, formatCurrency, STATUS_LABELS, TYPE_LABELS, PRIORITY_LABELS, DELIVERABLE_STATUS_LABELS } from '@/lib/constants';
import { X, FileDown, Loader2, CheckCircle2, Clock, AlertTriangle, Flag, Package, Shield } from 'lucide-react';
import { jsPDF } from 'jspdf';

// ── PDF helpers ──────────────────────────────────────────────────────────────
function sectionTitle(doc, text, x, y) {
  doc.setFillColor(245, 158, 11);
  doc.rect(x, y - 5, 3, 7, 'F');
  doc.setFontSize(10);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(text, x + 5, y);
}

function tableHeader(doc, x, y, colW, labels, fracs) {
  doc.setFillColor(15, 23, 42);
  doc.rect(x, y - 5, colW, 7, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(7.5);
  doc.setFont(undefined, 'bold');
  let cx = x + 2;
  labels.forEach((l, i) => { doc.text(l, cx, y); cx += colW * fracs[i]; });
  doc.setTextColor(30, 41, 59);
}

function tableRow(doc, x, y, colW, fracs, vals, shade) {
  if (shade) { doc.setFillColor(248, 250, 252); doc.rect(x, y - 4, colW, 7, 'F'); }
  doc.setFontSize(7.5);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(30, 41, 59);
  let cx = x + 2;
  vals.forEach((v, i) => { doc.text(String(v ?? '—'), cx, y); cx += colW * fracs[i]; });
}

function truncate(str, max) {
  if (!str) return '—';
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

function progressBar(doc, x, y, barW, pct, color = [245, 158, 11]) {
  doc.setFillColor(226, 232, 240);
  doc.roundedRect(x, y, barW, 3.5, 1, 1, 'F');
  if (pct > 0) {
    doc.setFillColor(...color);
    doc.roundedRect(x, y, barW * pct / 100, 3.5, 1, 1, 'F');
  }
}

function statusDot(doc, x, y, status) {
  const COLOR_MAP = {
    completed: [16, 185, 129], accepted: [16, 185, 129],
    in_progress: [59, 130, 246], delivered: [59, 130, 246],
    pending: [148, 163, 184], not_started: [148, 163, 184],
    overdue: [239, 68, 68], rejected: [239, 68, 68],
    blocked: [239, 68, 68], open: [239, 68, 68],
    mitigated: [16, 185, 129], accepted_risk: [245, 158, 11], closed: [148, 163, 184],
  };
  const c = COLOR_MAP[status] || [148, 163, 184];
  doc.setFillColor(...c);
  doc.circle(x, y - 1, 1.5, 'F');
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function ProgressReportModal({ project, onClose }) {
  const [milestones, setMilestones] = useState([]);
  const [deliverables, setDeliverables] = useState([]);
  const [risks, setRisks] = useState([]);
  const [wbsItems, setWbsItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  // Selection state
  const [selectedMsIds, setSelectedMsIds] = useState(new Set());
  const [includeDeliverables, setIncludeDeliverables] = useState(true);
  const [includeRisks, setIncludeRisks] = useState(true);
  const [includeWBS, setIncludeWBS] = useState(true);
  const [reportTitle, setReportTitle] = useState('Progress Report');

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [ms, deliv, risk, wbs] = await Promise.all([
        base44.entities.Milestone.filter({ project_id: project.id }, 'planned_date', 100),
        base44.entities.Deliverable.filter({ project_id: project.id }, '-created_date', 200),
        base44.entities.Risk.filter({ project_id: project.id }, '-risk_score', 100),
        base44.entities.WBSItem.filter({ project_id: project.id }, 'wbs_code', 500),
      ]);
      setMilestones(ms);
      setDeliverables(deliv);
      setRisks(risk);
      setWbsItems(wbs);
      // Default: select all milestones
      setSelectedMsIds(new Set(ms.map(m => m.id)));
      setLoading(false);
    }
    load();
  }, [project.id]);

  // WBS rollup
  function getMilestoneProgress(milestoneId) {
    const linked = wbsItems.filter(i => i.milestone_id === milestoneId);
    if (linked.length === 0) return null;
    const wbsById = Object.fromEntries(wbsItems.map(i => [i.id, i]));
    const wbsTree = {};
    wbsItems.forEach(i => { const pid = i.parent_id || '__root__'; if (!wbsTree[pid]) wbsTree[pid] = []; wbsTree[pid].push(i); });
    function rollup(id) {
      const ch = wbsTree[id] || [];
      if (!ch.length) return wbsById[id]?.progress || 0;
      const cp = ch.map(c => ({ p: rollup(c.id), w: c.weight || 1 }));
      const tw = cp.reduce((s, c) => s + c.w, 0);
      return Math.round(cp.reduce((s, c) => s + c.p * c.w, 0) / (tw || 1));
    }
    const tw = linked.reduce((s, i) => s + (i.weight || 1), 0);
    return Math.round(linked.reduce((s, i) => s + rollup(i.id) * (i.weight || 1), 0) / (tw || 1));
  }

  const selectedMs = milestones.filter(m => selectedMsIds.has(m.id));
  const filteredDeliverables = deliverables.filter(d => !d.milestone_id || selectedMsIds.has(d.milestone_id));
  const msById = Object.fromEntries(milestones.map(m => [m.id, m]));

  // ── KPI counts ────────────────────────────────────────────────────────────
  const completedMs = selectedMs.filter(m => m.status === 'completed').length;
  const pendingDeliverables = filteredDeliverables.filter(d => ['pending', 'in_progress'].includes(d.status)).length;
  const openRisks = risks.filter(r => r.status === 'open').length;
  const wbsLinkedToSelected = wbsItems.filter(i => selectedMsIds.has(i.milestone_id));
  const completedWBS = wbsLinkedToSelected.filter(i => i.status === 'completed').length;

  // ── Upcoming & overdue snapshots ────────────────────────────────────────
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const isOverdue = (d, status) => d && status !== 'completed' && new Date(d) < today;
  const upcomingMilestones = milestones
    .filter(m => m.planned_date && m.status !== 'completed' && new Date(m.planned_date) >= today)
    .sort((a, b) => new Date(a.planned_date) - new Date(b.planned_date))
    .slice(0, 5);
  const overdueMilestones = milestones.filter(m => isOverdue(m.planned_date, m.status));
  const overdueWBS = wbsItems.filter(w => isOverdue(w.planned_end, w.status));
  const overdueItems = [
    ...overdueMilestones.map(m => ({ type: 'Milestone', label: m.title, date: m.planned_date })),
    ...overdueWBS.map(w => ({ type: 'WBS', label: `${w.wbs_code || ''} ${w.name || ''}`.trim(), date: w.planned_end })),
  ];

  // ── PDF Generation ────────────────────────────────────────────────────────
  async function generate() {
    setGenerating(true);
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = 210, margin = 14, colW = W - margin * 2;
    let y = 0;

    function checkPage(needed = 12) {
      if (y + needed > 275) { doc.addPage(); y = 20; }
    }

    // ── Cover header ────────────────────────────────────────────────────────
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, W, 32, 'F');
    doc.setFillColor(245, 158, 11);
    doc.rect(0, 32, W, 2, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont(undefined, 'bold');
    doc.text(reportTitle, margin, 12);
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.text(`${project.code}  —  ${project.name}`, margin, 19);
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(`Generated: ${new Date().toLocaleDateString('en-GB')}   |   Client: ${project.client || '—'}   |   PM: ${project.project_manager || '—'}`, margin, 26);
    doc.setTextColor(0, 0, 0);
    y = 42;

    // ── Project info ─────────────────────────────────────────────────────────
    const infoItems = [
      ['Status', STATUS_LABELS[project.status] || project.status],
      ['Type', TYPE_LABELS[project.project_type] || project.project_type],
      ['Priority', PRIORITY_LABELS[project.priority] || project.priority],
      ['Start Date', formatDate(project.start_date)],
      ['Target Date', formatDate(project.target_completion_date)],
      ['Location', project.location || '—'],
      ['Contract Value', formatCurrency(project.contract_value, project.currency || 'SAR')],
      ['Overall Progress', `${project.progress || 0}%`],
    ];
    const iColW = colW / 4;
    infoItems.forEach(([label, val], idx) => {
      const col = idx % 4, row = Math.floor(idx / 4);
      const x = margin + col * iColW, iy = y + row * 11;
      doc.setFontSize(7); doc.setFont(undefined, 'bold'); doc.setTextColor(100, 116, 139);
      doc.text(label.toUpperCase(), x, iy);
      doc.setFontSize(8.5); doc.setFont(undefined, 'bold'); doc.setTextColor(15, 23, 42);
      doc.text(String(val), x, iy + 5);
    });
    y += Math.ceil(infoItems.length / 4) * 11 + 6;

    // ── Overall progress bar ─────────────────────────────────────────────────
    checkPage(18);
    const progress = project.progress || 0;
    doc.setFillColor(226, 232, 240);
    doc.roundedRect(margin, y, colW, 6, 2, 2, 'F');
    const progressColor = progress >= 80 ? [16, 185, 129] : progress >= 40 ? [245, 158, 11] : [239, 68, 68];
    doc.setFillColor(...progressColor);
    doc.roundedRect(margin, y, colW * progress / 100, 6, 2, 2, 'F');
    doc.setFontSize(8); doc.setFont(undefined, 'bold'); doc.setTextColor(15, 23, 42);
    doc.text(`Overall: ${progress}%`, margin + colW / 2, y + 4.5, { align: 'center' });
    y += 12;

    // ── KPI Summary boxes ─────────────────────────────────────────────────────
    checkPage(22);
    const kpis = [
      { label: 'Milestones\nComplete', value: `${completedMs}/${selectedMs.length}`, color: [16, 185, 129] },
      { label: 'WBS Tasks\nDone', value: `${completedWBS}/${wbsLinkedToSelected.length}`, color: [59, 130, 246] },
      { label: 'Pending\nDeliverables', value: String(pendingDeliverables), color: [245, 158, 11] },
      { label: 'Open\nRisks', value: String(openRisks), color: openRisks > 0 ? [239, 68, 68] : [16, 185, 129] },
    ];
    const kpiW = (colW - 9) / 4;
    kpis.forEach((k, i) => {
      const kx = margin + i * (kpiW + 3);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(kx, y, kpiW, 18, 2, 2, 'F');
      doc.setFillColor(...k.color);
      doc.roundedRect(kx, y, kpiW, 2, 1, 1, 'F');
      doc.setFontSize(16); doc.setFont(undefined, 'bold'); doc.setTextColor(...k.color);
      doc.text(k.value, kx + kpiW / 2, y + 11, { align: 'center' });
      doc.setFontSize(6.5); doc.setFont(undefined, 'normal'); doc.setTextColor(100, 116, 139);
      const lines = k.label.split('\n');
      lines.forEach((l, li) => doc.text(l, kx + kpiW / 2, y + 14.5 + li * 3.5, { align: 'center' }));
    });
    y += 24;

    // ── Upcoming milestones ─────────────────────────────────────────────────
    if (upcomingMilestones.length > 0) {
      checkPage(20);
      sectionTitle(doc, `Upcoming Milestones (${upcomingMilestones.length})`, margin, y); y += 8;
      tableHeader(doc, margin, y, colW, ['Milestone', 'Planned Date', 'Status'], [0.50, 0.25, 0.25]);
      y += 7;
      upcomingMilestones.forEach((m, i) => {
        checkPage(8);
        tableRow(doc, margin, y, colW, [0.50, 0.25, 0.25], [
          truncate(m.title, 40), formatDate(m.planned_date), (m.status || '—').replace(/_/g, ' '),
        ], i % 2 === 0);
        y += 7;
      });
      y += 4;
    }

    // ── Overdue items ───────────────────────────────────────────────────────
    if (overdueItems.length > 0) {
      checkPage(20);
      sectionTitle(doc, `Overdue Items (${overdueItems.length})`, margin, y); y += 8;
      tableHeader(doc, margin, y, colW, ['Type', 'Item', 'Due Date'], [0.18, 0.62, 0.20]);
      y += 7;
      overdueItems.forEach((it, i) => {
        checkPage(8);
        tableRow(doc, margin, y, colW, [0.18, 0.62, 0.20], [
          it.type, truncate(it.label, 50), formatDate(it.date),
        ], i % 2 === 0);
        y += 7;
      });
      y += 4;
    }

    // ── Milestones section ───────────────────────────────────────────────────
    if (selectedMs.length > 0) {
      checkPage(20);
      sectionTitle(doc, `Milestones (${selectedMs.length})`, margin, y); y += 8;
      tableHeader(doc, margin, y, colW, ['Milestone', 'Planned Date', 'Completed', 'Status', 'Progress'], [0.35, 0.15, 0.15, 0.13, 0.22]);
      y += 7;
      selectedMs.forEach((m, i) => {
        checkPage(10);
        const msProgress = getMilestoneProgress(m.id) ?? m.progress ?? 0;
        tableRow(doc, margin, y, colW, [0.35, 0.15, 0.15, 0.13, 0.22], [
          truncate(m.title, 30), formatDate(m.planned_date),
          m.completed_date ? formatDate(m.completed_date) : '—',
          '', // placeholder for status dot
          '',
        ], i % 2 === 0);
        // Status dot + text
        statusDot(doc, margin + colW * 0.65 + 4, y, m.status);
        doc.setFontSize(7); doc.setFont(undefined, 'normal'); doc.setTextColor(30, 41, 59);
        doc.text((m.status || '—').replace(/_/g, ' '), margin + colW * 0.65 + 8, y);
        // Mini progress bar
        const barX = margin + colW * 0.78 + 2;
        progressBar(doc, barX, y - 3, colW * 0.2, msProgress, msProgress === 100 ? [16, 185, 129] : [245, 158, 11]);
        doc.setFontSize(6.5); doc.text(`${msProgress}%`, barX + colW * 0.2 + 1, y);
        y += 7;
      });
      y += 4;
    }

    // ── WBS Tasks ────────────────────────────────────────────────────────────
    if (includeWBS && wbsLinkedToSelected.length > 0) {
      checkPage(20);
      sectionTitle(doc, `WBS Tasks — Linked to Selected Milestones (${wbsLinkedToSelected.length})`, margin, y); y += 8;
      tableHeader(doc, margin, y, colW, ['Task', 'Assignee', 'Planned End', 'Status', 'Progress'], [0.32, 0.18, 0.15, 0.15, 0.20]);
      y += 7;
      const sorted = [...wbsLinkedToSelected].sort((a, b) => (a.wbs_code || '').localeCompare(b.wbs_code || '', undefined, { numeric: true }));
      sorted.forEach((w, i) => {
        checkPage(10);
        tableRow(doc, margin, y, colW, [0.32, 0.18, 0.15, 0.15, 0.20], [
          truncate(`${w.wbs_code} ${w.name}`, 28),
          truncate(w.assignee || '—', 14),
          formatDate(w.planned_end),
          '', '',
        ], i % 2 === 0);
        statusDot(doc, margin + colW * 0.65 + 4, y, w.status);
        doc.setFontSize(7); doc.setFont(undefined, 'normal'); doc.setTextColor(30, 41, 59);
        doc.text((w.status || '—').replace(/_/g, ' '), margin + colW * 0.65 + 8, y);
        const barX = margin + colW * 0.8 + 2;
        progressBar(doc, barX, y - 3, colW * 0.18, w.progress || 0, w.status === 'completed' ? [16, 185, 129] : [245, 158, 11]);
        doc.setFontSize(6.5); doc.text(`${w.progress || 0}%`, barX + colW * 0.18 + 1, y);
        y += 7;
      });
      y += 4;
    }

    // ── Deliverables ─────────────────────────────────────────────────────────
    if (includeDeliverables && filteredDeliverables.length > 0) {
      checkPage(20);
      sectionTitle(doc, `Deliverables (${filteredDeliverables.length})`, margin, y); y += 8;
      tableHeader(doc, margin, y, colW, ['Deliverable', 'Type', 'Milestone', 'Planned Delivery', 'Status'], [0.30, 0.11, 0.22, 0.17, 0.20]);
      y += 7;
      filteredDeliverables.forEach((d, i) => {
        checkPage(10);
        const msTitle = msById[d.milestone_id]?.title || '—';
        tableRow(doc, margin, y, colW, [0.30, 0.11, 0.22, 0.17, 0.20], [
          truncate(d.name, 26), d.type || '—', truncate(msTitle, 18),
          formatDate(d.planned_delivery_date), '',
        ], i % 2 === 0);
        statusDot(doc, margin + colW * 0.80 + 4, y, d.status);
        doc.setFontSize(7); doc.setFont(undefined, 'normal'); doc.setTextColor(30, 41, 59);
        doc.text((d.status || '—').replace(/_/g, ' '), margin + colW * 0.80 + 8, y);
        y += 7;
      });
      y += 4;
    }

    // ── Risk Mitigation Status ────────────────────────────────────────────────
    if (includeRisks && risks.length > 0) {
      checkPage(20);
      sectionTitle(doc, `Risk Mitigation Status (${risks.length})`, margin, y); y += 8;
      tableHeader(doc, margin, y, colW, ['Risk', 'Category', 'Probability', 'Impact', 'Status', 'Owner'], [0.28, 0.12, 0.11, 0.10, 0.16, 0.23]);
      y += 7;
      risks.forEach((r, i) => {
        checkPage(10);
        tableRow(doc, margin, y, colW, [0.28, 0.12, 0.11, 0.10, 0.16, 0.23], [
          truncate(r.title, 24), r.category || '—', r.probability || '—', r.impact || '—', '', truncate(r.owner || '—', 18),
        ], i % 2 === 0);
        const riskStatusMap = { open: 'open', mitigated: 'mitigated', accepted: 'accepted_risk', closed: 'closed' };
        statusDot(doc, margin + colW * 0.61 + 4, y, riskStatusMap[r.status] || r.status);
        doc.setFontSize(7); doc.setFont(undefined, 'normal'); doc.setTextColor(30, 41, 59);
        doc.text((r.status || '—').replace(/_/g, ' '), margin + colW * 0.61 + 8, y);
        y += 7;
      });
      y += 4;

      // Risk summary
      checkPage(20);
      const riskSummary = [
        { label: 'Open', count: risks.filter(r => r.status === 'open').length, color: [239, 68, 68] },
        { label: 'Mitigated', count: risks.filter(r => r.status === 'mitigated').length, color: [16, 185, 129] },
        { label: 'Accepted', count: risks.filter(r => r.status === 'accepted').length, color: [245, 158, 11] },
        { label: 'Closed', count: risks.filter(r => r.status === 'closed').length, color: [148, 163, 184] },
      ];
      const rW = (colW - 9) / 4;
      riskSummary.forEach((rs, i) => {
        const rx = margin + i * (rW + 3);
        doc.setFillColor(248, 250, 252); doc.roundedRect(rx, y, rW, 12, 2, 2, 'F');
        doc.setFontSize(12); doc.setFont(undefined, 'bold'); doc.setTextColor(...rs.color);
        doc.text(String(rs.count), rx + rW / 2, y + 7, { align: 'center' });
        doc.setFontSize(6.5); doc.setFont(undefined, 'normal'); doc.setTextColor(100, 116, 139);
        doc.text(rs.label, rx + rW / 2, y + 11, { align: 'center' });
      });
      y += 16;
    }

    // ── Footer ────────────────────────────────────────────────────────────────
    const pageCount = doc.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p);
      doc.setFontSize(7); doc.setTextColor(148, 163, 184); doc.setFont(undefined, 'normal');
      doc.setFillColor(248, 250, 252); doc.rect(0, 287, W, 10, 'F');
      doc.text(`${project.name}  ·  ${reportTitle}  ·  Page ${p} of ${pageCount}  ·  Confidential`, W / 2, 293, { align: 'center' });
    }

    doc.save(`${project.code}_ProgressReport_${new Date().toISOString().slice(0, 10)}.pdf`);
    setGenerating(false);
  }

  function toggleMs(id) {
    setSelectedMsIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAllMs() {
    setSelectedMsIds(selectedMsIds.size === milestones.length ? new Set() : new Set(milestones.map(m => m.id)));
  }

  const STATUS_BADGE = {
    completed: 'bg-emerald-100 text-emerald-700',
    in_progress: 'bg-blue-100 text-blue-700',
    pending: 'bg-slate-100 text-slate-600',
    overdue: 'bg-red-100 text-red-700',
  };

  if (loading) return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl p-10 flex flex-col items-center gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
        <p className="text-slate-600 text-sm">Loading project data…</p>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-3">
            <FileDown className="w-5 h-5 text-amber-500" />
            <div>
              <h2 className="font-bold text-slate-800 text-base">Generate Progress Report</h2>
              <p className="text-xs text-slate-400 mt-0.5">{project.code} — {project.name}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500"><X className="w-5 h-5" /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">

          {/* Report title */}
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1.5">Report Title</label>
            <input value={reportTitle} onChange={e => setReportTitle(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
          </div>

          {/* KPI snapshot */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { icon: <Flag className="w-4 h-4 text-amber-500" />, label: 'Milestones', value: `${completedMs}/${selectedMs.length} done` },
              { icon: <CheckCircle2 className="w-4 h-4 text-emerald-500" />, label: 'WBS Tasks', value: `${completedWBS}/${wbsLinkedToSelected.length} done` },
              { icon: <Package className="w-4 h-4 text-blue-500" />, label: 'Pending Deliverables', value: pendingDeliverables },
              { icon: <Shield className="w-4 h-4 text-red-500" />, label: 'Open Risks', value: openRisks },
            ].map((k, i) => (
              <div key={i} className="bg-slate-50 rounded-lg p-3 border border-slate-200 flex flex-col gap-1">
                {k.icon}
                <div className="text-lg font-bold text-slate-800">{k.value}</div>
                <div className="text-xs text-slate-400">{k.label}</div>
              </div>
            ))}
          </div>

          {/* Status snapshot: upcoming & overdue */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <div className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" /> Upcoming Milestones ({upcomingMilestones.length})
              </div>
              {upcomingMilestones.length === 0 ? (
                <p className="text-xs text-slate-400 italic">No upcoming milestones.</p>
              ) : (
                <div className="space-y-1.5">
                  {upcomingMilestones.map(m => (
                    <div key={m.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-slate-700 truncate">{m.title}</span>
                      <span className="text-slate-500 shrink-0">{formatDate(m.planned_date)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <div className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> Overdue Items ({overdueItems.length})
              </div>
              {overdueItems.length === 0 ? (
                <p className="text-xs text-slate-400 italic">Nothing overdue.</p>
              ) : (
                <div className="space-y-1.5 max-h-32 overflow-y-auto">
                  {overdueItems.map((it, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-slate-700 truncate">
                        <span className="text-[10px] font-bold text-red-500 mr-1">{it.type}</span>{it.label}
                      </span>
                      <span className="text-red-500 shrink-0">{formatDate(it.date)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Milestone selection */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                <Flag className="w-3.5 h-3.5 text-amber-500" /> Select Milestones ({selectedMsIds.size}/{milestones.length})
              </label>
              <button onClick={toggleAllMs} className="text-xs text-amber-600 hover:underline font-medium">
                {selectedMsIds.size === milestones.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>
            {milestones.length === 0 ? (
              <p className="text-xs text-slate-400 italic">No milestones found for this project.</p>
            ) : (
              <div className="space-y-1.5 max-h-52 overflow-y-auto border border-slate-200 rounded-lg p-2">
                {milestones.map(m => {
                  const msProgress = getMilestoneProgress(m.id) ?? m.progress ?? 0;
                  const delivCount = deliverables.filter(d => d.milestone_id === m.id).length;
                  return (
                    <label key={m.id} className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition ${selectedMsIds.has(m.id) ? 'bg-amber-50 border border-amber-200' : 'hover:bg-slate-50 border border-transparent'}`}>
                      <input type="checkbox" checked={selectedMsIds.has(m.id)} onChange={() => toggleMs(m.id)}
                        className="accent-amber-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-slate-800 text-sm truncate">{m.title}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${STATUS_BADGE[m.status] || 'bg-slate-100 text-slate-600'}`}>
                            {m.status?.replace(/_/g, ' ')}
                          </span>
                          {delivCount > 0 && <span className="text-xs text-blue-500">📦 {delivCount} deliverable{delivCount !== 1 ? 's' : ''}</span>}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <div className="flex-1 bg-slate-200 rounded-full h-1.5">
                            <div className={`h-1.5 rounded-full ${msProgress === 100 ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${msProgress}%` }} />
                          </div>
                          <span className="text-xs text-slate-400 shrink-0">{msProgress}%</span>
                          {m.planned_date && <span className="text-xs text-slate-400 shrink-0">📅 {formatDate(m.planned_date)}</span>}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Section toggles */}
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-2">Include Sections</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { key: 'deliverables', label: 'Deliverables', icon: <Package className="w-4 h-4" />, count: filteredDeliverables.length, state: includeDeliverables, set: setIncludeDeliverables },
                { key: 'wbs', label: 'WBS Tasks', icon: <CheckCircle2 className="w-4 h-4" />, count: wbsLinkedToSelected.length, state: includeWBS, set: setIncludeWBS },
                { key: 'risks', label: 'Risk Status', icon: <Shield className="w-4 h-4" />, count: risks.length, state: includeRisks, set: setIncludeRisks },
              ].map(s => (
                <button key={s.key} onClick={() => s.set(v => !v)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition ${s.state ? 'bg-amber-50 border-amber-300 text-amber-800' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>
                  {s.icon}
                  <span>{s.label}</span>
                  <span className="ml-auto text-xs opacity-70">({s.count})</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between shrink-0 bg-slate-50">
          <button onClick={onClose} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-slate-100">Cancel</button>
          <button onClick={generate} disabled={generating || selectedMsIds.size === 0}
            className="flex items-center gap-2 px-6 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm rounded-lg disabled:opacity-40">
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
            {generating ? 'Generating PDF…' : `Generate PDF Report`}
          </button>
        </div>
      </div>
    </div>
  );
}