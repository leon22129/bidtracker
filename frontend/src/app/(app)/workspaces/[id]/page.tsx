'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useApplications } from '@/lib/use-applications';
import type {
  ApplicationFilters, JobApplication, ResumeArtifact, Workspace, WorkspaceSummary,
} from '@/lib/types';
import { ApplicationsTable } from '@/components/table/applications-table';
import { BulkActionsBar } from '@/components/table/bulk-actions';
import { TableToolbar } from '@/components/table/toolbar';
import { useToast } from '@/components/ui/toast';
import { ADMIN_ONLY_FIELDS } from '@/lib/permissions';
import { ApplicationAnswersModal } from '@/components/table/application-answers-modal';
import {
  downloadCoverLetterPdf,
  downloadJobDescription as downloadSavedJobDescription,
  downloadResumePdf,
} from '@/lib/resume-pdf';

/**
 * The workspace grid page — the app's primary screen.
 *
 * It owns three pieces of state and passes them down:
 *   - `filters` (drives the data hook; any change resets the row cache)
 *   - `selectedIds` (drives the bulk bar; supports shift-range selection)
 *   - the workspace metadata (name and owner)
 *
 * Edits are optimistic: the cached row is patched immediately, the request goes out, and on failure the
 * previous value is restored and the error surfaced. With per-cell writes over a local network the
 * round-trip is a few milliseconds, but optimism is what makes it *feel* like a spreadsheet rather than
 * a form.
 */
export default function WorkspaceTablePage() {
  const params = useParams<{ id: string }>();
  const workspaceId = params.id;
  const { user } = useAuth();
  const toast = useToast();

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [summary, setSummary] = useState<WorkspaceSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [answersArtifact, setAnswersArtifact] = useState<ResumeArtifact | null>(null);

  const [filters, setFilters] = useState<ApplicationFilters>({
    sort_by: 'date',
    sort_dir: 'desc',
  });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const lastClickedIndex = useRef<number | null>(null);

  const { total, loading, error, getRow, ensureRange, patchRow, reload, loadedRows } =
    useApplications(workspaceId, filters);

  const loadMeta = useCallback(async () => {
    try {
      const [ws, sum] = await Promise.all([
        api.getWorkspace(workspaceId),
        api.workspaceSummary(workspaceId),
      ]);
      setWorkspace(ws);
      setSummary(sum);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load this workspace');
    }
  }, [workspaceId]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    if (error) toast.error(error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  // ---- selection -----------------------------------------------------------
  const onToggleSelect = useCallback(
    (id: string, shiftKey: boolean, rowIndex: number) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);

        // Shift-click extends from the previous click, matching spreadsheet behaviour. Only rows
        // currently loaded can be added — the ids of unloaded rows simply aren't known client-side.
        if (shiftKey && lastClickedIndex.current !== null) {
          const [from, to] = [lastClickedIndex.current, rowIndex].sort((a, b) => a - b);
          for (let i = from; i <= to; i++) {
            const row = getRow(i);
            if (row) next.add(row.id);
          }
        } else if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }

        lastClickedIndex.current = rowIndex;
        return next;
      });
    },
    [getRow],
  );

  const onSelectAllVisible = useCallback((ids: string[], selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (selected) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    lastClickedIndex.current = null;
  }, []);

  const selectedRows = useMemo(
    () => loadedRows.filter((r) => selectedIds.has(r.id)),
    [loadedRows, selectedIds],
  );

  const refreshSummary = useCallback(async () => {
    try {
      setSummary(await api.workspaceSummary(workspaceId));
    } catch {
      /* the summary is decorative; a failure here must not disturb the grid */
    }
  }, [workspaceId]);

  // ---- editing -------------------------------------------------------------
  const onEditCell = useCallback(
    async (row: JobApplication, field: keyof JobApplication, value: unknown) => {
      const previous = row[field];
      patchRow(row.id, { [field]: value } as Partial<JobApplication>);

      try {
        // Pipeline status lives on a separate admin-only endpoint.
        const isPipelineField = field === 'pipeline_status';

        const updated = isPipelineField
          ? await api.updatePipeline(row.id, { [field]: value } as never)
          : await api.updateApplication(row.id, { [field]: value } as Partial<JobApplication>);

        // Replace with the server's version: changing `url` re-derives job_source/normalized_url and
        // may flip the row to Duplicated; changing `date` reassigns `number`. Trusting the local guess
        // would leave the grid quietly out of sync.
        patchRow(row.id, updated);

        if (
          field === 'url' &&
          updated.application_status === 'Duplicated' &&
          row.application_status !== 'Duplicated'
        ) {
          toast.info('That URL already exists — the row was marked Duplicated.');
        }
        if (field === 'application_status' || field === 'paid') void refreshSummary();
      } catch (err) {
        patchRow(row.id, { [field]: previous } as Partial<JobApplication>);
        toast.error(err instanceof Error ? err.message : 'Edit rejected');
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [patchRow, refreshSummary],
  );

  // ---- bulk actions --------------------------------------------------------
  const onBulkPatch = useCallback(
    async (patch: Partial<JobApplication>) => {
      const ids = [...selectedIds];
      try {
        const res = await api.bulkUpdate(ids, patch);
        const field = Object.keys(patch)[0] as keyof JobApplication;
        const label = ADMIN_ONLY_FIELDS.has(field) ? `${String(field)} (admin)` : String(field);

        if (res.failed.length === 0) {
          toast.success(`Updated ${res.updated} row${res.updated === 1 ? '' : 's'} — ${label}`);
        } else {
          // Partial success is the normal case for a mixed selection (paid rows, illegal transitions).
          // Reporting the first reason turns a vague "some failed" into something actionable.
          toast.info(
            `Updated ${res.updated}, skipped ${res.failed.length}. First reason: ${res.failed[0].reason}`,
          );
        }
        reload();
        clearSelection();
        void refreshSummary();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Bulk update failed');
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedIds, reload, clearSelection, refreshSummary],
  );

  const onBulkDelete = useCallback(async () => {
    try {
      const res = await api.bulkDelete([...selectedIds]);
      toast.success(`Deleted ${res.deleted} row${res.deleted === 1 ? '' : 's'}`);
      reload();
      clearSelection();
      void refreshSummary();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete rows');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, reload, clearSelection, refreshSummary]);

  const downloadResume = useCallback(async (row: JobApplication) => {
    try {
      const artifact = await api.getApplicationResume(row.id);
      await downloadResumePdf(artifact);
      toast.success('Resume downloaded.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not download the resume');
    }
  }, [toast]);

  const downloadJobDescription = useCallback(async (row: JobApplication) => {
    try {
      const artifact = await api.getApplicationResume(row.id);
      downloadSavedJobDescription(artifact);
      toast.success('Job description downloaded.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not download the job description');
    }
  }, [toast]);

  const downloadCoverLetter = useCallback(async (row: JobApplication) => {
    try {
      const artifact = await api.getApplicationResume(row.id);
      await downloadCoverLetterPdf(artifact);
      toast.success('Cover letter downloaded.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not download the cover letter');
    }
  }, [toast]);

  const viewApplicationAnswers = useCallback(async (row: JobApplication) => {
    try {
      setAnswersArtifact(await api.getApplicationResume(row.id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load application answers');
    }
  }, [toast]);

  // ---- render --------------------------------------------------------------
  if (loadError) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-sm font-semibold">Workspace unavailable</h1>
        <p className="mt-2 text-xs text-gray-600">{loadError}</p>
        <p className="mt-1 text-2xs text-gray-500">
          If you believe this workspace should be assigned to you, ask an admin to reassign it.
        </p>
        <Link href="/workspaces" className="btn-secondary btn-xs mt-4 inline-flex">
          Back to workspaces
        </Link>
      </main>
    );
  }

  if (!workspace) {
    return <p className="px-4 py-6 text-sm text-gray-500">Loading workspace…</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TableToolbar
        workspaceId={workspaceId}
        workspaceName={workspace.name}
        ownerUsername={workspace.owner.username}
        user={user}
        filters={filters}
        onFiltersChange={(next) => {
          setFilters(next);
          clearSelection();
        }}
        summary={summary}
        onReload={() => {
          reload();
          void refreshSummary();
        }}
      />

      <div className="min-h-0 flex-1">
        <ApplicationsTable
          user={user}
          total={total}
          loading={loading}
          getRow={getRow}
          ensureRange={ensureRange}
          filters={filters}
          onSortChange={(sortBy, sortDir) => {
            setFilters((f) => ({ ...f, sort_by: sortBy, sort_dir: sortDir }));
            clearSelection();
          }}
          selectedIds={selectedIds}
          onToggleSelect={onToggleSelect}
          onSelectAllVisible={onSelectAllVisible}
          onEditCell={onEditCell}
          onDownloadResume={downloadResume}
          onDownloadJobDescription={downloadJobDescription}
          onDownloadCoverLetter={downloadCoverLetter}
          onViewApplicationAnswers={viewApplicationAnswers}
        />
      </div>

      <BulkActionsBar
        user={user}
        selectedIds={[...selectedIds]}
        selectedRows={selectedRows}
        onClear={clearSelection}
        onBulkPatch={onBulkPatch}
        onBulkDelete={onBulkDelete}
      />
      {answersArtifact && (
        <ApplicationAnswersModal
          artifact={answersArtifact}
          onClose={() => setAnswersArtifact(null)}
        />
      )}
    </div>
  );
}
