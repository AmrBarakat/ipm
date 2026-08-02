import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * alertMilestoneDelayed
 *
 * Alerts the project manager when a milestone is delayed. Two invocation modes:
 *
 *  1. Entity automation (immediate): fires when a Milestone is updated and its
 *     status becomes "overdue". The payload carries the milestone in `data`; we
 *     create the notification at once.
 *  2. Scheduled daily scan: runs without a single milestone and walks every
 *     milestone, alerting on any whose planned_date is in the past but that
 *     isn't completed (the "exceeded its planned completion date" case).
 *
 * Dedup: once a milestone has been alerted (delay_alerted = true) it is not
 * alerted again, so neither repeated saves nor daily re-runs spam the feed.
 *
 * Auth: automation callers pass `x-automation-secret` matching AUTOMATION_SECRET;
 *       manual callers are authenticated via the user token. Either is accepted.
 */

// Business timezone — Saudi Arabia (UTC+3). "Today" for overdue detection is
// anchored to Asia/Riyadh so a milestone due late in the local day isn't treated
// as still-current by the UTC clock.
const BUSINESS_TZ = 'Asia/Riyadh';
function tzDateStr(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: BUSINESS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value || '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// A milestone counts as delayed if it's explicitly overdue, OR its planned
// completion date has passed without being completed.
function isDelayed(m, todayStr) {
  if (m.status === 'completed') return false;
  if (m.status === 'overdue') return true;
  if (m.planned_date && m.planned_date < todayStr) return true;
  return false;
}

function delayDays(m, todayStr) {
  if (!m.planned_date) return 0;
  const today = new Date(todayStr + 'T00:00:00Z');
  const planned = new Date(m.planned_date + 'T00:00:00Z');
  return Math.max(0, Math.round((today.getTime() - planned.getTime()) / 86400000));
}

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

    let body = {};
    try { body = await req.json(); } catch (_) { body = {}; }

    const todayStr = tzDateStr();

    // Project code cache (notifications carry project_code for the feed).
    const projectCache = {};
    async function getProjectCode(projectId) {
      if (!projectId) return '';
      if (projectCache[projectId]) return projectCache[projectId];
      try {
        const projects = await base44.asServiceRole.entities.Project.filter({ id: projectId });
        projectCache[projectId] = (projects[0] && projects[0].code) || projectId;
      } catch (_) { projectCache[projectId] = projectId; }
      return projectCache[projectId];
    }

    let alerted = 0;
    let skipped = 0;

    async function alertMilestone(m, reason) {
      // Dedup: only the first delay alert per milestone.
      if (m.delay_alerted) { skipped++; return; }
      if (!isDelayed(m, todayStr)) { skipped++; return; }

      const projectCode = await getProjectCode(m.project_id);
      const days = delayDays(m, todayStr);

      const title = `Milestone Delayed — ${m.title}`;
      const bodyTxt = reason === 'marked_overdue'
        ? `Milestone "${m.title}" in project ${projectCode} was marked overdue. Status: ${m.status}. Review the schedule.`
        : `Milestone "${m.title}" in project ${projectCode} is ${days} day${days === 1 ? '' : 's'} past its planned completion date (${m.planned_date}) and is not completed. Status: ${m.status}.`;

      await base44.asServiceRole.entities.Notification.create({
        project_id: m.project_id,
        project_code: projectCode,
        title,
        body: bodyTxt,
        severity: 'warning',
        link: `/projects/${m.project_id}?tab=milestones`,
        is_read: false,
      });

      await base44.asServiceRole.entities.Milestone.update(m.id, { delay_alerted: true });

      await base44.asServiceRole.entities.AuditLog.create({
        project_id: m.project_id,
        entity_type: 'Milestone',
        entity_id: m.id,
        action: 'delay_alerted',
        actor: 'system',
        summary: `Milestone "${m.title}" delay alert sent (${reason}).`,
        metadata: {
          title: m.title,
          status: m.status,
          planned_date: m.planned_date,
          delay_days: days,
        },
      });

      alerted++;
    }

    // ── Entity-automation mode: a single milestone was just updated ───────
    const singleMilestone = body.data || null;
    if (singleMilestone && singleMilestone.id) {
      const reason = singleMilestone.status === 'overdue' ? 'marked_overdue' : 'exceeded_plan';
      await alertMilestone(singleMilestone, reason);
      return Response.json({ success: true, mode: 'entity', today: todayStr, alerted, skipped });
    }

    // ── Scheduled mode: scan every milestone ──────────────────────────────
    const milestones = await base44.asServiceRole.entities.Milestone.list('-created_date', 2000);
    for (const m of milestones) {
      if (!isDelayed(m, todayStr)) continue;
      await alertMilestone(m, m.status === 'overdue' ? 'marked_overdue' : 'exceeded_plan');
    }

    return Response.json({
      success: true,
      mode: 'scheduled',
      today: todayStr,
      checked: milestones.length,
      alerted,
      skipped,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});