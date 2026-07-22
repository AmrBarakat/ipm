import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useEntityList } from '@/hooks/useEntity';
import { useQueryClient } from '@tanstack/react-query';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { Users as UsersIcon, CheckCircle, Ban, Clock, Loader2 } from 'lucide-react';

const PRIVILEGES = [
  { value: 'view', label: 'View-only' },
  { value: 'modify', label: 'Modify' },
  { value: 'create', label: 'Create' },
];

const STATUS = {
  pending: { bg: 'bg-amber-100', text: 'text-amber-700', icon: Clock, label: 'Pending' },
  approved: { bg: 'bg-emerald-100', text: 'text-emerald-700', icon: CheckCircle, label: 'Approved' },
  suspended: { bg: 'bg-red-100', text: 'text-red-700', icon: Ban, label: 'Suspended' },
};

const inp = 'border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white';

function todayLocal() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Admin-only user management. Lists every user, lets the admin approve / suspend,
 * set privilege (view / modify / create), and promote/demote admin role — with a
 * last-admin guard and confirm dialogs. All writes go through base44.entities.User.update;
 * FLS restricts these fields to admins server-side, so a non-admin caller is rejected
 * even if the request is crafted manually.
 */
export default function UsersSection({ currentUser }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { data: users = [], isLoading } = useEntityList('User', {}, '-created_date', 500);
  const [busyId, setBusyId] = useState(null);

  const pendingCount = users.filter((u) => u.account_status === 'pending').length;
  const adminCount = users.filter((u) => u.role === 'admin').length;
  const adminEmail = currentUser?.email;

  async function patch(id, data, label) {
    setBusyId(id);
    try {
      await base44.entities.User.update(id, data);
      await queryClient.invalidateQueries({ queryKey: ['User'] });
    } catch (e) {
      alert(`${label} failed: ${e?.response?.data?.error || e?.message || 'Unknown error'}`);
    } finally {
      setBusyId(null);
    }
  }

  async function approve(u) {
    await patch(u.id, { account_status: 'approved', approved_by: adminEmail, approved_at: todayLocal() }, 'Approve');
  }
  async function reapprove(u) {
    await patch(u.id, { account_status: 'approved', approved_by: adminEmail, approved_at: todayLocal() }, 'Re-approve');
  }
  async function suspend(u) {
    if (!(await confirm({
      title: `Suspend ${u.full_name || u.email}?`,
      description: 'They will lose access immediately and see the pending screen on next sign-in.',
      destructive: true, confirmText: 'Suspend',
    }))) return;
    await patch(u.id, { account_status: 'suspended' }, 'Suspend');
  }
  async function setPrivilege(u, priv) {
    await patch(u.id, { privilege: priv }, 'Set privilege');
  }
  async function toggleAdmin(u) {
    if (u.role === 'admin') {
      if (adminCount <= 1) { alert('Cannot demote the last remaining admin.'); return; }
      if (!(await confirm({
        title: `Demote ${u.full_name || u.email}?`,
        description: 'They will lose admin privileges but keep their current access level.',
        destructive: true, confirmText: 'Demote',
      }))) return;
      await patch(u.id, { role: 'user' }, 'Demote');
    } else {
      if (!(await confirm({
        title: `Promote ${u.full_name || u.email} to admin?`,
        description: 'They will have full admin privileges, including user management.',
        confirmText: 'Promote',
      }))) return;
      await patch(u.id, { role: 'admin' }, 'Promote');
    }
  }

  return (
    <section className="bg-white rounded-lg shadow-sm border border-slate-200 p-5 mb-4">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-8 h-8 rounded-md bg-slate-100 flex items-center justify-center text-slate-500 shrink-0">
          <UsersIcon className="w-4 h-4" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-slate-800">User Management</h2>
            {pendingCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
                {pendingCount} pending
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500">
            Approve new sign-ups and set each user's access level. New sign-ups appear here as Pending until you approve them.
            Base44 handles authentication (email/password + SSO); this layer governs access after sign-in.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
      ) : users.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-4">No users found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-400 uppercase border-b border-slate-200">
              <tr>
                <th className="text-left py-2 pr-3">Name</th>
                <th className="text-left py-2 pr-3">Email</th>
                <th className="text-left py-2 pr-3">Status</th>
                <th className="text-left py-2 pr-3">Privilege</th>
                <th className="text-left py-2 pr-3">Approved by</th>
                <th className="text-left py-2 pr-3">Last active</th>
                <th className="text-right py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const st = STATUS[u.account_status] || STATUS.pending;
                const StatusIcon = st.icon;
                const isSelf = u.id === currentUser?.id;
                const isBusy = busyId === u.id;
                const isAdmin = u.role === 'admin';
                return (
                  <tr key={u.id} className="border-b border-slate-100">
                    <td className="py-2 pr-3">
                      <div className="font-medium text-slate-800">{u.full_name || '—'}</div>
                      {isAdmin && <span className="text-xs text-amber-600 font-semibold">Admin</span>}
                    </td>
                    <td className="py-2 pr-3 text-slate-600">{u.email}</td>
                    <td className="py-2 pr-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${st.bg} ${st.text}`}>
                        <StatusIcon className="w-3 h-3" /> {st.label}
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      <select
                        value={u.privilege || 'view'}
                        disabled={isBusy || isSelf || isAdmin}
                        onChange={(e) => setPrivilege(u, e.target.value)}
                        className={inp}
                        style={{ minWidth: 110 }}
                      >
                        {PRIVILEGES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                      </select>
                    </td>
                    <td className="py-2 pr-3 text-slate-500 text-xs">{u.approved_by || '—'}</td>
                    <td className="py-2 pr-3 text-slate-400 text-xs">
                      {u.updated_date ? new Date(u.updated_date).toLocaleDateString() : '—'}
                    </td>
                    <td className="py-2 text-right">
                      <div className="inline-flex items-center gap-1">
                        {isBusy && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
                        {!isBusy && u.account_status !== 'approved' && (
                          <button onClick={() => approve(u)} className="px-2 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded">Approve</button>
                        )}
                        {!isBusy && u.account_status === 'approved' && !isSelf && (
                          <button onClick={() => suspend(u)} className="px-2 py-1 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded">Suspend</button>
                        )}
                        {!isBusy && u.account_status === 'suspended' && (
                          <button onClick={() => reapprove(u)} className="px-2 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded">Re-approve</button>
                        )}
                        {!isBusy && !isSelf && (
                          <button onClick={() => toggleAdmin(u)} className="px-2 py-1 text-xs font-medium text-slate-600 border border-slate-200 hover:bg-slate-50 rounded">
                            {isAdmin ? 'Demote' : 'Make Admin'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}