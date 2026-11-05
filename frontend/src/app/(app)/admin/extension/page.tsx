'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { ExtensionRelease } from '@/lib/types';
import { useToast } from '@/components/ui/toast';

export default function ExtensionReleasePage() {
  const { user } = useAuth();
  const toast = useToast();
  const [release, setRelease] = useState<ExtensionRelease | null>(null);
  const [version, setVersion] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (user?.role !== 'super_admin') return;
    let cancelled = false;
    void api.extensionRelease().then((result) => {
      if (cancelled) return;
      setRelease(result);
      setVersion(result.latest_version);
      setDownloadUrl(result.download_url ?? '');
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load extension settings.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user?.role]);

  if (user?.role !== 'super_admin') {
    return <main className="mx-auto max-w-lg px-4 py-16 text-center text-sm text-gray-600 dark:text-gray-400">Extension settings are restricted to super admins.</main>;
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const result = await api.updateExtensionRelease({ latest_version: version.trim(), download_url: downloadUrl.trim() });
      setRelease(result);
      setVersion(result.latest_version);
      setDownloadUrl(result.download_url ?? '');
      toast.success('Extension release saved. Older versions will now show the update alert.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save extension settings.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-lg font-semibold">Extension updates</h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        Publish the latest Resume Builder version and its download link. Users with an older version must update before signing in or continuing to use the extension.
      </p>
      {error && <p role="alert" className="mt-4 rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 p-3 text-sm text-red-800 dark:text-red-200">{error}</p>}
      {loading ? <p className="mt-5 text-sm text-gray-500 dark:text-gray-400">Loading extension settings...</p> : release && (
        <form className="card mt-5 space-y-5 p-5" onSubmit={save}>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="extension-version">Latest version</label>
            <input id="extension-version" className="input w-full" value={version} onChange={(event) => setVersion(event.target.value)} required maxLength={23} placeholder="0.9.4" disabled={saving} aria-describedby="extension-version-help" />
            <p id="extension-version-help" className="mt-1 text-xs text-gray-500 dark:text-gray-400">Use the version shown in the extension, such as 0.9.4. This becomes the minimum required version.</p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="extension-download">Download URL</label>
            <input id="extension-download" type="url" className="input w-full" value={downloadUrl} onChange={(event) => setDownloadUrl(event.target.value)} required maxLength={2048} placeholder="https://example.com/resume-builder.zip" disabled={saving} aria-describedby="extension-download-help" />
            <p id="extension-download-help" className="mt-1 text-xs text-gray-500 dark:text-gray-400">The download button in the update alert opens this link. Make sure users can access it before saving.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn-primary" type="submit" disabled={saving || !version.trim() || !downloadUrl.trim()}>{saving ? 'Saving...' : 'Save extension release'}</button>
            {release.download_url && <a className="text-sm text-blue-700 dark:text-blue-300 hover:underline" href={release.download_url} target="_blank" rel="noopener noreferrer">Open saved download link</a>}
          </div>
        </form>
      )}
    </main>
  );
}
