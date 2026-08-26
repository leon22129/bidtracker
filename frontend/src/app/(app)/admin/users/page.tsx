'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { canManageUsers, roleLabel } from '@/lib/permissions';
import { ROLES, type Role, type User } from '@/lib/types';
import { useToast } from '@/components/ui/toast';

/**
 * User administration — admin only.
 *
 * The backend refuses to demote or deactivate the last remaining admin and refuses to delete a user who
 * still owns workspaces (payment attribution would be destroyed). This page surfaces those constraints
 * up front rather than letting the user discover them via a 400.
 */
export default function UsersPage() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [resetting, setResetting] = useState<User | null>(null);

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
        <p className="text-sm text-gray-600">User management is restricted to administrators.</p>
      </main>
    );
  }

  const adminCount = users.filter((u) => u.role === 'admin' && u.is_active).length;

  async function patch(u: User, data: Partial<{ role: Role; is_active: boolean; username: string }>) {
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
    <main className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">Users</h1>
          <p className="mt-0.5 text-xs text-gray-500">
            Roles decide what a person can do everywhere; workspace permissions decide which tabs they see.
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setShowCreate(true)}>
          Add user
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-left text-2xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">User</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Workspaces</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isMe = u.id === me?.id;
                const lastAdmin = u.role === 'admin' && adminCount <= 1;
                return (
                  <tr key={u.id} className={`border-t border-gray-100 ${u.is_active ? '' : 'bg-gray-50 text-gray-500'}`}>
                    <td className="px-3 py-2">
                      <div className="font-medium">
                        {u.username}
                        {isMe && <span className="ml-1.5 text-2xs text-gray-500">(you)</span>}
                      </div>
                      <div className="text-2xs text-gray-500">{u.email}</div>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        className="input w-40 py-1 text-xs"
                        value={u.role}
                        disabled={lastAdmin}
                        title={lastAdmin ? 'This is the only active admin — promote someone else first' : undefined}
                        onChange={(e) => void patch(u, { role: e.target.value as Role })}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {roleLabel(r)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-gray-600">
                      {u.owned_workspace_count ?? 0} owned
                      {(u.granted_workspace_count ?? 0) > 0 && (
                        <span className="text-gray-400"> · {u.granted_workspace_count} shared</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-2xs font-medium ring-1 ring-inset ${
                          u.is_active
                            ? 'bg-green-50 text-green-700 ring-green-200'
                            : 'bg-gray-100 text-gray-600 ring-gray-300'
                        }`}
                      >
                        {u.is_active ? 'active' : 'deactivated'}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1.5">
                        <button
                          type="button"
                          className="btn-secondary btn-xs"
                          onClick={() => setResetting(u)}
                        >
                          Reset password
                        </button>
                        <button
                          type="button"
                          className="btn-secondary btn-xs"
                          disabled={isMe || (lastAdmin && u.is_active)}
                          title={isMe ? 'You cannot deactivate your own account' : undefined}
                          onClick={() => void patch(u, { is_active: !u.is_active })}
                        >
                          {u.is_active ? 'Deactivate' : 'Reactivate'}
                        </button>
                        <button
                          type="button"
                          className="btn-danger btn-xs"
                          disabled={isMe || lastAdmin}
                          onClick={() => void remove(u)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-2xs text-gray-500">
        Deactivating is preferred over deleting: it revokes access immediately (the next API call fails)
        while keeping the person&apos;s workspaces and payment history intact.
      </p>

      {showCreate && (
        <CreateUserModal
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
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const toast = useToast();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('bidder');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.createUser({ username: username.trim(), email: email.trim(), password, role });
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
          <input id="cu-password" type="text" className="input font-mono" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          <p className="mt-1 text-2xs text-gray-500">
            Minimum 8 characters. Shown as plain text because you have to pass it on — the user can change
            it from their Account page.
          </p>
        </div>
        <div>
          <label className="label" htmlFor="cu-role">Role</label>
          <select id="cu-role" className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>{roleLabel(r)}</option>
            ))}
          </select>
        </div>
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
        <p className="text-xs text-gray-600">
          There is no password-reset email in this system by design, so an admin sets the new password
          directly and hands it over.
        </p>
        <div>
          <label className="label" htmlFor="rp-password">New password</label>
          <input
            id="rp-password"
            type="text"
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
          <button type="button" className="text-gray-400 hover:text-gray-700" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
