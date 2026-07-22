import { base44 } from '@/api/base44Client';

// Fire-and-forget activity-logger for the central feed. Used by UI export flows
// (report/PDF/Excel generation) to record what happened. Never throws — logging
// must not break the user's export.
export function logActivity({ entity_type, entity_id, action, summary, project_id, metadata }) {
  if (!entity_type || !summary) return Promise.resolve();
  return base44.functions
    .invoke('logActivity', { entity_type, entity_id, action, summary, project_id, metadata })
    .catch(() => {});
}