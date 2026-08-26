'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { ImportPreview, ImportResult, Workspace } from '@/lib/types';
import { useToast } from '@/components/ui/toast';

const FIELD_LABELS: Record<string, string> = {
  date: 'Date',
  job_title: 'Job Title',
  company_name: 'Company Name',
  url: 'URL',
  application_status: 'Status',
  note: 'Note',
  resume_link: 'Resume Link',
};

/**
 * Excel / CSV import.
 *
 * Two-step by design: upload → column detection preview → run. The preview exists because a silent
 * mis-detected column in a 5,000-row import is expensive to undo, and because the fuzzy header matching
 * ("Job Link" → url, "Applied On" → date) is exactly the kind of thing a human should confirm once.
 *
 * The file is uploaded twice (once per step). That's deliberate: keeping a parsed workbook in server
 * memory between two requests would need a session store, and a re-upload of a few hundred KB over a
 * LAN is cheaper than that complexity.
 */
export default function ImportPage() {
  const params = useParams<{ id: string }>();
  const workspaceId = params.id;
  const router = useRouter();
  const toast = useToast();

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [enrich, setEnrich] = useState(false);
  const [defaultDate, setDefaultDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .getWorkspace(workspaceId)
      .then(setWorkspace)
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Could not load workspace'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  async function choose(f: File | null) {
    setFile(f);
    setPreview(null);
    setResult(null);
    if (!f) return;

    setBusy(true);
    try {
      setPreview(await api.importPreview(workspaceId, f));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not read that file');
      setFile(null);
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    if (!file) return;
    setBusy(true);
    try {
      const res = await api.importRun(workspaceId, file, { enrich, default_date: defaultDate });
      setResult(res);
      toast.success(`Imported ${res.created.toLocaleString()} rows`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  const missingUrl = preview && preview.detected_columns.url === null;

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-5">
        <Link href={`/workspaces/${workspaceId}`} className="text-xs text-gray-500 hover:underline">
          ← {workspace?.name ?? 'Workspace'}
        </Link>
        <h1 className="mt-1 text-lg font-semibold">Import from Excel or CSV</h1>
        <p className="mt-0.5 text-xs text-gray-500">
          Need to paste URLs one per line?{' '}
          <Link href={`/workspaces/${workspaceId}/add-urls`} className="text-blue-600 hover:underline">
            Paste URLs instead
          </Link>
        </p>
        <p className="mt-0.5 text-xs text-gray-500">
          Recognised columns: Date, Job Title, Company Name, URL, Status, Note, Resume Link. Only the URL
          column is required — everything else is optional or derived.
        </p>
      </div>

      {/* ---- step 1: file ---- */}
      <div
        className={`card flex flex-col items-center justify-center border-2 border-dashed p-8 text-center
          transition-colors ${dragging ? 'border-gray-900 bg-gray-50' : 'border-gray-300'}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void choose(e.dataTransfer.files?.[0] ?? null);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv,text/csv"
          className="hidden"
          onChange={(e) => void choose(e.target.files?.[0] ?? null)}
        />
        {file ? (
          <>
            <p className="text-sm font-medium">{file.name}</p>
            <p className="mt-0.5 text-2xs text-gray-500">
              {(file.size / 1024).toFixed(0)} KB
              {preview && ` · ${preview.total_rows.toLocaleString()} data rows`}
            </p>
            <button
              type="button"
              className="btn-secondary btn-xs mt-3"
              onClick={() => void choose(null)}
            >
              Choose a different file
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-700">Drop a .xlsx or .csv file here</p>
            <button
              type="button"
              className="btn-secondary btn-xs mt-3"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              {busy ? 'Reading…' : 'Browse files'}
            </button>
          </>
        )}
      </div>

      {/* ---- step 2: confirm detected columns ---- */}
      {preview && !result && (
        <div className="card mt-5 p-4">
          <h2 className="text-sm font-semibold">Detected columns</h2>
          <p className="mt-0.5 text-2xs text-gray-500">
            Matched from your header row. Unmatched columns are ignored.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            {Object.entries(FIELD_LABELS).map(([field, label]) => {
              const index = preview.detected_columns[field];
              const found = index !== null && index !== undefined;
              return (
                <div
                  key={field}
                  className={`rounded-md border px-2.5 py-1.5 text-2xs ${
                    found
                      ? 'border-green-200 bg-green-50 text-green-900'
                      : field === 'url'
                        ? 'border-red-200 bg-red-50 text-red-900'
                        : 'border-gray-200 bg-gray-50 text-gray-500'
                  }`}
                >
                  <span className="font-medium">{label}</span>
                  <span className="ml-1">
                    {found ? `→ "${preview.headers[index as number]}"` : '→ not found'}
                  </span>
                </div>
              );
            })}
          </div>

          {missingUrl && (
            <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              No URL column found. Rename the column to <strong>URL</strong> (or “Job Link”, “Link”,
              “Job URL”) and upload again — URLs are what duplicate detection is built on.
            </p>
          )}

          {preview.sample.length > 0 && (
            <div className="mt-4 overflow-auto rounded border border-gray-200">
              <table className="w-full text-2xs">
                <thead className="bg-gray-50 text-left text-gray-600">
                  <tr>
                    {preview.headers.map((h, i) => (
                      <th key={i} className="whitespace-nowrap px-2 py-1 font-medium">
                        {h || <span className="text-gray-400">col {i + 1}</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.sample.map((row, ri) => (
                    <tr key={ri} className="border-t border-gray-100">
                      {preview.headers.map((_, ci) => (
                        <td key={ci} className="max-w-[220px] truncate px-2 py-1 text-gray-700">
                          {String((row as unknown[])[ci] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-end gap-4 border-t border-gray-100 pt-4">
            <div className="w-40">
              <label className="label" htmlFor="fallback-date">
                Fallback date
              </label>
              <input
                id="fallback-date"
                type="date"
                className="input"
                value={defaultDate}
                onChange={(e) => setDefaultDate(e.target.value)}
              />
              <p className="mt-1 text-2xs text-gray-500">Used for rows with a missing/unparseable date.</p>
            </div>

            <label className="mb-6 flex items-center gap-2 text-xs text-gray-700">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-gray-900"
                checked={enrich}
                onChange={(e) => setEnrich(e.target.checked)}
              />
              Fetch missing company / job title from each URL
            </label>
            <span className="mb-6 text-2xs text-gray-500">
              Off by default: on a 5,000-row file this makes 5,000 outbound requests.
            </span>

            <button
              type="button"
              className="btn-primary mb-6 ml-auto"
              disabled={busy || Boolean(missingUrl)}
              onClick={run}
            >
              {busy ? 'Importing…' : `Import ${preview.total_rows.toLocaleString()} rows`}
            </button>
          </div>
        </div>
      )}

      {/* ---- step 3: results ---- */}
      {result && (
        <div className="card mt-5 p-4">
          <h2 className="text-sm font-semibold">Import complete</h2>
          <div className="mt-3 grid grid-cols-4 gap-3">
            <Stat label="Rows in file" value={result.total_rows} />
            <Stat label="Created" value={result.created} />
            <Stat label="Marked Duplicated" value={result.duplicates} tone="red" />
            <Stat label="Skipped" value={result.skipped.length} tone="amber" />
          </div>

          {result.skipped.length > 0 && (
            <details className="mt-3" open={result.skipped.length <= 10}>
              <summary className="cursor-pointer text-xs text-gray-600">
                Why {result.skipped.length} row{result.skipped.length === 1 ? '' : 's'} were skipped
              </summary>
              <ul className="mt-2 max-h-56 space-y-1 overflow-auto text-2xs">
                {result.skipped.map((s, i) => (
                  <li key={i} className="rounded border border-amber-100 bg-amber-50/60 px-2 py-1">
                    <span className="font-medium">Row {s.row}:</span> {s.reason}
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
            <button type="button" className="btn-secondary btn-xs" onClick={() => void choose(null)}>
              Import another file
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'red' | 'amber' }) {
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
