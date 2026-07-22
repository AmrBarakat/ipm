import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useEntityList, useEntityMutation } from '@/hooks/useEntity';
import { ENTITY_QUERY } from '@/lib/entityQueryDefaults';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Calendar } from 'lucide-react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx-js-style';
import { exportSectionsPDF, styleSheet } from '@/lib/reportExport';

import {
  TIME_SCALES, scaleByKey, HEADER_H, MIN_LEFT_WIDTH, MAX_LEFT_WIDTH,
  projectBounds, buildRows, computeCriticalPath, computeTreeMove,
  addDays, daysBetween, toISO, clamp,
} from './ganttUtils';
import GanttToolbar from './GanttToolbar';
import GanttTree from './GanttTree';
import GanttTimeline from './GanttTimeline';
import GanttEditorModal from './GanttEditorModal';
import { useCan } from '@/lib/can';
import ScheduleAssistantModal from '@/components/project-detail/ScheduleAssistantModal';

export default function TabGantt({ projectId, project }) {
  const { data: qWbs = [], isLoading: loadingWbs } = useEntityList('WBSItem', { project_id: projectId }, ENTITY_QUERY.WBSItem.sort, ENTITY_QUERY.WBSItem.limit);
  const { data: qMilestones = [], isLoading: loadingMs } = useEntityList('Milestone', { project_id: projectId }, ENTITY_QUERY.Milestone.sort, ENTITY_QUERY.Milestone.limit);
  const wbsMutation = useEntityMutation('WBSItem', ['Task']);
  const msMutation = useEntityMutation('Milestone');
  const queryClient = useQueryClient();
  const { canModify } = useCan();

  // Local optimistic copy of WBS items (for drag edits)
  const [wbsItems, setWbsItems] = useState([]);
  const [milestones, setMilestones] = useState([]);
  const committedRef = useRef([]);
  const isDraggingRef = useRef(false); // suppress query refetches while a drag is in progress
  const pendingDragItemsRef = useRef([]); // latest optimistic items array during a drag (read on commit)
  useEffect(() => {
    // Don't clobber an in-progress optimistic drag with a background refetch
    // (realtime subscription / window focus) — the drag commits on mouseup and
    // re-invalidates, so the saved state lands afterward.
    if (isDraggingRef.current) return;
    setWbsItems(qWbs);
    setMilestones(qMilestones);
    committedRef.current = qWbs;
  }, [qWbs, qMilestones]);

  // Real-time: keep the Gantt in sync when WBS items or milestones change
  // elsewhere (WBS tab, another user, automations) without a manual refresh.
  useEffect(() => {
    const unsubs = [
      base44.entities.WBSItem?.subscribe?.(() => queryClient.invalidateQueries({ queryKey: ['WBSItem'] })),
      base44.entities.Milestone?.subscribe?.(() => queryClient.invalidateQueries({ queryKey: ['Milestone'] })),
    ];
    return () => { unsubs.forEach(u => { try { u && u(); } catch (_) {} }); };
  }, [queryClient]);

  // After any WBS change lands (drag commit, reorder, external edit), re-run the
  // WBS → project + milestone progress rollup. Debounced so a multi-item batch
  // save triggers a single sync, not one per item.
  const syncTimerRef = useRef(null);
  useEffect(() => {
    if (!qWbs.length) return;
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      base44.functions.invoke('syncWBSProgress', { project_id: projectId }).catch(() => {});
    }, 700);
    return () => { if (syncTimerRef.current) clearTimeout(syncTimerRef.current); };
  }, [qWbs, projectId]);

  const [scaleKey, setScaleKey] = useState('week');
  const [leftWidth, setLeftWidth] = useState(340);
  const [expanded, setExpanded] = useState({});
  const [showDeps, setShowDeps] = useState(true);
  const [showCritical, setShowCritical] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [exporting, setExporting] = useState(null); // 'png' | 'pdf' | null
  const [editorRow, setEditorRow] = useState(null);
  const [showSmart, setShowSmart] = useState(false);

  const scrollRef = useRef(null);
  const containerRef = useRef(null);
  const chartRef = useRef(null); // inner chart (tree + timeline) targeted for export
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(600);

  const scale = scaleByKey(scaleKey);
  const dayWidth = scale.dayWidth;

  // Auto-expand ALL parent levels on load so the full tree is visible
  // immediately. Only sets parents that aren't already toggled (undefined),
  // so manual collapses are preserved across re-renders.
  useEffect(() => {
    setExpanded(prev => {
      const e = { ...prev };
      const childMap = {};
      wbsItems.forEach(i => { if (i.parent_id) (childMap[i.parent_id] ||= []).push(i); });
      wbsItems.forEach(i => { if (childMap[i.id] && e[i.id] === undefined) e[i.id] = true; });
      return e;
    });
  }, [wbsItems]);

  const bounds = useMemo(() => projectBounds(wbsItems, milestones, project), [wbsItems, milestones, project]);
  // Timeline start: initialize once real data arrives; stays stable during drags.
  // Reframed explicitly by Fit/Start buttons and before export to focus on project span.
  const [timelineStart, setTimelineStart] = useState(null);
  const didInitTimeline = useRef(false);
  useEffect(() => {
    if (!didInitTimeline.current && wbsItems.length > 0) {
      didInitTimeline.current = true;
      setTimelineStart(bounds.start);
    }
  }, [wbsItems.length, bounds.start]);
  const effectiveStart = timelineStart ?? bounds.start;
  // Extend end dynamically if bars exceed
  const totalDays = Math.max(daysBetween(effectiveStart, bounds.end), 14);

  // On first load, auto-scroll the timeline to the earliest WBS activity so the
  // bars are immediately visible. The window is anchored to project.start_date,
  // which can be weeks/months before the first real task — leaving the default
  // (left-aligned) view empty even though every activity is in the tree.
  const didInitScroll = useRef(false);
  useEffect(() => {
    if (didInitScroll.current || wbsItems.length === 0 || !scrollRef.current) return;
    didInitScroll.current = true;
    const earliest = wbsItems.reduce(
      (m, w) => (w.planned_start && (!m || w.planned_start < m)) ? w.planned_start : m, null);
    const target = earliest || new Date().toISOString().slice(0, 10);
    const x = Math.max(0, daysBetween(effectiveStart, target) * dayWidth - 40);
    requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollLeft = x; });
  }, [wbsItems, effectiveStart, dayWidth]);

  const rows = useMemo(() => buildRows(wbsItems, milestones, expanded), [wbsItems, milestones, expanded]);
  const wbsById = useMemo(() => Object.fromEntries(wbsItems.map(i => [i.id, i])), [wbsItems]);
  const cpm = useMemo(() => computeCriticalPath(wbsItems), [wbsItems]);
  const delayedIds = useMemo(() => {
    const s = new Set();
    for (const item of wbsItems) {
      const preds = (item.predecessor_ids || []).map(id => wbsById[id]).filter(Boolean);
      const predEnds = preds.map(p => p.actual_end || p.planned_end).filter(Boolean);
      if (!predEnds.length) continue;
      const latest = predEnds.reduce((a, b) => (a > b ? a : b));
      // Use planned_start (not actual_start) to match the AI assistant's
      // scheduleChat conflict check — same-day handoffs are valid.
      const myStart = item.planned_start;
      if (myStart && myStart < latest) s.add(item.id);
    }
    return s;
  }, [wbsItems, wbsById]);

  // Track viewport size
  useEffect(() => {
    function measure() {
      if (scrollRef.current) setViewportH(scrollRef.current.clientHeight);
    }
    measure();
    const ro = new ResizeObserver(measure);
    if (scrollRef.current) ro.observe(scrollRef.current);
    return () => ro.disconnect();
  }, [fullscreen]);

  function toggleExpand(id) { setExpanded(prev => ({ ...prev, [id]: !prev[id] })); }
  function expandAll() {
    const childMap = {};
    wbsItems.forEach(i => { if (i.parent_id) (childMap[i.parent_id] ||= []).push(i); });
    setExpanded(prev => {
      const e = { ...prev };
      wbsItems.forEach(i => { if (childMap[i.id]) e[i.id] = true; });
      return e;
    });
  }
  function collapseAll() {
    const childMap = {};
    wbsItems.forEach(i => { if (i.parent_id) (childMap[i.parent_id] ||= []).push(i); });
    setExpanded(prev => {
      const e = { ...prev };
      wbsItems.forEach(i => { if (childMap[i.id]) e[i.id] = false; });
      return e;
    });
  }

  function onScroll(e) {
    setScrollTop(e.target.scrollTop);
  }

  function pan(days) {
    if (scrollRef.current) scrollRef.current.scrollLeft += days * dayWidth;
  }
  function jumpToToday() {
    const x = daysBetween(effectiveStart, new Date()) * dayWidth - 100;
    if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, x);
  }
  function jumpToStart() {
    setTimelineStart(bounds.start);
    requestAnimationFrame(() => { if (scrollRef.current) { scrollRef.current.scrollLeft = 0; scrollRef.current.scrollTop = 0; } });
  }
  function fitToProject() {
    if (!containerRef.current) return;
    // Reframe to current project bounds first so the fit focuses on real activity span
    setTimelineStart(bounds.start);
    const span = Math.max(daysBetween(bounds.start, bounds.end), 14);
    const avail = containerRef.current.clientWidth - leftWidth - 24;
    const need = avail / span;
    // pick closest scale
    let best = TIME_SCALES[0], bestDiff = Infinity;
    TIME_SCALES.forEach(s => {
      const diff = Math.abs(s.dayWidth - need);
      if (diff < bestDiff) { bestDiff = diff; best = s; }
    });
    setScaleKey(best.key);
    requestAnimationFrame(() => { if (scrollRef.current) { scrollRef.current.scrollLeft = 0; scrollRef.current.scrollTop = 0; } });
  }

  // ── Drag move/resize: optimistic during drag, persist on commit ────────────
  const dragBaseRef = useRef(null); // committed start of the dragged item, captured at drag start

  const onMoveItem = useCallback((id, newStart, newEnd, mode, commit) => {
    if (!canModify) return;
    const cascade = mode === 'move';
    if (!commit) isDraggingRef.current = true;
    setWbsItems(prev => {
      const target = prev.find(i => i.id === id);
      if (!target) return prev;
      // Capture the pre-drag committed start once, so cascade delta is stable
      // across every frame of a continuous drag.
      if (dragBaseRef.current?.id !== id) {
        const committed = committedRef.current.find(x => x.id === id) || target;
        dragBaseRef.current = { id, baseStart: committed.planned_start };
      }
      let updated = prev.map(i => i.id === id ? { ...i, planned_start: newStart, planned_end: newEnd } : i);
      if (cascade) {
        const delta = daysBetween(dragBaseRef.current.baseStart, newStart);
        if (delta !== 0) {
          const byId = Object.fromEntries(updated.map(i => [i.id, { ...i }]));
          const succ = {};
          for (const it of updated) for (const p of (it.predecessor_ids || [])) { (succ[p] ||= []).push(it.id); }
          const q = [...(succ[id] || [])]; const seen = new Set([id]);
          // Shift successors from THEIR committed baseline by the same delta.
          const committedById = Object.fromEntries(committedRef.current.map(i => [i.id, i]));
          while (q.length) {
            const sid = q.shift(); if (seen.has(sid)) continue; seen.add(sid);
            const it = byId[sid]; const base = committedById[sid]; if (!it || !base) continue;
            if (base.planned_start) it.planned_start = toISO(addDays(base.planned_start, delta));
            if (base.planned_end) it.planned_end = toISO(addDays(base.planned_end, delta));
            for (const s2 of (succ[sid] || [])) if (!seen.has(s2)) q.push(s2);
          }
          updated = Object.values(byId);
        }
      }
      // Keep the latest optimistic array in a ref so the commit path can diff
      // it against the committed baseline directly — no setState wrapper.
      pendingDragItemsRef.current = updated;
      return updated;
    });

    if (commit) {
      const pending = pendingDragItemsRef.current || [];
      const changed = pending.filter(i => {
        const c = committedRef.current.find(x => x.id === i.id);
        return c && (i.planned_start !== c.planned_start || i.planned_end !== c.planned_end);
      });
      if (!changed.length) {
        isDraggingRef.current = false;
        dragBaseRef.current = null;
        return;
      }
      const updates = changed.map(i => ({ id: i.id, planned_start: i.planned_start, planned_end: i.planned_end }));
      base44.functions.invoke('applyWBSBatch', { wbs_updates: updates })
        .then(() => Promise.all([
          queryClient.invalidateQueries({ queryKey: ['WBSItem'] }),
          queryClient.invalidateQueries({ queryKey: ['Task'] }), // tasks derive from WBS — must refresh
        ]))
        .catch((err) => {
          setWbsItems(committedRef.current); // atomic rollback on backend failure
          toast.error(err?.response?.data?.error || 'Schedule save failed — no changes were saved.');
        })
        .finally(() => {
          // Keep the drag guard up until the save has settled AND the dependent
          // queries have been invalidated — otherwise a realtime/focus refetch
          // landing in this window snaps the bar back to its pre-drag position.
          isDraggingRef.current = false;
          dragBaseRef.current = null;
        });
    }
  }, [queryClient, canModify]);

  // ── Tree reorder / reparent ────────────────────────────────────────────────
  function onReorder(dragId, targetId, position) {
    if (!canModify) return;
    const updates = computeTreeMove(wbsItems, dragId, targetId, position);
    if (!updates.length) return;
    const snapshot = wbsItems;
    // optimistic
    setWbsItems(prev => prev.map(i => {
      const u = updates.find(x => x.id === i.id);
      return u ? { ...i, parent_id: u.parent_id, wbs_code: u.wbs_code } : i;
    }));
    // Reparent/renumber must land as one unit — apply atomically via the backend
    // so a mid-batch failure rolls back the whole tree change instead of leaving
    // wbs_code numbering half-applied.
    base44.functions.invoke('applyWBSBatch', { wbs_updates: updates })
      .then(() => queryClient.invalidateQueries({ queryKey: ['WBSItem'] }))
      .catch((err) => {
        setWbsItems(snapshot); // revert optimistic move — backend rolled back atomically
        toast.error(err?.response?.data?.error || 'Reorder failed — no changes were saved.');
      });
  }

  // ── Editor save ────────────────────────────────────────────────────────────
  function onEditorSave(row, form) {
    if (!canModify) return;
    if (row.kind === 'milestone') {
      const id = row.data.id;
      msMutation.mutateAsync({ action: 'update', id, data: { title: form.title, planned_date: form.planned_date, status: form.status } })
        .then(() => queryClient.invalidateQueries({ queryKey: ['Milestone'] }));
    } else {
      const id = row.data.id;
      wbsMutation.mutateAsync({ action: 'update', id, data: form })
        .then(() => queryClient.invalidateQueries({ queryKey: ['WBSItem'] }));
    }
  }

  // ── Divider drag (resize left column) ─────────────────────────────────────
  const dividerDrag = useRef(null);
  function onDividerDown(e) {
    dividerDrag.current = { startX: e.clientX, startW: leftWidth };
    document.body.style.userSelect = 'none'; document.body.style.cursor = 'col-resize';
  }
  useEffect(() => {
    function move(e) {
      if (!dividerDrag.current) return;
      const nw = clamp(dividerDrag.current.startW + (e.clientX - dividerDrag.current.startX), MIN_LEFT_WIDTH, MAX_LEFT_WIDTH);
      setLeftWidth(nw);
    }
    function up() { dividerDrag.current = null; document.body.style.userSelect = ''; document.body.style.cursor = ''; }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, []);

  // ── Exports ────────────────────────────────────────────────────────────────
  const EXPORT_STYLE_ID = 'gantt-export-style';
  function applyExportStyle() {
    let el = document.getElementById(EXPORT_STYLE_ID);
    if (!el) {
      el = document.createElement('style');
      el.id = EXPORT_STYLE_ID;
      el.textContent = `.gantt-export{background:#fff!important}.gantt-export *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}`;
      document.head.appendChild(el);
    }
    return el;
  }

  async function captureCanvas() {
    if (!chartRef.current) return null;
    setExporting(e => e || 'png');
    // Reframe to the project's actual activity span so the export focuses on
    // real activity, then widen the left task column so names aren't truncated.
    setTimelineStart(bounds.start);
    const longest = rows.reduce((mx, r) => {
      const text = r.kind === 'wbs' ? `${r.data.wbs_code || ''} ${r.data.name || ''}` : `◆ ${r.data.title || ''}`;
      return Math.max(mx, (r.depth || 0) * 16 + text.length * 6.2 + 70);
    }, 0);
    const exportLeft = Math.min(720, Math.max(leftWidth, Math.ceil(longest)));
    const restoreLeft = leftWidth;
    if (exportLeft !== leftWidth) setLeftWidth(exportLeft);
    // Let bars re-layout after the reframe + column resize before capturing.
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise(r => setTimeout(r, 120));

    const styleEl = applyExportStyle();
    const node = chartRef.current;
    node.classList.add('gantt-export');
    const dpr = window.devicePixelRatio || 1;
    const captureScale = Math.min(3, Math.max(2, dpr * 2));
    let canvas;
    try {
      canvas = await html2canvas(node, {
        backgroundColor: '#ffffff',
        useCORS: true,
        scale: captureScale,
        width: node.scrollWidth,
        height: node.scrollHeight,
        windowWidth: node.scrollWidth,
        windowHeight: node.scrollHeight,
      });
    } finally {
      node.classList.remove('gantt-export');
      if (styleEl) styleEl.remove();
      if (exportLeft !== restoreLeft) setLeftWidth(restoreLeft);
      setExporting(null);
    }
    return canvas;
  }

  async function exportPNG() {
    try { setExporting('png'); const canvas = await captureCanvas(); if (!canvas) return;
      const link = document.createElement('a');
      link.href = canvas.toDataURL('image/png'); // lossless — correct for text/lines
      link.download = `gantt_${(project?.code || 'project')}_${new Date().toISOString().slice(0,10)}.png`;
      link.click();
    } catch (e) { console.error(e); setExporting(null); }
  }

  // PDF: tile the chart across landscape pages at a readable size instead of
  // shrinking it onto one page. Page 1 carries a header band + legend; overflow
  // pages repeat a slim header. Image data is PNG so text stays sharp.
  async function exportPDF() {
    let canvas;
    try { setExporting('pdf'); canvas = await captureCanvas(); } catch (e) { console.error(e); setExporting(null); return; }
    if (!canvas) { setExporting(null); return; }
    try {
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
      const pw = pdf.internal.pageSize.getWidth();
      const ph = pdf.internal.pageSize.getHeight();
      const M = 24;
      const printableW = pw - M * 2;
      const bandH = 56;
      const firstContentTop = 96;
      const restContentTop = 44;
      const footerReserve = 30;
      const firstContentH = ph - firstContentTop - footerReserve;
      const restContentH = ph - restContentTop - footerReserve;
      const scalePt = printableW / canvas.width;   // fit width — never also shrink to fit height
      const pxPerPt = canvas.width / printableW;

      // ── Page 1 header band + legend ──────────────────────────────────────
      drawHeaderBand(pdf, M, M, printableW, bandH, {
        name: project?.name, code: project?.code, today: new Date().toLocaleDateString('en-GB'),
        scaleLabel: scale.label, pct: project?.progress ?? 0,
      });
      drawLegend(pdf, M, M + bandH + 2);

      // ── Slice the canvas into page-height bands ──────────────────────────
      let yPx = 0;
      let pageIndex = 1;
      while (yPx < canvas.height) {
        if (pageIndex > 1) pdf.addPage();
        const availPt = pageIndex === 1 ? firstContentH : restContentH;
        const slicePx = Math.max(1, Math.min(Math.floor(availPt * pxPerPt), canvas.height - yPx));
        const tmp = document.createElement('canvas');
        tmp.width = canvas.width; tmp.height = slicePx;
        tmp.getContext('2d').drawImage(canvas, 0, yPx, canvas.width, slicePx, 0, 0, canvas.width, slicePx);
        const dataUrl = tmp.toDataURL('image/png');
        const drawH = slicePx * scalePt;
        const topPt = pageIndex === 1 ? firstContentTop : restContentTop;
        pdf.addImage(dataUrl, 'PNG', M, topPt, printableW, drawH);
        yPx += slicePx;
        pageIndex++;
      }

      // ── Slim header (pages 2+) + footer on every page ────────────────────
      const pages = pdf.getNumberOfPages();
      for (let p = 1; p <= pages; p++) {
        pdf.setPage(p);
        if (p > 1) {
          pdf.setDrawColor(226, 232, 240); pdf.setLineWidth(0.5);
          pdf.line(M, restContentTop - 6, pw - M, restContentTop - 6);
          pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(15, 23, 42);
          pdf.text(`${project?.code || 'Project'} · Gantt`, M, restContentTop - 12);
          pdf.setFont('helvetica', 'normal'); pdf.setTextColor(148, 163, 184);
          pdf.text(`Page ${p} of ${pages}`, pw - M, restContentTop - 12, { align: 'right' });
        }
        pdf.setDrawColor(226, 232, 240); pdf.setLineWidth(0.5);
        pdf.line(M, ph - 14, pw - M, ph - 14);
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7); pdf.setTextColor(148, 163, 184);
        pdf.text(`${project?.name || 'Project'} · Gantt · Page ${p} of ${pages}`, pw / 2, ph - 8, { align: 'center' });
      }

      pdf.save(`gantt_${(project?.code || 'project')}_${new Date().toISOString().slice(0,10)}.pdf`);
    } catch (e) { console.error(e); } finally { setExporting(null); }
  }

  function exportTablePDF() {
    // Tabular fallback for very large charts — a clean schedule table via the
    // shared report exporter. Reuses the same row-building logic as exportExcel.
    const tblRows = wbsItems.filter(w => w.planned_start || w.planned_end).map(w => ({
      'WBS': w.wbs_code || '',
      'Task': w.name || '',
      'Start': w.planned_start || '',
      'Finish': w.planned_end || '',
      'Duration': (w.planned_start && w.planned_end) ? daysBetween(w.planned_start, w.planned_end) : '',
      '%': w.progress || 0,
      'Assignee': w.assignee || '',
      'Critical': cpm.criticalIds.has(w.id) ? 'Yes' : '',
      'Slack': cpm.float.get(w.id) || 0,
    }));
    const columns = [
      { header: 'WBS', key: 'WBS' }, { header: 'Task', key: 'Task' },
      { header: 'Start', key: 'Start' }, { header: 'Finish', key: 'Finish' },
      { header: 'Duration', key: 'Duration', align: 'right' },
      { header: '%', key: '%', align: 'right' },
      { header: 'Assignee', key: 'Assignee' },
      { header: 'Critical', key: 'Critical' },
      { header: 'Slack', key: 'Slack', align: 'right' },
    ];
    exportSectionsPDF(
      `gantt_${(project?.code || 'project')}_${new Date().toISOString().slice(0,10)}.pdf`,
      `Schedule — ${project?.name || project?.code || 'Project'}`,
      [{ title: 'Schedule', type: 'table', columns, rows: tblRows }],
      { subtitle: project?.code ? `Project code: ${project.code}` : undefined, orientation: 'landscape' },
    );
  }
  function exportExcel() {
    const columns = [
      { header: 'WBS Code', key: 'code' },
      { header: 'Task Name', key: 'name' },
      { header: 'Start', key: 'start' },
      { header: 'Finish', key: 'finish' },
      { header: 'Duration (days)', key: 'dur', fmt: '#,##0' },
      { header: '% Complete', key: 'pct', fmt: '0"%"' },
      { header: 'Assignee', key: 'assignee' },
      { header: 'Dependencies', key: 'deps' },
      { header: 'Critical', key: 'crit' },
      { header: 'Slack (days)', key: 'slack', fmt: '#,##0' },
    ];
    const data = wbsItems.filter(w => w.planned_start || w.planned_end).map(w => ({
      code: w.wbs_code || '',
      name: w.name || '',
      start: w.planned_start || '',
      finish: w.planned_end || '',
      dur: (w.planned_start && w.planned_end) ? daysBetween(w.planned_start, w.planned_end) : '',
      pct: w.progress || 0,
      assignee: w.assignee || '',
      deps: (w.predecessor_ids || []).map(id => wbsById[id]?.wbs_code || id).join(', '),
      crit: cpm.criticalIds.has(w.id) ? 'Yes' : '',
      slack: cpm.float.get(w.id) || 0,
    }));
    const sheetRows = data.length ? data : [Object.fromEntries(columns.map((c) => [c.header, '']))];
    const ws = XLSX.utils.json_to_sheet(sheetRows);
    styleSheet(ws, { headerRows: [0], freezeRow: 1, columns });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Schedule');
    XLSX.writeFile(wb, `gantt_${(project?.code || 'project')}_${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  if (loadingWbs && loadingMs) return (
    <div className="flex justify-center py-16"><div className="w-7 h-7 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>
  );
  if (rows.length === 0) return (
    <div className="text-center py-16 text-slate-400">
      <Calendar className="w-12 h-12 mx-auto mb-3 opacity-30" />
      <p className="text-sm">No WBS items or milestones with dates to display.</p>
      <p className="text-xs mt-1">Add planned dates to WBS items or milestones to see the Gantt.</p>
    </div>
  );

  const innerWidth = leftWidth + totalDays * dayWidth;
  const startForChart = effectiveStart;
  const chart = (
    <div ref={containerRef} className={`flex flex-col min-h-[400px] ${fullscreen ? 'h-full' : 'h-[calc(100vh-18rem)]'}`}>
      <GanttToolbar
        scaleKey={scaleKey} setScaleKey={setScaleKey}
        onPan={pan} onFit={fitToProject} onToday={jumpToToday} onJumpStart={jumpToStart}
        onExpandAll={expandAll} onCollapseAll={collapseAll}
        showDeps={showDeps} setShowDeps={setShowDeps} showCritical={showCritical} setShowCritical={setShowCritical}
        criticalCount={cpm.criticalIds.size} projectDuration={cpm.projectDurationDays} projectFinish={cpm.projectFinish}
        fullscreen={fullscreen} toggleFullscreen={() => setFullscreen(v => !v)}
        onExportPNG={exportPNG} onExportPDF={exportPDF} onExportTablePDF={exportTablePDF} onExportExcel={exportExcel} exporting={exporting}
        onSmartAnalysis={() => setShowSmart(true)}
      />
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-auto border border-slate-200 rounded-lg bg-white relative" style={{ minHeight: 320 }}>
        <div ref={chartRef} style={{ width: innerWidth, position: 'relative' }} className="flex flex-col">
          <div className="flex">
            <GanttTree
              rows={rows} leftWidth={leftWidth} scrollTop={scrollTop} viewportH={viewportH - HEADER_H}
              expanded={expanded} onToggleExpand={toggleExpand}
              onReorder={onReorder} exporting={!!exporting}
              criticalIds={cpm.criticalIds} delayedIds={delayedIds}
              onResizeStart={onDividerDown}
            />
            <GanttTimeline
              rows={rows} timelineStart={startForChart} totalDays={totalDays} dayWidth={dayWidth}
              scrollTop={scrollTop} viewportH={viewportH - HEADER_H} exporting={!!exporting}
              showDeps={showDeps} showCritical={showCritical} criticalIds={cpm.criticalIds} float={cpm.float}
              wbsById={wbsById} projectStart={project?.start_date || null}
              onMoveItem={onMoveItem} onOpenEditor={setEditorRow}
            />
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {fullscreen ? (
        <div className="fixed inset-0 z-50 bg-white flex flex-col p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-slate-700 text-sm">Gantt — {project?.name}</span>
          </div>
          <div className="flex-1 min-h-0">{chart}</div>
        </div>
      ) : chart}

      {editorRow && (
        <GanttEditorModal row={editorRow} allWbs={wbsItems} onSave={onEditorSave} onClose={() => setEditorRow(null)} />
      )}

      {showSmart && (
        <ScheduleAssistantModal
          projectId={projectId}
          onClose={() => setShowSmart(false)}
          onApplied={() => queryClient.invalidateQueries({ queryKey: ['WBSItem'] })}
        />
      )}
    </>
  );
}

// ── PDF header band + legend helpers (module-level) ──────────────────────────
function drawHeaderBand(pdf, x, y, w, h, info) {
  pdf.setFillColor(15, 23, 42); pdf.rect(x, y, w, h, 'F');
  pdf.setFillColor(245, 158, 11); pdf.rect(x, y + h - 3, w, 3, 'F'); // accent stripe
  pdf.setTextColor(255, 255, 255); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15);
  pdf.text(String(info.name || 'Project'), x + 10, y + 18);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(203, 213, 225);
  pdf.text(`Code: ${info.code || '—'}`, x + 10, y + 31);
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.setTextColor(255, 255, 255);
  pdf.text('Project Schedule — Gantt Chart', x + 10, y + 46);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(203, 213, 225);
  pdf.text(`Generated: ${info.today}`, x + w - 10, y + 18, { align: 'right' });
  pdf.text(`Scale: ${info.scaleLabel || '—'}`, x + w - 10, y + 30, { align: 'right' });
  pdf.text(`Progress: ${info.pct || 0}%`, x + w - 10, y + 42, { align: 'right' });
}

function drawLegend(pdf, x, y) {
  const items = [
    { type: 'bar', color: [168, 85, 247], label: 'Task' },
    { type: 'bar', color: [244, 63, 94], label: 'Critical path' },
    { type: 'diamond', color: [245, 158, 11], label: 'Milestone' },
    { type: 'striped', label: 'In-progress' },
  ];
  let cx = x;
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(71, 85, 105);
  for (const it of items) {
    if (it.type === 'bar') { pdf.setFillColor(...it.color); pdf.rect(cx, y, 10, 8, 'F'); }
    else if (it.type === 'diamond') { pdf.setFillColor(...it.color); pdf.rect(cx + 2, y, 6, 8, 'F'); }
    else if (it.type === 'striped') {
      pdf.setFillColor(248, 250, 252); pdf.rect(cx, y, 10, 8, 'F');
      pdf.setDrawColor(59, 130, 246); pdf.setLineWidth(0.6);
      for (let i = 0; i < 10; i += 3) pdf.line(cx + i, y, cx + i, y + 8);
    }
    pdf.text(it.label, cx + 14, y + 6);
    cx += 14 + pdf.getTextWidth(it.label) + 16;
  }
}