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
import { downloadJobDescription as downloadSavedJobDescription } from '@/lib/artifact-download';
import { copyText } from '@/lib/clipboard';

interface SelectedApplication {
  row: JobApplication;
  index: number;
}

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

  // Keep selected rows after their pages leave the scrolling cache, including their table order.
  const [selection, setSelection] = useState<Map<string, SelectedApplication>>(new Map());
  const selectedIds = useMemo(() => new Set(selection.keys()), [selection]);
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
      const anchor = lastClickedIndex.current;
      lastClickedIndex.current = rowIndex;
      setSelection((prev) => {
        const next = new Map(prev);

        // Shift-click extends from the previous click, matching spreadsheet behaviour. Only rows
        // currently loaded can be added — the ids of unloaded rows simply aren't known client-side.
        if (shiftKey && anchor !== null) {
          const [from, to] = [anchor, rowIndex].sort((a, b) => a - b);
          for (let i = from; i <= to; i++) {
            const row = getRow(i);
            if (row) next.set(row.id, { row, index: i });
          }
        } else if (next.has(id)) {
          next.delete(id);
        } else {
          const row = getRow(rowIndex);
          if (row) next.set(id, { row, index: rowIndex });
        }

        return next;
      });
    },
    [getRow],
  );

  const onSelectAllVisible = useCallback((rowIndices: number[], selected: boolean) => {
    setSelection((prev) => {
      const next = new Map(prev);
      for (const index of rowIndices) {
        const row = getRow(index);
        if (!row) continue;
        if (selected) next.set(row.id, { row, index });
        else next.delete(row.id);
      }
      return next;
    });
  }, [getRow]);

  const clearSelection = useCallback(() => {
    setSelection(new Map());
    lastClickedIndex.current = null;
  }, []);

  useEffect(clearSelection, [workspaceId, clearSelection]);

  const selectedRows = useMemo(() => {
    const currentRows = new Map(loadedRows.map((row) => [row.id, row]));
    return [...selection.values()]
      .sort((a, b) => a.index - b.index)
      .map(({ row }) => currentRows.get(row.id) ?? row);
  }, [loadedRows, selection]);

  const selectedLinks = useMemo(() => selectedRows.map((row) => row.url).join('\n'), [selectedRows]);

  const onCopyLinks = useCallback(async () => {
    if (!selectedRows.length) return;
    try {
      await copyText(selectedLinks);
      toast.success(`Copied ${selectedRows.length} link${selectedRows.length === 1 ? '' : 's'}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not copy links to the clipboard.');
    }
  }, [selectedLinks, selectedRows.length, toast]);

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
        setSelection((prev) => {
          const selected = prev.get(row.id);
          if (!selected) return prev;
          const next = new Map(prev);
          next.set(row.id, { ...selected, row: updated });
          return next;
        });

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
      const [artifact, { downloadResumePdf }] = await Promise.all([
        api.getApplicationResume(row.id),
        import('@/lib/resume-pdf'),
      ]);
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
      const [artifact, { downloadCoverLetterPdf }] = await Promise.all([
        api.getApplicationResume(row.id),
        import('@/lib/resume-pdf'),
      ]);
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

  const downloadScreenshot = useCallback(async (row: JobApplication) => {
    try {
      const blob = await api.getApplicationScreenshot(row.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `application-${row.number}-proof.png`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success('Submission screenshot downloaded.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not download the screenshot');
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
    <div
      className="flex h-full min-h-0 flex-col"
      onCopy={(event) => {
        const target = event.target as HTMLElement;
        // Native copying still works for text selections and active cell editors.
        if (
          !selectedRows.length || window.getSelection()?.toString() ||
          target.closest('textarea, select, input:not([type="checkbox"]), [contenteditable]')
        ) return;
        event.clipboardData.setData('text/plain', selectedLinks);
        event.preventDefault();
        toast.success(`Copied ${selectedRows.length} link${selectedRows.length === 1 ? '' : 's'}.`);
      }}
    >
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
          clearSelection();
          reload();
          void refreshSummary();
        }}
        canEdit={workspace.can_edit}
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
          onDownloadScreenshot={downloadScreenshot}
          readOnly={!workspace.can_edit}
        />
      </div>

      <BulkActionsBar
        user={user}
        selectedIds={[...selectedIds]}
        selectedRows={selectedRows}
        onClear={clearSelection}
        onCopyLinks={onCopyLinks}
        onBulkPatch={onBulkPatch}
        onBulkDelete={onBulkDelete}
        readOnly={!workspace.can_edit}
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
