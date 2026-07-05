/**
 * smartScheduleAnalysis
 *
 * One comprehensive schedule analysis. Reuses the deterministic engines from
 * scheduleAssistant (delay detection + dependency cascade) and estimateWBSDurations
 * (duration estimation + parent rollups), runs CPM for critical-path / float
 * awareness, then feeds the FULL project lifecycle (budget, procurement, change
 * orders, risks, milestones) plus the deterministic findings to an LLM that
 * SYNTHESIZES ranked, specific, actionable recommendations.
 *
 * Returns a review payload only — applying changes stays with applyWBSBatch.
 *
 * Auth: enforced. An unauthenticated caller is rejected (401) before any LLM call
 * so the endpoint can't be used to burn tokens anonymously.
 *
 * Input:  { project_id }
 * Output: { executive_summary, health_score, projected_finish, planned_finish,
 *           insights[], wbs_date_suggestions[], duration_estimates[],
 *           milestone_impacts[], procurement_gates[], notice? }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const BUSINESS_TZ = 'Asia/Riyadh';
function tzDateStr(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: BUSINESS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value || '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function toISO(d) { return tzDateStr(new Date(d)); }
function addDays(date, n) { const d = new Date(date); d.setDate(d.getDate() + n); return d; }
function daysBetween(a, b) {
  if (!a || !b) return 0;
  const da = new Date(a); da.setHours(0, 0, 0, 0);
  const db = new Date(b); db.setHours(0, 0, 0, 0);
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}
function workingDaysBetween(a, b) {
  if (!a || !b) return 0;
  let count = 0;
  const start = new Date(a < b ? a : b);
  const end = new Date(a < b ? b : a);
  const cur = new Date(start);
  while (cur <= end) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return a <= b ? count : -count;
}
function addWorkingDays(dateStr, days) {
  const d = new Date(dateStr);
  let added = 0;
  while (added < Math.abs(days)) {
    d.setDate(d.getDate() + (days >= 0 ? 1 : -1));
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return tzDateStr(d);
}
function addWorkingDaysDate(startDate, n) {
  const d = new Date(startDate);
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}
function rollToWorkday(d) {
  const dow = d.getDay();
  if (dow === 6) d.setDate(d.getDate() + 2);
  else if (dow === 0) d.setDate(d.getDate() + 1);
  return d;
}
function maxDate(dates) {
  const ts = dates.filter(Boolean).map((d) => new Date(d).getTime());
  return ts.length ? new Date(Math.max(...ts)) : null;
}
function durDays(w) {
  if (!w.planned_start || !w.planned_end) return null;
  return Math.max(1, Math.round((new Date(w.planned_end) - new Date(w.planned_start)) / 86400000));
}

// ── Critical Path Method (forward / backward pass) — reused from scheduleChat ─
function computeCPM(items) {
  const scheduled = items.filter((w) => w.planned_start && w.planned_end);
  if (scheduled.length === 0) return { criticalIds: new Set(), float: new Map(), projectFinish: null };
  const byId = Object.fromEntries(scheduled.map((i) => [i.id, i]));
  const epoch = new Date(Math.min(...scheduled.map((i) => new Date(i.planned_start).getTime())));
  const dur = (id) => Math.max(1, daysBetween(byId[id].planned_start, byId[id].planned_end));
  const startOffset = (id) => daysBetween(epoch, byId[id].planned_start);
  const successors = {};
  scheduled.forEach((i) => {
    (i.predecessor_ids || []).forEach((predId) => { if (byId[predId]) (successors[predId] ||= []).push(i.id); });
  });
  const inDeg = {};
  scheduled.forEach((i) => { inDeg[i.id] = (i.predecessor_ids || []).filter((p) => byId[p]).length; });
  const queue = scheduled.filter((i) => inDeg[i.id] === 0).map((i) => i.id);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    (successors[id] || []).forEach((sid) => {
      inDeg[sid] = (inDeg[sid] || 0) - 1;
      if (inDeg[sid] === 0) queue.push(sid);
    });
  }
  const es = {}, ef = {};
  order.forEach((id) => {
    const preds = (byId[id].predecessor_ids || []).filter((p) => byId[p]);
    es[id] = preds.length === 0 ? startOffset(id) : Math.max(...preds.map((p) => ef[p] ?? 0));
    ef[id] = es[id] + dur(id);
  });
  const projectDuration = Math.max(...Object.values(ef));
  const lf = {}, ls = {};
  [...order].reverse().forEach((id) => {
    const succs = (successors[id] || []).filter((s) => byId[s]);
    lf[id] = succs.length === 0 ? projectDuration : Math.min(...succs.map((s) => ls[s] ?? Infinity));
    ls[id] = lf[id] - dur(id);
  });
  const criticalIds = new Set();
  const float = new Map();
  scheduled.forEach((i) => {
    const totalFloat = (ls[i.id] ?? 0) - (es[i.id] ?? 0);
    float.set(i.id, Math.max(0, Math.round(totalFloat * 10) / 10));
    if (Math.abs(totalFloat) <= 0.5) criticalIds.add(i.id);
  });
  return { criticalIds, float, projectFinish: addDays(epoch, projectDuration) };
}

// ── Delay detection + dependency cascade — reused from scheduleAssistant ─────
// Conflict test is STRICTLY-EARLIER (<): same-day handoffs (successor start ==
// predecessor end) are valid, matching the Gantt banner and scheduleChat.
function detectDelaysAndCascade(items, today) {
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  const delays = [];
  for (const item of items) {
    if (item.actual_start && item.planned_start && item.actual_start > item.planned_start) {
      const d = workingDaysBetween(item.planned_start, item.actual_start);
      if (d > 0) delays.push({ item, delayDays: d, reason: `Actual start (${item.actual_start}) is ${d} working days late` });
    }
    if (!item.actual_start && item.planned_start && item.planned_start < today && item.status !== 'completed') {
      const d = workingDaysBetween(item.planned_start, today);
      if (d > 2) delays.push({ item, delayDays: d, reason: `Not started — planned start was ${item.planned_start} (${d} working days ago)` });
    }
  }
  const getEffectiveDuration = (item) =>
    (item.planned_start && item.planned_end) ? Math.max(1, workingDaysBetween(item.planned_start, item.planned_end)) : 5;

  const dependents = {};
  for (const item of items) for (const pid of (item.predecessor_ids || [])) { (dependents[pid] ||= []).push(item.id); }

  const suggested = {};
  for (const { item, delayDays, reason } of delays) {
    const newStart = item.actual_start || addWorkingDays(item.planned_start, delayDays);
    const dur = getEffectiveDuration(item);
    const newEnd = addWorkingDays(newStart, dur);
    suggested[item.id] = {
      planned_start: newStart, planned_end: newEnd, shift_days: delayDays, reason,
      original_start: item.planned_start, original_end: item.planned_end,
      name: item.name, wbs_code: item.wbs_code,
    };
  }

  const queue = delays.map((d) => d.item.id);
  const visited = new Set(queue);
  while (queue.length > 0) {
    const currentId = queue.shift();
    const currentSuggested = suggested[currentId];
    if (!currentSuggested) continue;
    const successors = dependents[currentId] || [];
    for (const sucId of successors) {
      const suc = byId[sucId];
      if (!suc) continue;
      // Same-day handoff is valid: successor may start ON the predecessor's end.
      const requiredStart = currentSuggested.planned_end;
      const sucCurrentStart = (suggested[sucId]?.planned_start) || suc.planned_start || requiredStart;
      if (sucCurrentStart < requiredStart) { // strictly earlier → conflict
        const shiftDays = workingDaysBetween(sucCurrentStart, requiredStart);
        const dur = getEffectiveDuration(suc);
        const newEnd = addWorkingDays(requiredStart, dur);
        suggested[sucId] = {
          planned_start: requiredStart, planned_end: newEnd, shift_days: shiftDays,
          reason: `Cascaded from delayed predecessor "${byId[currentId]?.name || currentId}"`,
          original_start: suc.planned_start, original_end: suc.planned_end,
          name: suc.name, wbs_code: suc.wbs_code,
        };
        if (!visited.has(sucId)) { visited.add(sucId); queue.push(sucId); }
      }
    }
  }
  return suggested;
}

// ── Duration estimation + parent rollups — reused from estimateWBSDurations ──
async function estimateDurations(base44, wbs, project) {
  const byId = {};
  wbs.forEach((w) => { byId[w.id] = w; });
  const childMap = {};
  wbs.forEach((w) => { if (w.parent_id) { (childMap[w.parent_id] ||= []).push(w); } });
  const hasChildren = (id) => (childMap[id] || []).length > 0;

  const undated = wbs.filter((w) =>
    !hasChildren(w.id) &&
    (!w.planned_start || !w.planned_end || (w.planned_start && w.planned_end && w.planned_start === w.planned_end))
  );
  const dated = wbs
    .filter((w) => w.planned_start && w.planned_end && w.planned_start !== w.planned_end)
    .map((w) => ({ name: w.name, wbs_code: w.wbs_code || '', days: durDays(w) }));
  const noCalibration = dated.length === 0;

  const projectType = project?.project_type || 'plc';
  const typeHint = {
    plc: 'PLC / control panel build', plc_scada: 'PLC + SCADA integration',
    pme: 'power management & electrical', service: 'field service / commissioning',
    other: 'industrial automation',
  }[projectType] || 'industrial automation';

  const undatedCtx = undated.map((w) => {
    const preds = (w.predecessor_ids || []).map((id) => byId[id]).filter(Boolean);
    return {
      wbs_id: w.id, wbs_code: w.wbs_code || '', name: w.name || '',
      description: (w.description || '').slice(0, 300), status: w.status || '', weight: w.weight || 0,
      has_planned_start: !!w.planned_start, planned_start: w.planned_start || null,
      predecessors: preds.map((p) => ({ wbs_code: p.wbs_code || '', name: p.name, planned_end: p.planned_end || null, days: durDays(p) })),
    };
  });

  let aiResults = [];
  if (undated.length > 0) {
    let estimates = [];
    try {
      const llmRes = await base44.asServiceRole.integrations.Core.InvokeLLM({
        model: 'gemini_3_flash',
        prompt: [
          `You are a senior project planner for industrial automation projects (${typeHint}).`,
          `Tasks span PLC programming, SCADA, control-panel build, wiring, testing, FAT/SAT, and commissioning.`,
          `Below are WBS activities with NO planned end date. Estimate a realistic DURATION IN WORKING DAYS (minimum 1) for each,`,
          `using the project's already-dated activities as a calibration baseline.`,
          `DATED ACTIVITIES (calibration baseline — name: working-day duration):`,
          dated.length ? dated.map((d) => `- ${d.wbs_code ? d.wbs_code + ' ' : ''}${d.name}: ${d.days} day(s)`).join('\n') : '- (none yet — use domain judgement)',
          `UNDATED ACTIVITIES TO ESTIMATE:`, JSON.stringify(undatedCtx, null, 2),
          `Return JSON { "estimates": [ {wbs_id, estimated_duration_days, reason, confidence} ] }`,
          `where estimated_duration_days is an integer >= 1, reason is one short line citing the calibration basis,`,
          `confidence is "low" | "medium" | "high".`,
        ].join('\n'),
        response_json_schema: {
          type: 'object',
          properties: {
            estimates: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  wbs_id: { type: 'string' },
                  estimated_duration_days: { type: 'integer' },
                  reason: { type: 'string' },
                  confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
                },
                required: ['wbs_id', 'estimated_duration_days', 'reason', 'confidence'],
              },
            },
          },
          required: ['estimates'],
        },
      });
      estimates = llmRes?.estimates || [];
    } catch (_) { estimates = []; /* resilient: fall back below */ }

    const estMap = new Map((estimates || []).map((e) => [e.wbs_id, e]));
    const avgDays = dated.length ? Math.max(1, Math.round(dated.reduce((s, d) => s + d.days, 0) / dated.length)) : 3;
    const projectStart = project?.start_date || null;
    aiResults = undated.map((item) => {
      const e = estMap.get(item.id) || {
        estimated_duration_days: avgDays,
        reason: noCalibration ? `fallback: rough domain guess (~${avgDays} day${avgDays === 1 ? '' : 's'})` : `fallback: project average (~${avgDays} day${avgDays === 1 ? '' : 's'})`,
        confidence: 'low',
      };
      const dur = Math.max(1, Math.round(e.estimated_duration_days || 1));
      const conf = noCalibration ? 'low' : (e.confidence || 'medium');
      let start;
      if (item.planned_start) {
        start = new Date(item.planned_start);
      } else {
        const preds0 = (item.predecessor_ids || []).map((id) => byId[id]).filter(Boolean);
        const predEnds0 = preds0.map((p) => p.planned_end ? new Date(p.planned_end) : null).filter(Boolean);
        if (predEnds0.length) {
          start = new Date(Math.max(...predEnds0.map((d) => d.getTime())));
          start.setDate(start.getDate() + 1);
        } else {
          start = projectStart ? new Date(projectStart) : new Date();
        }
      }
      const preds = (item.predecessor_ids || []).map((id) => byId[id]).filter(Boolean);
      const predEnds = preds.map((p) => p.planned_end ? new Date(p.planned_end) : null).filter(Boolean);
      if (predEnds.length) {
        const latestPred = new Date(Math.max(...predEnds.map((d) => d.getTime())));
        if (start.getTime() <= latestPred.getTime()) {
          start = new Date(latestPred);
          start.setDate(start.getDate() + 1);
        }
      }
      rollToWorkday(start);
      const end = addWorkingDaysDate(start, dur);
      return {
        wbs_id: item.id, wbs_code: item.wbs_code || '', item_name: item.name,
        predecessors: preds.map((p) => p.wbs_code || p.name).join(', '),
        proposed_start: toISO(start), proposed_end: toISO(end),
        estimated_duration_days: dur, reason: e.reason || '', confidence: conf,
        had_planned_start: !!item.planned_start, is_rollup: false,
      };
    });
  }

  // Parent rollups (deterministic) — deepest-first so nested parents resolve.
  const proposedBy = {};
  aiResults.forEach((r) => { proposedBy[r.wbs_id] = { start: r.proposed_start, end: r.proposed_end }; });
  const dateOf = (w) => (w.planned_start && w.planned_end) ? { start: w.planned_start, end: w.planned_end } : (proposedBy[w.id] || null);
  const depthOf = {};
  const depth = (id) => {
    if (depthOf[id] != null) return depthOf[id];
    const w = byId[id];
    depthOf[id] = w && w.parent_id ? 1 + depth(w.parent_id) : 0;
    return depthOf[id];
  };
  const rollups = [];
  wbs.filter((w) => hasChildren(w.id)).sort((a, b) => depth(b.id) - depth(a.id)).forEach((w) => {
    const kids = childMap[w.id] || [];
    const kidDates = kids.map(dateOf).filter(Boolean);
    if (kidDates.length === 0) return;
    const starts = kidDates.map((d) => d.start).sort();
    const ends = kidDates.map((d) => d.end).sort();
    const minStart = starts[0];
    const maxEnd = ends[ends.length - 1];
    proposedBy[w.id] = { start: minStart, end: maxEnd };
    if (w.planned_start === minStart && w.planned_end === maxEnd) return;
    const d = Math.max(1, Math.round((new Date(maxEnd) - new Date(minStart)) / 86400000));
    const preds = (w.predecessor_ids || []).map((id) => byId[id]).filter(Boolean);
    rollups.push({
      wbs_id: w.id, wbs_code: w.wbs_code || '', item_name: w.name,
      predecessors: preds.map((p) => p.wbs_code || p.name).join(', '),
      proposed_start: minStart, proposed_end: maxEnd, estimated_duration_days: d,
      reason: `rolled up from ${kids.length} child activit${kids.length === 1 ? 'y' : 'ies'}`,
      confidence: 'high', had_planned_start: !!w.planned_start, is_rollup: true,
    });
  });

  return [...rollups, ...aiResults];
}

// ── Procurement-gate scan: long-lead POs delivered after the task that needs them ─
function detectProcurementGates(items, purchaseOrders) {
  const gateKeywords = ['panel', 'install', 'wire', 'wiring', 'build', 'assemble', 'assembly', 'mount', 'fat', 'sat', 'commission', 'integrate', 'erection', 'connect', 'test'];
  const gates = [];
  for (const po of purchaseOrders) {
    if (po.status === 'delivered' || po.status === 'cancelled') continue;
    const delivery = po.expected_delivery_date || po.actual_delivery_date;
    if (!delivery) continue;
    for (const w of items) {
      if (!w.planned_start) continue;
      const name = ((w.name || '') + ' ' + (w.description || '')).toLowerCase();
      if (w.planned_start < delivery && gateKeywords.some((k) => name.includes(k))) {
        const slip = daysBetween(w.planned_start, delivery);
        if (slip > 0) {
          gates.push({
            po_number: po.po_number || po.description || 'PO',
            vendor: po.vendor_name || '',
            expected_delivery: delivery,
            gating_task_wbs_code: w.wbs_code || '',
            gating_task_name: w.name,
            gating_task_start: w.planned_start,
            slip_days: slip,
            critical: false,
          });
        }
      }
    }
  }
  gates.sort((a, b) => b.slip_days - a.slip_days);
  return gates.slice(0, 10);
}

Deno.serve(async (req) => {
  try {
    // ── Auth (enforced — no anonymous LLM calls) ──────────────────────────
    const base44 = createClientFromRequest(req);
    let user;
    try { user = await base44.auth.me(); } catch (_) { user = null; }
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { project_id } = await req.json();
    if (!project_id) return Response.json({ error: 'project_id required' }, { status: 400 });

    // ── Load the full project lifecycle (parallel, guarded) ───────────────
    const safe = (p) => p.then((v) => v).catch(() => []);
    const [projectArr, items, milestones, risks, changeOrders, purchaseOrders, bomItems, invoices] = await Promise.all([
      safe(base44.asServiceRole.entities.Project.filter({ id: project_id })),
      safe(base44.asServiceRole.entities.WBSItem.filter({ project_id }, 'wbs_code', 2000)),
      safe(base44.asServiceRole.entities.Milestone.filter({ project_id }, 'planned_date', 500)),
      safe(base44.asServiceRole.entities.Risk.filter({ project_id }, '-created_date', 200)),
      safe(base44.asServiceRole.entities.ChangeOrder.filter({ project_id }, '-created_date', 200)),
      safe(base44.asServiceRole.entities.PurchaseOrder.filter({ project_id }, '-expected_delivery_date', 500)),
      safe(base44.asServiceRole.entities.BOMItem.filter({ project_id }, 'category', 1000)),
      safe(base44.asServiceRole.entities.Invoice.filter({ project_id }, 'planned_date', 200)),
    ]);
    const project = projectArr[0] || null;
    if (!project && items.length === 0) {
      return Response.json({ error: 'Project not found or has no WBS items.' }, { status: 404 });
    }

    const today = toISO(new Date());
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));

    // ── Deterministic engines ─────────────────────────────────────────────
    const cpm = computeCPM(items);
    const delaySuggested = detectDelaysAndCascade(items, today);
    const durationEstimates = await estimateDurations(base44, items, project);

    // Projected finish = latest of all current ends, delay-cascade ends, and
    // duration-estimate proposed ends.
    const allEnds = [
      ...items.map((i) => i.planned_end),
      ...Object.values(delaySuggested).map((s) => s.planned_end),
      ...durationEstimates.map((d) => d.proposed_end),
    ].filter(Boolean);
    const projectedFinish = toISO(maxDate(allEnds) || project?.target_completion_date || today);
    const plannedFinish = project?.target_completion_date || toISO(maxDate(items.map((i) => i.planned_end)) || projectedFinish);

    // Milestone impacts (undetermined by delay cascade vs milestone dates)
    const milestoneImpacts = [];
    for (const ms of milestones) {
      if (!ms.planned_date || ms.status === 'completed') continue;
      if (projectedFinish > ms.planned_date) {
        milestoneImpacts.push({
          milestone_id: ms.id, milestone_title: ms.title,
          original_date: ms.planned_date, suggested_date: projectedFinish,
          shift_days: workingDaysBetween(ms.planned_date, projectedFinish),
        });
      }
    }

    // Procurement gates
    const procurementGates = detectProcurementGates(items, purchaseOrders);

    // ── Schedule-health metrics ───────────────────────────────────────────
    const total = items.length;
    const withDates = items.filter((i) => i.planned_start && i.planned_end).length;
    const undatedCount = total - withDates;
    const avgProgress = total ? Math.round(items.reduce((s, i) => s + (i.progress || 0), 0) / total) : 0;
    const delayedCount = Object.keys(delaySuggested).length;
    const cascadeSlip = Math.max(0, ...Object.values(delaySuggested).map((s) => s.shift_days || 0));
    const criticalCount = cpm.criticalIds.size;

    // ── Cost context ──────────────────────────────────────────────────────
    const contractValue = project?.contract_value || 0;
    const committedPO = purchaseOrders.filter((p) => p.status !== 'cancelled').reduce((s, p) => s + (p.amount || 0), 0);
    const actualCost = items.reduce((s, i) => s + (i.actual_cost || 0), 0);
    const plannedCost = items.reduce((s, i) => s + (i.planned_cost || 0), 0);

    // ── Build the deterministic findings arrays for the UI ────────────────
    const wbsDateSuggestions = Object.entries(delaySuggested).map(([id, s]) => ({ id, ...s }));

    // ── Build a compact but complete LLM context ──────────────────────────
    const itemFacts = items.slice(0, 200).map((w) => {
      const preds = (w.predecessor_ids || []).map((pid) => byId[pid]).filter(Boolean);
      return {
        wbs_code: w.wbs_code || '', name: w.name || '',
        planned_start: w.planned_start || null, planned_end: w.planned_end || null,
        status: w.status || 'not_started', progress: w.progress || 0,
        float_days: cpm.float.has(w.id) ? cpm.float.get(w.id) : null,
        critical: cpm.criticalIds.has(w.id),
        predecessors: preds.map((p) => `${p.wbs_code} ${p.name} (end ${p.actual_end || p.planned_end || '?'})`),
      };
    });

    const openRisks = risks.filter((r) => r.status === 'open' || r.status === 'mitigated');
    const pendingCOs = changeOrders.filter((c) => c.status === 'pending' || c.status === 'submitted');

    const factsBlob = [
      `PROJECT: ${project?.name || project_id} (${project?.code || ''}) — type ${project?.project_type || '?'}, status ${project?.status || '?'}, progress ${project?.progress || 0}%.`,
      `Project start: ${project?.start_date || '?'}. Target completion: ${plannedFinish}.`,
      `COMPUTED PROJECTED FINISH (deterministic): ${projectedFinish}.`,
      `Today: ${today}.`,
      ``,
      `SCHEDULE HEALTH:`,
      `Total tasks: ${total}. With dates: ${withDates} (${total ? Math.round(withDates * 100 / total) : 0}%). Undated: ${undatedCount}.`,
      `Average progress: ${avgProgress}%. Critical-path tasks: ${criticalCount}. Delayed/cascaded: ${delayedCount}. Max cascade slip: ${cascadeSlip} working days.`,
      ``,
      `COST CONTEXT:`,
      `Contract value: ${contractValue} ${project?.currency || ''}. Committed POs: ${committedPO}. Planned cost: ${plannedCost}. Actual cost: ${actualCost}.`,
      ``,
      `CRITICAL PATH ITEMS: ${[...cpm.criticalIds].map((id) => byId[id]?.wbs_code).filter(Boolean).join(', ') || 'none'}.`,
      ``,
      `DETERMINISTIC DELAY/CASCADE FINDINGS (${wbsDateSuggestions.length}):`,
      wbsDateSuggestions.length ? wbsDateSuggestions.map((s) => `- ${s.wbs_code} ${s.name}: ${s.original_start || '?'}→${s.original_end || '?'} ⇒ ${s.planned_start}→${s.planned_end} (+${s.shift_days}d) — ${s.reason}`).join('\n') : '- none',
      ``,
      `DURATION ESTIMATES (${durationEstimates.length}):`,
      durationEstimates.length ? durationEstimates.map((d) => `- ${d.wbs_code} ${d.item_name}: ${d.proposed_start}→${d.proposed_end} (${d.estimated_duration_days}d, ${d.confidence}${d.is_rollup ? ', rollup' : ''}) — ${d.reason}`).join('\n') : '- none',
      ``,
      `MILESTONE IMPACTS (${milestoneImpacts.length}):`,
      milestoneImpacts.length ? milestoneImpacts.map((m) => `- ${m.milestone_title}: ${m.original_date} ⇒ ${m.suggested_date} (+${m.shift_days}d)`).join('\n') : '- none',
      ``,
      `PROCUREMENT GATES (${procurementGates.length}) — PO delivered AFTER the task that needs it starts:`,
      procurementGates.length ? procurementGates.map((g) => `- PO ${g.po_number}${g.vendor ? ' (' + g.vendor + ')' : ''} expected ${g.expected_delivery} gates task ${g.gating_task_wbs_code} "${g.gating_task_name}" (starts ${g.gating_task_start}, +${g.slip_days}d)`).join('\n') : '- none',
      ``,
      `OPEN RISKS (${openRisks.length}):`,
      openRisks.length ? openRisks.slice(0, 15).map((r) => `- [${r.probability}/${r.impact}] ${r.title} — ${r.mitigation_plan || r.description || ''}`).join('\n') : '- none',
      ``,
      `PENDING CHANGE ORDERS (${pendingCOs.length}):`,
      pendingCOs.length ? pendingCOs.slice(0, 10).map((c) => `- ${c.title}: +${c.impact_cost} cost, +${c.impact_days}d (status ${c.status})`).join('\n') : '- none',
      ``,
      `WBS ITEMS (computed — first 200):`,
      JSON.stringify(itemFacts, null, 2),
    ].join('\n');

    // ── Synthesis LLM call ────────────────────────────────────────────────
    let synthesis = {
      executive_summary: `Projected finish ${projectedFinish} vs planned ${plannedFinish}. ${delayedCount} delayed/cascaded task(s), ${criticalCount} on the critical path, ${undatedCount} undated. Review the apply tables below.`,
      health_score: Math.max(0, Math.min(100, 100 - delayedCount * 5 - undatedCount * 3 - (cascadeSlip * 2) - (criticalCount > 0 && delayedCount > 0 ? 10 : 0))),
      projected_finish: projectedFinish,
      planned_finish: plannedFinish,
      insights: [],
    };
    try {
      const llmRes = await base44.asServiceRole.integrations.Core.InvokeLLM({
        model: 'gemini_3_flash',
        prompt: [
          `You are a senior project planner for industrial automation projects (PLC/SCADA/panel build/commissioning).`,
          `You are given EXACT, precomputed schedule facts plus the full project lifecycle (budget, procurement, change orders, risks, milestones).`,
          `Your job is to SYNTHESIZE and PRIORITIZE — do NOT recompute dates. Produce ranked, SPECIFIC, ACTIONABLE recommendations.`,
          ``,
          `RULES:`,
          `- Every insight must cite concrete WBS codes / PO numbers / dates and a concrete action with a quantified day or cost impact.`,
          `- Never write generic advice like "consider optimizing" — name the item and the step.`,
          `- Same-day handoffs (successor start == predecessor end) are VALID; only flag a start that is STRICTLY EARLIER than its predecessor's end.`,
          `- severity is critical/high/medium/low. Order insights by severity (critical first).`,
          `- category must be one of: critical_path | delay_cascade | resource_conflict | procurement_gate | milestone_risk | scope_change | undated_work | cost_schedule.`,
          `- health_score 0-100: weight by critical-path slip, delayed %, undated %, and risk exposure. >=80 healthy, 50-79 at risk, <50 critical.`,
          `- executive_summary: 3-4 plain sentences — is the project on track, the single biggest threat, projected vs planned finish.`,
          ``,
          factsBlob,
          ``,
          `Return JSON matching the requested schema.`,
        ].join('\n'),
        response_json_schema: {
          type: 'object',
          properties: {
            executive_summary: { type: 'string' },
            health_score: { type: 'integer' },
            projected_finish: { type: 'string' },
            planned_finish: { type: 'string' },
            insights: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  category: { type: 'string', enum: ['critical_path', 'delay_cascade', 'resource_conflict', 'procurement_gate', 'milestone_risk', 'scope_change', 'undated_work', 'cost_schedule'] },
                  severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
                  title: { type: 'string' },
                  detail: { type: 'string' },
                  recommended_action: { type: 'string' },
                  quantified_impact: { type: 'string' },
                  affected_wbs_codes: { type: 'array', items: { type: 'string' } },
                  affected_milestone_ids: { type: 'array', items: { type: 'string' } },
                },
                required: ['id', 'category', 'severity', 'title', 'detail', 'recommended_action', 'quantified_impact'],
              },
            },
          },
          required: ['executive_summary', 'health_score', 'projected_finish', 'planned_finish', 'insights'],
        },
      });
      if (llmRes) {
        synthesis = {
          executive_summary: String(llmRes.executive_summary || synthesis.executive_summary),
          health_score: Math.max(0, Math.min(100, Number(llmRes.health_score ?? synthesis.health_score))),
          projected_finish: String(llmRes.projected_finish || projectedFinish),
          planned_finish: String(llmRes.planned_finish || plannedFinish),
          insights: Array.isArray(llmRes.insights) ? llmRes.insights : [],
        };
      }
    } catch (_) { /* resilient: keep deterministic findings + fallback synthesis */ }

    return Response.json({
      ...synthesis,
      wbs_date_suggestions: wbsDateSuggestions,
      duration_estimates: durationEstimates,
      milestone_impacts: milestoneImpacts,
      procurement_gates: procurementGates,
      schedule_health: {
        total_tasks: total, with_dates: withDates, undated: undatedCount,
        avg_progress: avgProgress, critical_count: criticalCount,
        delayed_count: delayedCount, cascade_slip_days: cascadeSlip,
      },
      cost: { contract_value: contractValue, committed_po: committedPO, planned_cost: plannedCost, actual_cost: actualCost, currency: project?.currency || '' },
      notice: null,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});