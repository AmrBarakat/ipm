import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

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
 * Mutation wrapper for create/update/delete on an entity.
 * Automatically invalidates that entity's queryKey on success so React Query refetches.
 *
 * Usage:
 *   const { mutateAsync } = useEntityMutation('Invoice');
 *   await create(data)    // { action: 'create', data }
 *   await update(data)    // { action: 'update', id, data }
 *   await remove(data)    // { action: 'delete', id }
 */
export function useEntityMutation(entityName) {
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
    },
  });
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