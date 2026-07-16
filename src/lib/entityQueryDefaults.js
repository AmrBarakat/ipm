// Canonical sort + limit for project-scoped entity list queries.
// Using these constants everywhere (instead of hard-coded per-call values)
// unifies React Query cache keys, so multiple tabs viewing the same
// project share cached data instead of refetching independently.
export const ENTITY_QUERY = {
  WBSItem:     { sort: 'wbs_code',      limit: 2000 },
  Milestone:   { sort: 'planned_date',  limit: 500 },
  BOMItem:     { sort: '-created_date', limit: 2000 },
  Task:        { sort: '-created_date', limit: 1000 },
  Deliverable: { sort: '-created_date', limit: 500 },
};