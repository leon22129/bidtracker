/**
 * Single source of truth for every "enum-like" value in the system.
 *
 * These are plain strings in the database. Validity is enforced at the
 * DTO boundary via `@IsIn(...)` against the arrays exported here — meaning there is exactly one
 * place to change if a value is ever added.
 */

export const ROLES = ['super_admin', 'admin', 'bidder_manager', 'bidder'] as const;
export type Role = (typeof ROLES)[number];

export const APPLICATION_STATUSES = ['Pending', 'Applied', 'Cancelled', 'Rejected', 'Banned', 'Duplicated'] as const;
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
  Cancelled: 'slate',
  Rejected: 'black',
  Banned: 'orange',
  Duplicated: 'red',
};

export const MAX_PAGE_SIZE = 500;
export const DEFAULT_PAGE_SIZE = 100;

/** Conservative chunk size for batched inserts and duplicate lookups. */
export const IMPORT_CHUNK_SIZE = 500;

/** Hard ceiling on a single manual-paste / import operation, to keep one request bounded. */
export const MAX_ROWS_PER_INGEST = 20000;
