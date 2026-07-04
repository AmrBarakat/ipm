/**
 * AI Estimate WBS Durations
 *
 * Finds WBS items missing a duration (no planned_end, or no dates at all) and
 * asks the LLM to estimate a working-day duration for each, calibrated against
 * the project's own dated activities. Derives proposed_start / proposed_end
 * (skipping weekends, never before a predecessor's finish) and returns a review
 * list. DOES NOT WRITE — the caller reviews and applies selected rows.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

function toISO(d) {
  return new Date(d).toISOString().slice(0, 10);
}

/** Add `n` working days to `startDate` (skips Sat/Sun). Returns a Date. */
function addWorkingDays(startDate, n) {
  const d = new Date(startDate);
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}

/** Roll a weekend date forward to the next Monday (in place). */
function rollToWorkday(d) {
  const dow = d.getDay();
  if (dow === 6) d.setDate(d.getDate() + 2);
  else if (dow === 0) d.setDate(d.getDate() + 1);
  return d;
}

function durDays(w) {
  if (!w.planned_start || !w.planned_end) return null;
  return Math.max(1, Math.round((new Date(w.planned_end) - new Date(w.planned_start)) / 86400000));
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    try { await base44.auth.me(); } catch (_) {}

    const { project_id } = await req.json();
    if (!project_id) return Response.json({ error: 'project_id required' }, { status: 400 });

    const [wbs, projects] = await Promise.all([
      base44.asServiceRole.entities.WBSItem.filter({ project_id }),
      base44.asServiceRole.entities.Project.filter({ id: project_id }),
    ]);
    const project = projects[0];
    const byId = {};
    wbs.forEach((w) => { byId[w.id] = w; });

    // Needs a duration estimate: missing planned_start and/or planned_end,
    // OR a zero-duration item (planned_start === planned_end) which draws no bar.
    const undated = wbs.filter((w) =>
      !w.planned_start || !w.planned_end || (w.planned_start && w.planned_end && w.planned_start === w.planned_end)
    );
    if (undated.length === 0) {
      return Response.json({ estimates: [], message: 'All WBS items already have durations.' });
    }

    // Calibration: dated activities with a real duration (name + day-count) so the
    // model matches this project's real pace instead of guessing in a vacuum.
    // Zero-duration items are excluded so they don't pollute the baseline.
    const dated = wbs
      .filter((w) => w.planned_start && w.planned_end && w.planned_start !== w.planned_end)
      .map((w) => ({ name: w.name, wbs_code: w.wbs_code || '', days: durDays(w) }));

    const projectType = project?.project_type || 'plc';
    const typeHint = {
      plc: 'PLC / control panel build',
      plc_scada: 'PLC + SCADA integration',
      pme: 'power management & electrical',
      service: 'field service / commissioning',
      other: 'industrial automation',
    }[projectType] || 'industrial automation';

    const undatedCtx = undated.map((w) => {
      const preds = (w.predecessor_ids || []).map((id) => byId[id]).filter(Boolean);
      return {
        wbs_id: w.id,
        wbs_code: w.wbs_code || '',
        name: w.name || '',
        description: (w.description || '').slice(0, 300),
        status: w.status || '',
        weight: w.weight || 0,
        has_planned_start: !!w.planned_start,
        planned_start: w.planned_start || null,
        predecessors: preds.map((p) => ({
          wbs_code: p.wbs_code || '',
          name: p.name,
          planned_end: p.planned_end || null,
          days: durDays(p),
        })),
      };
    });

    const prompt = [
      `You are a senior project planner for industrial automation projects (${typeHint}).`,
      `Tasks span PLC programming, SCADA, control-panel build, wiring, testing, FAT/SAT, and commissioning.`,
      ``,
      `Below is a list of WBS activities that have NO planned end date (and some have no start date either).`,
      `Estimate a realistic DURATION IN WORKING DAYS (minimum 1) for each, using the project's already-dated`,
      `activities as a calibration baseline — a task similar to a dated one should get a similar duration.`,
      `Also consider the task name, description, status, weight, and its predecessors' durations.`,
      ``,
      `PROJECT DISCIPLINE: ${typeHint}`,
      ``,
      `DATED ACTIVITIES (calibration baseline — name: working-day duration):`,
      dated.length
        ? dated.map((d) => `- ${d.wbs_code ? d.wbs_code + ' ' : ''}${d.name}: ${d.days} day(s)`).join('\n')
        : '- (none yet — use domain judgement for industrial automation)',
      ``,
      `UNDATED ACTIVITIES TO ESTIMATE:`,
      JSON.stringify(undatedCtx, null, 2),
      ``,
      `Return a JSON object { "estimates": [ {wbs_id, estimated_duration_days, reason, confidence} ] }`,
      `where:`,
      `- estimated_duration_days is an integer >= 1 (working days)`,
      `- reason is one short line citing the calibration basis (e.g. "similar to 'Panel A wiring' which is 4 days" or "commissioning tasks here average 3 days")`,
      `- confidence is "low" | "medium" | "high" — "low" when there are no similar dated neighbours to calibrate against`,
      `Provide one estimate per undated activity, keyed by wbs_id.`,
    ].join('\n');

    let estimates = [];
    try {
      const llmRes = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt,
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
    } catch (err) {
      return Response.json({ error: 'AI estimation failed: ' + (err.message || err) }, { status: 502 });
    }

    // Derive proposed start/end for each estimate.
    const projectStart = project?.start_date || null;
    const result = estimates
      .map((e) => {
        const item = byId[e.wbs_id];
        if (!item) return null;
        const dur = Math.max(1, Math.round(e.estimated_duration_days || 1));

        let start;
        if (item.planned_start) {
          start = new Date(item.planned_start);
        } else {
          const preds = (item.predecessor_ids || []).map((id) => byId[id]).filter(Boolean);
          const predEnds = preds.map((p) => p.planned_end ? new Date(p.planned_end) : null).filter(Boolean);
          if (predEnds.length) {
            start = new Date(Math.max(...predEnds.map((d) => d.getTime())));
            start.setDate(start.getDate() + 1); // day after latest predecessor finish
          } else {
            start = projectStart ? new Date(projectStart) : new Date();
          }
        }

        // Never let an estimated start fall before a predecessor's finish.
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
        const end = addWorkingDays(start, dur);

        return {
          wbs_id: item.id,
          wbs_code: item.wbs_code || '',
          item_name: item.name,
          predecessors: preds.map((p) => p.wbs_code || p.name).join(', '),
          proposed_start: toISO(start),
          proposed_end: toISO(end),
          estimated_duration_days: dur,
          reason: e.reason || '',
          confidence: e.confidence || 'medium',
          had_planned_start: !!item.planned_start,
        };
      })
      .filter(Boolean);

    return Response.json({ estimates: result, undated_count: undated.length });
  } catch (err) {
    return Response.json({ error: err.message || 'Estimation failed' }, { status: 500 });
  }
});