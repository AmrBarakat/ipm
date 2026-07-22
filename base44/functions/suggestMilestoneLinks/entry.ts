import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { requirePrivilege } from '../../shared/requirePrivilege.ts';

// Scored auto-link engine: for each leaf WBS item without a milestone_id, rank
// every milestone and return a best suggestion + coverage stats so the user can
// review gaps in one place. Auth: user (401 if not logged in).

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'at', 'by',
  'with', 'from', 'as', 'is', 'are', 'be', 'this', 'that',
]);

function norm(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokens(s) {
  return norm(s).split(' ').filter((t) => t && !STOPWORDS.has(t));
}

// Acronym/initials token for multi-word labels (e.g. "Factory Acceptance Test" → "fat"),
// so an item literally named "FAT" matches a milestone titled "Factory Acceptance Test".
function initialsToken(s) {
  const ws = norm(s).split(' ').filter(Boolean);
  if (ws.length < 2) return null;
  const ini = ws.map((w) => w[0]).join('');
  return /^[a-z]+$/.test(ini) ? ini : null;
}

function tokenSet(s) {
  const set = new Set(tokens(s));
  const ini = initialsToken(s);
  if (ini) set.add(ini);
  return set;
}

function daysBetween(a, b) {
  if (!a || !b) return null;
  const da = new Date(a + 'T00:00:00Z');
  const db = new Date(b + 'T00:00:00Z');
  return Math.round((db - da) / 86400000);
}

function scoreItemToMilestone(item, ms, milestonesByDate, siblingMs) {
  // 1. Imported title exact match → 100.
  let titleMatch = 0;
  if (item.milestone_title && norm(item.milestone_title) === norm(ms.title)) titleMatch = 100;

  // 2. Date-window: item.planned_end after previous milestone's date and on/before
  //    this milestone's planned_date → up to 80 by closeness to this milestone's date.
  let dateScore = 0;
  if (item.planned_end && ms.planned_date) {
    const idx = milestonesByDate.findIndex((m) => m.id === ms.id);
    const prevDate = idx > 0 ? milestonesByDate[idx - 1].planned_date : null;
    const afterPrev = !prevDate || (daysBetween(prevDate, item.planned_end) ?? 0) > 0;
    const daysBefore = daysBetween(item.planned_end, ms.planned_date) ?? 0;
    const onOrBefore = daysBefore >= 0;
    if (afterPrev && onOrBefore) {
      const closeness = 1 - Math.min(1, daysBefore / 30);
      dateScore = Math.round(80 * closeness);
    }
  }

  // 3. Sibling affinity: a sibling under the same parent already linked to this milestone → +20.
  const sibling = siblingMs.has(ms.id) ? 20 : 0;

  // 4. Keyword overlap (token sets + initials for acronyms) → up to 60.
  let kwScore = 0;
  const it = tokenSet(item.name || '');
  const mt = tokenSet(ms.title || '');
  if (it.size && mt.size) {
    let inter = 0;
    for (const t of it) if (mt.has(t)) inter++;
    const ratio = inter / Math.min(it.size, mt.size);
    kwScore = Math.round(60 * Math.min(1, ratio));
  }

  // base = strongest primary signal; sibling is an additive bonus on top.
  const base = Math.max(titleMatch, dateScore, kwScore);
  return Math.min(100, base + sibling);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const denied = requirePrivilege(user, 'view');
    if (denied) return denied;

    const body = await req.json().catch(() => ({}));
    const projectId = body?.project_id || body?.data?.project_id;
    if (!projectId) return Response.json({ error: 'project_id required' }, { status: 400 });

    const [items, milestones] = await Promise.all([
      base44.asServiceRole.entities.WBSItem.filter({ project_id: projectId }, 'wbs_code', 2000),
      base44.asServiceRole.entities.Milestone.filter({ project_id: projectId }, 'planned_date', 1000),
    ]);

    if (milestones.length === 0) {
      return Response.json({
        suggestions: [],
        coverage: { orphan_count: items.length, orphans: [], empty_milestones: 0, empty_milestone_list: [] },
      });
    }

    // Leaf items = have no children. Only unlinked leaves are candidates.
    const parentIds = new Set(items.map((i) => i.parent_id).filter(Boolean));
    const leaves = items.filter((i) => !i.milestone_id && !parentIds.has(i.id));

    // Milestones with a planned_date, sorted ascending, for previous-milestone lookup.
    const milestonesByDate = milestones
      .filter((m) => m.planned_date)
      .sort((a, b) => (a.planned_date < b.planned_date ? -1 : a.planned_date > b.planned_date ? 1 : 0));

    // Sibling affinity index: parent_id → set of milestone_ids already linked by siblings.
    const byParent = {};
    items.forEach((i) => { if (i.parent_id) (byParent[i.parent_id] ||= []).push(i); });

    const suggestions = [];
    const orphans = [];

    for (const item of leaves) {
      const siblingMs = new Set();
      if (item.parent_id) {
        (byParent[item.parent_id] || []).forEach((s) => {
          if (s.milestone_id && s.id !== item.id) siblingMs.add(s.milestone_id);
        });
      }

      const ranked = milestones
        .map((ms) => ({ milestone_id: ms.id, title: ms.title, score: scoreItemToMilestone(item, ms, milestonesByDate, siblingMs) }))
        .sort((a, b) => b.score - a.score);

      const best = ranked[0];
      const runnerUpScore = ranked[1] ? ranked[1].score : 0;
      const auto = !!best && best.score >= 70 && (best.score - runnerUpScore) >= 15;

      suggestions.push({
        wbs_id: item.id,
        wbs_code: item.wbs_code,
        name: item.name,
        best: best ? { milestone_id: best.milestone_id, title: best.title, score: best.score } : null,
        runner_up_score: runnerUpScore,
        auto,
        ranked: ranked.slice(0, 5),
      });

      if (!auto) orphans.push({ wbs_id: item.id, wbs_code: item.wbs_code, name: item.name });
    }

    // Empty milestones = no WBS item linked to them.
    const linkedMs = new Set(items.map((i) => i.milestone_id).filter(Boolean));
    const emptyMilestoneList = milestones
      .filter((m) => !linkedMs.has(m.id))
      .map((m) => ({ milestone_id: m.id, title: m.title, planned_date: m.planned_date }));

    return Response.json({
      suggestions,
      coverage: {
        orphan_count: orphans.length,
        orphans,
        empty_milestones: emptyMilestoneList.length,
        empty_milestone_list: emptyMilestoneList,
      },
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});