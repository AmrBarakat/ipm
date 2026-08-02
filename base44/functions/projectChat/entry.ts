import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * projectChat — read-only general project assistant.
 *
 * Answers questions about ANY part of a project (BOM, finance, procurement,
 * risks, deliverables, schedule, documents, change orders, vendors) by loading a
 * broad project snapshot in parallel, boiling it down into compact precomputed
 * fact sheets, and letting the LLM reason over those facts. It NEVER writes to
 * project entities — only Message + AuditLog. If one entity load fails, the rest
 * still load and the missing area is reported via data_gaps.
 *
 * Input:  { project_id, conversation_id?, user_message, mode? }
 *   mode: 'deep' → claude_sonnet_4_6 for complex multi-part questions;
 *         default → gemini_3_flash for speed.
 * Output: { conversation_id, answer, citations[], suggested_actions[], data_gaps[] }
 */

// ── Date helpers (calendar-day math, anchored to business tz) ─────────────────
const BUSINESS_TZ = 'Asia/Riyadh';
function tzDateStr(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: BUSINESS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function toISO(d: Date | string): string { return tzDateStr(new Date(d)); }
function daysBetween(a: Date | string, b: Date | string): number {
  if (!a || !b) return 0;
  const da = new Date(a as string); da.setHours(0, 0, 0, 0);
  const db = new Date(b as string); db.setHours(0, 0, 0, 0);
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}
function maxDate(dates: (Date | string | null | undefined)[]): string {
  const ts = dates.filter(Boolean).map((d) => new Date(d as string).getTime());
  return ts.length ? toISO(new Date(Math.max(...ts))) : '';
}

function money(n: number | null | undefined): string {
  return Math.round(Number(n) || 0).toLocaleString('en-US');
}
function pct(n: number): string { return `${Math.round(Number(n) || 0)}%`; }

// Weighted WBS rollup (tree by parent_id, weight || 1) — matches syncWBSProgress.
function rollupOverallProgress(items: any[]): number {
  if (!items || !items.length) return 0;
  const byId: Record<string, any> = {};
  const tree: Record<string, any[]> = {};
  items.forEach((i) => { byId[i.id] = i; const p = i.parent_id || '__root__'; (tree[p] ||= []).push(i); });
  const rp = (id: string): number => {
    const ch = tree[id] || [];
    if (!ch.length) return byId[id]?.progress || 0;
    const wsum = ch.reduce((s, c) => s + (c.weight || 1), 0);
    return Math.round(ch.reduce((s, c) => s + rp(c.id) * (c.weight || 1), 0) / (wsum || 1));
  };
  const roots = tree['__root__'] || [];
  if (!roots.length) return 0;
  const wsum = roots.reduce((s, r) => s + (r.weight || 1), 0);
  return Math.round(roots.reduce((s, r) => s + rp(r.id) * (r.weight || 1), 0) / (wsum || 1));
}

Deno.serve(async (req) => {
  let stage = 'start';
  try {
    const base44 = createClientFromRequest(req);

    // ── Auth ──────────────────────────────────────────────────────────────
    stage = 'auth';
    const secret = req.headers.get('x-automation-secret');
    const isAutomation = !!secret && secret === Deno.env.get('AUTOMATION_SECRET');
    let user: { full_name?: string; email?: string } | null = null;
    if (!isAutomation) {
      try { user = await base44.auth.me(); } catch (_) { user = null; }
      if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const actor = user ? (user.full_name || user.email || 'user') : 'system';

    // ── Input ─────────────────────────────────────────────────────────────
    stage = 'input';
    const body = await req.json();
    const { project_id, conversation_id, user_message, mode } = body || {};
    if (!project_id || !user_message) {
      return Response.json({ error: 'project_id and user_message are required' }, { status: 400 });
    }
    const model = mode === 'deep' ? 'claude_sonnet_4_6' : 'gemini_3_flash';

    // ── Ensure a project-kind conversation exists ──────────────────────────
    stage = 'ensure_conversation';
    let convId = conversation_id;
    if (!convId) {
      const conv = await base44.asServiceRole.entities.Conversation.create({
        project_id,
        kind: 'project',
        title: String(user_message).slice(0, 60) || 'New Conversation',
      });
      convId = conv.id;
    }

    // ── Parallel context load (allSettled → partial failures tolerated) ───
    stage = 'load_context';
    const loads: Record<string, () => Promise<any[]>> = {
      project: () => base44.asServiceRole.entities.Project.filter({ id: project_id }),
      wbs: () => base44.asServiceRole.entities.WBSItem.filter({ project_id }, 'wbs_code', 1000),
      milestones: () => base44.asServiceRole.entities.Milestone.filter({ project_id }, 'planned_date', 500),
      bom: () => base44.asServiceRole.entities.BOMItem.filter({ project_id }, '-created_date', 2000),
      pos: () => base44.asServiceRole.entities.PurchaseOrder.filter({ project_id }, '-issue_date', 500),
      invoices: () => base44.asServiceRole.entities.Invoice.filter({ project_id }, 'planned_date', 500),
      collections: () => base44.asServiceRole.entities.Collection.filter({ project_id }, '-received_date', 500),
      expenses: () => base44.asServiceRole.entities.Expense.filter({ project_id }, 'planned_date', 500),
      risks: () => base44.asServiceRole.entities.Risk.filter({ project_id }, '-created_date', 200),
      deliverables: () => base44.asServiceRole.entities.Deliverable.filter({ project_id }, 'planned_delivery_date', 500),
      changeOrders: () => base44.asServiceRole.entities.ChangeOrder.filter({ project_id }, '-created_date', 200),
      vendors: () => base44.asServiceRole.entities.Vendor.filter({}, '-created_date', 300),
      tasks: () => base44.asServiceRole.entities.Task.filter({ project_id }, '-created_date', 1000),
      notes: () => base44.asServiceRole.entities.Note.filter({ project_id }, '-created_date', 200),
      priorMessages: () => base44.asServiceRole.entities.Message.filter({ conversation_id: convId }, 'created_date', 50),
    };
    const keys = Object.keys(loads);
    // Invoke each loader (Object.values returns the functions, not their results).
    const settled = await Promise.allSettled(Object.values(loads).map((fn) => fn()));
    const data: Record<string, any[]> = {};
    const loadErrors: { entity: string; reason: string }[] = [];
    keys.forEach((k, i) => {
      const r = settled[i];
      if (r.status === 'fulfilled') data[k] = r.value || [];
      else loadErrors.push({ entity: k, reason: String((r.reason as any)?.message || r.reason) });
    });
    const loadGaps = loadErrors.map((e) => e.entity);

    const project = (data.project && data.project[0]) || null;
    const wbs = data.wbs || [];
    const milestones = data.milestones || [];
    const bom = data.bom || [];
    const pos = data.pos || [];
    const invoices = data.invoices || [];
    const collections = data.collections || [];
    const expenses = data.expenses || [];
    const risks = data.risks || [];
    const deliverables = data.deliverables || [];
    const changeOrders = data.changeOrders || [];
    const vendors = data.vendors || [];
    const tasks = data.tasks || [];
    const notes = data.notes || [];
    const priorMessages = data.priorMessages || [];

    const today = tzDateStr(new Date());

    // ── Compact fact sheets ────────────────────────────────────────────────
    stage = 'build_facts';
    const sections: string[] = [];

    // Project header
    sections.push([
      `PROJECT: ${project?.name || project_id} (${project?.code || ''}) — client ${project?.client || '?'}, status ${project?.status || '?'}, progress ${project?.progress || 0}%.`,
      `Start: ${project?.start_date || '?'}. Target completion: ${project?.target_completion_date || '?'}. Today: ${today}.`,
    ].join('\n'));

    // SCHEDULE
    if (loadGaps.includes('wbs')) {
      sections.push('SCHEDULE: (unavailable — WBS context failed to load)');
    } else {
      const overall = rollupOverallProgress(wbs);
      const finish = maxDate(wbs.map((w) => w.planned_end));
      const scheduled = wbs.filter((w) => w.planned_start && w.planned_end);
      const overdue = wbs.filter((w) => w.planned_end && w.planned_end < today && w.status !== 'completed');
      const unscheduled = wbs.filter((w) => !w.planned_start || !w.planned_end);
      const upcomingMs = milestones
        .filter((m) => m.planned_date && m.planned_date >= today)
        .sort((a, b) => (a.planned_date < b.planned_date ? -1 : 1))
        .slice(0, 5);
      sections.push([
        'SCHEDULE:',
        `- Overall weighted progress: ${pct(overall)}. Project finish (max planned_end): ${finish || 'unknown'}.`,
        `- WBS items: ${wbs.length} total, ${scheduled.length} scheduled, ${unscheduled.length} unscheduled, ${overdue.length} overdue (planned_end past today, not completed).`,
        `- Next milestones (showing top ${upcomingMs.length} of ${milestones.length}):`,
        ...upcomingMs.map((m) => `   • ${m.title} — ${m.planned_date}, status ${m.status}, progress ${m.progress || 0}%`),
      ].join('\n'));
    }

    // BOM / MATERIAL
    if (loadGaps.includes('bom')) {
      sections.push('BOM/MATERIAL: (unavailable — BOM context failed to load)');
    } else {
      const top = bom.filter((i) => !i.parent_id && i.category !== 'service');
      const totalCost = top.reduce((s, i) => s + (Number(i.planned_cost_price) || 0) * (Number(i.quantity) || 1), 0);
      const totalSell = top.reduce((s, i) => s + (Number(i.selling_price) || 0) * (Number(i.quantity) || 1), 0);
      const blended = totalSell > 0 ? Math.round(((totalSell - totalCost) / totalSell) * 100) : 0;
      const statusCounts: Record<string, number> = {};
      bom.forEach((i) => { const s = i.material_status || 'not_ordered'; statusCounts[s] = (statusCounts[s] || 0) + 1; });
      const topLines = [...bom]
        .map((i) => ({ i, val: (Number(i.planned_cost_price) || 0) * (Number(i.quantity) || 1) }))
        .sort((a, b) => b.val - a.val)
        .slice(0, 10);
      const overdueExp = bom.filter((i) => i.expected_delivery_date && i.expected_delivery_date < today && i.material_status !== 'delivered');
      sections.push([
        'BOM/MATERIAL:',
        `- ${top.length} top-level material lines (excl. children & services); ${bom.length} total rows.`,
        `- Total planned cost: ${money(totalCost)} ${project?.currency || 'SAR'}. Total selling: ${money(totalSell)}. Blended margin: ${pct(blended)}.`,
        `- By material_status: ${Object.entries(statusCounts).map(([k, v]) => `${k}=${v}`).join(', ') || 'n/a'}.`,
        `- Overdue expected deliveries: ${overdueExp.length}.`,
        `- Top value lines (showing top ${topLines.length} of ${bom.length}):`,
        ...topLines.map((t) => `   • [${t.i.manufacturer_part_number || '—'}] ${t.i.description || '—'} — qty ${t.i.quantity || 0}, cost ${money(t.val)}, status ${t.i.material_status || 'not_ordered'}`),
      ].join('\n'));
    }

    // PROCUREMENT
    if (loadGaps.includes('pos')) {
      sections.push('PROCUREMENT: (unavailable — PO context failed to load)');
    } else {
      const open = pos.filter((p) => !['delivered', 'cancelled'].includes(p.status));
      const openValue = open.reduce((s, p) => s + (Number(p.amount) || 0), 0);
      const byStatus: Record<string, number> = {};
      pos.forEach((p) => { byStatus[p.status] = (byStatus[p.status] || 0) + 1; });
      const overduePO = pos.filter((p) => p.expected_delivery_date && p.expected_delivery_date < today && !['delivered', 'cancelled'].includes(p.status));
      sections.push([
        'PROCUREMENT:',
        `- ${pos.length} POs total; ${open.length} open worth ${money(openValue)} ${project?.currency || 'SAR'}.`,
        `- By status: ${Object.entries(byStatus).map(([k, v]) => `${k}=${v}`).join(', ') || 'n/a'}.`,
        `- Overdue POs (expected delivery past today, not delivered): ${overduePO.length}.`,
      ].join('\n'));
    }

    // FINANCE
    if (loadGaps.includes('invoices') || loadGaps.includes('collections') || loadGaps.includes('expenses') || loadGaps.includes('changeOrders')) {
      sections.push('FINANCE: (partially unavailable — one or more financial contexts failed to load)');
    } else {
      const approvedCOs = changeOrders.filter((co) => ['approved', 'implemented'].includes(co.status));
      const coRevenue = approvedCOs.reduce((s, co) => s + (Number(co.co_selling) || 0), 0);
      const revisedContract = (Number(project?.contract_value) || 0) + coRevenue;
      const plannedInvoiced = invoices.filter((i) => i.status !== 'cancelled').reduce((s, i) => s + (Number(i.planned_amount) || 0), 0);
      const actualInvoiced = invoices.filter((i) => ['invoiced', 'paid', 'partial', 'overdue'].includes(i.status)).reduce((s, i) => s + (Number(i.actual_amount) || Number(i.planned_amount) || 0), 0);
      const collected = collections.reduce((s, c) => s + (Number(c.amount) || 0), 0);
      const outstanding = actualInvoiced - collected;
      const plannedExp = expenses.filter((e) => e.status !== 'cancelled').reduce((s, e) => s + (Number(e.planned_amount) || 0), 0);
      const actualExp = expenses.filter((e) => ['committed', 'paid'].includes(e.status)).reduce((s, e) => s + (Number(e.actual_amount) || Number(e.planned_amount) || 0), 0);
      const margin = collected - actualExp;
      const marginPct = collected > 0 ? Math.round((margin / collected) * 100) : 0;
      const nextInv = invoices
        .filter((i) => i.planned_date && i.planned_date >= today && !['paid', 'cancelled'].includes(i.status))
        .sort((a, b) => (a.planned_date < b.planned_date ? -1 : 1))
        .slice(0, 5);
      sections.push([
        'FINANCE:',
        `- Revised contract value: ${money(revisedContract)} ${project?.currency || 'SAR'} (original ${money(project?.contract_value)} + ${money(coRevenue)} approved COs).`,
        `- Invoiced: planned ${money(plannedInvoiced)}, actual ${money(actualInvoiced)}. Collected: ${money(collected)}. Outstanding (invoiced−collected): ${money(outstanding)}.`,
        `- Expenses: planned ${money(plannedExp)}, actual/committed ${money(actualExp)}.`,
        `- Cash margin (collected−spent): ${money(margin)} (${pct(marginPct)}).`,
        `- Next invoices due (showing top ${nextInv.length} of ${invoices.length}):`,
        ...nextInv.map((i) => `   • ${i.description || '—'} — ${i.planned_date}, ${money(i.planned_amount)} ${project?.currency || 'SAR'}, status ${i.status}`),
      ].join('\n'));
    }

    // RISKS
    if (loadGaps.includes('risks')) {
      sections.push('RISKS: (unavailable — risk context failed to load)');
    } else {
      const openRisks = risks.filter((r) => r.status !== 'closed' && r.status !== 'accepted');
      const byImpact: Record<string, number> = {};
      openRisks.forEach((r) => { byImpact[r.impact || 'medium'] = (byImpact[r.impact || 'medium'] || 0) + 1; });
      const topRisks = [...risks].sort((a, b) => (Number(b.risk_score) || 0) - (Number(a.risk_score) || 0)).slice(0, 5);
      sections.push([
        'RISKS:',
        `- ${risks.length} total, ${openRisks.length} open. Open by impact: ${Object.entries(byImpact).map(([k, v]) => `${k}=${v}`).join(', ') || 'n/a'}.`,
        `- Top risks by score (showing top ${topRisks.length} of ${risks.length}):`,
        ...topRisks.map((r) => `   • ${r.title} — ${r.category || 'other'}, prob ${r.probability}/impact ${r.impact}, score ${r.risk_score || 0}, owner ${r.owner || '—'}, status ${r.status}`),
      ].join('\n'));
    }

    // DELIVERABLES
    if (loadGaps.includes('deliverables')) {
      sections.push('DELIVERABLES: (unavailable — deliverable context failed to load)');
    } else {
      const byStatus: Record<string, number> = {};
      deliverables.forEach((d) => { byStatus[d.status] = (byStatus[d.status] || 0) + 1; });
      const overdueDl = deliverables.filter((d) => d.planned_delivery_date && d.planned_delivery_date < today && !['delivered', 'accepted'].includes(d.status));
      sections.push([
        'DELIVERABLES:',
        `- ${deliverables.length} total. By status: ${Object.entries(byStatus).map(([k, v]) => `${k}=${v}`).join(', ') || 'n/a'}.`,
        `- Overdue (planned delivery past today, not delivered/accepted): ${overdueDl.length}.`,
      ].join('\n'));
    }

    // CHANGE ORDERS
    if (loadGaps.includes('changeOrders')) {
      sections.push('CHANGE ORDERS: (unavailable — change-order context failed to load)');
    } else {
      const byStatus: Record<string, { count: number; value: number }> = {};
      changeOrders.forEach((co) => {
        const k = co.status || 'pending';
        byStatus[k] = byStatus[k] || { count: 0, value: 0 };
        byStatus[k].count += 1; byStatus[k].value += Number(co.co_selling) || 0;
      });
      const totalDays = changeOrders.reduce((s, co) => s + (Number(co.impact_days) || 0), 0);
      sections.push([
        'CHANGE ORDERS:',
        `- ${changeOrders.length} total. By status: ${Object.entries(byStatus).map(([k, v]) => `${k}=${v.count} (${money(v.value)})`).join(', ') || 'n/a'}.`,
        `- Total schedule-day impact (Σ impact_days, all COs): ${totalDays} days.`,
      ].join('\n'));
    }

    // VENDORS / TASKS / NOTES (lightweight)
    if (!loadGaps.includes('vendors')) {
      const byRating: Record<string, number> = {};
      vendors.forEach((v) => { byRating[v.rating || 'approved'] = (byRating[v.rating || 'approved'] || 0) + 1; });
      sections.push(`VENDORS: ${vendors.length} total. By rating: ${Object.entries(byRating).map(([k, v]) => `${k}=${v}`).join(', ') || 'n/a'}.`);
    }
    if (!loadGaps.includes('tasks')) {
      const byStatus: Record<string, number> = {};
      tasks.forEach((t) => { byStatus[t.status] = (byStatus[t.status] || 0) + 1; });
      const overdueTasks = tasks.filter((t) => t.due_date && t.due_date < today && t.status !== 'done');
      sections.push(`TASKS: ${tasks.length} total. By status: ${Object.entries(byStatus).map(([k, v]) => `${k}=${v}`).join(', ') || 'n/a'}. ${overdueTasks.length} overdue.`);
    }
    if (!loadGaps.includes('notes')) {
      sections.push(`NOTES: ${notes.length} project notes on file.`);
    }

    const contextBlob = sections.join('\n\n');
    const historyText = priorMessages
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');

    const systemInstruction =
      'You are a project management assistant for an EHS/industrial-automation firm. ' +
      'Answer the user\'s question using ONLY the PROJECT CONTEXT provided. Be concise, quantitative, and specific — cite the numbers. ' +
      'If the answer isn\'t in the context, say what\'s missing rather than guessing. ' +
      'You do not make changes; if the user asks to change something, tell them which tab to use.';

    // ── LLM call (guarded; falls back to schema-less + JSON.parse) ──────────
    stage = 'invoke_llm';
    let raw: any;
    try {
      raw = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt: `${systemInstruction}

PROJECT CONTEXT:
${contextBlob}

Conversation so far:
${historyText || '(none)'}

User question: ${user_message}`,
        model,
        response_json_schema: {
          type: 'object',
          properties: {
            answer: { type: 'string' },
            citations: {
              type: 'array',
              items: {
                type: 'object',
                properties: { area: { type: 'string' }, detail: { type: 'string' } },
                required: ['area', 'detail'],
              },
            },
            suggested_actions: {
              type: 'array',
              items: {
                type: 'object',
                properties: { label: { type: 'string' }, tab: { type: 'string' } },
                required: ['label', 'tab'],
              },
            },
            data_gaps: { type: 'array', items: { type: 'string' } },
          },
          required: ['answer', 'citations', 'suggested_actions', 'data_gaps'],
        },
      });
    } catch (llmErr) {
      // Retry once WITHOUT response_json_schema, then parse the text as JSON.
      try {
        const rawText = await base44.asServiceRole.integrations.Core.InvokeLLM({
          prompt: `${systemInstruction}\n\nReturn ONLY valid JSON matching {answer, citations:[{area,detail}], suggested_actions:[{label,tab}], data_gaps:[]}. No markdown, no backticks.\n\nPROJECT CONTEXT:\n${contextBlob}\n\nConversation so far:\n${historyText || '(none)'}\n\nUser question: ${user_message}`,
          model,
        });
        const txt = String((rawText?.response ?? rawText?.answer ?? rawText) || '').replace(/```json|```/g, '').trim();
        raw = JSON.parse(txt);
      } catch (e2) {
        return Response.json({ error: `LLM call failed: ${(llmErr as any)?.message || llmErr}`, stage: 'invoke_llm' }, { status: 502 });
      }
    }
    // InvokeLLM may return the parsed object directly OR nested under `.response`.
    const result = (raw?.response || raw || {}) as Record<string, unknown>;

    const answer = String(result?.answer || '');
    const citations = Array.isArray(result?.citations)
      ? (result.citations as any[]).map((c) => ({ area: String(c?.area || ''), detail: String(c?.detail || '') })).filter((c) => c.area || c.detail)
      : [];
    const suggested_actions = Array.isArray(result?.suggested_actions)
      ? (result.suggested_actions as any[]).map((a) => ({ label: String(a?.label || ''), tab: String(a?.tab || '') })).filter((a) => a.label)
      : [];
    const modelGaps = Array.isArray(result?.data_gaps) ? (result.data_gaps as unknown[]).map(String) : [];
    const data_gaps = [...modelGaps, ...loadErrors.map((e) => `${e.entity} context failed to load (${e.reason})`)];

    const reply = { answer, citations, suggested_actions, data_gaps };

    // ── Persist user + assistant turns (non-fatal) ─────────────────────────
    stage = 'persist';
    try {
      await base44.asServiceRole.entities.Message.create({ conversation_id: convId, role: 'user', content: String(user_message) });
      await base44.asServiceRole.entities.Message.create({ conversation_id: convId, role: 'assistant', content: JSON.stringify(reply) });
    } catch (persistErr) {
      console.error('projectChat persist failed:', persistErr);
    }

    // ── Audit log (best-effort; never breaks the answer) ────────────────────
    stage = 'audit';
    try {
      await base44.asServiceRole.entities.AuditLog.create({
        project_id,
        entity_type: 'Conversation',
        entity_id: convId,
        action: 'updated',
        actor,
        summary: `Project assistant answered: ${String(user_message).slice(0, 80)}`,
        metadata: { conversation_id: convId, areas_cited: citations.map((c) => c.area), model },
      });
    } catch (_) { /* audit is best-effort */ }

    stage = 'done';
    return Response.json({ conversation_id: convId, ...reply });
  } catch (error) {
    console.error(`projectChat failed at stage=${stage}:`, error);
    return Response.json({ error: `${(error as any)?.message || error} (stage: ${stage})`, stage }, { status: 500 });
  }
});