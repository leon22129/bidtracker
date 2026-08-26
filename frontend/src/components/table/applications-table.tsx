'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { AccessLevel, ApplicationFilters, JobApplication, User } from '@/lib/types';
import { Cell } from './cell';
import {
  COLUMNS, HEADER_HEIGHT, ROW_HEIGHT, SELECT_COL_WIDTH, loadColumnWidths, saveColumnWidths,
} from './columns';
import { isAdmin } from '@/lib/permissions';

function isWeekBoundary(date: string): boolean {
  return new Date(`${date.slice(0, 10)}T00:00:00Z`).getUTCDay() === 0;
}

interface Props {
  user: User | null;
  access: AccessLevel;
  total: number;
  loading: boolean;
  getRow: (index: number) => JobApplication | undefined;
  ensureRange: (start: number, end: number) => void;
  filters: ApplicationFilters;
  onSortChange: (sortBy: string, sortDir: 'asc' | 'desc') => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string, shiftKey: boolean, rowIndex: number) => void;
  onSelectAllVisible: (ids: string[], selected: boolean) => void;
  onEditCell: (row: JobApplication, field: keyof JobApplication, value: unknown) => void;
}

/**
 * The 50,000-row grid.
 *
 * Three techniques do the heavy lifting:
 *  1. Row virtualisation (`@tanstack/react-virtual`) — only ~30 rows exist in the DOM at any time, so
 *     scroll cost is independent of the row count.
 *  2. Windowed data fetching (`useApplications`) — `getRow(index)` returns undefined for rows whose
 *     page hasn't arrived, and those render as skeletons instead of blocking.
 *  3. Absolute row positioning inside a spacer div of `total * ROW_HEIGHT` — the scrollbar reflects the
 *     full result set immediately, so the user can drag straight to row 43,000.
 *
 * Layout is a flex row per record rather than a real <table>, because sticky-left columns plus
 * pixel-accurate resizing plus absolute positioning is fragile with table layout. Semantics are
 * restored with explicit ARIA grid roles.
 */
export function ApplicationsTable(props: Props) {
  const {
    user, access, total, loading, getRow, ensureRange, filters, onSortChange,
    selectedIds, onToggleSelect, onSelectAllVisible, onEditCell,
  } = props;

  const scrollRef = useRef<HTMLDivElement>(null);
  const [widths, setWidths] = useState<Record<string, number>>({});

  useEffect(() => {
    setWidths(loadColumnWidths());
  }, []);

  // Non-admins never see the admin-only recruiting columns: showing a column that is always locked is
  // just noise in an already-wide table.
  const columns = useMemo(
    () => COLUMNS.filter((c) => !c.adminOnly || isAdmin(user)),
    [user],
  );

  const widthOf = useCallback(
    (key: string) => widths[key] ?? columns.find((c) => c.key === key)?.width ?? 140,
    [widths, columns],
  );

  const totalWidth = useMemo(
    () => SELECT_COL_WIDTH + columns.reduce((sum, c) => sum + widthOf(c.key), 0),
    [columns, widthOf],
  );

  const virtualizer = useVirtualizer({
    count: total,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const virtualRows = virtualizer.getVirtualItems();

  // Tell the data layer which absolute range is visible so it can fetch the matching pages.
  useEffect(() => {
    if (virtualRows.length === 0) {
      ensureRange(0, 0);
      return;
    }
    ensureRange(virtualRows[0].index, virtualRows[virtualRows.length - 1].index);
  }, [virtualRows, ensureRange]);

  // ---- column resizing -----------------------------------------------------
  const resizing = useRef<{ key: string; startX: number; startWidth: number } | null>(null);

  const onResizeStart = (key: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = { key, startX: e.clientX, startWidth: widthOf(key) };

    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      const col = columns.find((c) => c.key === resizing.current!.key);
      const min = col?.minWidth ?? 60;
      const next = Math.max(min, resizing.current.startWidth + (ev.clientX - resizing.current.startX));
      setWidths((prev) => ({ ...prev, [resizing.current!.key]: next }));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      resizing.current = null;
      setWidths((prev) => {
        saveColumnWidths(prev);
        return prev;
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // ---- header sorting ------------------------------------------------------
  const toggleSort = (key: string) => {
    const dir = filters.sort_by === key && filters.sort_dir === 'desc' ? 'asc' : 'desc';
    onSortChange(key, dir);
    virtualizer.scrollToIndex(0);
  };

  // Select-all applies to the rows currently loaded in memory; the footer states this explicitly so
  // "select all" can never be mistaken for "all 50,000 matching rows".
  const visibleIds = virtualRows
    .map((v) => getRow(v.index)?.id)
    .filter((id): id is string => Boolean(id));
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));

  const leftOffset = (index: number) =>
    SELECT_COL_WIDTH + columns.slice(0, index).reduce((sum, c) => sum + widthOf(c.key), 0);

  const stickyCount = columns.filter((c) => c.sticky).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scrollRef}
        className="thin-scroll relative min-h-0 flex-1 overflow-auto bg-white"
        role="grid"
        aria-rowcount={total}
        aria-colcount={columns.length + 1}
      >
        <div style={{ width: totalWidth, minWidth: '100%' }}>
          {/* ---- sticky header ---- */}
          <div
            className="sticky top-0 z-20 flex border-b-4 border-gray-900 bg-gray-700 shadow-sticky-row"
            style={{ height: HEADER_HEIGHT }}
            role="row"
          >
            <div
              className="sticky left-0 z-30 flex shrink-0 items-center justify-center border-r
                border-gray-600 bg-gray-700"
              style={{ width: SELECT_COL_WIDTH }}
            >
              <input
                type="checkbox"
                aria-label="Select all loaded rows"
                className="h-3.5 w-3.5 accent-gray-900"
                checked={allVisibleSelected}
                onChange={(e) => onSelectAllVisible(visibleIds, e.target.checked)}
              />
            </div>

            {columns.map((col, index) => {
              const active = filters.sort_by === col.key;
              return (
                <div
                  key={col.key}
                  role="columnheader"
                  aria-sort={active ? (filters.sort_dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  className={`group relative flex shrink-0 items-center border-r border-gray-600
                    bg-gray-700 px-2 text-2xs font-semibold uppercase tracking-wide text-white ${
                      col.sortable ? 'cursor-pointer select-none hover:text-gray-900' : ''
                    } ${col.sticky ? 'sticky z-10 shadow-sticky-col' : ''}`}
                  style={{
                    width: widthOf(col.key),
                    ...(col.sticky ? { left: leftOffset(index) } : {}),
                    ...(col.align === 'right' ? { justifyContent: 'flex-end' } : {}),
                  }}
                  onClick={() => col.sortable && toggleSort(col.key)}
                  title={col.adminOnly ? `${col.label} — admin only` : col.label}
                >
                  <span className="truncate">{col.label}</span>
                  {active && (
                      <span className="ml-1 text-white">
                      {filters.sort_dir === 'asc' ? '▲' : '▼'}
                    </span>
                  )}
                  {col.adminOnly && <span className="ml-1 text-gray-300" title="Admin only">🔒</span>}

                  {/* Resize handle: 5px wide, invisible until hover. */}
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    className="absolute right-0 top-0 h-full w-[5px] cursor-col-resize
                      bg-transparent hover:bg-blue-400"
                    onMouseDown={(e) => onResizeStart(col.key, e)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              );
            })}
          </div>

          {/* ---- virtualised body ---- */}
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {total === 0 && !loading && (
              <div className="absolute inset-x-0 top-8 text-center text-xs text-gray-500">
                No applications match the current filters.
              </div>
            )}

            {virtualRows.map((virtualRow) => {
              const row = getRow(virtualRow.index);

              if (!row) {
                // Placeholder while this page is in flight. Same height as a real row, so the
                // scroll position never jumps when data lands.
                return (
                  <div
                    key={virtualRow.key}
                    className="absolute left-0 flex items-center border-b border-gray-300"
                    style={{
                      top: virtualRow.start,
                      height: ROW_HEIGHT,
                      width: totalWidth,
                    }}
                  >
                    <div
                      className="sticky left-0 shrink-0 bg-white"
                      style={{ width: SELECT_COL_WIDTH }}
                    />
                    <div className="ml-2 h-3 w-40 animate-pulse rounded bg-gray-100" />
                  </div>
                );
              }

              const selected = selectedIds.has(row.id);
              const previousRow = virtualRow.index > 0 ? getRow(virtualRow.index - 1) : undefined;
              const nextRow = getRow(virtualRow.index + 1);
              const dateSorted = filters.sort_by === 'date';
              const dateDescending = dateSorted && filters.sort_dir !== 'asc';
              const dayStart = !dateSorted
                ? false
                : dateDescending
                  ? virtualRow.index > 0 && Boolean(previousRow && previousRow.date.slice(0, 10) !== row.date.slice(0, 10))
                  : Boolean(nextRow && nextRow.date.slice(0, 10) !== row.date.slice(0, 10));
              const weekBoundary = dayStart && isWeekBoundary(row.date);
              const boundaryClass = weekBoundary
                ? 'bg-green-50'
                : dayStart
                  ? 'bg-red-50'
                  : '';
              const boundaryStyle = weekBoundary
                ? { borderTop: '7px solid #16a34a' }
                : dayStart
                  ? { borderTop: '5px solid #ef4444' }
                  : undefined;
              const rowSurface = row.application_status === 'Duplicated'
                 ? 'bg-red-200 text-red-950 hover:bg-red-300'
                : row.application_status === 'Rejected'
                  ? 'bg-gray-500 text-white hover:bg-gray-600'
                  : row.application_status === 'Applied' && row.paid
                    ? 'bg-green-100 text-green-950 hover:bg-green-200'
                    : row.application_status === 'Applied'
                      ? 'bg-green-50 text-green-950 hover:bg-green-100'
                      : row.application_status === 'Pending'
                        ? 'bg-amber-50 text-gray-900 hover:bg-amber-100'
                        : dayStart ? boundaryClass : 'bg-white hover:bg-gray-50/80';
              return (
                <div
                  key={row.id}
                  role="row"
                  aria-rowindex={virtualRow.index + 1}
                  aria-selected={selected}
                  className={`absolute left-0 flex border-b border-gray-300 ${selected ? 'bg-blue-50' : rowSurface}`}
                  style={{
                    top: virtualRow.start,
                    height: ROW_HEIGHT,
                    width: totalWidth,
                    ...boundaryStyle,
                  }}
                >
                  <div
                    className={`sticky left-0 z-10 flex shrink-0 items-center justify-center border-r
                      border-gray-300 ${selected ? 'bg-blue-50' : rowSurface.replace(/ text-\S+| hover:\S+/g, '')}`}
                    style={{ width: SELECT_COL_WIDTH }}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Select row ${row.number}`}
                      className="h-3.5 w-3.5 accent-gray-900"
                      checked={selected}
                      onChange={(e) =>
                        onToggleSelect(
                          row.id,
                          (e.nativeEvent as MouseEvent).shiftKey,
                          virtualRow.index,
                        )
                      }
                    />
                  </div>

                  {columns.map((col, index) => (
                    <div
                      key={col.key}
                      role="gridcell"
                      className={`shrink-0 border-r border-gray-300 ${
                        col.sticky
                          ? `sticky z-[5] shadow-sticky-col ${
                              selected ? 'bg-blue-50' : rowSurface.replace(/ text-\S+| hover:\S+/g, '')
                            }`
                          : ''
                      }`}
                      style={{
                        width: widthOf(col.key),
                        ...(col.sticky ? { left: leftOffset(index) } : {}),
                      }}
                    >
                      <Cell
                        row={row}
                        column={col}
                        user={user}
                        access={access}
                        boundary={col.key === 'date' ? (weekBoundary ? 'week' : dayStart ? 'day' : undefined) : undefined}
                        onCommit={(field, value) => onEditCell(row, field, value)}
                      />
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ---- status bar ---- */}
      <div className="flex h-8 shrink-0 items-center gap-3 border-t border-gray-200 bg-gray-50 px-3
        text-2xs text-gray-600">
        <span className="tabular-nums">
          {total.toLocaleString()} row{total === 1 ? '' : 's'}
        </span>
        {selectedIds.size > 0 && (
          <span className="font-medium text-gray-900">{selectedIds.size} selected</span>
        )}
        {loading && <span className="text-gray-500">Loading…</span>}
        <div className="hidden items-center gap-2.5 md:flex" aria-label="Row color legend">
          <LegendItem color="bg-green-50" label="Applied unpaid" />
          <LegendItem color="bg-green-100" label="Applied paid" />
          <LegendItem color="bg-amber-50" label="Pending" />
          <LegendItem color="bg-gray-500" label="Rejected" />
            <LegendItem color="bg-red-200" label="Duplicated" />
        </div>
        <span className="ml-auto text-gray-400">
          {stickyCount} pinned column{stickyCount === 1 ? '' : 's'} · drag a header edge to resize ·
          click a cell to edit
        </span>
      </div>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1 whitespace-nowrap">
      <span className={`h-2.5 w-2.5 rounded-sm border border-gray-400 ${color}`} aria-hidden="true" />
      {label}
    </span>
  );
}
