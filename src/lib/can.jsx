import { useAuth } from '@/lib/AuthContext';

/**
 * Centralized privilege helpers. Base44 owns authentication; this layer governs
 * what an authenticated user may DO, based on the app-managed privilege field
 * (view / modify / create) plus the built-in admin role.
 *
 *   canView   — approved (any privilege) or admin
 *   canModify — admin, or privilege 'modify' / 'create'
 *   canCreate — admin, or privilege 'create'
 *
 * Use the <Can> wrapper to hide mutating controls, or useCan() for finer-grained
 * disabled states. RLS is the real security boundary; UI gating is convenience.
 */
export function useCan() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isApproved = isAdmin || user?.account_status === 'approved';
  const priv = user?.privilege || 'view';
  return {
    isAdmin,
    isApproved,
    canView: isApproved,
    canModify: isAdmin || priv === 'modify' || priv === 'create',
    canCreate: isAdmin || priv === 'create',
    privilege: priv,
    accountStatus: user?.account_status,
  };
}

/**
 * <Can create> … </Can>   renders children only if canCreate
 * <Can modify> … </Can>   renders children only if canModify
 * <Can create fallback={...}> renders fallback (default null) when denied
 */
export function Can({ modify, create, children, fallback = null }) {
  const { canModify, canCreate } = useCan();
  if (create && !canCreate) return fallback;
  if (modify && !canModify) return fallback;
  return children;
}