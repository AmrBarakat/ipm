import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const PROB_SCORE = { low: 1, medium: 2, high: 3 };
const IMPACT_SCORE = { low: 1, medium: 2, high: 3, critical: 4 };

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { project_id, risk_title, risk_description, category, probability, impact } = await req.json();
    if (!project_id || !risk_title) {
      return Response.json({ error: 'project_id and risk_title are required' }, { status: 400 });
    }

    // Fetch historical completed tasks for this project for context
    const allTasks = await base44.asServiceRole.entities.Task.filter({ project_id }, '-created_date', 200);
    const doneTasks = allTasks.filter(t => t.status === 'done').map(t => t.title).slice(0, 40);
    const openTasks = allTasks.filter(t => t.status !== 'done').map(t => t.title).slice(0, 20);

    const riskScore = (PROB_SCORE[probability] || 2) * (IMPACT_SCORE[impact] || 2);

    const prompt = `You are a senior project manager for industrial automation and energy projects.

A project risk has been logged:
- Title: "${risk_title}"
- Description: "${risk_description || 'N/A'}"
- Category: ${category}
- Probability: ${probability}
- Impact: ${impact}
- Risk Score: ${riskScore}/12

Historical completed tasks in this project (for context):
${doneTasks.length > 0 ? doneTasks.map(t => `• ${t}`).join('\n') : '(none yet)'}

Current open tasks:
${openTasks.length > 0 ? openTasks.map(t => `• ${t}`).join('\n') : '(none)'}

Based on this risk and the project's task history, suggest 4–6 concrete, actionable mitigation tasks that a team member could immediately create and execute to reduce this risk. 
Each task title should be specific, short (under 12 words), and directly address the risk.
Do NOT suggest tasks that already appear in the open tasks list above.

Return ONLY a JSON object in this exact format:
{
  "suggested_tasks": ["Task 1 title", "Task 2 title", "Task 3 title", "Task 4 title"],
  "mitigation_summary": "A 1-2 sentence summary of the recommended mitigation strategy."
}`;

    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: 'object',
        properties: {
          suggested_tasks: { type: 'array', items: { type: 'string' } },
          mitigation_summary: { type: 'string' }
        }
      }
    });

    return Response.json({
      suggested_tasks: result.suggested_tasks || [],
      mitigation_summary: result.mitigation_summary || '',
      risk_score: riskScore,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});