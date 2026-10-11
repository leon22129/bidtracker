'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type {
  ApplicationFilters, ApplicationStatus, JobSource, PipelineStatus, User,
  WorkspaceSummary,
} from '@/lib/types';
import { APPLICATION_STATUSES, JOB_SOURCES, PIPELINE_STATUSES } from '@/lib/types';
import { isAdmin } from '@/lib/permissions';

interface Props {
  workspaceId: string;
  workspaceName: string;
  ownerUsername: string;
  user: User | null;
  filters: ApplicationFilters;
  onFiltersChange: (next: ApplicationFilters) => void;
  summary: WorkspaceSummary | null;
  onReload: () => void;
  canEdit: boolean;
}

/**
 * Filter bar above the grid.
 *
 * Search is debounced by 300ms: every keystroke would otherwise invalidate the whole page cache and
 * fire a fresh COUNT + SELECT against 50k rows. 300ms is short enough to feel live and long enough
 * that a typed word produces one query, not eight.
 */
export function TableToolbar(props: Props) {
  const {
    workspaceId, workspaceName, ownerUsername, user, filters, onFiltersChange, summary,
    onReload, canEdit,
  } = props;

  const [searchText, setSearchText] = useState(filters.search ?? '');
  const [showMore, setShowMore] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      const value = searchText.trim();
      if (value !== (filters.search ?? '')) onFiltersChange({ ...filters, search: value || undefined });
    }, 300);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);

  // Keep the input in sync when filters are cleared from elsewhere (e.g. the "Clear" button).
  useEffect(() => {
    setSearchText(filters.search ?? '');
  }, [filters.search]);

  function toggleIn<T extends string>(key: keyof ApplicationFilters, value: T) {
    const current = (filters[key] as T[] | undefined) ?? [];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    onFiltersChange({ ...filters, [key]: next.length ? next : undefined });
  }

  const activeCount =
    (filters.application_status?.length ?? 0) +
    (filters.pipeline_status?.length ?? 0) +
    (filters.job_source?.length ?? 0) +
    (filters.paid === undefined ? 0 : 1) +
    (filters.date_from ? 1 : 0) +
    (filters.date_to ? 1 : 0) +
    (filters.search ? 1 : 0);

  return (
    <div className="shrink-0 border-b border-gray-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <div className="mr-1 min-w-0">
          <h1 className="truncate text-sm font-semibold leading-tight">{workspaceName}</h1>
          <p className="text-2xs text-gray-500">
            Owner {ownerUsername}
            {!canEdit && <span className="ml-1 font-medium text-amber-700">· Read-only</span>}
            {summary && (
              <>
                {' · '}
                <span className="tabular-nums">
                  {(summary.by_application_status.Applied ?? 0).toLocaleString()} applied
                </span>
                {' · '}
                <span className="tabular-nums">
                  {(summary.by_application_status.Duplicated ?? 0).toLocaleString()} duplicated
                </span>
                {' · '}
                <span className="tabular-nums">{summary.paid.toLocaleString()} paid</span>
              </>
            )}
          </p>
        </div>

        <div className="relative ml-auto w-56">
          <input
            className="input py-1 pl-7 text-xs"
            placeholder="Search title, company, URL, note…"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
          <span className="pointer-events-none absolute left-2 top-1.5 text-xs text-gray-400">⌕</span>
          {searchText && (
            <button
              type="button"
              className="absolute right-1.5 top-1 text-xs text-gray-400 hover:text-gray-700"
              onClick={() => setSearchText('')}
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        <StatusChips filters={filters} onToggle={(v) => toggleIn('application_status', v)} />

        <button
          type="button"
          className="btn-secondary btn-xs"
          onClick={() => setShowMore((s) => !s)}
          aria-expanded={showMore}
        >
          Filters{activeCount > 0 && ` (${activeCount})`}
        </button>

        {activeCount > 0 && (
          <button
            type="button"
            className="text-xs text-gray-500 underline hover:text-gray-900"
            onClick={() =>
              onFiltersChange({ sort_by: filters.sort_by, sort_dir: filters.sort_dir })
            }
          >
            Clear
          </button>
        )}

        <button type="button" className="btn-secondary btn-xs" onClick={onReload} title="Refresh data">
          ↻
        </button>

        {canEdit && (
          <>
            <Link href={`/workspaces/${workspaceId}/add`} className="btn-primary btn-xs">
              Add application
            </Link>
            <Link href={`/workspaces/${workspaceId}/import`} className="btn-secondary btn-xs">
              Import Excel/CSV
            </Link>
          </>
        )}
      </div>

      {showMore && (
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3 border-t border-gray-100
          bg-gray-50/70 px-3 py-2.5">
          <FilterGroup label="Job source">
            <div className="flex max-w-xl flex-wrap gap-1">
              {JOB_SOURCES.map((s) => (
                <Chip
                  key={s}
                  label={s}
                  active={filters.job_source?.includes(s as JobSource) ?? false}
                  onClick={() => toggleIn('job_source', s)}
                />
              ))}
            </div>
          </FilterGroup>

          {isAdmin(user) && (
            <FilterGroup label="Pipeline">
              <div className="flex max-w-md flex-wrap gap-1">
                {PIPELINE_STATUSES.map((s) => (
                  <Chip
                    key={s}
                    label={s}
                    active={filters.pipeline_status?.includes(s as PipelineStatus) ?? false}
                    onClick={() => toggleIn('pipeline_status', s)}
                  />
                ))}
              </div>
            </FilterGroup>
          )}

          <FilterGroup label="Date range">
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                className="input w-32 py-1 text-xs"
                value={filters.date_from ?? ''}
                onChange={(e) =>
                  onFiltersChange({ ...filters, date_from: e.target.value || undefined })
                }
              />
              <span className="text-xs text-gray-400">→</span>
              <input
                type="date"
                className="input w-32 py-1 text-xs"
                value={filters.date_to ?? ''}
                onChange={(e) => onFiltersChange({ ...filters, date_to: e.target.value || undefined })}
              />
            </div>
          </FilterGroup>

          <FilterGroup label="Paid">
            <div className="flex gap-1">
              <Chip
                label="Paid"
                active={filters.paid === true}
                onClick={() =>
                  onFiltersChange({ ...filters, paid: filters.paid === true ? undefined : true })
                }
              />
              <Chip
                label="Unpaid"
                active={filters.paid === false}
                onClick={() =>
                  onFiltersChange({ ...filters, paid: filters.paid === false ? undefined : false })
                }
              />
            </div>
          </FilterGroup>
        </div>
      )}
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-2xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      {children}
    </div>
  );
}

/** The four application statuses are the most-used filter, so they stay on the main row. */
function StatusChips({
  filters,
  onToggle,
}: {
  filters: ApplicationFilters;
  onToggle: (value: ApplicationStatus) => void;
}) {
  return (
    <div className="flex gap-1">
      {APPLICATION_STATUSES.map((s) => (
        <Chip
          key={s}
          label={s}
          active={filters.application_status?.includes(s) ?? false}
          onClick={() => onToggle(s)}
        />
      ))}
    </div>
  );
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full border px-2 py-0.5 text-2xs font-medium transition-colors ${
        active
          ? 'border-gray-900 bg-gray-900 text-white'
          : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400 hover:text-gray-900'
      }`}
    >
      {label}
    </button>
  );
}
