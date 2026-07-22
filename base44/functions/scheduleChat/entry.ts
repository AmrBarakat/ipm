import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Business timezone — Saudi Arabia (UTC+3). Date math is anchored to Asia/Riyadh
// so "today" and projected finish dates match the local calendar day.
const BUSINESS_TZ = 'Asia/Riyadh';
function tzDateStr(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: BUSINESS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

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
 * Input:  { project_id, conversation_id?, user_message, mode? }
 *   mode: 'chat' (default, gemini_3_flash) | 'analyze' (claude_sonnet_4_6)
 * Output:  { conversation_id, answer, proposed_changes[], rejected[], impact,
 *            conflicts_found, conflicts_resolved, risk_flags[] }
 *
 * Auth: automation callers pass `x-automation-secret` matching AUTOMATION_SECRET;
 *       frontend callers are authenticated via the user token.
 */

// ── Date helpers (calendar days, matching the Gantt CPM) ──────────────────────
function toISO(d: Date | string): string { return tzDateStr(new Date(d)); }
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
  weight?: number;
  parent_id?: string;
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
  confidence: string;
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

// Generic schedule words that should NOT trigger name-match filtering.
const NAME_STOPWORDS = new Set([
  'schedule', 'scheduling', 'task', 'tasks', 'project', 'date', 'dates', 'finish',
  'finishing', 'path', 'critical', 'plan', 'planning', 'week', 'weeks', 'day', 'days',
  'time', 'start', 'starting', 'end', 'ending', 'milestone', 'milestones', 'item',
  'items', 'wbs', 'phase', 'phases', 'work', 'works', 'the', 'this', 'that', 'these',
  'those', 'what', 'which', 'how', 'why', 'when', 'where', 'are', 'was', 'were', 'will',
  'should', 'could', 'would', 'can', 'may', 'might', 'must', 'have', 'has', 'had', 'all',
  'any', 'some', 'more', 'less', 'than', 'then', 'them', 'they', 'their', 'our', 'your',
  'please', 'tell', 'show', 'list', 'explain', 'describe', 'give', 'me', 'my', 'our',
  'about', 'for', 'from', 'into', 'onto', 'with', 'without', 'over', 'under', 'between',
  'before', 'after', 'during', 'while', 'and', 'but', 'or', 'not', 'now', 'today', 'tomorrow',
]);

/** If the user message names specific tasks/phases, return the matching WBS items
 *  plus their ancestors and direct dependents. Returns null when no specific
 *  task is named (caller should send all items, trimmed). */
function nameMatchedItems(userMessage: string, items: WBS[]): WBS[] | null {
  const msg = (userMessage || '').toLowerCase();
  const tokens = msg.split(/[^a-z0-9]+/).filter((t) => t.length >= 4 && !NAME_STOPWORDS.has(t));
  if (tokens.length === 0) return null;
  const matched = items.filter((i) => {
    const hay = `${i.name || ''} ${i.wbs_code || ''}`.toLowerCase();
    return tokens.some((t) => hay.includes(t));
  });
  if (matched.length === 0) return null;
  const byId = Object.fromEntries(items.map((i) => [i.id, i])) as Record<string, WBS>;
  const ids = new Set(matched.map((m) => m.id));
  // ancestors via parent_id
  matched.forEach((m) => {
    let cur: WBS | undefined = m;
    let guard = 0;
    while (cur?.parent_id && byId[cur.parent_id] && guard++ < 50) {
      ids.add(cur.parent_id);
      cur = byId[cur.parent_id];
    }
  });
  // direct dependents (successors)
  items.forEach((i) => {
    if ((i.predecessor_ids || []).some((pid) => ids.has(pid))) ids.add(i.id);
  });
  return items.filter((i) => ids.has(i.id));
}

// Action verbs that indicate the user wants schedule edits (not just info).
const ACTION_RE = /move|shift|shifted|reschedule|re-schedule|change|changed|update|updated|pull[- ]?in|optimiz|optimis|fix|fixing|extend|extended|shorten|delay|delayed|advance|advanced|accelerate|rebaseline|rearrange|push|bring forward|move up|move earlier|move later|tighten|compress|slip|slipped/i;

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
    const { project_id, conversation_id, user_message, mode } = body || {};
    if (!project_id || !user_message) {
      return Response.json({ error: 'project_id and user_message are required' }, { status: 400 });
    }
    if (mode && !['chat', 'analyze'].includes(mode)) {
      return Response.json({ error: "mode must be 'chat' or 'analyze'" }, { status: 400 });
    }
    const model = mode === 'analyze' ? 'claude_sonnet_4_6' : 'gemini_3_flash';

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

    // ── Step 1: compute the real schedule state over ALL items ─────────────
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
    const currentFinishISO = currentFinish ? toISO(currentFinish) : '';

    // ── Working-day / weekend config (if present on the project) ──────────
    const workingDaysLine = (project && (project.working_days || project.weekend_days || project.working_days_config))
      ? `Working days config: ${project.working_days || 'n/a'}; weekend: ${project.weekend_days || 'n/a'}.`
      : `Working days: Sunday–Thursday; weekend: Friday–Saturday (Saudi standard). All date math above is in calendar days.`;

    // ── Step 2: COMPACT per-item fact sheet (trimmed + filtered) ───────────
    const contextItems = nameMatchedItems(String(user_message), wbsItems as WBS[]) || (wbsItems as WBS[]);
    const itemFacts = contextItems.map((w) => ({
      wbs_item_id: w.id,
      wbs_code: w.wbs_code || '',
      name: w.name || '',
      planned_start: w.planned_start || null,
      planned_end: w.planned_end || null,
      duration: (w.planned_start && w.planned_end) ? daysBetween(w.planned_start, w.planned_end) : null,
      parent_id: w.parent_id || null,
      status: w.status || 'not_started',
      weight: w.weight ?? null,
      predecessor_ids: w.predecessor_ids || [],
    }));

    const factsBlob = [
      `PROJECT: ${project?.name || project_id} (${project?.code || ''}) — status ${project?.status || '?'}, progress ${project?.progress || 0}%.`,
      `Project start: ${project?.start_date || '?'}. Target completion: ${project?.target_completion_date || '?'}.`,
      `CURRENT PROJECTED FINISH (computed): ${currentFinishISO || 'unknown'}.`,
      `Today: ${today}.`,
      workingDaysLine,
      ``,
      `COMPUTED SCHEDULE FACTS (these are exact — do not recompute them):`,
      `Critical path items: ${[...criticalIds].map((id) => byId[id]?.wbs_code).filter(Boolean).join(', ') || 'none'}.`,
      `Overdue items (${overdue.length}): ${overdue.map((w) => `${w.wbs_code} ${w.name} (was due ${w.planned_end})`).join('; ') || 'none'}.`,
      `Unscheduled items (${unscheduled.length}): ${unscheduled.map((w) => `${w.wbs_code} ${w.name}`).join('; ') || 'none'}.`,
      `Dependency conflicts (${conflicts.length}): ${conflicts.map((c) => `${c.item.wbs_code} starts ${c.itemStart} but predecessor ${c.predecessor.wbs_code} finishes ${c.predFinish}`).join('; ') || 'none'}.`,
      ``,
      `WBS ITEMS (only those relevant to the question; edit only these ids):`,
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
      'Set conflicts_found to the number of dependency conflicts present, and conflicts_resolved to how many of those your proposed_changes eliminate.\n' +
      'STRICT RULES for proposed_changes:\n' +
      '- Only reference wbs_item_id values that appear in the WBS ITEMS list above.\n' +
      '- Every change MUST include a one-sentence `reason` and a `confidence` of "high", "medium", or "low".\n' +
      '- proposed_end must be on or after proposed_start.\n' +
      '- A child item may not end after its parent end unless your proposed_changes also move the parent.\n' +
      '- Do NOT propose changes to items whose status is "completed" unless the user explicitly asks to change completed work.';

    // ── Socratic / informational short-circuit ────────────────────────────
    // If the user message has no actionable schedule-edit intent, answer with a
    // minimal schema (just `answer`) — no proposed_changes — so the turn is
    // fast and the model is not forced to emit the full change schema.
    const actionable = ACTION_RE.test(String(user_message));
    if (!actionable) {
      const sRaw = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt: `${systemInstruction}

${factsBlob}

Conversation so far:
${historyText || '(none)'}

User question: ${user_message}

This is an informational / socratic question — do NOT propose any date changes. Answer concisely using the computed facts above. Return JSON: { "answer": "..." }.`,
        model,
        response_json_schema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] },
      });
      const sRes = (sRaw?.response || sRaw || {}) as Record<string, unknown>;
      const reply = {
        answer: String(sRes?.answer || ''),
        proposed_changes: [] as ProposedChange[],
        rejected: [] as unknown[],
        impact: { projected_finish: currentFinishISO, days_delta: 0 },
        conflicts_found: conflicts.length,
        conflicts_resolved: 0,
        risk_flags: [] as string[],
      };

      await base44.asServiceRole.entities.Message.create({ conversation_id: convId, role: 'user', content: String(user_message) });
      await base44.asServiceRole.entities.Message.create({ conversation_id: convId, role: 'assistant', content: JSON.stringify(reply) });
      await base44.asServiceRole.entities.AuditLog.create({
        project_id,
        entity_type: 'Conversation',
        entity_id: convId,
        action: 'updated',
        actor,
        summary: `Schedule assistant answered an informational question (no changes proposed)${conflicts.length ? `; ${conflicts.length} conflict(s) found` : ''}`,
        metadata: { conversation_id: convId, mode, socratic: true, conflicts_found: conflicts.length },
      });
      return Response.json({ conversation_id: convId, ...reply });
    }

    // ── Step 3: actionable turn — ask the LLM with a strict schema ────────
    const _raw = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: `${systemInstruction}

${factsBlob}

Conversation so far:
${historyText || '(none)'}

User question: ${user_message}`,
      model,
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
                confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
              },
              required: ['wbs_item_id', 'wbs_code', 'item_name', 'current_start', 'current_end', 'proposed_start', 'proposed_end', 'reason', 'confidence'],
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
    // InvokeLLM may return the parsed object directly OR nested under `.response`.
    const llmResult = (_raw?.response || _raw || {}) as Record<string, unknown>;

    // ── Sanitize + dependency-validate the proposed changes ─────────────
    const proposedEndById: Record<string, string> = {};
    const rawChanges = Array.isArray(llmResult?.proposed_changes)
      ? (llmResult.proposed_changes as ProposedChange[])
      : [];
    rawChanges.forEach((c) => {
      if (c && c.wbs_item_id && byId[c.wbs_item_id]) proposedEndById[c.wbs_item_id] = c.proposed_end;
    });

    const validChanges: ProposedChange[] = [];
    const rejected: { wbs_item_id: string; wbs_code: string; reason: string }[] = [];
    const completedRequested = /\b(completed|done|finished)\b/i.test(String(user_message));

    function rejectChange(c: any, reason: string) {
      const item = c?.wbs_item_id ? byId[c.wbs_item_id] : null;
      rejected.push({ wbs_item_id: c?.wbs_item_id || '', wbs_code: c?.wbs_code || item?.wbs_code || '', reason });
    }

    for (const c of rawChanges as any[]) {
      if (!c || !c.wbs_item_id || !byId[c.wbs_item_id]) { rejectChange(c, 'Unknown WBS item id'); continue; }
      const item = byId[c.wbs_item_id];
      if (!c.reason || !String(c.reason).trim()) { rejectChange(c, 'Missing reason'); continue; }
      if (!['high', 'medium', 'low'].includes(c.confidence)) { rejectChange(c, 'Missing or invalid confidence'); continue; }
      if (!c.proposed_start || !c.proposed_end || !/^\d{4}-\d{2}-\d{2}$/.test(c.proposed_start) || !/^\d{4}-\d{2}-\d{2}$/.test(c.proposed_end)) {
        rejectChange(c, 'Invalid date format'); continue;
      }
      if (c.proposed_end < c.proposed_start) { rejectChange(c, 'proposed_end is before proposed_start'); continue; }
      if (item.status === 'completed' && !completedRequested) { rejectChange(c, 'Item is completed; not changing without explicit request'); continue; }
      // child cannot end after parent end unless the parent is also being moved
      if (item.parent_id && byId[item.parent_id]) {
        const parent = byId[item.parent_id];
        const parentEnd = proposedEndById[parent.id] || parent.actual_end || parent.planned_end;
        if (parentEnd && c.proposed_end > parentEnd && !proposedEndById[parent.id]) {
          rejectChange(c, 'Child ends after parent end without moving the parent'); continue;
        }
      }
      // dependency safety: proposed_start must be >= every predecessor's finish
      const preds = (item.predecessor_ids || []).map((pid) => byId[pid]).filter(Boolean);
      const predFinishes = preds.map((p) => proposedEndById[p.id] || p.actual_end || p.planned_end).filter(Boolean) as string[];
      if (predFinishes.length && c.proposed_start < predFinishes.reduce((m, d) => d > m ? d : m, '')) {
        rejectChange(c, 'Violates predecessor dependency'); continue;
      }
      validChanges.push({
        wbs_item_id: c.wbs_item_id,
        wbs_code: item.wbs_code || c.wbs_code || '',
        item_name: item.name || c.item_name || '',
        current_start: item.planned_start || c.current_start || '',
        current_end: item.planned_end || c.current_end || '',
        proposed_start: c.proposed_start,
        proposed_end: c.proposed_end,
        reason: c.reason,
        confidence: c.confidence,
      });
    }

    // Recompute conflicts_resolved against the validated proposal set
    let conflictsResolved = 0;
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
      : currentFinishISO;
    const daysDelta = projectedFinish && currentFinishISO ? daysBetween(currentFinishISO, projectedFinish) : 0;

    // ── Server-side self-check line appended to the answer ───────────────
    let answer = String(llmResult?.answer || '');
    if (validChanges.length > 0) {
      const m = rejected.length;
      answer = `${answer.trim()}\n\nProposed ${validChanges.length} change(s)${m ? `; ${m} filtered for consistency` : ''}.`;
    }

    const reply = {
      answer,
      proposed_changes: validChanges,
      rejected,
      impact: {
        projected_finish: projectedFinish,
        days_delta: daysDelta,
      },
      conflicts_found: conflicts.length,
      conflicts_resolved: conflictsResolved,
      risk_flags: Array.isArray(llmResult?.risk_flags)
        ? (llmResult.risk_flags as unknown[]).map(String)
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
      summary: `Schedule assistant proposed ${validChanges.length} change(s)${rejected.length ? `, ${rejected.length} filtered` : ''}${conflicts.length ? `; ${conflicts.length} conflict(s) found` : ''}`,
      metadata: {
        conversation_id: convId,
        mode,
        proposed_changes: validChanges.length,
        rejected: rejected.length,
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