'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { isAdmin, roleLabel } from '@/lib/permissions';
import { useToast } from '@/components/ui/toast';

/**
 * Account page — currently just "change my password".
 *
 * This closes the loop on the default-admin requirement: the bootstrapped admin signs in with the
 * env-var password and changes it here. The bootstrap only runs when zero admins exist, so a changed
 * password is never reverted by a server restart.
 */
export default function AccountPage() {
  const { user } = useAuth();
  const toast = useToast();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [slackWebhook, setSlackWebhook] = useState('');
  const [slackUserId, setSlackUserId] = useState('');
  const [webhookConfigured, setWebhookConfigured] = useState(false);
  const [slackBusy, setSlackBusy] = useState(false);

  const mismatch = confirm.length > 0 && next !== confirm;
  const tooShort = next.length > 0 && next.length < 8;

  useEffect(() => {
    if (!isAdmin(user)) return;
    void api.slackSettings()
      .then((settings) => {
        setWebhookConfigured(settings.webhook_configured);
        setSlackUserId(settings.slack_user_id ?? '');
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : 'Could not load Slack settings'));
  }, [user, toast]);

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

  async function saveSlack(e: React.FormEvent) {
    e.preventDefault();
    setSlackBusy(true);
    try {
      const settings = await api.updateSlackSettings({
        ...(slackWebhook.trim() ? { slack_webhook_url: slackWebhook.trim() } : {}),
        slack_user_id: slackUserId.trim() || null,
      });
      setWebhookConfigured(settings.webhook_configured);
      setSlackUserId(settings.slack_user_id ?? '');
      setSlackWebhook('');
      toast.success('Slack settings saved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save Slack settings');
    } finally {
      setSlackBusy(false);
    }
  }

  async function removeSlackWebhook() {
    setSlackBusy(true);
    try {
      const settings = await api.updateSlackSettings({ slack_webhook_url: null });
      setWebhookConfigured(settings.webhook_configured);
      setSlackWebhook('');
      toast.success('Slack webhook removed');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not remove Slack webhook');
    } finally {
      setSlackBusy(false);
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

      {isAdmin(user) && (
        <form onSubmit={saveSlack} className="card mt-5 space-y-3 p-4">
          <div>
            <h2 className="text-sm font-semibold">Slack notifications</h2>
            <p className="mt-1 text-2xs text-gray-500">
              Receive a message for each new daily milestone of 10 applications you submit.
            </p>
          </div>

          <div>
            <label className="label" htmlFor="slack-webhook">Slack Webhook URL</label>
            <input
              id="slack-webhook"
              type="password"
              className="input"
              autoComplete="off"
              placeholder={webhookConfigured
                ? 'Webhook configured — enter a new URL to replace it'
                : 'https://hooks.slack.com/services/...'}
              value={slackWebhook}
              onChange={(event) => setSlackWebhook(event.target.value)}
            />
            <p className="mt-1 text-2xs text-gray-500">The saved URL is never displayed again.</p>
          </div>

          <div>
            <label className="label" htmlFor="slack-user-id">Slack User ID</label>
            <input
              id="slack-user-id"
              className="input"
              placeholder="U012ABCDEF"
              value={slackUserId}
              onChange={(event) => setSlackUserId(event.target.value.toUpperCase())}
              maxLength={30}
            />
            <p className="mt-1 text-2xs text-gray-500">
              Used for the real Slack mention in milestone messages.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            {webhookConfigured && (
              <button
                type="button"
                className="btn-danger"
                disabled={slackBusy}
                onClick={() => void removeSlackWebhook()}
              >
                Remove webhook
              </button>
            )}
            <button type="submit" className="btn-primary" disabled={slackBusy}>
              {slackBusy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      )}

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
