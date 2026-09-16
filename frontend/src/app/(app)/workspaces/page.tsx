'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { canManageWorkspaces } from '@/lib/permissions';
import type { PermissionType, User, Workspace } from '@/lib/types';
import { useToast } from '@/components/ui/toast';

export default function WorkspacesPage() {
  const { user } = useAuth();
  const toast = useToast();
  const admin = canManageWorkspaces(user);

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newOwner, setNewOwner] = useState('');
  const [managing, setManaging] = useState<Workspace | null>(null);
  const [reassigning, setReassigning] = useState<Workspace | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.listWorkspaces(true);
      setWorkspaces(list);
      if (admin) setUsers(await api.listUsers());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load workspaces');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createWorkspace(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || !newOwner) return;
    setCreating(true);
    try {
      await api.createWorkspace({ name: newName.trim(), owner_user_id: newOwner });
      toast.success(`Created "${newName.trim()}"`);
      setNewName('');
      setNewOwner('');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create workspace');
    } finally {
      setCreating(false);
    }
  }

  async function removeWorkspace(w: Workspace) {
    const confirmed = window.confirm(
      `Delete "${w.name}" and all ${w.application_count.toLocaleString()} of its applications?\n\n` +
        'This cannot be undone.',
    );
    if (!confirmed) return;
    try {
      const res = await api.deleteWorkspace(w.id);
      toast.success(`Deleted "${w.name}" (${res.deleted_applications} applications)`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete workspace');
    }
  }

  async function toggleArchive(w: Workspace) {
    try {
      await api.updateWorkspace(w.id, { is_archived: !w.is_archived });
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update workspace');
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-lg font-semibold">Workspaces</h1>
          <p className="mt-0.5 text-xs text-gray-500">
            Each workspace (tab) belongs to one bidder — that owner receives the payment credit for its
            applied rows, regardless of who entered them.
          </p>
        </div>
      </div>

      {admin && (
        <form onSubmit={createWorkspace} className="card mb-6 flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-48 flex-1">
            <label className="label" htmlFor="ws-name">
              Workspace name
            </label>
            <input
              id="ws-name"
              className="input"
              placeholder="John Applications"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <div className="min-w-48 flex-1">
            <label className="label" htmlFor="ws-owner">
              Owner (gets paid for this tab)
            </label>
            <select
              id="ws-owner"
              className="input"
              value={newOwner}
              onChange={(e) => setNewOwner(e.target.value)}
            >
              <option value="">Select a bidder…</option>
              {users
                .filter((u) => u.is_active)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.username} ({u.role})
                  </option>
                ))}
            </select>
          </div>
          <button type="submit" className="btn-primary" disabled={creating || !newName || !newOwner}>
            {creating ? 'Creating…' : 'Create workspace'}
          </button>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : workspaces.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-sm text-gray-600">
            {admin
              ? 'No workspaces yet. Create one above to get started.'
              : 'No workspaces have been assigned to you yet. Ask an admin for access.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {workspaces.map((w) => {
            const canManageSharing = user?.role === 'super_admin' || w.created_by_user_id === user?.id;
            return (
            <div
              key={w.id}
              className={`card flex flex-col p-4 ${w.is_archived ? 'opacity-60' : ''}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link
                    href={`/workspaces/${w.id}`}
                    className="block truncate text-sm font-medium hover:underline"
                  >
                    {w.name}
                  </Link>
                  <p className="mt-0.5 text-2xs text-gray-500">
                    Owner: {w.owner.username}
                    {w.is_archived && ' · archived'}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-2xs font-medium ring-1 ring-inset ${
                    w.my_access === 'edit'
                      ? 'bg-green-50 text-green-700 ring-green-200'
                      : 'bg-gray-50 text-gray-600 ring-gray-200'
                  }`}
                >
                  {w.my_access === 'edit' ? 'can edit' : 'view only'}
                </span>
              </div>

              <p className="mt-3 text-2xl font-semibold tabular-nums">
                {w.application_count.toLocaleString()}
              </p>
              <p className="text-2xs text-gray-500">applications</p>

              {admin && w.permissions && w.permissions.length > 0 && (
                <p className="mt-2 text-2xs text-gray-500">
                  Shared with:{' '}
                  {w.permissions.map((p) => `${p.username} (${p.permission_type})`).join(', ')}
                </p>
              )}

              <div className="mt-4 flex flex-wrap gap-1.5">
                <Link href={`/workspaces/${w.id}`} className="btn-secondary btn-xs">
                  Open table
                </Link>
                {w.my_access === 'edit' && (
                  <>
                    <Link href={`/workspaces/${w.id}/add-urls`} className="btn-secondary btn-xs">
                      Add URLs
                    </Link>
                    <Link href={`/workspaces/${w.id}/import`} className="btn-secondary btn-xs">
                      Import Excel/CSV
                    </Link>
                  </>
                )}
                {admin && canManageSharing && (
                  <>
                    <button
                      type="button"
                      className="btn-secondary btn-xs"
                      onClick={() => setManaging(w)}
                    >
                      Permissions
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-xs"
                      onClick={() => setReassigning(w)}
                    >
                      Reassign owner
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-xs"
                      onClick={() => toggleArchive(w)}
                    >
                      {w.is_archived ? 'Unarchive' : 'Archive'}
                    </button>
                    <button
                      type="button"
                      className="btn-danger btn-xs"
                      onClick={() => removeWorkspace(w)}
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            </div>
            );
          })}
        </div>
      )}

      {managing && admin && (
        <PermissionsModal
          workspace={managing}
          users={users}
          onClose={() => setManaging(null)}
          onChanged={load}
        />
      )}

      {reassigning && admin && (
        <OwnerModal
          workspace={reassigning}
          users={users}
          onClose={() => setReassigning(null)}
          onChanged={load}
        />
      )}
    </main>
  );
}

function OwnerModal({
  workspace,
  users,
  onClose,
  onChanged,
}: {
  workspace: Workspace;
  users: User[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const [ownerId, setOwnerId] = useState(workspace.owner_user_id);
  const [busy, setBusy] = useState(false);

  async function reassign() {
    if (!ownerId || ownerId === workspace.owner_user_id) return;
    setBusy(true);
    try {
      await api.updateWorkspace(workspace.id, { owner_user_id: ownerId });
      const owner = users.find((user) => user.id === ownerId);
      toast.success(`Owner changed to ${owner?.username ?? 'the selected user'}`);
      await onChanged();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not reassign owner');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4">
      <div className="card w-full max-w-md p-5">
        <h2 className="text-sm font-semibold">Reassign owner — {workspace.name}</h2>
        <p className="mt-1 text-2xs text-gray-500">
          The new owner receives payment credit for future applied rows in this workspace. Existing
          payment records are unchanged.
        </p>

        <div className="mt-4">
          <label className="label" htmlFor="workspace-owner">
            New owner
          </label>
          <select
            id="workspace-owner"
            className="input"
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value)}
          >
            {users
              .filter((user) => user.is_active)
              .map((user) => (
                <option key={user.id} value={user.id}>
                  {user.username} ({user.role})
                </option>
              ))}
          </select>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void reassign()}
            disabled={busy || ownerId === workspace.owner_user_id}
          >
            {busy ? 'Saving…' : 'Save owner'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PermissionsModal({
  workspace,
  users,
  onClose,
  onChanged,
}: {
  workspace: Workspace;
  users: User[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const [userId, setUserId] = useState('');
  const [level, setLevel] = useState<PermissionType>('edit');
  const [busy, setBusy] = useState(false);

  // Superadmins already have global access and the owner already has edit — offering either would
  // create grants that do nothing.
  const candidates = users.filter(
    (u) => u.is_active && u.role !== 'super_admin' && u.id !== workspace.owner_user_id,
  );

  async function grant() {
    if (!userId) return;
    setBusy(true);
    try {
      await api.grantPermission(workspace.id, userId, level);
      toast.success('Permission granted');
      setUserId('');
      await onChanged();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not grant permission');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(uid: string) {
    setBusy(true);
    try {
      await api.revokePermission(workspace.id, uid);
      toast.success('Permission revoked');
      await onChanged();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not revoke permission');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4">
      <div className="card w-full max-w-md p-5">
        <h2 className="text-sm font-semibold">Permissions — {workspace.name}</h2>
        <p className="mt-1 text-2xs text-gray-500">
          Owner <strong>{workspace.owner.username}</strong> always has edit access and receives the
          payment credit. Grants below let other bidders work in this tab without changing who is paid.
        </p>

        <div className="mt-4 space-y-2">
          {(workspace.permissions ?? []).length === 0 ? (
            <p className="text-xs text-gray-500">No other users have access.</p>
          ) : (
            (workspace.permissions ?? []).map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-md border border-gray-200 px-2.5 py-1.5"
              >
                <span className="text-xs">
                  {p.username}{' '}
                  <span className="text-gray-500">
                    · {p.role} · {p.permission_type}
                  </span>
                </span>
                <button
                  type="button"
                  className="btn-secondary btn-xs"
                  disabled={busy}
                  onClick={() => revoke(p.user_id)}
                >
                  Revoke
                </button>
              </div>
            ))
          )}
        </div>

        <div className="mt-4 flex items-end gap-2">
          <div className="flex-1">
            <label className="label">Add user</label>
            <select className="input" value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">Select…</option>
              {candidates.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.username} ({u.role})
                </option>
              ))}
            </select>
          </div>
          <div className="w-28">
            <label className="label">Level</label>
            <select
              className="input"
              value={level}
              onChange={(e) => setLevel(e.target.value as PermissionType)}
            >
              <option value="edit">edit</option>
              <option value="view">view</option>
            </select>
          </div>
          <button type="button" className="btn-primary" disabled={busy || !userId} onClick={grant}>
            Grant
          </button>
        </div>

        <div className="mt-5 flex justify-end">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
