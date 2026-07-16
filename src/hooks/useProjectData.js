import { useEntityList } from '@/hooks/useEntity';
import { ENTITY_QUERY } from '@/lib/entityQueryDefaults';

// Project-scoped datasets. When no project is selected, a sentinel filter
// returns [] quickly so we don't fetch the whole DB in Portfolio mode.
export function useProjectData(projectId) {
  const pid = projectId || '__none__';
  const milestones  = useEntityList('Milestone',  { project_id: pid }, ENTITY_QUERY.Milestone.sort,  ENTITY_QUERY.Milestone.limit);
  const wbsItems    = useEntityList('WBSItem',    { project_id: pid }, ENTITY_QUERY.WBSItem.sort,    ENTITY_QUERY.WBSItem.limit);
  const tasks       = useEntityList('Task',       { project_id: pid }, ENTITY_QUERY.Task.sort,       ENTITY_QUERY.Task.limit);
  const deliverables = useEntityList('Deliverable', { project_id: pid }, ENTITY_QUERY.Deliverable.sort, ENTITY_QUERY.Deliverable.limit);
  const bomItems    = useEntityList('BOMItem',    { project_id: pid }, ENTITY_QUERY.BOMItem.sort,    ENTITY_QUERY.BOMItem.limit);

  return {
    milestones: milestones.data || [],
    wbsItems: wbsItems.data || [],
    tasks: tasks.data || [],
    deliverables: deliverables.data || [],
    bomItems: bomItems.data || [],
    isLoading: milestones.isLoading || wbsItems.isLoading || tasks.isLoading ||
      deliverables.isLoading || bomItems.isLoading,
  };
}