import { useEntityList } from '@/hooks/useEntity';

// Project-scoped datasets. When no project is selected, a sentinel filter
// returns [] quickly so we don't fetch the whole DB in Portfolio mode.
export function useProjectData(projectId) {
  const pid = projectId || '__none__';
  const milestones  = useEntityList('Milestone',  { project_id: pid }, 'planned_date',  500);
  const wbsItems    = useEntityList('WBSItem',    { project_id: pid }, 'wbs_code',      1000);
  const tasks       = useEntityList('Task',       { project_id: pid }, '-created_date', 500);
  const deliverables = useEntityList('Deliverable', { project_id: pid }, '-created_date', 500);
  const bomItems    = useEntityList('BOMItem',    { project_id: pid }, '-created_date', 1000);

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