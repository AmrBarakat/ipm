/**
 * Privilege helpers shared by user-facing backend functions.
 *
 * Base44 provides managed authentication (email/password + SSO) and the built-in
 * role system. This layer checks the app-managed account_status + privilege
 * fields AFTER authentication — it never handles passwords or credentials.
 *
 * Automation-secret functions bypass this (they run as the system service role).
 *
 * Usage:
 *   const user = await base44.auth.me().catch(() => null);
 *   const denied = requirePrivilege(user, 'modify');
 *   if (denied) return denied;
 */
export type PrivilegeLevel = 'view' | 'modify' | 'create';

export function hasPrivilege(user: any, level: PrivilegeLevel): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.account_status !== 'approved') return false;
  const p = user.privilege || 'view';
  if (level === 'view') return true;
  if (level === 'modify') return p === 'modify' || p === 'create';
  if (level === 'create') return p === 'create';
  return false;
}

/** Returns a 401/403 Response if the user lacks the privilege, else null. */
export function requirePrivilege(user: any, level: PrivilegeLevel): Response | null {
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPrivilege(user, level)) {
    return Response.json(
      { error: `This action requires "${level}" privilege and an approved account.` },
      { status: 403 }
    );
  }
  return null;
}