'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { roleLabel } from '@/lib/permissions';
import { useToast } from '@/components/ui/toast';

/**
 * Account page — currently just "change my password".
 *
 * This closes the loop on the default-admin requirement: the bootstrapped admin signs in with the
 * env-var password and changes it here. The bootstrap only runs when zero admins exist, so a changed
 * password is never reverted by a container restart.
 */
export default function AccountPage() {
  const { user } = useAuth();
  const toast = useToast();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const mismatch = confirm.length > 0 && next !== confirm;
  const tooShort = next.length > 0 && next.length < 8;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mismatch || tooShort) return;
    setBusy(true);
    try {
      await api.changePassword(current, next);
      toast.success('Password changed');
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change password');
    } finally {
      setBusy(false);
    }
  }

  if (!user) return null;

  return (
    <main className="mx-auto max-w-lg px-4 py-6">
      <h1 className="text-lg font-semibold">Account</h1>

      <dl className="card mt-4 divide-y divide-gray-100 p-4 text-xs">
        <div className="flex justify-between pb-2">
          <dt className="text-gray-500">Username</dt>
          <dd className="font-medium">{user.username}</dd>
        </div>
        <div className="flex justify-between py-2">
          <dt className="text-gray-500">Email</dt>
          <dd className="font-medium">{user.email}</dd>
        </div>
        <div className="flex justify-between pt-2">
          <dt className="text-gray-500">Role</dt>
          <dd className="font-medium">{roleLabel(user.role)}</dd>
        </div>
      </dl>
      <p className="mt-1.5 text-2xs text-gray-500">
        Only an admin can change a username, email, or role — ask one if these are wrong.
      </p>

      <form onSubmit={submit} className="card mt-5 space-y-3 p-4">
        <h2 className="text-sm font-semibold">Change password</h2>

        <div>
          <label className="label" htmlFor="current">Current password</label>
          <input
            id="current"
            type="password"
            className="input"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
        </div>

        <div>
          <label className="label" htmlFor="next">New password</label>
          <input
            id="next"
            type="password"
            className="input"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
            minLength={8}
          />
          {tooShort && <p className="mt-1 text-2xs text-red-600">At least 8 characters.</p>}
        </div>

        <div>
          <label className="label" htmlFor="confirm">Confirm new password</label>
          <input
            id="confirm"
            type="password"
            className="input"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
          {mismatch && <p className="mt-1 text-2xs text-red-600">Passwords don&apos;t match.</p>}
        </div>

        <div className="flex justify-end pt-1">
          <button
            type="submit"
            className="btn-primary"
            disabled={busy || mismatch || tooShort || !current || !next}
          >
            {busy ? 'Saving…' : 'Change password'}
          </button>
        </div>

        <p className="text-2xs text-gray-500">
          You stay signed in on this device. Existing tokens elsewhere remain valid until they expire —
          if you suspect an account is compromised, ask an admin to deactivate it.
        </p>
      </form>
    </main>
  );
}
