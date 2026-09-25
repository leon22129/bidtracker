'use client';

import { useEffect, useRef, useState } from 'react';
import type { ApplicationStatus, JobApplication, PipelineStatus, User } from '@/lib/types';
import { allowedStatusTransitions, canEditField, whyLocked } from '@/lib/permissions';
import { PipelinePill, StatusPill } from '@/components/ui/status-pill';
import type { ColumnDef } from './columns';

interface CellProps {
  row: JobApplication;
  column: ColumnDef;
  user: User | null;
  boundary?: 'day' | 'week';
  onCommit: (field: keyof JobApplication, value: unknown) => void;
  onDownloadResume?: (row: JobApplication) => void;
  onDownloadJobDescription?: (row: JobApplication) => void;
  onDownloadCoverLetter?: (row: JobApplication) => void;
}

/**
 * One grid cell, click-to-edit.
 *
 * The editing model is deliberately "one active editor at a time, committed on blur/Enter". A
 * full-grid keyboard-navigable editing surface (arrow keys moving a focus rectangle) is closer to real
 * Sheets, but it needs its own focus-management layer; click-to-edit gets ~90% of the benefit for a
 * fraction of the complexity and composes correctly with virtualised rows that unmount as they scroll.
 *
 * Permission handling: `canEditField` mirrors the backend policy, so locked cells render as static
 * text with a tooltip explaining *why*. The backend re-checks regardless.
 */
export function Cell({
  row, column, user, boundary, onCommit, onDownloadResume, onDownloadJobDescription,
  onDownloadCoverLetter,
}: CellProps) {
  const [editing, setEditing] = useState(false);
  const [customSource, setCustomSource] = useState(false);
  const editable = column.editor !== 'readonly' && canEditField(user, row, column.key);
  const lockReason = whyLocked(user, row, column.key);

  function commit(value: unknown) {
    setEditing(false);
    setCustomSource(false);
    const current = row[column.key];
    const normalisedCurrent = current === null ? '' : current;
    const normalisedNext = value === null ? '' : value;
    if (String(normalisedCurrent) === String(normalisedNext)) return; // no-op edit: skip the request
    onCommit(column.key, value);
  }

  if (column.editor === 'resume') {
    const hasResume = Boolean(row.resume_generated_at);
    return (
      <div className="cell justify-center gap-1">
        <button
          type="button"
          className="rounded border border-gray-400 bg-white px-1.5 py-0.5 text-2xs font-semibold text-gray-800 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!hasResume}
          title={hasResume ? 'Download saved resume PDF' : 'No resume was saved for this application'}
          onClick={() => onDownloadResume?.(row)}
        >
          Resume.pdf
        </button>
        <button
          type="button"
          className="rounded border border-gray-400 bg-white px-1.5 py-0.5 text-2xs font-semibold text-gray-800 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!hasResume}
          title={hasResume ? 'Download the saved job description as jd.txt' : 'No job description was saved'}
          onClick={() => onDownloadJobDescription?.(row)}
        >
          JD.txt
        </button>
        <button
          type="button"
          className="rounded border border-gray-400 bg-white px-1.5 py-0.5 text-2xs font-semibold text-gray-800 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!row.cover_letter_template}
          title={row.cover_letter_template ? 'Download cover letter.pdf' : 'No cover letter was generated'}
          onClick={() => onDownloadCoverLetter?.(row)}
        >
          Cover letter.pdf
        </button>
      </div>
    );
  }

  // ---- checkbox (paid) ----
  if (column.editor === 'checkbox') {
    return (
      <div
        className={`cell justify-center ${editable ? '' : 'cell-locked'}`}
        title={lockReason ?? undefined}
      >
        <input
          type="checkbox"
          className="h-3.5 w-3.5 accent-gray-900 disabled:opacity-60"
          checked={Boolean(row[column.key])}
          disabled={!editable}
          onChange={(e) => onCommit(column.key, e.target.checked)}
        />
      </div>
    );
  }

  // ---- read-only display ----
  if (!editing) {
    return (
      <div
        className={`cell ${editable ? 'cell-editable' : 'cell-locked'} ${
          column.align === 'right' ? 'justify-end' : column.align === 'center' ? 'justify-center' : ''
        }`}
        title={lockReason ?? displayTitle(row, column)}
        onClick={() => editable && setEditing(true)}
        onKeyDown={(e) => {
          if (editable && (e.key === 'Enter' || e.key === 'F2')) setEditing(true);
        }}
        role={editable ? 'button' : undefined}
        tabIndex={editable ? 0 : undefined}
      >
        <Display row={row} column={column} boundary={boundary} />
      </div>
    );
  }

  // ---- active editors ----
  if (column.editor === 'select') {
    const options =
      column.key === 'application_status'
        ? allowedStatusTransitions(user, row.application_status)
        : (column.options ?? []);

    if (column.key === 'job_source' && customSource) {
      return (
        <div className="cell">
          <input
            autoFocus
            type="text"
            aria-label="Custom job source"
            placeholder="Enter job source"
            className="h-6 w-full rounded border border-blue-400 px-1 text-xs text-gray-900 outline-none"
            defaultValue={String(row[column.key] ?? '')}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => commit(e.target.value.trim())}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                setCustomSource(false);
                setEditing(false);
              }
            }}
          />
        </div>
      );
    }

    return (
      <div className="cell">
        <select
          autoFocus
          className="h-6 w-full rounded border border-blue-400 bg-white px-1 text-xs text-gray-900 outline-none"
          defaultValue={String(row[column.key] ?? '')}
          onBlur={() => setEditing(false)}
          onChange={(e) => {
            if (column.key === 'job_source' && e.target.value === '__custom__') {
              setCustomSource(true);
              return;
            }
            commit(e.target.value);
          }}
          onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
        >
          {/* The row's current value is always present so the select can render it even when the
              user's role cannot transition *to* it (e.g. a bidder looking at a Duplicated row). */}
          {!options.includes(String(row[column.key]) as never) && (
            <option value={String(row[column.key] ?? '')}>{String(row[column.key] ?? '')}</option>
          )}
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
          {column.key === 'job_source' && <option value="__custom__">+ Add custom source...</option>}
        </select>
      </div>
    );
  }

  if (column.editor === 'date' || column.editor === 'datetime') {
    const raw = row[column.key] as string | null;
    const value =
      column.editor === 'date'
        ? (raw ?? '').slice(0, 10)
        : raw
          ? new Date(raw).toISOString().slice(0, 16)
          : '';
    return (
      <div className="cell">
        <input
          autoFocus
          type={column.editor === 'date' ? 'date' : 'datetime-local'}
          className="h-6 w-full rounded border border-blue-400 px-1 text-xs text-gray-900 outline-none"
          defaultValue={value}
          onBlur={(e) => commit(e.target.value || null)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      </div>
    );
  }

  if (column.editor === 'longtext') {
    return <LongTextEditor row={row} column={column} onCommit={commit} onCancel={() => setEditing(false)} />;
  }

  return (
    <div className="cell">
      <input
        autoFocus
        type="text"
        className="h-6 w-full rounded border border-blue-400 px-1 text-xs text-gray-900 outline-none"
        defaultValue={String(row[column.key] ?? '')}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setEditing(false);
        }}
      />
    </div>
  );
}

/**
 * Notes are frequently long. Editing them in a 32px-tall cell is miserable, so the editor pops out
 * over neighbouring cells while keeping the row in place.
 */
function LongTextEditor({
  row,
  column,
  onCommit,
  onCancel,
}: {
  row: JobApplication;
  column: ColumnDef;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <div className="relative h-full">
      <textarea
        ref={ref}
        className="absolute left-0 top-0 z-20 min-h-[80px] w-[320px] max-w-[420px] resize rounded border
          border-blue-400 bg-white p-1.5 text-xs text-gray-900 shadow-lg outline-none"
        defaultValue={String(row[column.key] ?? '')}
        onBlur={(e) => onCommit(e.target.value)}
        onKeyDown={(e) => {
          // Enter inserts a newline here; Ctrl/Cmd+Enter commits, matching spreadsheet conventions.
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.target as HTMLTextAreaElement).blur();
          if (e.key === 'Escape') onCancel();
        }}
      />
    </div>
  );
}

function Display({
  row,
  column,
  boundary,
}: {
  row: JobApplication;
  column: ColumnDef;
  boundary?: 'day' | 'week';
}) {
  const value = row[column.key];

  if (column.key === 'application_status') {
    return <StatusPill status={row.application_status as ApplicationStatus} />;
  }
  if (column.key === 'pipeline_status') {
    return <PipelinePill status={row.pipeline_status as PipelineStatus} />;
  }
  if (column.key === 'date') {
    const date = String(value ?? '').slice(0, 10);
    const dateTextClass = row.application_status === 'Rejected' ? 'text-white' : 'text-gray-700';
    const label = date
      ? new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
          weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
        })
      : '';
    return boundary ? (
      <span className="flex min-w-0 flex-col leading-tight">
        <span className={`text-[9px] font-bold uppercase tracking-wide ${boundary === 'week' ? 'text-green-700' : 'text-red-700'}`}>
          {boundary === 'week' ? 'Week boundary' : 'Day start'}
        </span>
        <span className={`tabular-nums font-semibold ${dateTextClass}`}>{label}</span>
      </span>
    ) : (
      <span className={`tabular-nums font-medium ${dateTextClass}`}>{label}</span>
    );
  }
  if (column.key === 'number') {
    return (
      <span className={`tabular-nums ${row.application_status === 'Rejected' ? 'text-white' : 'text-gray-500'}`}>
        {String(value ?? '')}
      </span>
    );
  }
  if (column.editor === 'url') {
    if (!value) return <span className="text-gray-300">—</span>;
    const compactUrl = String(value).replace(/^https?:\/\/(www\.)?/, '');
    return (
      <a
        href={String(value)}
        target="_blank"
        rel="noopener noreferrer"
        className={`truncate hover:underline ${row.application_status === 'Rejected' ? 'text-white hover:text-gray-100' : 'text-blue-600'}`}
        title={String(value)}
        // Opening the link must not also start an edit on the cell behind it.
        onClick={(e) => e.stopPropagation()}
      >
        {compactUrl}
      </a>
    );
  }
  if (value === null || value === undefined || value === '') {
    return <span className="text-gray-300">—</span>;
  }
  return <span className="truncate">{String(value)}</span>;
}

function displayTitle(row: JobApplication, column: ColumnDef): string | undefined {
  const value = row[column.key];
  if (value === null || value === undefined || value === '') return undefined;
  const s = String(value);
  return s.length > 30 ? s : undefined;
}
