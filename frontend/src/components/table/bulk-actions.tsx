'use client';

import { useState } from 'react';
import type { ApplicationStatus, JobApplication, PipelineStatus, User } from '@/lib/types';
import { APPLICATION_STATUSES, JOB_SOURCES, PIPELINE_STATUSES } from '@/lib/types';
import { canDeleteApplications, isAdmin } from '@/lib/permissions';

interface Props {
  user: User | null;
  selectedIds: string[];
  /** Selected rows, including snapshots retained after scrolling away. */
  selectedRows: JobApplication[];
  onClear: () => void;
  onCopyLinks: () => Promise<void>;
  onBulkPatch: (patch: Partial<JobApplication>) => Promise<void>;
  onBulkDelete: () => Promise<void>;
  readOnly?: boolean;
}

/**
 * Floating action bar, shown only while rows are selected.
 *
 * Every action here hits the same backend endpoints that enforce the same per-row policy as inline
 * editing — a bulk edit of 500 rows is 500 individual permission checks server-side, not one blanket
 * write. The UI hides actions the role can't perform, but that is convenience, not enforcement.
 *
 * `date` is deliberately absent: bulk-changing dates would reshuffle the per-date `number` sequence for
 * every affected day at once, which is confusing and rarely what anyone means.
 */
export function BulkActionsBar(props: Props) {
  const { user, selectedIds, selectedRows, onClear, onCopyLinks, onBulkPatch, onBulkDelete, readOnly = false } = props;
  const [busy, setBusy] = useState(false);

  if (selectedIds.length === 0) return null;

  const lockedCount = selectedRows.filter((r) => r.paid).length;
  const admin = isAdmin(user);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  // Non-admins can only move rows forward through the allowed transitions, and a mixed selection has
  // no single legal target, so we offer the transitions the backend permits and let it reject rows
  // that aren't eligible (reported per-id in the response).
  const statusOptions: ApplicationStatus[] = admin
    ? [...APPLICATION_STATUSES]
    : ['Applied', 'Rejected', 'Cancelled'];

  return (
    <div
      className="pointer-events-auto fixed bottom-4 left-1/2 z-30 -translate-x-1/2"
      role="region"
      aria-label="Selected applications"
    >
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-700 bg-gray-900
        px-3 py-2 text-white shadow-lg">
        <span className="text-xs font-medium tabular-nums">
          {selectedIds.length} selected
          {!readOnly && lockedCount > 0 && (
            <span className="ml-1 font-normal text-amber-300">
              ({lockedCount} paid{admin ? '' : ' — will be skipped'})
            </span>
          )}
        </span>

        <div className="mx-1 h-4 w-px bg-gray-700" />

        <button
          type="button"
          className="rounded border border-gray-500 px-2 py-1 text-2xs font-medium hover:bg-gray-700 disabled:opacity-50"
          disabled={busy}
          title="Copy selected job URLs, one per line (Ctrl/Cmd+C)"
          onClick={() => void run(onCopyLinks)}
        >
          Copy links
        </button>

        {!readOnly && (
          <>
            <BulkSelect
              label="Status"
              disabled={busy}
              options={statusOptions}
              onPick={(value) => run(() => onBulkPatch({ application_status: value as ApplicationStatus }))}
            />

            <BulkSelect
              label="Source"
              disabled={busy}
              options={[...JOB_SOURCES]}
              onPick={(value) => run(() => onBulkPatch({ job_source: value as never }))}
            />

            {admin && (
              <BulkSelect
                label="Pipeline"
                disabled={busy}
                options={[...PIPELINE_STATUSES]}
                onPick={(value) => run(() => onBulkPatch({ pipeline_status: value as PipelineStatus }))}
              />
            )}

            {canDeleteApplications(user, selectedRows) && (
              <button
                type="button"
                className="rounded border border-red-500 bg-red-600 px-2 py-1 text-2xs font-medium
                  hover:bg-red-700 disabled:opacity-50"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      `Delete ${selectedIds.length} application${selectedIds.length === 1 ? '' : 's'}?\n\n` +
                        'This cannot be undone and will affect payment counts for the weeks involved.',
                    )
                  ) {
                    void run(onBulkDelete);
                  }
                }}
              >
                Delete
              </button>
            )}
          </>
        )}

        <div className="mx-1 h-4 w-px bg-gray-700" />

        <button
          type="button"
          className="text-2xs text-gray-300 underline hover:text-white"
          onClick={onClear}
          disabled={busy}
        >
          Clear
        </button>
      </div>
    </div>
  );
}

/** A select styled as a button; resets to its placeholder after each use so it can be reused. */
function BulkSelect({
  label,
  options,
  onPick,
  disabled,
}: {
  label: string;
  options: string[];
  onPick: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <select
      className="rounded border border-gray-600 bg-gray-900 px-1.5 py-1 text-2xs text-white
        disabled:opacity-50"
      value=""
      disabled={disabled}
      aria-label={`Set ${label} for selected rows`}
      onChange={(e) => {
        const value = e.target.value;
        e.currentTarget.value = '';
        if (value) onPick(value);
      }}
    >
      <option value="">{label}…</option>
      {options.map((o) => (
        <option key={o} value={o} className="text-gray-900">
          {o}
        </option>
      ))}
    </select>
  );
}
