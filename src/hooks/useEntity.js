import { useQuery, useMutation, useQueryClient, useInfiniteQuery, keepPreviousData } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from '@/components/ui/use-toast';

/**
 * Fetch a list of entities with optional filter/sort/limit.
 * - If filterObj is provided (non-null), uses .filter(filterObj, sort, limit)
 * - Otherwise uses .list(sort, limit)
 * queryKey: [entityName, filterObj, sort, limit]
 */
export function useEntityList(entityName, filterObj, sort, limit) {
  const queryKey = [entityName, filterObj, sort, limit];
  return useQuery({
    queryKey,
    queryFn: async () => {
      const entity = base44.entities[entityName];
      if (filterObj != null) {
        return await entity.filter(filterObj, sort, limit);
      }
      return await entity.list(sort, limit);
    },
  });
}

/**
 * Paginated ("load more") list using useInfiniteQuery.
 * filterObj is sent server-side; pageSize items per page, skip = pageParam.
 * Returns { items, hasNextPage, fetchNextPage, isFetchingNextPage, isLoading, isFetching, ...query }
 */
export function useEntityInfiniteList(entityName, filterObj, sort, pageSize = 25) {
  const queryKey = [entityName, 'infinite', filterObj, sort, pageSize];
  const query = useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam = 0 }) => {
      const entity = base44.entities[entityName];
      return await entity.filter(filterObj || {}, sort, pageSize, pageParam);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastPageParam) =>
      lastPage.length === pageSize ? lastPageParam + pageSize : undefined,
    placeholderData: keepPreviousData,
  });
  const items = query.data?.pages.flat() ?? [];
  return { ...query, items };
}

/**
 * Mutation wrapper for create/update/delete on an entity.
 * Automatically invalidates that entity's queryKey on success so React Query refetches.
 *
 * Usage:
 *   const { mutateAsync } = useEntityMutation('Invoice');
 *   await create(data)    // { action: 'create', data }
 *   await update(data)    // { action: 'update', id, data }
 *   await remove(data)    // { action: 'delete', id }
 *
 * relatedKeys: optional array of extra entity names whose queries should also be
 *   invalidated on success — for tightly linked entities so a screen showing both
 *   refetches together. e.g. editing a WBS item must refresh Tasks that carry
 *   wbs:/milestone_id tags derived from it: useEntityMutation('WBSItem', ['Task']).
 */
export function useEntityMutation(entityName, relatedKeys = []) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ action, id, data }) => {
      const entity = base44.entities[entityName];
      if (action === 'create') return await entity.create(data);
      if (action === 'update') return await entity.update(id, data);
      if (action === 'delete') return await entity.delete(id);
      throw new Error(`Unknown mutation action: ${action}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [entityName] });
      relatedKeys.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
    },
    onError: (error, variables) => {
      toast({
        title: `Failed to ${variables?.action || 'save'} ${entityName}`,
        description: error?.message || 'Unknown error',
        variant: 'destructive',
      });
    },
  });
}

/**
 * Run an array of mutation promises with Promise.allSettled so one rejection
 * doesn't abort the rest. Surfaces a summary toast when any fail.
 * Returns { succeeded, failed, total }.
 */
export async function runBatch(promises, label = 'items') {
  const results = await Promise.allSettled(promises);
  const failed = results.filter(r => r.status === 'rejected').length;
  const succeeded = results.length - failed;
  if (failed > 0) {
    toast({
      title: `${succeeded} succeeded, ${failed} failed`,
      description: `${failed} of ${results.length} ${label} could not be completed.`,
      variant: 'destructive',
    });
  }
  return { succeeded, failed, total: results.length };
}

/**
 * Convenience hook returning loading + error booleans for a query.
 */
export function useEntityQueryState(query) {
  return {
    loading: query.isLoading,
    error: query.isError ? query.error : null,
  };
}