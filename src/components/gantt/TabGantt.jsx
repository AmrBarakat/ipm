import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useEntityList, useEntityMutation } from '@/hooks/useEntity';
import { useQueryClient } from '@tanstack/react-query';
import { Calendar } from 'lucide-react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';

import {
  TIME_SCALES, scaleByKey, HEADER_H, MIN_LEFT_WIDTH, MAX_LEFT_WIDTH,
  projectBounds, buildRows, computeCriticalPath, computeTreeMove,
  addDays, daysBetween, toISO, clamp,
} from './ganttUtils';
import GanttToolbar from './GanttToolbar';
import GanttTree from './GanttTree';
import GanttTimeline from './GanttTimeline';
import GanttEditorModal from './GanttEditorModal';
import ScheduleAssistantModal from '@/components/project-detail/ScheduleAssistantModal';

export default function TabGantt({ projectId, project }) {
  const { data: qWbs = [], isLoading: loadingWbs } = useEntityList('WBSItem', { project_id: projectId }, 'wbs_code', 2000);
  const { data: qMilestones = [], isLoading: loadingMs } = useEntityList('Milestone', { project_id: projectId }, 'planned_date', 500);
  const wbsMutation = useEntityMutation('WBSItem');
  const msMutation = useEntityMutation('Milestone');
  const queryClient = useQueryClient();

  // Local optimistic copy of WBS items (for drag edits)
  const [wbsItems, setWbsItems] = useState([]);
  const [milestones, setMilestones] = useState([]);
  const committedRef = useRef([]);
  useEffect(() => {
    setWbsItems(qWbs);
    setMilestones(qMilestones);
    committedRef.current = qWbs;
  }, [qWbs, qMilestones]);

  const [scaleKey, setScaleKey] = useState('week');
  const [leftWidth, setLeftWidth] = useState(340);
  const [expanded, setExpanded] = useState({});
  const [showDeps, setShowDeps] = useState(true);
  const [showCritical, setShowCritical] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [exporting, setExporting] = useState(null); // 'png' | 'pdf' | null
  const [editorRow, setEditorRow] = useState(null);
  const [aiModal, setAiModal] = useState(null); // null | 'optimize' | 'estimate'

  const scrollRef = useRef(null);
  const containerRef = useRef(null);
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

  // ── Drag move/resize: optimistic + persist on mouseup ──────────────────────
  const onMoveItem = useCallback((id, newStart, newEnd, cascade) => {
    setWbsItems(prev => {
      const prevMoved = prev.find(i => i.id === id);
      let updated = prev.map(i => i.id === id ? { ...i, planned_start: newStart, planned_end: newEnd } : i);
      if (cascade && prevMoved) {
        // incremental shift from this drag (bar's previous position → new)
        const delta = daysBetween(prevMoved.planned_start, newStart);
        if (delta !== 0) {
          const byId = Object.fromEntries(updated.map(i => [i.id, { ...i }]));
          const succ = {};
          for (const it of updated) for (const p of (it.predecessor_ids || [])) { (succ[p] ||= []).push(it.id); }
          const q = [...(succ[id] || [])]; const seen = new Set([id]);
          while (q.length) {
            const sid = q.shift(); if (seen.has(sid)) continue; seen.add(sid);
            const it = byId[sid]; if (!it) continue;
            if (it.planned_start) it.planned_start = toISO(addDays(it.planned_start, delta));
            if (it.planned_end) it.planned_end = toISO(addDays(it.planned_end, delta));
            for (const s2 of (succ[sid] || [])) if (!seen.has(s2)) q.push(s2);
          }
          updated = Object.values(byId);
        }
      }
      return updated;
    });
  }, []);

  const onResizeItem = useCallback(() => {
    // Persist all changed items vs committed
    const changed = wbsItems.filter(i => {
      const c = committedRef.current.find(x => x.id === i.id);
      return c && (i.planned_start !== c.planned_start || i.planned_end !== c.planned_end);
    });
    if (!changed.length) return;
    Promise.all(changed.map(i => wbsMutation.mutateAsync({ action: 'update', id: i.id, data: { planned_start: i.planned_start, planned_end: i.planned_end } })))
      .then(() => queryClient.invalidateQueries({ queryKey: ['WBSItem'] }));
  }, [wbsItems, wbsMutation, queryClient]);

  // ── Tree reorder / reparent ────────────────────────────────────────────────
  function onReorder(dragId, targetId, position) {
    const updates = computeTreeMove(wbsItems, dragId, targetId, position);
    if (!updates.length) return;
    // optimistic
    setWbsItems(prev => prev.map(i => {
      const u = updates.find(x => x.id === i.id);
      return u ? { ...i, parent_id: u.parent_id, wbs_code: u.wbs_code } : i;
    }));
    Promise.all(updates.map(u => wbsMutation.mutateAsync({ action: 'update', id: u.id, data: { parent_id: u.parent_id, wbs_code: u.wbs_code } })))
      .then(() => queryClient.invalidateQueries({ queryKey: ['WBSItem'] }));
  }

  // ── Editor save ────────────────────────────────────────────────────────────
  function onEditorSave(row, form) {
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
  async function captureCanvas() {
    setExporting(e => e || 'png');
    // Reframe the timeline to the project's actual activity span (start → end)
    // so the export focuses only on project activities, not empty/padded space.
    setTimelineStart(bounds.start);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const el = scrollRef.current;
    const inner = el.firstChild;
    const canvas = await html2canvas(inner, { backgroundColor: '#ffffff', width: inner.scrollWidth, height: inner.scrollHeight, windowWidth: inner.scrollWidth, windowHeight: inner.scrollHeight, scale: 1 });
    setExporting(null);
    return canvas;
  }
  async function exportPNG() {
    try { setExporting('png'); const canvas = await captureCanvas();
      const link = document.createElement('a');
      link.href = canvas.toDataURL('image/png');
      link.download = `gantt_${(project?.code || 'project')}_${new Date().toISOString().slice(0,10)}.png`;
      link.click();
    } catch (e) { console.error(e); setExporting(null); }
  }
  async function exportPDF() {
    try { setExporting('pdf'); const canvas = await captureCanvas();
      const img = canvas.toDataURL('image/jpeg', 0.92);
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
      const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
      const m = 18;
      const aw = pw - m * 2, ah = ph - m * 2;
      const ratio = Math.min(aw / canvas.width, ah / canvas.height);
      const w = canvas.width * ratio, h = canvas.height * ratio;
      pdf.addImage(img, 'JPEG', m + (aw - w) / 2, m + (ah - h) / 2, w, h);
      pdf.save(`gantt_${(project?.code || 'project')}_${new Date().toISOString().slice(0,10)}.pdf`);
    } catch (e) { console.error(e); setExporting(null); }
  }
  function exportExcel() {
    const data = wbsItems.filter(w => w.planned_start || w.planned_end).map(w => ({
      'WBS Code': w.wbs_code || '',
      'Task Name': w.name || '',
      'Start': w.planned_start || '',
      'Finish': w.planned_end || '',
      'Duration (days)': (w.planned_start && w.planned_end) ? daysBetween(w.planned_start, w.planned_end) : '',
      '% Complete': w.progress || 0,
      'Assignee': w.assignee || '',
      'Dependencies': (w.predecessor_ids || []).map(id => wbsById[id]?.wbs_code || id).join(', '),
      'Critical': cpm.criticalIds.has(w.id) ? 'Yes' : '',
      'Slack (days)': cpm.float.get(w.id) || 0,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
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
    <div ref={containerRef} className="flex flex-col h-full">
      <GanttToolbar
        scaleKey={scaleKey} setScaleKey={setScaleKey}
        onPan={pan} onFit={fitToProject} onToday={jumpToToday} onJumpStart={jumpToStart}
        onExpandAll={expandAll} onCollapseAll={collapseAll}
        showDeps={showDeps} setShowDeps={setShowDeps} showCritical={showCritical} setShowCritical={setShowCritical}
        criticalCount={cpm.criticalIds.size} projectDuration={cpm.projectDurationDays} projectFinish={cpm.projectFinish}
        fullscreen={fullscreen} toggleFullscreen={() => setFullscreen(v => !v)}
        onExportPNG={exportPNG} onExportPDF={exportPDF} onExportExcel={exportExcel} exporting={exporting}
        onEstimate={() => setAiModal('estimate')} onOptimize={() => setAiModal('optimize')}
      />
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-auto border border-slate-200 rounded-lg bg-white relative" style={{ minHeight: 320 }}>
        <div style={{ width: innerWidth, position: 'relative' }} className="flex flex-col">
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
              onMoveItem={onMoveItem} onResizeItem={onResizeItem} onOpenEditor={setEditorRow}
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

      {aiModal && (
        <ScheduleAssistantModal
          projectId={projectId}
          initialFlow={aiModal}
          onClose={() => setAiModal(null)}
          onApplied={() => queryClient.invalidateQueries({ queryKey: ['WBSItem'] })}
        />
      )}
    </>
  );
}