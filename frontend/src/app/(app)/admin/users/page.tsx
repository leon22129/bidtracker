'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { canManageUsers, roleLabel } from '@/lib/permissions';
import { ROLES, type Role, type User } from '@/lib/types';
import { useToast } from '@/components/ui/toast';

type UserStatusFilter = 'active' | 'deactivated' | 'all';
type UserRow = { user: User; depth: number; startsAdminGroup?: boolean };

function groupUsersByManager(users: User[], depth = 0): UserRow[] {
  const managers = users.filter((user) => user.role === 'bidder_manager');
  const visibleManagerIds = new Set(managers.map((user) => user.id));
  const biddersByManager = new Map<string, User[]>();
  const groupedBidderIds = new Set<string>();

  for (const user of users) {
    if (
      user.role !== 'bidder'
      || !user.manager_user_id
      || !visibleManagerIds.has(user.manager_user_id)
    ) continue;

    const managerBidders = biddersByManager.get(user.manager_user_id) ?? [];
    managerBidders.push(user);
    biddersByManager.set(user.manager_user_id, managerBidders);
    groupedBidderIds.add(user.id);
  }

  const rows: UserRow[] = [];
  for (const manager of managers) {
    rows.push({ user: manager, depth });
    for (const bidder of biddersByManager.get(manager.id) ?? []) {
      rows.push({ user: bidder, depth: depth + 1 });
    }
  }

  for (const user of users) {
    if (user.role !== 'bidder_manager' && !groupedBidderIds.has(user.id)) {
      rows.push({ user, depth });
    }
  }

  return rows;
}

function groupUsersByAdmin(
  users: User[],
  admins: User[],
  adminsByUserId: Map<string, User | undefined>,
): UserRow[] {
  const usersByAdmin = new Map<string, User[]>();
  const unassigned: User[] = [];
  const rows: UserRow[] = [];

  for (const user of users) {
    const admin = adminsByUserId.get(user.id);
    if (user.role === 'super_admin') {
      rows.push({ user, depth: 0 });
    } else if (admin) {
      const team = usersByAdmin.get(admin.id) ?? [];
      team.push(user);
      usersByAdmin.set(admin.id, team);
    } else {
      unassigned.push(user);
    }
  }

  for (const admin of admins) {
    const team = usersByAdmin.get(admin.id);
    if (!team) continue;
    const adminVisible = team.some((user) => user.id === admin.id);
    const teamRows: UserRow[] = adminVisible ? [{ user: admin, depth: 0 }] : [];
    // Keep filtered teams together without nesting them beneath another visible admin.
    teamRows.push(...groupUsersByManager(team.filter((user) => user.id !== admin.id), adminVisible ? 1 : 0));
    teamRows[0].startsAdminGroup = true;
    rows.push(...teamRows);
  }

  const unassignedRows = groupUsersByManager(unassigned);
  if (unassignedRows.length > 0) unassignedRows[0].startsAdminGroup = true;
  return [...rows, ...unassignedRows];
}

function findAdmin(user: User, usersById: Map<string, User>): User | undefined {
  if (user.role === 'admin') return user;
  if (user.role === 'super_admin') return undefined;
  const creator = user.created_by_user_id ? usersById.get(user.created_by_user_id) : undefined;
  if (user.role === 'bidder') {
    const manager = user.manager_user_id ? usersById.get(user.manager_user_id) : undefined;
    const managerAdmin = manager?.created_by_user_id ? usersById.get(manager.created_by_user_id) : undefined;
    if (managerAdmin?.role === 'admin') return managerAdmin;
    if (creator?.role === 'bidder_manager') {
      const creatorAdmin = creator.created_by_user_id ? usersById.get(creator.created_by_user_id) : undefined;
      if (creatorAdmin?.role === 'admin') return creatorAdmin;
    }
  }
  return creator?.role === 'admin' ? creator : undefined;
}

/**
 * User administration. Admins manage their account; bidder managers manage their own bidders.
 *
 * The backend refuses to demote or deactivate the last remaining admin and refuses to delete a user who
 * owns workspaces or has created applications (payment attribution would be destroyed). This page surfaces those constraints
 * up front rather than letting the user discover them via a 400.
 */
export default function UsersPage() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [resetting, setResetting] = useState<User | null>(null);
  const [statusFilter, setStatusFilter] = useState<UserStatusFilter>('active');
  const [adminFilter, setAdminFilter] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setUsers(await api.listUsers());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load users');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!canManageUsers(me)) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="text-sm text-gray-600 dark:text-gray-400">You do not have access to user management.</p>
      </main>
    );
  }

  const adminCount = users.filter((u) => u.role === 'admin' && u.is_active).length;
  const addableRoles = me?.role === 'super_admin'
    ? ROLES.filter((role) => role === 'admin')
    : me?.role === 'bidder_manager'
      ? ROLES.filter((role) => role === 'bidder')
      : ROLES.filter((role) => role === 'bidder' || role === 'bidder_manager');

  const bidderManagers = users.filter((u) => u.role === 'bidder_manager' && u.is_active);
  const isManager = me?.role === 'bidder_manager';
  const isSuperAdmin = me?.role === 'super_admin';
  const admins = users.filter((u) => u.role === 'admin');
  // Resolve ownership from all accounts, even when a status filter hides the admin or manager.
  const usersById = new Map(users.map((u) => [u.id, u]));
  const adminsByUserId = new Map(users.map((u) => [u.id, findAdmin(u, usersById)]));
  const scopedUsers = !isSuperAdmin || adminFilter === 'all' ? users : users.filter((u) => (
    adminFilter === 'unassigned'
      ? (u.role === 'bidder_manager' || u.role === 'bidder') && !adminsByUserId.get(u.id)
      : adminsByUserId.get(u.id)?.id === adminFilter
  ));
  const userCounts = {
    active: scopedUsers.filter((u) => u.is_active).length,
    deactivated: scopedUsers.filter((u) => !u.is_active).length,
    all: scopedUsers.length,
  };
  const filteredUsers = scopedUsers.filter((u) => (
    statusFilter === 'all'
    || (statusFilter === 'active' ? u.is_active : !u.is_active)
  ));
  const userRows = isSuperAdmin
    ? groupUsersByAdmin(filteredUsers, admins, adminsByUserId)
    : groupUsersByManager(filteredUsers);

  async function patch(u: User, data: Partial<{
    role: Role;
    is_active: boolean;
    username: string;
    manager_user_id: string | null;
    can_continue_after_eligibility_failure: boolean;
  }>) {
    try {
      await api.updateUser(u.id, data);
      toast.success(`Updated ${u.username}`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    }
  }

  async function remove(u: User) {
    const owned = u.owned_workspace_count ?? 0;
    if (owned > 0) {
      toast.error(
        `${u.username} owns ${owned} workspace${owned === 1 ? '' : 's'}. Reassign the owner first — ` +
          'deleting them would erase the payment credit for those tabs.',
      );
      return;
    }
    if (!window.confirm(`Permanently delete ${u.username}? Deactivating is usually the better option.`)) {
      return;
    }
    try {
      await api.deleteUser(u.id);
      toast.success(`Deleted ${u.username}`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  return (
    <main className={`mx-auto px-4 py-6 ${isSuperAdmin ? 'max-w-7xl' : 'max-w-5xl'}`}>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">Users</h1>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {isSuperAdmin
              ? 'Grouped by admin, with bidder managers and their bidders listed underneath. Filter by admin to view their team.'
              : isManager
              ? 'Add bidders to your team and deactivate access when needed.'
              : 'Roles decide what a person can do; profile ownership decides which workspace they use.'}
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setShowCreate(true)}>
          Add user
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter users by status">
          {([
            ['active', 'Active'],
            ['deactivated', 'Deactivated'],
            ['all', 'All'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={statusFilter === value ? 'btn-primary btn-xs' : 'btn-secondary btn-xs'}
              onClick={() => setStatusFilter(value)}
              aria-pressed={statusFilter === value}
            >
              {label} ({userCounts[value]})
            </button>
          ))}
        </div>
        {isSuperAdmin && (
          <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
            Admin
            <select className="input w-56 py-1.5 text-xs" value={adminFilter}
              aria-label="Filter users by admin" onChange={(event) => setAdminFilter(event.target.value)}>
              <option value="all">All admins</option>
              {admins.map((admin) => (
                <option key={admin.id} value={admin.id}>{admin.username}{admin.is_active ? '' : ' (deactivated)'}</option>
              ))}
              <option value="unassigned">No admin assigned</option>
            </select>
          </label>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 dark:bg-gray-800 text-left text-2xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
              <tr>
                <th className="px-3 py-2 font-medium">User</th>
                <th className="px-3 py-2 font-medium">Role</th>
                {isSuperAdmin && <th className="px-3 py-2 font-medium">Admin</th>}
                <th className="px-3 py-2 font-medium">Workspaces</th>
                <th className="px-3 py-2 font-medium">Manager</th>
                <th className="px-3 py-2 font-medium">Status</th>
                {!isManager && <th className="px-3 py-2 font-medium">Continue after eligibility failure</th>}
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {userRows.map(({ user: u, depth, startsAdminGroup }) => {
                const isMe = u.id === me?.id;
                const lastAdmin = u.role === 'admin' && adminCount <= 1;
                const roleOptions = [...new Set([u.role, ...addableRoles])];
                const owningAdmin = adminsByUserId.get(u.id);
                return (
                  <tr
                    key={u.id}
                    className={`${startsAdminGroup ? 'border-t-2 border-slate-200 dark:border-slate-700' : 'border-t border-gray-100 dark:border-gray-800'} ${
                      u.is_active ? '' : 'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                    } ${isSuperAdmin && u.role === 'admin' ? 'bg-slate-100 dark:bg-slate-800' : u.role === 'bidder_manager' ? 'bg-slate-50/60 dark:bg-slate-800/60' : ''}`}
                  >
                    <td className="px-3 py-2">
                      <div className={depth > 0 ? `flex items-start ${depth === 1 ? 'pl-5' : 'pl-10'}` : ''}>
                        {depth > 0 && (
                          <span className="mr-2 text-gray-300 dark:text-gray-500" aria-hidden="true">&#8627;</span>
                        )}
                        <div>
                          <div className="font-medium">
                            {u.username}
                            {isMe && <span className="ml-1.5 text-2xs text-gray-500 dark:text-gray-400">(you)</span>}
                          </div>
                          <div className="text-2xs text-gray-500 dark:text-gray-400">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        className="input w-40 py-1 text-xs"
                        value={u.role}
                        disabled={lastAdmin || isManager}
                        title={lastAdmin ? 'This is the only active admin — promote someone else first' : undefined}
                        onChange={(e) => void patch(u, { role: e.target.value as Role })}
                      >
                        {roleOptions.map((r) => (
                          <option key={r} value={r}>
                            {roleLabel(r)}
                          </option>
                        ))}
                      </select>
                    </td>
                    {isSuperAdmin && (
                      <td className="px-3 py-2">
                        {u.role === 'admin' || u.role === 'super_admin' ? (
                          <span className="text-gray-400">—</span>
                        ) : owningAdmin ? (
                          <div className="min-w-36">
                            <div className="font-medium">{owningAdmin.username}</div>
                            <div className="text-2xs text-gray-500 dark:text-gray-400">{owningAdmin.email}</div>
                            {!owningAdmin.is_active && <div className="text-2xs text-gray-500 dark:text-gray-400">Deactivated</div>}
                          </div>
                        ) : (
                          <span className="text-gray-500 dark:text-gray-400">No admin assigned</span>
                        )}
                      </td>
                    )}
                    <td className="px-3 py-2 tabular-nums text-gray-600 dark:text-gray-400">
                      {u.owned_workspace_count ?? 0} owned
                    </td>
                    <td className="px-3 py-2">
                      {u.role === 'bidder' && !isManager ? (
                        <select
                          className="input w-40 py-1 text-xs"
                          value={u.manager_user_id ?? ''}
                          onChange={(e) => void patch(u, { manager_user_id: e.target.value || null })}
                          aria-label={`Manager for ${u.username}`}
                        >
                          <option value="">Unassigned</option>
                          {bidderManagers.map((manager) => (
                            <option key={manager.id} value={manager.id}>{manager.username}</option>
                          ))}
                        </select>
                      ) : isManager ? (
                        <span className="text-gray-600 dark:text-gray-400">You</span>
                      ) : u.role === 'bidder_manager' ? (
                        <span className="text-gray-600 dark:text-gray-400">
                          {u.managed_bidder_count ?? 0} bidder{u.managed_bidder_count === 1 ? '' : 's'}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-2xs font-medium ring-1 ring-inset ${
                          u.is_active
                            ? 'bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 ring-green-200 dark:ring-green-800'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 ring-gray-300 dark:ring-gray-600'
                        }`}
                      >
                        {u.is_active ? 'active' : 'deactivated'}
                      </span>
                    </td>
                    {!isManager && (
                      <td className="px-3 py-2">
                        {(u.role === 'bidder' || u.role === 'bidder_manager') && (
                          <label className="flex items-center gap-2 whitespace-nowrap">
                            <input type="checkbox" checked={u.can_continue_after_eligibility_failure ?? false}
                              aria-label={`Allow ${u.username} to continue after eligibility failure`}
                              onChange={(e) => void patch(u, { can_continue_after_eligibility_failure: e.target.checked })} />
                            {u.can_continue_after_eligibility_failure ? 'Enabled' : 'Disabled'}
                          </label>
                        )}
                      </td>
                    )}
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1.5">
                        {!isManager && (
                          <button
                            type="button"
                            className="btn-secondary btn-xs"
                            onClick={() => setResetting(u)}
                          >
                            Reset password
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn-secondary btn-xs"
                          disabled={isMe || (lastAdmin && u.is_active)}
                          title={isMe ? 'You cannot deactivate your own account' : undefined}
                          onClick={() => void patch(u, { is_active: !u.is_active })}
                        >
                          {u.is_active ? 'Deactivate' : 'Reactivate'}
                        </button>
                        {!isManager && (
                          <button
                            type="button"
                            className="btn-danger btn-xs"
                            disabled={isMe || lastAdmin}
                            onClick={() => void remove(u)}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filteredUsers.length === 0 && (
            <p className="p-6 text-center text-xs text-gray-500 dark:text-gray-400">
              No {statusFilter === 'all' ? '' : `${statusFilter} `}users found.
            </p>
          )}
        </div>
      )}

      <p className="mt-3 text-2xs text-gray-500 dark:text-gray-400">
        Deactivating is preferred over deleting: it revokes access immediately (the next API call fails)
        while keeping the person&apos;s workspaces and payment history intact.
      </p>

      {showCreate && (
        <CreateUserModal
          allowedRoles={addableRoles}
          bidderManagers={bidderManagers}
          managerMode={isManager}
          onClose={() => setShowCreate(false)}
          onCreated={async () => {
            setShowCreate(false);
            await load();
          }}
        />
      )}

      {resetting && (
        <ResetPasswordModal user={resetting} onClose={() => setResetting(null)} />
      )}
    </main>
  );
}

function CreateUserModal({
  allowedRoles,
  bidderManagers,
  managerMode,
  onClose,
  onCreated,
}: {
  allowedRoles: Role[];
  bidderManagers: User[];
  managerMode: boolean;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const toast = useToast();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>(allowedRoles[0]);
  const [managerUserId, setManagerUserId] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.createUser({
        username: username.trim(),
        email: email.trim(),
        password,
        role,
        ...(role === 'bidder' ? { manager_user_id: managerUserId || null } : {}),
      });
      toast.success(`Created ${username.trim()}`);
      await onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create user');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Add user" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label" htmlFor="cu-username">Username</label>
          <input id="cu-username" className="input" value={username} onChange={(e) => setUsername(e.target.value)} required minLength={2} />
        </div>
        <div>
          <label className="label" htmlFor="cu-email">Email</label>
          <input id="cu-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="cu-password">Temporary password</label>
          <input id="cu-password" type="password" autoComplete="new-password" className="input font-mono" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          <p className="mt-1 text-2xs text-gray-500 dark:text-gray-400">
            Minimum 8 characters. Shown as plain text because you have to pass it on — the user can change
            it from their Account page.
          </p>
        </div>
        <div>
          <label className="label" htmlFor="cu-role">Role</label>
          <select id="cu-role" className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {allowedRoles.map((r) => (
              <option key={r} value={r}>{roleLabel(r)}</option>
            ))}
          </select>
        </div>
        {role === 'bidder' && !managerMode && (
          <div>
            <label className="label" htmlFor="cu-manager">Bidder manager</label>
            <select
              id="cu-manager"
              className="input"
              value={managerUserId}
              onChange={(e) => setManagerUserId(e.target.value)}
            >
              <option value="">Unassigned</option>
              {bidderManagers.map((manager) => (
                <option key={manager.id} value={manager.id}>{manager.username}</option>
              ))}
            </select>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create user'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose }: { user: User; onClose: () => void }) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.resetUserPassword(user.id, password);
      toast.success(`Password reset for ${user.username}`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Reset password — ${user.username}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-xs text-gray-600 dark:text-gray-400">
          There is no password-reset email in this system by design, so an admin sets the new password
          directly and hands it over.
        </p>
        <div>
          <label className="label" htmlFor="rp-password">New password</label>
          <input
            id="rp-password"
            type="password"
            autoComplete="new-password"
            className="input font-mono"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoFocus
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Set password'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4">
      <div className="card w-full max-w-md p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button type="button" className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-300" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
