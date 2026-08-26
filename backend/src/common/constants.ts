/**
 * Single source of truth for every "enum-like" value in the system.
 *
 * SQLite has no enum type, so these are plain strings in the database. Validity is enforced at the
 * DTO boundary via `@IsIn(...)` against the arrays exported here — meaning there is exactly one
 * place to change if a value is ever added.
 */

export const ROLES = ['admin', 'bidder_manager', 'bidder'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSION_TYPES = ['view', 'edit'] as const;
export type PermissionType = (typeof PERMISSION_TYPES)[number];

export const APPLICATION_STATUSES = ['Pending', 'Applied', 'Rejected', 'Duplicated'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const PIPELINE_STATUSES = [
  'Not Started',
  'Recruiter Interview',
  'Technical Interview',
  'Final Interview',
  'Offer Received',
  'Accepted',
  'Rejected',
] as const;
export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

/** Pipeline stages that count as "an interview happened" for analytics. */
export const INTERVIEW_PIPELINE_STAGES: PipelineStatus[] = [
  'Recruiter Interview',
  'Technical Interview',
  'Final Interview',
];

/** Pipeline stages that count as "an offer" for analytics. */
export const OFFER_PIPELINE_STAGES: PipelineStatus[] = ['Offer Received', 'Accepted'];

export const JOB_SOURCES = [
  'Greenhouse',
  'Workday',
  'ADP',
  'Dayforce',
  'Lever',
  'SmartRecruiters',
  'iCIMS',
  'Taleo',
  'LinkedIn',
  'Indeed',
  'ZipRecruiter',
  'Company Career Page',
  'Other',
] as const;
export type JobSource = (typeof JOB_SOURCES)[number];

/** Tailwind-side colour contract, mirrored in the frontend. Kept here so the API can describe itself. */
export const APPLICATION_STATUS_COLORS: Record<ApplicationStatus, string> = {
  Pending: 'gray',
  Applied: 'green',
  Rejected: 'black',
  Duplicated: 'red',
};

export const MAX_PAGE_SIZE = 500;
export const DEFAULT_PAGE_SIZE = 100;

/** Chunk size for batched inserts. SQLite has a bound-parameter limit (~32k); this stays well under. */
export const IMPORT_CHUNK_SIZE = 500;

/** Hard ceiling on a single manual-paste / import operation, to keep one request bounded. */
export const MAX_ROWS_PER_INGEST = 20000;
