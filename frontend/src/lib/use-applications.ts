'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import type { ApplicationFilters, JobApplication } from './types';

/**
 * WINDOWED ROW CACHE — how this app serves a 50,000-row "Google Sheets" table.
 *
 * The table never holds all rows. It holds:
 *   - `total`, so the virtualizer can size the scrollbar for the full result set, and
 *   - a Map of page-index -> rows, populated on demand as the viewport moves.
 *
 * Why not fetch everything? 50k rows × ~15 fields ≈ 30 MB of JSON, several seconds of parse time, and
 * a permanently janky tab. Why not plain page-by-page paging? Because the requirement is a spreadsheet
 * feel — continuous scrolling, jump-to-anywhere. This hook is the middle path: infinite scroll with a
 * bounded memory footprint.
 *
 * PAGE_SIZE is 200: large enough that a fast scroll doesn't fire a request per frame, small enough
 * that a single request stays ~100 KB and lands in well under 100 ms.
 */
export const PAGE_SIZE = 200;

/** Pages kept in memory (~2,400 rows). Beyond this, the pages furthest from the viewport are evicted. */
const MAX_CACHED_PAGES = 12;

interface UseApplicationsResult {
  total: number;
  loading: boolean;
  error: string | null;
  /** Row at absolute index, or undefined while its page is in flight. */
  getRow: (index: number) => JobApplication | undefined;
  /** Tells the hook which absolute row range is visible; triggers fetches for missing pages. */
  ensureRange: (startIndex: number, endIndex: number) => void;
  /** Applies a server response (or optimistic patch) to the cached copy of one row. */
  patchRow: (id: string, patch: Partial<JobApplication>) => void;
  /** Drops the cache and refetches — used after import, paste, bulk edit, delete. */
  reload: () => void;
  /** Rows currently in memory, for bulk-selection helpers. */
  loadedRows: JobApplication[];
}

export function useApplications(
  workspaceId: string | null,
  filters: ApplicationFilters,
): UseApplicationsResult {
  const [pages, setPages] = useState<Map<number, JobApplication[]>>(new Map());
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inFlight = useRef<Set<number>>(new Set());
  const pageBounds = useRef<Map<number, { start: string | null; end: string | null }>>(new Map());
  const totalRef = useRef(0);
  const lastRange = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const generation = useRef(0);

  // Serialising the filters gives a stable dependency: any filter change invalidates the whole cache,
  // because row N means something different under a different filter/sort.
  const filterKey = useMemo(() => JSON.stringify({ workspaceId, ...filters }), [workspaceId, filters]);

  const resetAndFetch = useCallback(() => {
    generation.current += 1;
    inFlight.current.clear();
    pageBounds.current.clear();
    totalRef.current = 0;
    setPages(new Map());
    setTotal(0);
    setError(null);
  }, []);

  useEffect(() => {
    resetAndFetch();
  }, [filterKey, resetAndFetch]);

  const fetchPage = useCallback(
    async (pageIndex: number) => {
      if (!workspaceId) return;
      if (inFlight.current.has(pageIndex)) return;

      const gen = generation.current;
      inFlight.current.add(pageIndex);
      setLoading(true);

      try {
        const previous = pageBounds.current.get(pageIndex - 1);
        const following = pageBounds.current.get(pageIndex + 1);
        const cursorAfter = previous?.end ?? undefined;
        const cursorBefore = cursorAfter ? undefined : following?.start ?? undefined;
        const usingCursor = Boolean(cursorAfter || cursorBefore);
        const res = await api.listApplications(
          workspaceId,
          pageIndex + 1,
          PAGE_SIZE,
          filters,
          {
            cursorAfter,
            cursorBefore,
            includeTotal: !usingCursor && totalRef.current === 0,
          },
        );
        // A response from a superseded filter state must not be written into the new cache.
        if (gen !== generation.current) return;

        if (res.total !== null) {
          totalRef.current = res.total;
          setTotal(res.total);
        }
        pageBounds.current.set(pageIndex, {
          start: res.start_cursor,
          end: res.end_cursor,
        });
        setPages((prev) => {
          const next = new Map(prev);
          next.set(pageIndex, res.items);
          return evictDistantPages(next, lastRange.current);
        });
        setError(null);
      } catch (err) {
        if (gen === generation.current) {
          setError(err instanceof Error ? err.message : 'Failed to load applications');
        }
      } finally {
        inFlight.current.delete(pageIndex);
        if (inFlight.current.size === 0) setLoading(false);
      }
    },
    [workspaceId, filters],
  );

  // Initial load: page 0 establishes `total` so the virtualizer can size itself.
  useEffect(() => {
    if (workspaceId) void fetchPage(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, workspaceId]);

  const ensureRange = useCallback(
    (startIndex: number, endIndex: number) => {
      lastRange.current = { start: startIndex, end: endIndex };
      const firstPage = Math.max(0, Math.floor(startIndex / PAGE_SIZE));
      const lastPage = Math.floor(Math.max(0, endIndex) / PAGE_SIZE);

      // Prefetch one page either side so scrolling doesn't reveal blank rows at the seam.
      for (let p = Math.max(0, firstPage - 1); p <= lastPage + 1; p++) {
        if (p * PAGE_SIZE >= total && p !== 0) break;
        if (!pages.has(p)) void fetchPage(p);
      }
    },
    [pages, fetchPage, total],
  );

  const getRow = useCallback(
    (index: number): JobApplication | undefined => {
      const page = pages.get(Math.floor(index / PAGE_SIZE));
      return page?.[index % PAGE_SIZE];
    },
    [pages],
  );

  const patchRow = useCallback((id: string, patch: Partial<JobApplication>) => {
    setPages((prev) => {
      const next = new Map(prev);
      for (const [pageIndex, rows] of next) {
        const rowIndex = rows.findIndex((r) => r.id === id);
        if (rowIndex !== -1) {
          const copy = rows.slice();
          copy[rowIndex] = { ...copy[rowIndex], ...patch };
          next.set(pageIndex, copy);
          break;
        }
      }
      return next;
    });
  }, []);

  const reload = useCallback(() => {
    resetAndFetch();
    void fetchPage(0);
  }, [resetAndFetch, fetchPage]);

  const loadedRows = useMemo(
    () => [...pages.entries()].sort((a, b) => a[0] - b[0]).flatMap(([, rows]) => rows),
    [pages],
  );

  return { total, loading, error, getRow, ensureRange, patchRow, reload, loadedRows };
}

/**
 * Keeps memory bounded during a long scroll session: hold at most MAX_CACHED_PAGES, dropping the
 * pages furthest from where the user actually is.
 */
function evictDistantPages(
  pages: Map<number, JobApplication[]>,
  range: { start: number; end: number },
): Map<number, JobApplication[]> {
  if (pages.size <= MAX_CACHED_PAGES) return pages;

  const centre = Math.floor((range.start + range.end) / 2 / PAGE_SIZE);
  const sorted = [...pages.keys()].sort(
    (a, b) => Math.abs(a - centre) - Math.abs(b - centre),
  );
  const keep = new Set(sorted.slice(0, MAX_CACHED_PAGES));

  const next = new Map<number, JobApplication[]>();
  for (const [key, value] of pages) if (keep.has(key)) next.set(key, value);
  return next;
}
