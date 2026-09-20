'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { UrlPreviewResult, Workspace } from '@/lib/types';
import { useToast } from '@/components/ui/toast';
import { StatusPill } from '@/components/ui/status-pill';

/**
 * Manual URL entry — the bidders' main data-entry screen.
 *
 * Shape from the spec: one date picker plus a textarea where each line is one application. Everything
 * else (company, job title, source, duplicate detection, per-date numbering) is derived server-side.
 *
 * The preview step is not in the spec but is worth its small cost: a bidder pasting 80 URLs wants to
 * know *before* committing how many are duplicates, because duplicates don't count toward their weekly
 * payment. Preview is read-only and writes nothing.
 */
export default function AddUrlsPage() {
  const params = useParams<{ id: string }>();
  const workspaceId = params.id;
  const router = useRouter();
  const toast = useToast();

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [text, setText] = useState('');
  const [enrich, setEnrich] = useState(true);
  const [preview, setPreview] = useState<UrlPreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generationMessage, setGenerationMessage] = useState<string | null>(null);
  const [result, setResult] = useState<{
    created: number;
    duplicates: number;
    invalid_lines: string[];
    duplicate_details: Array<{ url: string; reason: string; existing_in: string }>;
  } | null>(null);

  useEffect(() => {
    api
      .getWorkspace(workspaceId)
      .then(setWorkspace)
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Could not load workspace'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const lines = useMemo(
    () => text.split('\n').map((l) => l.trim()).filter(Boolean),
    [text],
  );

  // Any change to the pasted text invalidates a previous preview — showing stale duplicate counts
  // next to new input would be worse than showing none.
  useEffect(() => {
    setPreview(null);
  }, [text]);

  const runPreview = useCallback(async () => {
    if (lines.length === 0) return;
    setPreviewing(true);
    try {
      setPreview(await api.previewUrls(workspaceId, text));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setPreviewing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, text, lines.length]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (lines.length === 0) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await api.createFromUrls({ workspace_id: workspaceId, date, urls: text, enrich });
      setResult(res);
      setText('');
      setPreview(null);
      toast.success(
        `Added ${res.created} application${res.created === 1 ? '' : 's'}` +
          (res.duplicates ? ` · ${res.duplicates} marked Duplicated` : ''),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add URLs');
    } finally {
      setSubmitting(false);
    }
  }

  async function generateFromUrl() {
    if (lines.length !== 1) {
      toast.error('Enter exactly one job URL to generate a resume');
      return;
    }
    setGenerating(true);
    setGenerationMessage(null);
    try {
      const response = await api.generateApplication({
        workspace_id: workspaceId,
        url: lines[0],
        profile_id: workspace?.resume_profile_id ?? undefined,
      });
      const message = response.success
        ? 'Resume generated and the job was added to this workspace.'
        : response.reason ?? 'The job did not pass the eligibility check.';
      setGenerationMessage(message);
      if (response.success) toast.success(message);
      else toast.info(message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not generate resume');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-5">
        <Link href={`/workspaces/${workspaceId}`} className="text-xs text-gray-500 hover:underline">
          ← {workspace?.name ?? 'Workspace'}
        </Link>
        <h1 className="mt-1 text-lg font-semibold">Add URLs</h1>
        <p className="mt-0.5 text-xs text-gray-500">
          One job URL per line. Company name, job title, and job source are detected automatically;
          anything that can&apos;t be detected is left blank for you to fill in on the table.
        </p>
      </div>

      <form onSubmit={submit} className="card p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-40">
            <label className="label" htmlFor="date">
              Application date
            </label>
            <input
              id="date"
              type="date"
              className="input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
          <p className="mb-1.5 text-2xs text-gray-500">
            Row numbers restart at 1 for each date, so this date decides the numbering block.
          </p>
        </div>

        <div className="mt-4">
          <div className="flex items-baseline justify-between">
            <label className="label" htmlFor="urls">
              Job URLs
            </label>
            <span className="text-2xs tabular-nums text-gray-500">
              {lines.length} line{lines.length === 1 ? '' : 's'}
            </span>
          </div>
          <textarea
            id="urls"
            className="input h-64 resize-y font-mono text-xs leading-relaxed"
            placeholder={
              'https://boards.greenhouse.io/acme/jobs/4012345\n' +
              'https://acme.wd1.myworkdayjobs.com/en-US/careers/job/Senior-Engineer_R-1234\n' +
              'https://jobs.lever.co/example/8f3c1b22-1111-2222-3333-444455556666'
            }
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-gray-700">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-gray-900"
              checked={enrich}
              onChange={(e) => setEnrich(e.target.checked)}
            />
            Fetch page titles to fill company &amp; job title
          </label>
          <span className="text-2xs text-gray-500">
            (slower for large batches — the insert never fails if a site blocks us)
          </span>

          <div className="ml-auto flex gap-2">
            <button
              type="button"
              className="btn-secondary"
              disabled={previewing || lines.length === 0}
              onClick={runPreview}
            >
              {previewing ? 'Checking…' : 'Check duplicates'}
            </button>
            <button type="submit" className="btn-primary" disabled={submitting || lines.length === 0}>
              {submitting ? 'Adding…' : `Add ${lines.length || ''} application${lines.length === 1 ? '' : 's'}`}
            </button>
            <button type="button" className="btn-primary" disabled={generating || lines.length !== 1} onClick={() => void generateFromUrl()}>
              {generating ? 'Generating…' : 'Generate resume'}
            </button>
          </div>
        </div>
      </form>

      {generationMessage && <div className="card mt-5 p-4 text-sm text-gray-700">{generationMessage}</div>}

      {preview && <PreviewPanel preview={preview} />}

      {result && (
        <div className="card mt-5 p-4">
          <h2 className="text-sm font-semibold">Done</h2>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <Stat label="Created" value={result.created} />
            <Stat label="Marked Duplicated" value={result.duplicates} tone="red" />
            <Stat label="Invalid lines" value={result.invalid_lines.length} tone="amber" />
          </div>

          {result.invalid_lines.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-gray-600">
                Show {result.invalid_lines.length} skipped line
                {result.invalid_lines.length === 1 ? '' : 's'}
              </summary>
              <ul className="mt-2 max-h-40 overflow-auto rounded border border-gray-200 bg-gray-50 p-2
                font-mono text-2xs text-gray-700">
                {result.invalid_lines.map((l, i) => (
                  <li key={i} className="truncate">
                    {l}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {result.duplicate_details.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-gray-600">
                Show duplicates ({result.duplicate_details.length})
              </summary>
              <ul className="mt-2 max-h-48 space-y-1 overflow-auto text-2xs">
                {result.duplicate_details.map((d, i) => (
                  <li key={i} className="rounded border border-red-100 bg-red-50/60 px-2 py-1">
                    <span className="block truncate font-mono text-gray-700">{d.url}</span>
                    <span className="text-red-700">
                      {d.reason} · already in {d.existing_in}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              className="btn-primary btn-xs"
              onClick={() => router.push(`/workspaces/${workspaceId}`)}
            >
              Open the table
            </button>
            <button type="button" className="btn-secondary btn-xs" onClick={() => setResult(null)}>
              Add more
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function PreviewPanel({ preview }: { preview: UrlPreviewResult }) {
  return (
    <div className="card mt-5 p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Duplicate check</h2>
        <span className="text-2xs text-gray-500">
          scope: {preview.duplicate_scope === 'global' ? 'all workspaces' : 'this workspace only'}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-3">
        <Stat label="Lines" value={preview.total_lines} />
        <Stat label="Valid URLs" value={preview.valid} />
        <Stat label="Duplicates" value={preview.duplicates} tone="red" />
        <Stat label="Invalid" value={preview.invalid.length} tone="amber" />
      </div>

      {preview.duplicates > 0 && (
        <p className="mt-3 text-2xs text-gray-600">
          Duplicated rows are still inserted so the history is complete, but they are excluded from the
          weekly payment count.
        </p>
      )}

      <div className="mt-3 max-h-72 overflow-auto rounded border border-gray-200">
        <table className="w-full text-2xs">
          <thead className="sticky top-0 bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="w-64 px-2 py-1 font-medium">Pasted URL</th>
              <th className="w-64 px-2 py-1 font-medium">Current row URL</th>
              <th className="w-48 px-2 py-1 font-medium">Current row title</th>
              <th className="w-40 px-2 py-1 font-medium">Current row</th>
              <th className="w-32 px-2 py-1 font-medium">Date</th>
              <th className="w-36 px-2 py-1 font-medium">Source</th>
              <th className="w-40 px-2 py-1 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.filter((r) => r.is_duplicate).map((r, i) => (
              <tr key={i} className="border-t border-gray-100">
                <td className="max-w-0 whitespace-normal break-all px-2 py-1 font-mono text-gray-700">{r.url}</td>
                <td className="max-w-0 whitespace-normal break-all px-2 py-1 font-mono text-gray-700">{r.existing_url ?? 'Not available'}</td>
                <td className="max-w-0 whitespace-normal break-words px-2 py-1 text-gray-700" title={r.existing_job_title ?? undefined}>
                  {r.existing_job_title ?? <span className="text-gray-400">Not available</span>}
                </td>
                <td className="px-2 py-1 text-gray-500">{r.existing_in ?? 'Within this paste'}</td>
                <td className="px-2 py-1 text-gray-600">{r.existing_date ?? 'Not available'}</td>
                <td className="px-2 py-1 text-gray-600">{r.job_source}</td>
                <td className="px-2 py-1">
                  {r.is_duplicate ? (
                    <span className="flex items-center gap-1">
                      <StatusPill status="Duplicated" />
                      {r.existing_in && <span className="text-gray-500">in {r.existing_in}</span>}
                    </span>
                  ) : (
                    <StatusPill status="Pending" />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {preview.invalid.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-gray-600">
            {preview.invalid.length} line{preview.invalid.length === 1 ? '' : 's'} don&apos;t look like
            URLs and will be skipped
          </summary>
          <ul className="mt-2 max-h-32 overflow-auto rounded border border-amber-200 bg-amber-50 p-2
            font-mono text-2xs text-amber-900">
            {preview.invalid.map((l, i) => (
              <li key={i} className="truncate">
                {l}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'red' | 'amber';
}) {
  return (
    <div className="rounded-md border border-gray-200 px-3 py-2">
      <p
        className={`text-xl font-semibold tabular-nums ${
          value === 0 ? 'text-gray-400' : tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-600' : ''
        }`}
      >
        {value.toLocaleString()}
      </p>
      <p className="text-2xs text-gray-500">{label}</p>
    </div>
  );
}
