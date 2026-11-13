'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { ExtensionRelease } from '@/lib/types';

export default function ExtensionDownloadPage() {
  const { user } = useAuth();
  const [release, setRelease] = useState<ExtensionRelease | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    void api.extensionRelease().then((result) => {
      if (!cancelled) setRelease(result);
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load the extension download.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [attempt]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-lg font-semibold">Resume Builder extension</h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        Download Resume Builder for Chrome to generate resumes while browsing job postings.
      </p>
      <div className="card mt-5 space-y-4 p-5">
        {loading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading extension download...</p>
        ) : error ? (
          <>
            <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>
            <button type="button" className="btn-secondary" onClick={() => setAttempt((value) => value + 1)}>Try again</button>
          </>
        ) : release && (
          <>
            <p className="text-sm font-medium">Latest version: {release.latest_version}</p>
            {release.download_url ? (
              <a className="btn-primary" href={release.download_url} target="_blank" rel="noopener noreferrer">
                Download extension
              </a>
            ) : (
              <p className="text-sm text-gray-600 dark:text-gray-400">
                The extension download is not available yet. Contact your administrator.
              </p>
            )}
          </>
        )}
      </div>
      {user?.role === 'super_admin' && (
        <Link className="btn-secondary mt-4" href="/admin/extension">Manage download link</Link>
      )}
    </main>
  );
}
