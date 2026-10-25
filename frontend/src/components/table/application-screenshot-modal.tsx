'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { ApplicationFilters, JobApplication } from '@/lib/types';

interface Props {
  application: JobApplication;
  filters: ApplicationFilters;
  onClose: () => void;
}

export function ApplicationScreenshotModal({ application, filters, onClose }: Props) {
  const [current, setCurrent] = useState(application);
  const [attempt, setAttempt] = useState(0);
  const [image, setImage] = useState<{ id: string; url?: string; error?: string } | null>(null);
  const [neighbors, setNeighbors] = useState<{
    id: string;
    previous?: JobApplication;
    next?: JobApplication;
    error?: string;
  } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;
    contentRef.current?.scrollTo(0, 0);
    setImage(null);
    void api.getApplicationScreenshot(current.id).then((blob) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setImage({ id: current.id, url: objectUrl });
    }).catch((error: unknown) => {
      if (!cancelled) setImage({
        id: current.id,
        error: error instanceof Error ? error.message : 'Could not load the screenshot.',
      });
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [current.id, attempt]);

  useEffect(() => {
    let cancelled = false;
    // Ask the server for adjacent screenshots so navigation also works beyond loaded table pages.
    const screenshotFilters = { ...filters, has_screenshot: true };
    void Promise.all([
      api.listApplications(current.workspace_id, 1, 1, screenshotFilters, {
        cursorBefore: current.id, includeTotal: false,
      }),
      api.listApplications(current.workspace_id, 1, 1, screenshotFilters, {
        cursorAfter: current.id, includeTotal: false,
      }),
    ]).then(([previous, next]) => {
      if (!cancelled) setNeighbors({ id: current.id, previous: previous.items[0], next: next.items[0] });
    }).catch((error: unknown) => {
      if (!cancelled) setNeighbors({
        id: current.id,
        error: error instanceof Error ? error.message : 'Could not load adjacent screenshots.',
      });
    });
    return () => { cancelled = true; };
  }, [current.id, current.workspace_id, filters, attempt]);

  const previous = neighbors?.id === current.id ? neighbors.previous : undefined;
  const next = neighbors?.id === current.id ? neighbors.next : undefined;
  const activeImage = image?.id === current.id ? image : null;
  const navigationError = neighbors?.id === current.id ? neighbors.error : undefined;

  const navigate = useCallback((direction: 'previous' | 'next') => {
    const target = direction === 'previous' ? previous : next;
    if (target) setCurrent(target);
  }, [previous, next]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (!event.altKey && !event.ctrlKey && !event.metaKey &&
        (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
        event.preventDefault();
        if (!event.repeat) navigate(event.key === 'ArrowRight' ? 'next' : 'previous');
      } else if (event.key === 'Tab') {
        const dialog = dialogRef.current;
        const controls = dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]');
        const first = controls?.[0];
        const last = controls?.[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [navigate, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-6"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="application-screenshot-title"
        aria-describedby="application-screenshot-help"
        tabIndex={-1}
        className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-white shadow-xl outline-none"
      >
        <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-gray-200 px-4 py-3">
          <div className="min-w-0" aria-live="polite">
            <h2 id="application-screenshot-title" className="text-sm font-semibold text-gray-900">
              Submission screenshot
            </h2>
            <p className="mt-1 break-words text-xs text-gray-600">
              {current.date.slice(0, 10)} · #{current.number} ·{' '}
              {[current.company_name, current.job_title].filter(Boolean).join(' — ') || 'Application'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {activeImage?.url && !activeImage.error && (
              <a className="btn-secondary btn-xs" href={activeImage.url}
                download={`application-${current.date.slice(0, 10)}-${current.number}-proof.png`}>
                Download
              </a>
            )}
            <button type="button" className="btn-secondary btn-xs" onClick={onClose}>Close</button>
          </div>
        </div>
        <div ref={contentRef} className="min-h-0 overflow-auto bg-gray-100 p-3" aria-busy={!activeImage}>
          {activeImage?.error ? (
            <div role="alert" className="p-8 text-center text-sm text-red-700">
              <p>{activeImage.error}</p>
              <button type="button" className="btn-secondary btn-xs mt-3" onClick={() => setAttempt((value) => value + 1)}>
                Retry
              </button>
            </div>
          ) : activeImage?.url ? (
            // Screenshots use authenticated blob URLs and retain their original aspect ratio.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={activeImage.url} className="mx-auto block h-auto max-w-full" alt={`Submission screenshot for ${current.company_name || 'application'} — ${current.job_title || `#${current.number}`}`}
              onError={() => setImage((value) => value?.id === current.id
                ? { ...value, error: 'Could not display the screenshot.' } : value)} />
          ) : (
            <p role="status" className="p-12 text-center text-sm text-gray-500">Loading screenshot…</p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-4 py-3">
          <p id="application-screenshot-help" className="text-xs text-gray-500">
            ← Previous · Next → · Esc to close. Skips applications without screenshots.
          </p>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-secondary btn-xs" disabled={!previous}
              aria-keyshortcuts="ArrowLeft" onClick={() => navigate('previous')}>
              ← Previous
            </button>
            <button type="button" className="btn-secondary btn-xs" disabled={!next}
              aria-keyshortcuts="ArrowRight" onClick={() => navigate('next')}>
              Next →
            </button>
          </div>
          {navigationError && (
            <p role="alert" className="w-full text-xs text-red-700">
              {navigationError}{' '}
              <button type="button" className="underline" onClick={() => setAttempt((value) => value + 1)}>Retry navigation</button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
