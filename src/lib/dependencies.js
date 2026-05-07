/**
 * Given a flat list of tasks (each may have predecessor_ids),
 * compute the earliest_start for every task based on predecessor due_dates.
 * Returns a map: taskId -> { earliestStart: Date|null, delayed: boolean }
 */
export function computeDependencyImpact(tasks) {
  const byId = Object.fromEntries(tasks.map(t => [t.id, t]));
  const result = {};

  for (const task of tasks) {
    const predecessors = (task.predecessor_ids || [])
      .map(pid => byId[pid])
      .filter(Boolean);

    if (predecessors.length === 0) {
      result[task.id] = { earliestStart: null, delayed: false, predecessors: [] };
      continue;
    }

    // Earliest this task can start = max(predecessor.due_date) + 1 day
    let maxPredEnd = null;
    for (const pred of predecessors) {
      const d = pred.due_date ? new Date(pred.due_date) : null;
      if (d && (!maxPredEnd || d > maxPredEnd)) maxPredEnd = d;
    }

    if (!maxPredEnd) {
      result[task.id] = { earliestStart: null, delayed: false, predecessors };
      continue;
    }

    const earliestStart = new Date(maxPredEnd);
    earliestStart.setDate(earliestStart.getDate() + 1);

    const currentStart = task.start_date ? new Date(task.start_date) : null;
    const delayed = currentStart ? currentStart < earliestStart : false;

    result[task.id] = { earliestStart, delayed, predecessors };
  }

  return result;
}

/**
 * Format a date to YYYY-MM-DD string
 */
export function toDateStr(date) {
  return date.toISOString().split('T')[0];
}