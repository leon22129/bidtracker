import type { ApplicationStatus, PipelineStatus } from '@/lib/types';

/** Application status colours, mirrored in the backend. */
const STATUS_CLASS: Record<ApplicationStatus, string> = {
  Pending: 'status-pending',
  Applied: 'status-applied',
  Cancelled: 'status-cancelled',
  Rejected: 'status-rejected',
  Banned: 'status-banned',
  Duplicated: 'status-duplicated',
};

export function StatusPill({ status }: { status: ApplicationStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-2xs font-medium ring-1 ring-inset ${STATUS_CLASS[status]}`}
    >
      {status}
    </span>
  );
}

/** Pipeline colours run cool → warm as the candidate advances, so progress is readable at a glance. */
const PIPELINE_CLASS: Record<PipelineStatus, string> = {
  'Not Started': 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 ring-gray-200 dark:ring-gray-700',
  'Recruiter Interview': 'bg-sky-100 text-sky-800 ring-sky-200 dark:bg-sky-900 dark:text-sky-200 dark:ring-sky-800',
  'Technical Interview': 'bg-indigo-100 dark:bg-indigo-900 text-indigo-800 dark:text-indigo-200 ring-indigo-200 dark:ring-indigo-800',
  'Final Interview': 'bg-violet-100 dark:bg-violet-900 text-violet-800 dark:text-violet-200 ring-violet-200 dark:ring-violet-800',
  'Offer Received': 'bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200 ring-amber-200 dark:ring-amber-800',
  Accepted: 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 ring-green-300 dark:ring-green-700',
  Rejected: 'bg-gray-900 text-white ring-gray-900 dark:bg-gray-950 dark:ring-gray-500',
};

export function PipelinePill({ status }: { status: PipelineStatus }) {
  if (status === 'Not Started') {
    return <span className="text-2xs text-gray-400">Not Started</span>;
  }
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-2xs font-medium ring-1 ring-inset ${PIPELINE_CLASS[status]}`}
    >
      {status}
    </span>
  );
}
