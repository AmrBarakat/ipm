import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { plain_text, file_name, project_name, project_type, start_date } = await req.json();
    if (!plain_text) return Response.json({ error: 'plain_text is required' }, { status: 400 });

    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      model: 'claude_sonnet_4_6',
      prompt: `You are an expert project management assistant. Analyze the following project plan data (extracted from an Excel/CSV file) and extract all WBS items and Milestones.

=== PROJECT PLAN DATA ===
${plain_text}
=== END DATA ===

=== COLUMN MAPPING (fuzzy match aliases) ===
- WBS: also "WBS No", "WBS Code", "ID", "Code", "Ref"
- Activity Name: also "Task Name", "Description", "Activity", "Work Item", "Name"  ← REQUIRED
- Task Mode / Type: also "Type", "Level", "Mode", "Category"
- Duration: also "Duration (Days)", "Days", "Dur"
- Start Day: also "Start", "Start Date", "Begin", "From"
- Finish Day: also "Finish", "End", "End Date", "To", "Completion"
- Predecessor: also "Depends On", "Dependency", "Pred"
- Responsible: also "Resource", "Owner", "Assigned To", "Team", "Role"
- Status: also "Progress", "State", "% Done"
- Weight (%): also "Weight", "Progress Weight", "EV Weight"
- EV Method: also "EV Rule", "Measurement", "Earned Value Method"
- Deliverable / Remarks: also "Output", "Remarks", "Notes", "Document"

=== HIERARCHY DETECTION (try in order) ===
1. If WBS column exists: parse dot-notation depth. "1"=Level1/Phase, "1.1"=Level2/Task, "1.1.1"=Level3/SubTask.
2. If no WBS: detect from indentation of Activity Name.
3. If no WBS and no indentation: detect phase headers from ALL-CAPS names or known keywords (INITIATION, PROCUREMENT, DELIVERY, COMMISSIONING, TESTING, HANDOVER, CLOSEOUT, FAT, SAT, ENGINEERING, DESIGN).
4. Auto-renumber WBS sequentially. Store original in original_wbs.

=== MILESTONE AUTO-DETECTION ===
Flag a row as a Milestone if ANY condition is true:
- Task Mode = "Milestone"
- Duration = 0 or blank AND it is a phase/header row
- Activity Name ends with: Confirmation, Completion, Delivery, Handover, Sign-off, Approved, Received, Issued, Kickoff, Meeting, FAT, SAT

=== EV METHOD AUTO-ASSIGNMENT ===
1. Milestone row → "0/100"
2. Duration ≤ 2 days → "50/50"
3. Duration ≥ 3 days AND deliverable is binary (signed/approved/received) → "0/100"
4. Duration ≥ 3 days AND involves configuration/development/programming → "Weighted Milestone"
5. Duration ≥ 3 days AND quantity-based → "% Complete"
6. Default → "% Complete"

=== WEIGHT AUTO-CALCULATION ===
If weights are missing or all zero:
- Raw score = Duration days (blank → 1)
- Normalize all LEAF task raw scores to sum = 100% (2 decimal places)
- Phase/parent rows: set weight = sum of their children

Project context:
- Project name: ${project_name || 'Unknown'}
- Project type: ${project_type || 'Unknown'}
- Start date: ${start_date || 'Unknown'}
- File name: ${file_name || 'project_plan.xlsx'}

Return JSON with:
- "project_name": detected project name (string or null)
- "milestones": array of milestone objects with: title (UPPER CASE), planned_date (YYYY-MM-DD), weight (number), description, ev_method ("0/100"), is_ai_generated (bool)
- "wbs_items": array of WBS item objects with: wbs_code, original_wbs, name, task_mode (milestone|summary|task), assignee, planned_start (YYYY-MM-DD), planned_end (YYYY-MM-DD), duration_days, weight (number), parent_code, status (not_started|in_progress|completed|blocked), ev_method, predecessor, deliverable, remarks, is_ai_generated (bool)
`,
      response_json_schema: {
        type: 'object',
        properties: {
          project_name: { type: 'string' },
          milestones: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                planned_date: { type: 'string' },
                weight: { type: 'number' },
                description: { type: 'string' },
                ev_method: { type: 'string' },
                is_ai_generated: { type: 'boolean' },
              },
            },
          },
          wbs_items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                wbs_code: { type: 'string' },
                original_wbs: { type: 'string' },
                name: { type: 'string' },
                task_mode: { type: 'string' },
                assignee: { type: 'string' },
                planned_start: { type: 'string' },
                planned_end: { type: 'string' },
                duration_days: { type: 'number' },
                weight: { type: 'number' },
                parent_code: { type: 'string' },
                status: { type: 'string' },
                ev_method: { type: 'string' },
                predecessor: { type: 'string' },
                deliverable: { type: 'string' },
                remarks: { type: 'string' },
                is_ai_generated: { type: 'boolean' },
              },
            },
          },
        },
      },
    });

    const parsed = result?.response || result;
    return Response.json({
      project_name: parsed.project_name || null,
      milestones: (parsed.milestones || []).filter(m => m.title),
      wbs_items: (parsed.wbs_items || []).filter(w => w.name),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});