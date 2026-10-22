import type { ApplicationStatus, PipelineStatus } from '@/lib/types';

/** Application status colours, mirrored in the backend. */
const STATUS_CLASS: Record<ApplicationStatus, string> = {
  Pending: 'status-pending',
  Applied: 'status-applied',
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
  'Not Started': 'bg-gray-100 text-gray-600 ring-gray-200',
  'Recruiter Interview': 'bg-sky-100 text-sky-800 ring-sky-200',
  'Technical Interview': 'bg-indigo-100 text-indigo-800 ring-indigo-200',
  'Final Interview': 'bg-violet-100 text-violet-800 ring-violet-200',
  'Offer Received': 'bg-amber-100 text-amber-800 ring-amber-200',
  Accepted: 'bg-green-100 text-green-800 ring-green-300',
  Rejected: 'bg-gray-900 text-white ring-gray-900',
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
