import type { JobApplication } from '@/lib/types';
import { APPLICATION_STATUSES, JOB_SOURCES, PIPELINE_STATUSES } from '@/lib/types';

export type EditorKind =
  | 'readonly'
  | 'text'
  | 'longtext'
  | 'url'
  | 'date'
  | 'datetime'
  | 'select'
  | 'checkbox'
  | 'resume';

export interface ColumnDef {
  key: keyof JobApplication;
  label: string;
  width: number;
  minWidth: number;
  editor: EditorKind;
  options?: readonly string[];
  sortable: boolean;
  /** Only an admin may edit this column (mirrors the backend policy). */
  adminOnly?: boolean;
  align?: 'left' | 'right' | 'center';
  /** Pinned to the left edge while scrolling horizontally. */
  sticky?: boolean;
}

/**
 * Application columns in display order, including the admin-managed recruiting fields.
 *
 * `date` and `number` are sticky so that when a user scrolls right to edit a note, they can still see
 * which row they are on — the single most important affordance for a wide spreadsheet.
 */
export const COLUMNS: ColumnDef[] = [
  { key: 'date', label: 'Date', width: 108, minWidth: 92, editor: 'date', sortable: true, sticky: true },
  {
    key: 'number', label: '#', width: 56, minWidth: 48, editor: 'readonly', sortable: true,
    align: 'right', sticky: true,
  },
  { key: 'job_title', label: 'Job Title', width: 230, minWidth: 120, editor: 'text', sortable: true },
  {
    key: 'company_name', label: 'Company Name', width: 180, minWidth: 110, editor: 'text',
    sortable: true,
  },
  { key: 'url', label: 'URL', width: 300, minWidth: 140, editor: 'url', sortable: false },
  {
    key: 'resume_generated_at', label: 'Generated files', width: 410, minWidth: 380, editor: 'resume',
    sortable: false, align: 'center',
  },
  {
    key: 'job_source', label: 'Job Source', width: 150, minWidth: 110, editor: 'select',
    options: JOB_SOURCES, sortable: true,
  },
  {
    key: 'application_status', label: 'Application Status', width: 150, minWidth: 130,
    editor: 'select', options: APPLICATION_STATUSES, sortable: true,
  },
  {
    key: 'pipeline_status', label: 'Pipeline Status', width: 165, minWidth: 130, editor: 'select',
    options: PIPELINE_STATUSES, sortable: true, adminOnly: true,
  },
  { key: 'note', label: 'Note', width: 240, minWidth: 120, editor: 'longtext', sortable: false },
  {
    key: 'paid', label: 'Paid', width: 62, minWidth: 56, editor: 'checkbox', sortable: true,
    align: 'center',
  },
];

export const SELECT_COL_WIDTH = 36;
export const ROW_HEIGHT = 32;
export const HEADER_HEIGHT = 34;

const STORAGE_KEY = 'bidtracker_column_widths';

/** Column widths persist per browser so a user's layout survives a reload. */
export function loadColumnWidths(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function saveColumnWidths(widths: Record<string, number>) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
  } catch {
    /* private mode / quota — layout simply won't persist */
  }
}
