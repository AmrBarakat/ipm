// ── Gantt scheduling utilities: date math, CPM critical path, tree rows ──────
import { toLocalDate } from '@/lib/utils';

export const ROW_H = 38;
export const HEADER_H = 44; // two tiers
export const MIN_LEFT_WIDTH = 200;
export const MAX_LEFT_WIDTH = 520;

// Time scales: px per day. "Day" = most zoomed-in.
export const TIME_SCALES = [
  { key: 'day',     label: 'Day',     dayWidth: 44 },
  { key: 'week',    label: 'Week',    dayWidth: 16 },
  { key: 'month',   label: 'Month',   dayWidth: 7  },
  { key: 'quarter', label: 'Quarter', dayWidth: 3.2 },
  { key: 'year',    label: 'Year',    dayWidth: 1.6 },
];

export function scaleByKey(key) {
  return TIME_SCALES.find(s => s.key === key) || TIME_SCALES[1];
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}
export function daysBetween(a, b) {
  if (!a || !b) return 0;
  const da = new Date(a); da.setHours(0, 0, 0, 0);
  const db = new Date(b); db.setHours(0, 0, 0, 0);
  return Math.round((db - da) / 86400000);
}
export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
export function toISO(date) {
  return toLocalDate(date);
}
export function isWeekend(date) {
  const day = new Date(date).getDay();
  return day === 0 || day === 6;
}

/** Project bounds across WBS + milestones + project dates. */
export function projectBounds(wbsItems, milestones, project) {
  const dates = [];
  if (project?.start_date) dates.push(new Date(project.start_date));
  if (project?.target_completion_date) dates.push(new Date(project.target_completion_date));
  (wbsItems || []).forEach(w => {
    if (w.planned_start) dates.push(new Date(w.planned_start));
    if (w.planned_end) dates.push(new Date(w.planned_end));
  });
  (milestones || []).forEach(m => { if (m.planned_date) dates.push(new Date(m.planned_date)); });
  if (dates.length === 0) {
    const now = new Date();
    return { start: addDays(now, -15), end: addDays(now, 45) };
  }
  const min = new Date(Math.min(...dates.map(d => d.getTime())));
  const max = new Date(Math.max(...dates.map(d => d.getTime())));
  return { start: addDays(min, -7), end: addDays(max, 21) };
}

/** Build an ordered flat row list: milestone rows first, then WBS tree (respecting expansion). */
export function buildRows(wbsItems, milestones, expanded) {
  const rows = [];
  const msSorted = [...(milestones || [])].filter(m => m.planned_date).sort((a, b) => new Date(a.planned_date) - new Date(b.planned_date));
  msSorted.forEach(m => rows.push({ kind: 'milestone', id: m.id, data: m, depth: 0, hasChildren: false }));

  const items = wbsItems || [];
  const idSet = new Set(items.map(i => i.id));
  const byParent = {};
  // Orphan guard: if an item's parent_id points to a parent NOT in this list
  // (deleted / filtered out / stale), treat it as a top-level (__root__) row so
  // it still renders. No WBS item may ever be silently dropped from the tree.
  items.forEach(i => {
    const p = (i.parent_id && idSet.has(i.parent_id)) ? i.parent_id : '__root__';
    (byParent[p] ||= []).push(i);
  });
  Object.values(byParent).forEach(arr =>
    arr.sort((a, b) => (a.wbs_code || '').localeCompare(b.wbs_code || '', undefined, { numeric: true }))
  );
  function walk(parentId, depth) {
    for (const item of (byParent[parentId] || [])) {
      const isParent = (byParent[item.id] || []).length > 0;
      rows.push({ kind: 'wbs', id: item.id, data: item, depth, hasChildren: isParent });
      if (isParent && expanded[item.id]) walk(item.id, depth + 1);
    }
  }
  walk('__root__', 0);
  return rows;
}

// ── Critical Path Method (CPM) over WBS items with planned dates ─────────────
/**
 * Returns { criticalIds:Set, float:Map(id->days), projectDurationDays, projectFinish, epoch }
 * Only items with planned_start && planned_end participate.
 */
export function computeCriticalPath(wbsItems) {
  const items = (wbsItems || []).filter(w => w.planned_start && w.planned_end);
  if (items.length === 0) {
    return { criticalIds: new Set(), float: new Map(), projectDurationDays: 0, projectFinish: null, epoch: null };
  }
  const byId = Object.fromEntries(items.map(i => [i.id, i]));
  const epoch = new Date(Math.min(...items.map(i => new Date(i.planned_start).getTime())));

  const dur = id => Math.max(1, daysBetween(byId[id].planned_start, byId[id].planned_end));
  // start offset in days from epoch
  const startOffset = id => daysBetween(epoch, byId[id].planned_start);

  const successors = {};
  items.forEach(i => {
    (i.predecessor_ids || []).forEach(predId => {
      if (byId[predId]) { (successors[predId] ||= []).push(i.id); }
    });
  });
  const inDeg = {};
  items.forEach(i => { inDeg[i.id] = (i.predecessor_ids || []).filter(p => byId[p]).length; });
  const queue = items.filter(i => inDeg[i.id] === 0).map(i => i.id);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    (successors[id] || []).forEach(sid => {
      inDeg[sid] = (inDeg[sid] || 0) - 1;
      if (inDeg[sid] === 0) queue.push(sid);
    });
  }
  // Forward pass
  const es = {}, ef = {};
  order.forEach(id => {
    const preds = (byId[id].predecessor_ids || []).filter(p => byId[p]);
    es[id] = preds.length === 0 ? startOffset(id) : Math.max(...preds.map(p => ef[p] ?? 0));
    ef[id] = es[id] + dur(id);
  });
  const projectDuration = Math.max(...Object.values(ef));
  // Backward pass
  const lf = {}, ls = {};
  [...order].reverse().forEach(id => {
    const succs = (successors[id] || []).filter(s => byId[s]);
    lf[id] = succs.length === 0 ? projectDuration : Math.min(...succs.map(s => ls[s] ?? Infinity));
    ls[id] = lf[id] - dur(id);
  });
  const criticalIds = new Set();
  const float = new Map();
  items.forEach(i => {
    const totalFloat = (ls[i.id] ?? 0) - (es[i.id] ?? 0);
    float.set(i.id, Math.max(0, Math.round(totalFloat * 10) / 10));
    if (Math.abs(totalFloat) <= 0.5) criticalIds.add(i.id);
  });
  return { criticalIds, float, projectDurationDays: Math.round(projectDuration), projectFinish: addDays(epoch, projectDuration), epoch };
}

// ── Header tick generation ───────────────────────────────────────────────────
/**
 * Returns { minor: [{label, day, wDays}], major: [{label, day, wDays}] }
 * `day` is offset from timelineStart; wDays is width in days.
 */
export function buildHeader(timelineStart, totalDays, scaleKey) {
  const minor = [];
  const major = [];
  const start = new Date(timelineStart);
  if (scaleKey === 'day') {
    // minor = each day (cap density)
    const step = totalDays > 120 ? 7 : 1;
    for (let d = 0; d < totalDays; d += step) {
      const dt = addDays(start, d);
      minor.push({ label: step === 1 ? `${dt.toLocaleDateString('en', { weekday: 'narrow' })}${dt.getDate()}` : `W${Math.ceil((d + 1) / 7)}`, day: d, wDays: step });
    }
    pushMonthMajors(major, start, totalDays);
  } else if (scaleKey === 'week') {
    for (let d = 0; d < totalDays; d += 7) {
      const dt = addDays(start, d);
      minor.push({ label: `${dt.toLocaleDateString('en', { month: 'short' })} W${Math.ceil(dt.getDate() / 7)}`, day: d, wDays: 7 });
    }
    pushMonthMajors(major, start, totalDays);
  } else if (scaleKey === 'month') {
    let cur = new Date(start.getFullYear(), start.getMonth(), 1);
    let d = daysBetween(start, cur);
    while (d < totalDays) {
      const next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      const wDays = Math.min(daysBetween(cur, next), totalDays - d);
      minor.push({ label: cur.toLocaleDateString('en', { month: 'short' }), day: d, wDays: Math.max(1, wDays) });
      cur = next; d = daysBetween(start, cur);
    }
    pushYearMajors(major, start, totalDays);
  } else if (scaleKey === 'quarter') {
    let cur = new Date(start.getFullYear(), Math.floor(start.getMonth() / 3) * 3, 1);
    let d = daysBetween(start, cur);
    while (d < totalDays) {
      const next = new Date(cur.getFullYear(), cur.getMonth() + 3, 1);
      const q = Math.floor(cur.getMonth() / 3) + 1;
      const wDays = Math.min(daysBetween(cur, next), totalDays - d);
      minor.push({ label: `Q${q}`, day: d, wDays: Math.max(1, wDays) });
      cur = next; d = daysBetween(start, cur);
    }
    pushYearMajors(major, start, totalDays);
  } else { // year
    let cur = new Date(start.getFullYear(), 0, 1);
    let d = daysBetween(start, cur);
    while (d < totalDays) {
      const next = new Date(cur.getFullYear() + 1, 0, 1);
      const wDays = Math.min(daysBetween(cur, next), totalDays - d);
      minor.push({ label: String(cur.getFullYear()), day: d, wDays: Math.max(1, wDays) });
      cur = next; d = daysBetween(start, cur);
    }
    // major every 5 years
    let y = new Date(start.getFullYear(), 0, 1);
    let dy = daysBetween(start, y);
    while (dy < totalDays) {
      const span = Math.min(5 * 365, totalDays - dy);
      major.push({ label: `${y.getFullYear()}+`, day: dy, wDays: Math.max(1, span) });
      y = new Date(y.getFullYear() + 5, 0, 1); dy = daysBetween(start, y);
    }
  }
  return { minor, major };
}

function pushMonthMajors(major, start, totalDays) {
  let cur = new Date(start.getFullYear(), start.getMonth(), 1);
  let d = daysBetween(start, cur);
  while (d < totalDays) {
    const next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    major.push({ label: cur.toLocaleDateString('en', { month: 'long', year: 'numeric' }), day: d, wDays: Math.max(1, daysBetween(cur, next)) });
    cur = next; d = daysBetween(start, cur);
  }
}
function pushYearMajors(major, start, totalDays) {
  let cur = new Date(start.getFullYear(), 0, 1);
  let d = daysBetween(start, cur);
  while (d < totalDays) {
    const next = new Date(cur.getFullYear() + 1, 0, 1);
    major.push({ label: String(cur.getFullYear()), day: d, wDays: Math.max(1, daysBetween(cur, next)) });
    cur = next; d = daysBetween(start, cur);
  }
}

/** Weekend columns across the timeline (only when reasonable density). */
export function buildWeekends(timelineStart, totalDays, scaleKey) {
  if (scaleKey === 'quarter' || scaleKey === 'year') return [];
  const out = [];
  for (let d = 0; d < totalDays; d++) {
    const dt = addDays(timelineStart, d);
    if (isWeekend(dt)) out.push({ day: d, wDays: 1 });
  }
  return out;
}

// ── Tree move (reparent / reorder) → list of WBS field updates ───────────────
/**
 * computeTreeMove(allItems, dragId, targetId, position)
 * position: 'child' | 'before' | 'after'
 * Returns array of { id, parent_id?, wbs_code } for items whose parent or code changed.
 */
export function computeTreeMove(allItems, dragId, targetId, position) {
  if (dragId === targetId) return [];
  // prevent dropping into own descendant
  const byId = Object.fromEntries(allItems.map(i => [i.id, i]));
  let t = targetId;
  while (t) {
    if (t === dragId) return [];
    t = byId[t]?.parent_id;
  }
  const byParent = {};
  allItems.forEach(i => { const p = i.parent_id || '__root__'; (byParent[p] ||= []).push(i); });
  Object.values(byParent).forEach(arr => arr.sort((a, b) => (a.wbs_code || '').localeCompare(b.wbs_code || '', undefined, { numeric: true })));

  function renumber(parentId, list) {
    const parentCode = parentId === '__root__' ? '' : (byId[parentId]?.wbs_code || '');
    return list.map((item, idx) => {
      const code = parentCode ? `${parentCode}.${idx + 1}` : String(idx + 1);
      return { id: item.id, parent_id: parentId === '__root__' ? null : parentId, wbs_code: code };
    });
  }

  let newParentId, orderedList;
  if (position === 'child') {
    newParentId = targetId;
    const sibs = (byParent[targetId] || []).filter(i => i.id !== dragId);
    orderedList = renumber(targetId, [...sibs, byId[dragId]]);
  } else {
    const target = byId[targetId];
    newParentId = target.parent_id || '__root__';
    const sibs = (byParent[newParentId] || []).filter(i => i.id !== dragId);
    const targetIdx = sibs.findIndex(i => i.id === targetId);
    if (targetIdx < 0) return [];
    const insertAt = position === 'before' ? targetIdx : targetIdx + 1;
    sibs.splice(insertAt, 0, byId[dragId]);
    orderedList = renumber(newParentId, sibs);
  }

  const updates = [];
  orderedList.forEach(u => {
    const orig = byId[u.id];
    if (orig.parent_id !== u.parent_id || orig.wbs_code !== u.wbs_code) {
      updates.push({ id: u.id, parent_id: u.parent_id, wbs_code: u.wbs_code });
    }
  });
  return updates;
}