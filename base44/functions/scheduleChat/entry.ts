import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * scheduleChat
 *
 * Conversational scheduling & project-controls assistant.
 * Accepts { project_id, conversation_id, user_message }.
 * Loads project schedule context (milestones, tasks, WBS) and prior messages,
 * asks the LLM (as a scheduling expert) and persists the user + assistant turns
 * as Message records, plus an AuditLog entry.
 *
 * Auth: automation callers pass `x-automation-secret` matching AUTOMATION_SECRET;
 *       frontend callers are authenticated via the user token. Either is accepted.
 */

const SYSTEM_INSTRUCTION =
  'You are a scheduling and project controls expert for industrial automation projects. ' +
  'Analyze the schedule and answer the user\'s question. ' +
  'Respond in JSON with keys: answer (string), suggested_actions (array of strings), risk_flags (array of strings).';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // ── Auth ──────────────────────────────────────────────────────────────
    const secret = req.headers.get('x-automation-secret');
    const isAutomation = !!secret && secret === Deno.env.get('AUTOMATION_SECRET');
    let user = null;
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

    // Ensure a conversation exists (create one if not provided)
    let convId = conversation_id;
    if (!convId) {
      const conv = await base44.asServiceRole.entities.Conversation.create({
        project_id,
        title: String(user_message).slice(0, 60) || 'New Conversation',
      });
      convId = conv.id;
    }

    // ── Load schedule context (service role) ──────────────────────────────
    const [projectArr, milestones, tasks, wbsItems, priorMessages] = await Promise.all([
      base44.asServiceRole.entities.Project.filter({ id: project_id }),
      base44.asServiceRole.entities.Milestone.filter({ project_id }, 'planned_date', 500),
      base44.asServiceRole.entities.Task.filter({ project_id }, '-created_date', 500),
      base44.asServiceRole.entities.WBSItem.filter({ project_id }, 'wbs_code', 1000),
      base44.asServiceRole.entities.Message.filter({ conversation_id: convId }, 'created_date', 50),
    ]);
    const project = projectArr[0] || null;

    const historyText = priorMessages
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');

    const scheduleText = [
      `Project: ${project?.name || project_id} (${project?.code || ''}) — status ${project?.status || '?'}, progress ${project?.progress || 0}%, start ${project?.start_date || '?'}, target completion ${project?.target_completion_date || '?'}.`,
      `Milestones:\n${(milestones.length ? milestones.map((m) => `- ${m.title} (status ${m.status}, planned ${m.planned_date || '?'}, progress ${m.progress || 0}%)`).join('\n') : 'none')}`,
      `Tasks:\n${(tasks.length ? tasks.map((t) => `- ${t.title} (status ${t.status}, priority ${t.priority}, assignee ${t.assignee || '?'}, due ${t.due_date || '?'})`).join('\n') : 'none')}`,
      `WBS:\n${(wbsItems.length ? wbsItems.map((w) => `- ${w.wbs_code} ${w.name} (status ${w.status}, progress ${w.progress || 0}%, planned ${w.planned_start || '?'} → ${w.planned_end || '?'})`).join('\n') : 'none')}`,
    ].join('\n\n');

    const prompt = `${SYSTEM_INSTRUCTION}

Project schedule data:
${scheduleText}

Conversation so far:
${historyText || '(none)'}

User question: ${user_message}`;

    // ── Ask the LLM ───────────────────────────────────────────────────────
    const llmResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
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

    const reply = {
      answer: String(llmResult?.answer || ''),
      suggested_actions: Array.isArray(llmResult?.suggested_actions) ? llmResult.suggested_actions.map(String) : [],
      risk_flags: Array.isArray(llmResult?.risk_flags) ? llmResult.risk_flags.map(String) : [],
    };

    // ── Persist user + assistant messages ─────────────────────────────────
    await base44.asServiceRole.entities.Message.create({ conversation_id: convId, role: 'user', content: String(user_message) });
    await base44.asServiceRole.entities.Message.create({ conversation_id: convId, role: 'assistant', content: JSON.stringify(reply) });

    // ── Audit log ─────────────────────────────────────────────────────────
    await base44.asServiceRole.entities.AuditLog.create({
      project_id,
      entity_type: 'Conversation',
      entity_id: convId,
      action: 'updated',
      actor,
      summary: `Schedule assistant answered: ${reply.answer.slice(0, 120)}`,
      metadata: {
        conversation_id: convId,
        suggested_actions: reply.suggested_actions,
        risk_flags: reply.risk_flags,
      },
    });

    return Response.json({ conversation_id: convId, ...reply });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});