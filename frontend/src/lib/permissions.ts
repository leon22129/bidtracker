import type { ApplicationStatus, JobApplication, Role, User } from './types';

/**
 * Client-side mirror of `backend/src/common/policies/application.policy.ts`.
 *
 * This exists ONLY to shape the UI — disable a dropdown option, gray out a row, hide an admin menu.
 * The backend enforces the same rules independently, so a user who bypasses this (devtools, curl)
 * gets a 403, not an escalation. Any change here must be made there too; the backend is authoritative.
 */

export const ADMIN_ONLY_FIELDS = new Set<keyof JobApplication>([
  'pipeline_status',
  'interview_date',
  'interview_note',
  'paid',
  'number',
  'workspace_id',
]);

const DUPLICATED_EDITABLE_FIELDS = new Set<keyof JobApplication>([
  'company_name',
  'job_title',
  'job_source',
  'note',
]);

export function isAdmin(user: Pick<User, 'role'> | null | undefined): boolean {
  return user?.role === 'admin' || user?.role === 'super_admin';
}

/** Can this user edit this specific field on this specific row? */
export function canEditField(
  user: Pick<User, 'role'> | null,
  row: Pick<JobApplication, 'paid' | 'application_status'>,
  field: keyof JobApplication,
): boolean {
  if (!user) return false;
  if (isAdmin(user)) return true;
  if (row.paid) return false;                 // paid rows are locked
  if (row.application_status === 'Rejected') return false;
  if (row.application_status === 'Duplicated' && !DUPLICATED_EDITABLE_FIELDS.has(field)) return false;
  if (ADMIN_ONLY_FIELDS.has(field)) return false;
  return true;
}

/** Which statuses may this user select, given the row's current status? */
export function allowedStatusTransitions(
  user: Pick<User, 'role'> | null,
  current: ApplicationStatus,
): ApplicationStatus[] {
  if (!user) return [current];
  if (isAdmin(user)) return ['Pending', 'Applied', 'Rejected', 'Duplicated'];

  // Non-admins: forward-only, and nothing may touch Duplicated.
  if (current === 'Duplicated') return ['Duplicated'];
  if (current === 'Pending') return ['Pending', 'Applied'];
  if (current === 'Applied') return ['Applied', 'Rejected'];
  return ['Rejected'];
}

export function canDeleteApplications(
  user: Pick<User, 'role'> | null,
  rows: Pick<JobApplication, 'application_status' | 'paid'>[] = [],
): boolean {
  return isAdmin(user) || (
    rows.length > 0 && rows.every((row) => (
      !row.paid && (row.application_status === 'Pending' || row.application_status === 'Duplicated')
    ))
  );
}

export function canManageUsers(user: Pick<User, 'role'> | null): boolean {
  return isAdmin(user);
}

export function canManageWorkspaces(user: Pick<User, 'role'> | null): boolean {
  return isAdmin(user);
}

export function canViewAnalytics(user: Pick<User, 'role'> | null): boolean {
  return isAdmin(user);
}

export function roleLabel(role: Role): string {
  return { super_admin: 'Super Admin', admin: 'Admin', bidder_manager: 'Bidder Manager', bidder: 'Bidder' }[role];
}

/** Human explanation for a disabled control — better than a silently dead input. */
export function whyLocked(
  user: Pick<User, 'role'> | null,
  row: Pick<JobApplication, 'paid' | 'application_status'>,
  field: keyof JobApplication,
): string | null {
  if (canEditField(user, row, field)) return null;
  if (row.paid) return 'This row is paid and locked — only an admin can edit it';
  if (row.application_status === 'Rejected') return 'Rejected applications are locked — only an admin can edit them';
  if (row.application_status === 'Duplicated') {
    return 'Duplicated applications only allow company, title, source, and note edits';
  }
  if (ADMIN_ONLY_FIELDS.has(field)) return 'Only an admin can change this field';
  return 'You do not have permission to edit this';
}
