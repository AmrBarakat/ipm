import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * scheduleChat
 *
 * A schedule OPTIMIZER, not a commentator. Before calling the LLM it computes the
 * real schedule state with the same critical-path math the Gantt uses (forward /
 * backward pass over WBS items with predecessor_ids): critical items, total float,
 * projected finish, overdue items, dependency conflicts, and unscheduled items.
 * The model then reasons over those COMPUTED facts and returns CONCRETE,
 * dependency-safe date changes the user can review and apply.
 *
 * Input:  { project_id, conversation_id?, user_message }
 * Output:  { conversation_id, answer, proposed_changes[], impact, conflicts_found,
 *            conflicts_resolved, risk_flags[] }
 *
 * Auth: automation callers pass `x-automation-secret` matching AUTOMATION_SECRET;
 *       frontend callers are authenticated via the user token.
 */

// ── Date helpers (calendar days, matching the Gantt CPM) ──────────────────────
function toISO(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(date: Date | string, n: number): Date {
  const d = new Date(date); d.setDate(d.getDate() + n); return d;
}
function daysBetween(a: Date | string, b: Date | string): number {
  if (!a || !b) return 0;
  const da = new Date(a); da.setHours(0, 0, 0, 0);
  const db = new Date(b); db.setHours(0, 0, 0, 0);
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}
function maxDate(dates: (Date | string | null | undefined)[]): Date | null {
  const ts = dates.filter(Boolean).map((d) => new Date(d as string).getTime());
  return ts.length ? new Date(Math.max(...ts)) : null;
}

interface WBS {
  id: string;
  wbs_code: string;
  name: string;
  planned_start?: string;
  planned_end?: string;
  actual_start?: string;
  actual_end?: string;
  status?: string;
  progress?: number;
  predecessor_ids?: string[];
  milestone_id?: string;
  [k: string]: unknown;
}

interface ProposedChange {
  wbs_item_id: string;
  wbs_code: string;
  item_name: string;
  current_start: string;
  current_end: string;
  proposed_start: string;
  proposed_end: string;
  reason: string;
}

// ── Critical Path Method (forward / backward pass) ───────────────────────────
function computeCPM(items: WBS[]) {
  const scheduled = items.filter((w) => w.planned_start && w.planned_end);
  if (scheduled.length === 0) {
    return { criticalIds: new Set<string>(), float: new Map<string, number>(), projectFinish: null as Date | null };
  }
  const byId = Object.fromEntries(scheduled.map((i) => [i.id, i])) as Record<string, WBS>;
  const epoch = new Date(Math.min(...scheduled.map((i) => new Date(i.planned_start!).getTime())));

  const dur = (id: string) => Math.max(1, daysBetween(byId[id].planned_start!, byId[id].planned_end!));
  const startOffset = (id: string) => daysBetween(epoch, byId[id].planned_start!);

  const successors: Record<string, string[]> = {};
  scheduled.forEach((i) => {
    (i.predecessor_ids || []).forEach((predId) => {
      if (byId[predId]) (successors[predId] ||= []).push(i.id);
    });
  });
  const inDeg: Record<string, number> = {};
  scheduled.forEach((i) => { inDeg[i.id] = (i.predecessor_ids || []).filter((p) => byId[p]).length; });
  const queue = scheduled.filter((i) => inDeg[i.id] === 0).map((i) => i.id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    (successors[id] || []).forEach((sid) => {
      inDeg[sid] = (inDeg[sid] || 0) - 1;
      if (inDeg[sid] === 0) queue.push(sid);
    });
  }
  // Forward pass
  const es: Record<string, number> = {}, ef: Record<string, number> = {};
  order.forEach((id) => {
    const preds = (byId[id].predecessor_ids || []).filter((p) => byId[p]);
    es[id] = preds.length === 0 ? startOffset(id) : Math.max(...preds.map((p) => ef[p] ?? 0));
    ef[id] = es[id] + dur(id);
  });
  const projectDuration = Math.max(...Object.values(ef));
  // Backward pass
  const lf: Record<string, number> = {}, ls: Record<string, number> = {};
  [...order].reverse().forEach((id) => {
    const succs = (successors[id] || []).filter((s) => byId[s]);
    lf[id] = succs.length === 0 ? projectDuration : Math.min(...succs.map((s) => ls[s] ?? Infinity));
    ls[id] = lf[id] - dur(id);
  });
  const criticalIds = new Set<string>();
  const float = new Map<string, number>();
  scheduled.forEach((i) => {
    const totalFloat = (ls[i.id] ?? 0) - (es[i.id] ?? 0);
    float.set(i.id, Math.max(0, Math.round(totalFloat * 10) / 10));
    if (Math.abs(totalFloat) <= 0.5) criticalIds.add(i.id);
  });
  return { criticalIds, float, projectFinish: addDays(epoch, projectDuration) };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // ── Auth ──────────────────────────────────────────────────────────────
    const secret = req.headers.get('x-automation-secret');
    const isAutomation = !!secret && secret === Deno.env.get('AUTOMATION_SECRET');
    let user: { full_name?: string; email?: string } | null = null;
    if (!isAutomation) {
      try { user = await base44.auth.me(); } catch (_) { user = null; }
      if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const actor = user ? (user.full_name || user.email || 'user') : 'system';

    // ── Input ─────────────────────────────────────────────────────────────
    const body = await req.json();
    const { project_id, conversation_id, user_message } = body || {};
    if (!project_id || !user_message) {
      return Response.json({ error: 'project_id and user_message are required' }, { status: 400 });
    }

    // Ensure a conversation exists
    let convId = conversation_id;
    if (!convId) {
      const conv = await base44.asServiceRole.entities.Conversation.create({
        project_id,
        title: String(user_message).slice(0, 60) || 'New Conversation',
      });
      convId = conv.id;
    }

    // ── Load schedule context (service role) ──────────────────────────────
    const [projectArr, milestones, wbsItems, priorMessages] = await Promise.all([
      base44.asServiceRole.entities.Project.filter({ id: project_id }),
      base44.asServiceRole.entities.Milestone.filter({ project_id }, 'planned_date', 500),
      base44.asServiceRole.entities.WBSItem.filter({ project_id }, 'wbs_code', 1000),
      base44.asServiceRole.entities.Message.filter({ conversation_id: convId }, 'created_date', 50),
    ]);
    const project = projectArr[0] || null;
    const today = toISO(new Date());

    // ── Step 1: compute the real schedule state ───────────────────────────
    const { criticalIds, float, projectFinish } = computeCPM(wbsItems as WBS[]);
    const byId = Object.fromEntries((wbsItems as WBS[]).map((w) => [w.id, w])) as Record<string, WBS>;

    const overdue: WBS[] = [];
    const unscheduled: WBS[] = [];
    const conflicts: { item: WBS; predecessor: WBS; predFinish: string; itemStart: string }[] = [];
    (wbsItems as WBS[]).forEach((w) => {
      if (!w.planned_start || !w.planned_end) { unscheduled.push(w); return; }
      if (w.planned_end < today && w.status !== 'completed') overdue.push(w);
      (w.predecessor_ids || []).forEach((predId) => {
        const pred = byId[predId];
        if (!pred || !pred.planned_end) return;
        const predFinish = pred.actual_end || pred.planned_end;
        if (w.planned_start! < predFinish) {
          conflicts.push({ item: w, predecessor: pred, predFinish, itemStart: w.planned_start! });
        }
      });
    });

    const currentFinish = projectFinish || maxDate((wbsItems as WBS[]).map((w) => w.planned_end)) || project?.target_completion_date || null;

    // ── Step 2: structured per-item fact sheet for the model ──────────────
    const itemFacts = (wbsItems as WBS[]).map((w) => {
      const preds = (w.predecessor_ids || []).map((pid) => byId[pid]).filter(Boolean);
      return {
        wbs_item_id: w.id,
        wbs_code: w.wbs_code || '',
        name: w.name || '',
        planned_start: w.planned_start || null,
        planned_end: w.planned_end || null,
        status: w.status || 'not_started',
        progress: w.progress || 0,
        float_days: float.has(w.id) ? float.get(w.id) : null,
        critical: criticalIds.has(w.id),
        overdue: overdue.includes(w),
        unscheduled: unscheduled.includes(w),
        predecessors: preds.map((p) => `${p.wbs_code} ${p.name} (end ${p.actual_end || p.planned_end || '?'})`),
      };
    });

    const factsBlob = [
      `PROJECT: ${project?.name || project_id} (${project?.code || ''}) — status ${project?.status || '?'}, progress ${project?.progress || 0}%.`,
      `Project start: ${project?.start_date || '?'}. Target completion: ${project?.target_completion_date || '?'}.`,
      `CURRENT PROJECTED FINISH (computed): ${currentFinish ? toISO(currentFinish) : 'unknown'}.`,
      `Today: ${today}.`,
      ``,
      `COMPUTED SCHEDULE FACTS (these are exact — do not recompute them):`,
      `Critical path items: ${[...criticalIds].map((id) => byId[id]?.wbs_code).filter(Boolean).join(', ') || 'none'}.`,
      `Overdue items (${overdue.length}): ${overdue.map((w) => `${w.wbs_code} ${w.name} (was due ${w.planned_end})`).join('; ') || 'none'}.`,
      `Unscheduled items (${unscheduled.length}): ${unscheduled.map((w) => `${w.wbs_code} ${w.name}`).join('; ') || 'none'}.`,
      `Dependency conflicts (${conflicts.length}): ${conflicts.map((c) => `${c.item.wbs_code} starts ${c.itemStart} but predecessor ${c.predecessor.wbs_code} finishes ${c.predFinish}`).join('; ') || 'none'}.`,
      ``,
      `WBS ITEMS (computed):`,
      JSON.stringify(itemFacts, null, 2),
      ``,
      `MILESTONES: ${milestones.length ? milestones.map((m) => `${m.title} (${m.status}, ${m.planned_date || '?'})`).join('; ') : 'none'}.`,
    ].join('\n');

    const historyText = priorMessages
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');

    const systemInstruction =
      'You are a scheduling and project-controls expert for industrial automation projects. ' +
      'You are given EXACT, precomputed schedule facts (critical path, float, projected finish, overdue items, dependency conflicts, unscheduled items). ' +
      'Reason over those facts — do NOT recompute critical path or float yourself. ' +
      'When the user asks to optimize, fix conflicts, or pull in the finish date, return CONCRETE date edits in `proposed_changes`. ' +
      'Every proposed date MUST respect dependency constraints: a task may not start before its predecessors finish. ' +
      'If moving an item requires moving its predecessors, include those predecessor moves in the same set of proposed_changes. ' +
      'If the schedule has no conflicts and cannot be meaningfully improved, return an empty proposed_changes array and say so plainly in `answer` — do NOT invent changes. ' +
      'Dates must be ISO YYYY-MM-DD strings. Compute `impact.projected_finish` as the latest proposed_end (or current finish if no changes) and `impact.days_delta` as days saved (negative) or added (positive) vs. the current projected finish. ' +
      'Set conflicts_found to the number of dependency conflicts present, and conflicts_resolved to how many of those your proposed_changes eliminate.';

    const prompt = `${systemInstruction}

${factsBlob}

Conversation so far:
${historyText || '(none)'}

User question: ${user_message}`;

    // ── Step 3: ask the LLM with a strict, concrete-output schema ────────
    const llmResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      model: 'gemini_3_flash',
      response_json_schema: {
        type: 'object',
        properties: {
          answer: { type: 'string' },
          proposed_changes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                wbs_item_id: { type: 'string' },
                wbs_code: { type: 'string' },
                item_name: { type: 'string' },
                current_start: { type: 'string' },
                current_end: { type: 'string' },
                proposed_start: { type: 'string' },
                proposed_end: { type: 'string' },
                reason: { type: 'string' },
              },
              required: ['wbs_item_id', 'wbs_code', 'item_name', 'current_start', 'current_end', 'proposed_start', 'proposed_end', 'reason'],
            },
          },
          impact: {
            type: 'object',
            properties: {
              projected_finish: { type: 'string' },
              days_delta: { type: 'number' },
            },
            required: ['projected_finish', 'days_delta'],
          },
          conflicts_found: { type: 'number' },
          conflicts_resolved: { type: 'number' },
          risk_flags: { type: 'array', items: { type: 'string' } },
        },
        required: ['answer', 'proposed_changes', 'impact', 'conflicts_found', 'conflicts_resolved', 'risk_flags'],
      },
    });

    // ── Sanitize + dependency-validate the proposed changes ─────────────
    const proposedEndById: Record<string, string> = {};
    const rawChanges: ProposedChange[] = Array.isArray((llmResult as Record<string, unknown>)?.proposed_changes)
      ? (llmResult as Record<string, unknown>).proposed_changes as ProposedChange[]
      : [];
    rawChanges.forEach((c) => {
      if (c && byId[c.wbs_item_id]) proposedEndById[c.wbs_item_id] = c.proposed_end;
    });

    const validChanges: ProposedChange[] = [];
    let conflictsResolved = 0;
    for (const c of rawChanges) {
      if (!c || !byId[c.wbs_item_id]) continue;
      // basic shape sanity
      if (!c.proposed_start || !c.proposed_end || !/^\d{4}-\d{2}-\d{2}$/.test(c.proposed_start) || !/^\d{4}-\d{2}-\d{2}$/.test(c.proposed_end)) continue;
      if (c.proposed_start > c.proposed_end) continue;
      // dependency safety: proposed_start must be >= every predecessor's finish
      // (use proposed_end where the predecessor is also being moved, else current)
      const item = byId[c.wbs_item_id];
      const preds = (item.predecessor_ids || []).map((pid) => byId[pid]).filter(Boolean);
      const predFinishes = preds.map((p) => proposedEndById[p.id] || p.actual_end || p.planned_end).filter(Boolean) as string[];
      if (predFinishes.length && c.proposed_start < predFinishes.reduce((m, d) => d > m ? d : m, '')) {
        // violates a dependency — drop it rather than write an unsafe date
        continue;
      }
      validChanges.push({
        wbs_item_id: c.wbs_item_id,
        wbs_code: item.wbs_code || c.wbs_code || '',
        item_name: item.name || c.item_name || '',
        current_start: item.planned_start || c.current_start || '',
        current_end: item.planned_end || c.current_end || '',
        proposed_start: c.proposed_start,
        proposed_end: c.proposed_end,
        reason: c.reason || '',
      });
    }

    // Recompute conflicts_resolved against the validated proposal set
    if (conflicts.length) {
      const newEnd: Record<string, string> = {};
      validChanges.forEach((c) => { newEnd[c.wbs_item_id] = c.proposed_end; });
      const newStart: Record<string, string> = {};
      validChanges.forEach((c) => { newStart[c.wbs_item_id] = c.proposed_start; });
      conflictsResolved = conflicts.filter((c) => {
        const ns = newStart[c.item.id] || c.item.planned_start;
        const pf = newEnd[c.predecessor.id] || c.predecessor.actual_end || c.predecessor.planned_end;
        return ns && pf && ns >= pf;
      }).length;
    }

    const projectedFinish = validChanges.length
      ? validChanges.map((c) => c.proposed_end).reduce((m, d) => d > m ? d : m, '')
      : (currentFinish ? toISO(currentFinish) : '');
    const currentFinishISO = currentFinish ? toISO(currentFinish) : '';
    const daysDelta = projectedFinish && currentFinishISO ? daysBetween(currentFinishISO, projectedFinish) : 0;

    const reply = {
      answer: String((llmResult as Record<string, unknown>)?.answer || ''),
      proposed_changes: validChanges,
      impact: {
        projected_finish: projectedFinish,
        days_delta: daysDelta,
      },
      conflicts_found: conflicts.length,
      conflicts_resolved: conflictsResolved,
      risk_flags: Array.isArray((llmResult as Record<string, unknown>)?.risk_flags)
        ? ((llmResult as Record<string, unknown>).risk_flags as unknown[]).map(String)
        : [],
    };

    // ── Persist user + assistant messages ─────────────────────────────────
    await base44.asServiceRole.entities.Message.create({ conversation_id: convId, role: 'user', content: String(user_message) });
    await base44.asServiceRole.entities.Message.create({ conversation_id: convId, role: 'assistant', content: JSON.stringify(reply) });

    // ── Audit log (the proposal itself; apply writes its own audit entry) ──
    await base44.asServiceRole.entities.AuditLog.create({
      project_id,
      entity_type: 'Conversation',
      entity_id: convId,
      action: 'updated',
      actor,
      summary: `Schedule assistant proposed ${validChanges.length} change(s)${conflicts.length ? `; ${conflicts.length} conflict(s) found` : ''}`,
      metadata: {
        conversation_id: convId,
        proposed_changes: validChanges.length,
        conflicts_found: conflicts.length,
        conflicts_resolved: conflictsResolved,
        current_finish: currentFinishISO,
        projected_finish: projectedFinish,
      },
    });

    return Response.json({ conversation_id: convId, ...reply });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});