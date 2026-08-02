import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * projectChat — general project-management assistant.
 *
 * Answers questions across the whole project (schedule, cost, procurement, scope,
 * risks, deliverables) by loading a broad project snapshot, handing it to the LLM
 * with a general project-expert system instruction, and persisting the exchange
 * into the same Message store scheduleChat uses — but on a conversation whose
 * `kind` is 'project' so the two histories never mix.
 *
 * Input:  { project_id, conversation_id?, user_message }
 * Output:  { conversation_id, answer, suggested_actions[], risk_flags[] }
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const secret = req.headers.get('x-automation-secret');
    const isAutomation = !!secret && secret === Deno.env.get('AUTOMATION_SECRET');
    let user: { full_name?: string; email?: string } | null = null;
    if (!isAutomation) {
      try { user = await base44.auth.me(); } catch (_) { user = null; }
      if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const actor = user ? (user.full_name || user.email || 'user') : 'system';

    const body = await req.json();
    const { project_id, conversation_id, user_message } = body || {};
    if (!project_id || !user_message) {
      return Response.json({ error: 'project_id and user_message are required' }, { status: 400 });
    }

    // Ensure a project-kind conversation exists
    let convId = conversation_id;
    if (!convId) {
      const conv = await base44.asServiceRole.entities.Conversation.create({
        project_id,
        kind: 'project',
        title: String(user_message).slice(0, 60) || 'New Conversation',
      });
      convId = conv.id;
    }

    // ── Broad project context (service role) ─────────────────────────────
    const [projectArr, tasks, milestones, expenses, risks, invoices, collections, pos, bom, priorMessages] = await Promise.all([
      base44.asServiceRole.entities.Project.filter({ id: project_id }),
      base44.asServiceRole.entities.Task.filter({ project_id }, '-created_date', 200),
      base44.asServiceRole.entities.Milestone.filter({ project_id }, 'planned_date', 200),
      base44.asServiceRole.entities.Expense.filter({ project_id }, 'planned_date', 200),
      base44.asServiceRole.entities.Risk.filter({ project_id }, '-created_date', 200),
      base44.asServiceRole.entities.Invoice.filter({ project_id }, 'planned_date', 200),
      base44.asServiceRole.entities.Collection.filter({ project_id }, '-received_date', 200),
      base44.asServiceRole.entities.PurchaseOrder.filter({ project_id }, '-issue_date', 200),
      base44.asServiceRole.entities.BOMItem.filter({ project_id }, '-created_date', 300),
      base44.asServiceRole.entities.Message.filter({ conversation_id: convId }, 'created_date', 50),
    ]);
    const project = projectArr[0] || null;

    const snapshot = {
      project: {
        name: project?.name, code: project?.code, status: project?.status, progress: project?.progress,
        contract_value: project?.contract_value, currency: project?.currency,
        start_date: project?.start_date, target_completion_date: project?.target_completion_date,
        project_manager: project?.project_manager,
      },
      milestones: milestones.map((m) => ({ title: m.title, status: m.status, planned_date: m.planned_date, progress: m.progress })),
      tasks: tasks.slice(0, 60).map((t) => ({ title: t.title, status: t.status, priority: t.priority, assignee: t.assignee, due_date: t.due_date, progress: t.progress })),
      risks: risks.map((r) => ({ title: r.title, category: r.category, probability: r.probability, impact: r.impact, status: r.status, owner: r.owner })),
      financials: {
        plannedExpenses: expenses.filter((e) => e.status !== 'cancelled').reduce((s, e) => s + (e.planned_amount || 0), 0),
        actualExpenses: expenses.filter((e) => ['committed', 'paid'].includes(e.status)).reduce((s, e) => s + (e.actual_amount || e.planned_amount || 0), 0),
        plannedInvoiced: invoices.filter((i) => i.status !== 'cancelled').reduce((s, i) => s + (i.planned_amount || 0), 0),
        collected: collections.reduce((s, c) => s + (c.amount || 0), 0),
        openPOs: pos.filter((p) => !['delivered', 'cancelled'].includes(p.status)).length,
      },
      bom: { totalItems: bom.length, ordered: bom.filter((b) => ['ordered', 'received', 'delivered'].includes(b.material_status) || b.ordered).length },
    };

    const historyText = priorMessages.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');

    const systemInstruction =
      'You are a general project-management assistant for industrial automation and energy projects. ' +
      'Answer questions across the whole project — schedule, cost, procurement, scope, risks, and deliverables — using the provided project snapshot. ' +
      'Be concise, practical, and specific to THIS project. When the user asks for recommendations, give concrete next steps. ' +
      'Do not invent data not present in the snapshot; if something is unknown, say so plainly. ' +
      'Return JSON with: answer (string), suggested_actions (array of short strings), risk_flags (array of short strings).';

    const raw = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: `${systemInstruction}\n\nPROJECT SNAPSHOT:\n${JSON.stringify(snapshot, null, 2)}\n\nConversation so far:\n${historyText || '(none)'}\n\nUser: ${user_message}`,
      model: 'gemini_3_flash',
      response_json_schema: {
        type: 'object',
        properties: {
          answer: { type: 'string' },
          suggested_actions: { type: 'array', items: { type: 'string' } },
          risk_flags: { type: 'array', items: { type: 'string' } },
        },
        required: ['answer', 'suggested_actions', 'risk_flags'],
      },
    });
    const llm = (raw?.response || raw || {}) as Record<string, unknown>;
    const reply = {
      answer: String(llm?.answer || ''),
      suggested_actions: Array.isArray(llm?.suggested_actions) ? (llm.suggested_actions as unknown[]).map(String) : [],
      risk_flags: Array.isArray(llm?.risk_flags) ? (llm.risk_flags as unknown[]).map(String) : [],
    };

    await base44.asServiceRole.entities.Message.create({ conversation_id: convId, role: 'user', content: String(user_message) });
    await base44.asServiceRole.entities.Message.create({ conversation_id: convId, role: 'assistant', content: JSON.stringify(reply) });
    await base44.asServiceRole.entities.AuditLog.create({
      project_id,
      entity_type: 'Conversation',
      entity_id: convId,
      action: 'updated',
      actor,
      summary: 'Project assistant answered a question.',
      metadata: { conversation_id: convId },
    });

    return Response.json({ conversation_id: convId, ...reply });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});