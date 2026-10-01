import { ForbiddenException } from '@nestjs/common';
import { ApplicationStatus, Role } from '../constants';

/**
 * FIELD-LEVEL AUTHORIZATION — the security core of this application.
 *
 * Pure functions, zero I/O, so they can be unit-tested exhaustively and, more importantly, so that
 * EVERY write path (inline edit, bulk edit, Excel import, paid toggle) can call the same
 * code. A permission model that lives in the UI or is re-implemented per endpoint is a permission
 * model with holes; this module exists to make the side door impossible.
 */

/** Fields a bidder / bidder_manager may write on an unlocked row in a workspace they can edit. */
export const BIDDER_WRITABLE_FIELDS = [
  'date',
  'job_title',
  'company_name',
  'url',
  'job_source',
  'application_status',
  'note',
] as const;

/** Fields only an admin may ever write. */
export const ADMIN_ONLY_FIELDS = [
  'number',
  'workspace_id',
  'pipeline_status',
  'interview_date',
  'interview_note',
  'paid',
] as const;

const DUPLICATED_WRITABLE_FIELDS = [
  'job_title',
  'company_name',
  'job_source',
  'note',
] as const;

/**
 * Allow-list of status transitions available to non-admins, as `from>to`.
 *
 * An allow-list, not a deny-list: forgetting an entry means "admin has to do it" (safe), whereas
 * forgetting a deny entry would mean a bidder can inflate their own payment (expensive).
 */
const BIDDER_ALLOWED_TRANSITIONS = new Set<string>([
  'Pending>Applied',
  'Applied>Rejected',
  // Set ALLOW_BIDDER_PENDING_TO_REJECTED=true to also permit discarding un-applied rows.
  ...(process.env.ALLOW_BIDDER_PENDING_TO_REJECTED === 'true' ? ['Pending>Rejected'] : []),
]);

export function isAdmin(role: Role | string): boolean {
  return role === 'admin' || role === 'super_admin';
}

/**
 * A paid row is a settled financial record. It is read-only for everyone except admin — enforced
 * here, before any patch filtering, on single edits, bulk edits and deletes alike.
 */
export function assertRowNotLocked(
  row: { paid: boolean; application_status?: ApplicationStatus | string },
  role: Role | string,
): void {
  if (row.application_status === 'Rejected' && !isAdmin(role)) {
    throw new ForbiddenException(
      'Rejected applications are locked. Only an admin can modify this row.',
    );
  }
  if (row.paid && !isAdmin(role)) {
    throw new ForbiddenException(
      'This row is marked as paid and is locked. Only an admin can modify it.',
    );
  }
}

/**
 * Enforces the application-status state machine.
 *
 *   Pending ──▶ Applied ──▶ Rejected          (any role)
 *   everything else, including anything touching `Duplicated`   (admin only)
 *
 * `Duplicated` is admin-only because duplicates are excluded from the weekly payment count: letting
 * a bidder clear the flag would let them bill for a duplicate paste.
 */
export function assertStatusTransition(
  from: ApplicationStatus | string,
  to: ApplicationStatus | string,
  role: Role | string,
): void {
  if (from === to) return;
  if (isAdmin(role)) return;

  if (to === 'Duplicated') {
    throw new ForbiddenException(
      'Only an admin can mark a row as Duplicated (it affects payment calculation).',
    );
  }
  if (from === 'Duplicated') {
    throw new ForbiddenException(
      'Only an admin can change a row away from Duplicated (it affects payment calculation).',
    );
  }
  if (!BIDDER_ALLOWED_TRANSITIONS.has(`${from}>${to}`)) {
    throw new ForbiddenException(
      `Transition ${from} → ${to} is not allowed for your role. ` +
        'Allowed: Pending → Applied, Applied → Rejected.',
    );
  }
}

/**
 * Removes admin-only keys from a non-admin patch.
 *
 * Keys whose value is unchanged are silently dropped (so the client may PATCH a whole row object
 * without tripping over fields it never edited); keys that would actually change an admin-only
 * field throw 403.
 */
export function filterPatchByRole<T extends Record<string, any>>(
  patch: T,
  current: Record<string, any>,
  role: Role | string,
): Partial<T> {
  if (isAdmin(role)) return patch;

  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;

    if ((ADMIN_ONLY_FIELDS as readonly string[]).includes(key)) {
      if (!isSameValue(current[key], value)) {
        throw new ForbiddenException(`Only an admin can modify "${key}".`);
      }
      continue; // unchanged admin-only field: drop it, don't fail
    }

    if (
      current.application_status === 'Duplicated' &&
      !(DUPLICATED_WRITABLE_FIELDS as readonly string[]).includes(key)
    ) {
      if (isSameValue(current[key], value)) continue;
      throw new ForbiddenException(
        'Only an admin can modify this field on a Duplicated application.',
      );
    }

    if (!(BIDDER_WRITABLE_FIELDS as readonly string[]).includes(key)) {
      continue; // unknown/derived field (id, created_at, normalized_url, ...) — never client-writable
    }

    out[key] = value;
  }
  return out as Partial<T>;
}

function isSameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date && (typeof b === 'string' || b instanceof Date)) {
    return a.getTime() === new Date(b as any).getTime();
  }
  if (a === null && b === null) return true;
  return a === b;
}
