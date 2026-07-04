import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Add working days to a date string (skipping weekends)
 */
function addWorkingDays(dateStr, days) {
  const d = new Date(dateStr);
  let added = 0;
  while (added < Math.abs(days)) {
    d.setDate(d.getDate() + (days >= 0 ? 1 : -1));
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

function workingDaysBetween(a, b) {
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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    let user;
    try { user = await base44.auth.me(); } catch (_) { user = null; }
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { project_id, apply } = await req.json();
    if (!project_id) return Response.json({ error: 'project_id required' }, { status: 400 });

    // Fetch all WBS items and milestones for this project
    const [items, milestones] = await Promise.all([
      base44.entities.WBSItem.filter({ project_id }, 'wbs_code', 500),
      base44.entities.Milestone.filter({ project_id }, 'planned_date', 100),
    ]);

    if (items.length === 0) {
      return Response.json({ suggestions: [], summary: 'No WBS items found.' });
    }

    const byId = Object.fromEntries(items.map(i => [i.id, i]));
    const today = new Date().toISOString().slice(0, 10);

    // ── Step 1: Detect delays & compute cascading impacts ──────────────────
    const delays = []; // { item, delayDays, reason }

    for (const item of items) {
      // Check if this item's actual start is later than planned
      if (item.actual_start && item.planned_start && item.actual_start > item.planned_start) {
        const d = workingDaysBetween(item.planned_start, item.actual_start);
        if (d > 0) delays.push({ item, delayDays: d, reason: `Actual start (${item.actual_start}) is ${d} working days late` });
      }
      // Check if in-progress item hasn't started yet but planned start has passed
      if (!item.actual_start && item.planned_start && item.planned_start < today && item.status !== 'completed') {
        const d = workingDaysBetween(item.planned_start, today);
        if (d > 2) delays.push({ item, delayDays: d, reason: `Not started — planned start was ${item.planned_start} (${d} working days ago)` });
      }
    }

    // ── Step 2: Build dependency graph & propagate cascading date shifts ───
    // For each item, compute the effective earliest start date based on predecessors
    function getEffectiveDuration(item) {
      if (item.planned_start && item.planned_end) {
        return Math.max(1, workingDaysBetween(item.planned_start, item.planned_end));
      }
      return 5; // default 5 working days if no dates
    }

    // Topological sort for dependency propagation
    const inDegree = Object.fromEntries(items.map(i => [i.id, (i.predecessor_ids || []).length]));
    const dependents = {}; // predecessorId → [successorId]
    for (const item of items) {
      for (const pid of (item.predecessor_ids || [])) {
        if (!dependents[pid]) dependents[pid] = [];
        dependents[pid].push(item.id);
      }
    }

    // Build suggested dates map
    const suggested = {}; // id → { planned_start, planned_end, shift_days, reason }

    // Seed with delayed items
    for (const { item, delayDays, reason } of delays) {
      const newStart = item.actual_start || addWorkingDays(item.planned_start, delayDays);
      const dur = getEffectiveDuration(item);
      const newEnd = addWorkingDays(newStart, dur);
      suggested[item.id] = {
        planned_start: newStart,
        planned_end: newEnd,
        shift_days: delayDays,
        reason,
        original_start: item.planned_start,
        original_end: item.planned_end,
        name: item.name,
        wbs_code: item.wbs_code,
      };
    }

    // BFS/queue to propagate to successors
    const queue = delays.map(d => d.item.id);
    const visited = new Set(queue);

    while (queue.length > 0) {
      const currentId = queue.shift();
      const currentSuggested = suggested[currentId];
      if (!currentSuggested) continue;

      const successors = dependents[currentId] || [];
      for (const sucId of successors) {
        const suc = byId[sucId];
        if (!suc) continue;

        // Successor can't start until this item ends
        const requiredStart = addWorkingDays(currentSuggested.planned_end, 1);
        const sucCurrentStart = (suggested[sucId]?.planned_start) || suc.planned_start || requiredStart;

        if (requiredStart > sucCurrentStart) {
          const shiftDays = workingDaysBetween(sucCurrentStart, requiredStart);
          const dur = getEffectiveDuration(suc);
          const newEnd = addWorkingDays(requiredStart, dur);
          suggested[sucId] = {
            planned_start: requiredStart,
            planned_end: newEnd,
            shift_days: shiftDays,
            reason: `Cascaded from delayed predecessor "${byId[currentId]?.name || currentId}"`,
            original_start: suc.planned_start,
            original_end: suc.planned_end,
            name: suc.name,
            wbs_code: suc.wbs_code,
          };
          if (!visited.has(sucId)) {
            visited.add(sucId);
            queue.push(sucId);
          }
        }
      }
    }

    // ── Step 3: AI-enhanced suggestions for items without dependencies ─────
    const noDateItems = items.filter(i =>
      !i.planned_start && !suggested[i.id] && i.status !== 'completed'
    );

    let aiSuggestions = {};
    if (noDateItems.length > 0 && noDateItems.length <= 30) {
      const context = items
        .filter(i => i.planned_start)
        .map(i => `${i.wbs_code} "${i.name}": ${i.planned_start} → ${i.planned_end || '?'}, status: ${i.status}`)
        .join('\n');

      const llmResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
        model: 'gemini_3_flash',
        prompt: `You are a project scheduling expert for industrial automation projects. 
        
Existing scheduled WBS items:
${context}

Unscheduled items (need start/end date suggestions):
${noDateItems.map(i => `- ${i.wbs_code} "${i.name}" (predecessors: ${(i.predecessor_ids || []).map(pid => byId[pid]?.name || pid).join(', ') || 'none'})`).join('\n')}

Today's date: ${today}

For each unscheduled item, suggest realistic planned_start and planned_end dates (YYYY-MM-DD format) based on:
1. Dependencies — it must start after all predecessors end
2. Logical sequencing for industrial/automation projects
3. Typical durations for each type of task
4. The overall project timeline context

Return only valid JSON.`,
        response_json_schema: {
          type: 'object',
          properties: {
            suggestions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  wbs_code: { type: 'string' },
                  planned_start: { type: 'string' },
                  planned_end: { type: 'string' },
                  reasoning: { type: 'string' }
                }
              }
            }
          }
        }
      });

      for (const s of (llmResult?.suggestions || [])) {
        const item = noDateItems.find(i => i.wbs_code === s.wbs_code);
        if (item) {
          aiSuggestions[item.id] = {
            planned_start: s.planned_start,
            planned_end: s.planned_end,
            shift_days: 0,
            reason: s.reasoning || 'AI-suggested based on project timeline',
            original_start: null,
            original_end: null,
            name: item.name,
            wbs_code: item.wbs_code,
            ai_suggested: true,
          };
        }
      }
    }

    const allSuggestions = { ...aiSuggestions, ...suggested };

    // ── Step 4: Check milestone impact ─────────────────────────────────────
    const milestoneImpacts = [];
    // Latest suggested end across all items — computed once, reused per milestone.
    const latestEnd = Object.values(allSuggestions)
      .map(s => s.planned_end)
      .filter(Boolean)
      .sort()
      .pop();
    for (const ms of milestones) {
      if (!ms.planned_date || ms.status === 'completed') continue;
      if (latestEnd && latestEnd > ms.planned_date) {
        const shift = workingDaysBetween(ms.planned_date, latestEnd);
        milestoneImpacts.push({
          milestone_id: ms.id,
          milestone_title: ms.title,
          original_date: ms.planned_date,
          suggested_date: latestEnd,
          shift_days: shift,
        });
      }
    }

    // ── Step 5: Apply if requested ─────────────────────────────────────────
    if (apply) {
      const updates = Object.entries(allSuggestions).map(([id, s]) =>
        base44.asServiceRole.entities.WBSItem.update(id, {
          planned_start: s.planned_start,
          planned_end: s.planned_end,
        })
      );
      const msUpdates = milestoneImpacts.map(mi =>
        base44.asServiceRole.entities.Milestone.update(mi.milestone_id, {
          planned_date: mi.suggested_date,
        })
      );
      await Promise.all([...updates, ...msUpdates]);
      return Response.json({ applied: true, updated: Object.keys(allSuggestions).length, milestones_updated: milestoneImpacts.length });
    }

    return Response.json({
      suggestions: Object.entries(allSuggestions).map(([id, s]) => ({ id, ...s })),
      milestone_impacts: milestoneImpacts,
      summary: `Found ${Object.keys(suggested).length} delay-driven adjustment(s) and ${Object.keys(aiSuggestions).length} AI date suggestion(s). ${milestoneImpacts.length} milestone(s) affected.`,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});