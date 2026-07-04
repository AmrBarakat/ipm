import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * suggestRiskMitigation
 *
 * Returns an AI-generated mitigation plan for a project risk.
 *
 * Auth: automation callers pass `x-automation-secret` matching AUTOMATION_SECRET;
 *       frontend callers are authenticated via the user token. Either is accepted.
 *
 * Input:  { risk_title, risk_description, category, probability, impact }
 * Output: { mitigation_summary, suggested_tasks[], contingency_plan, timeline }
 */

const SYSTEM_INSTRUCTION =
  'You are a risk management expert for industrial automation and energy projects. Respond only in JSON.';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // ── Auth ──────────────────────────────────────────────────────────────
    const secret = req.headers.get('x-automation-secret');
    const isAutomation = !!secret && secret === Deno.env.get('AUTOMATION_SECRET');
    if (!isAutomation) {
      let user = null;
      try { user = await base44.auth.me(); } catch (_) { user = null; }
      if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ── Input ─────────────────────────────────────────────────────────────
    const { risk_title, risk_description, category, probability, impact } = await req.json();
    if (!risk_title) {
      return Response.json({ error: 'risk_title is required' }, { status: 400 });
    }

    const userPrompt = `A project risk has been logged:
- Title: "${risk_title}"
- Description: "${risk_description || 'N/A'}"
- Category: ${category || 'other'}
- Probability: ${probability || 'medium'}
- Impact: ${impact || 'medium'}

Suggest concrete mitigation strategies for this risk. Respond with a JSON object in exactly this shape:
{
  "mitigation_summary": "string — a concise summary of the recommended mitigation strategy",
  "suggested_tasks": ["string", "..."] — actionable mitigation tasks a team member can execute immediately",
  "contingency_plan": "string — what to do if the risk materializes",
  "timeline": "string — recommended timeframe to implement the mitigation"
}`;

    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: `${SYSTEM_INSTRUCTION}\n\n${userPrompt}`,
      response_json_schema: {
        type: 'object',
        properties: {
          mitigation_summary: { type: 'string' },
          suggested_tasks: { type: 'array', items: { type: 'string' } },
          contingency_plan: { type: 'string' },
          timeline: { type: 'string' },
        },
        required: ['mitigation_summary', 'suggested_tasks', 'contingency_plan', 'timeline'],
      },
    });

    return Response.json({
      mitigation_summary: String(result?.mitigation_summary || ''),
      suggested_tasks: Array.isArray(result?.suggested_tasks) ? result.suggested_tasks.map(String) : [],
      contingency_plan: String(result?.contingency_plan || ''),
      timeline: String(result?.timeline || ''),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});