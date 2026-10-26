# 3. Permission & Authorization Logic

Authorization answers **three independent questions**, and the code keeps them separate on purpose:

```
(A) ROLE      — may this kind of user call this endpoint at all?      → RolesGuard
(B) SCOPE     — is this workspace owned by/created by this user?       → WorkspaceAccessService
(C) FIELD     — may this user set this column to this value?           → ApplicationPolicy
```

Most permission bugs in tools like this come from implementing (A) and forgetting (C). Here (C) is a pure,
unit-tested module that every write path must pass through.

## 3.1 (A) Role capability matrix

| Capability | admin | bidder_manager | bidder |
|---|:--:|:--:|:--:|
| Create users | ✅ | ✅ (bidders allocated to self) | ❌ |
| Deactivate / reactivate users | ✅ | ✅ (allocated bidders only) | ❌ |
| Delete users | ✅ | ❌ | ❌ |
| Reset any password | ✅ | ❌ | ❌ |
| Change username / role | ✅ | ❌ | ❌ |
| Change **own** password | ✅ | ✅ | ✅ |
| Create / rename / delete workspace | ✅ | ❌ | ❌ |
| List accessible workspaces | created workspaces | owned + assigned bidders' workspaces | owned workspace |
| View assigned bidders' application tables and profiles | ✅ | ✅ (read-only) | ❌ |
| Assign a profile to a bidder manager | ✅ | ❌ | ❌ |
| Choose who works on a manager-allocated profile | ❌ | ✅ (self or own allocated bidders) | ❌ |
| Add application manually / import Excel or CSV | ✅ | ✅ (owned workspace) | ✅ (owned workspace) |
| Edit job title/company/url/note | ✅ | ✅ (owned workspace) | ✅ (owned workspace) |
| Set status `Pending→Applied`, `Applied→Rejected` | ✅ | ✅ | ✅ |
| Any other status transition | ✅ | ❌ | ❌ |
| Set/clear `Duplicated` | ✅ | ❌ | ❌ |
| Edit `pipeline_status` | ✅ | ❌ | ❌ |
| Edit `interview_date` / `interview_note` | ✅ | ❌ | ❌ |
| Toggle `paid` | ✅ | ❌ | ❌ |
| Edit **any** field on a paid row | ✅ | ❌ | ❌ |
| Delete applications | ✅ | unpaid Pending/Duplicated | unpaid Pending/Duplicated |
| View own live bid-count report | ✅ | ✅ | ✅ |
| View payment history / process payment | ✅ | ❌ | ❌ |
| View analytics dashboard | ✅ | ❌ | ❌ |

Each bidder may be assigned to one `bidder_manager`, and each workspace/profile may be explicitly allocated
to one `bidder_manager` by an admin. Admins do not assign profiles directly to bidders. A manager can read
profiles allocated to them and choose either themselves or an active bidder on their team as the owner. The manager cannot edit those application tables unless they are also the
workspace owner. A workspace has one owner and one resume profile; changing the owner transfers current access
but does not rewrite historical application/payment attribution.

## 3.2 (B) Workspace scope resolution

```ts
canView(user, workspace): boolean

  if (user.role === 'super_admin') return true;
  if (user.role === 'admin') return workspace.created_by_user_id === user.id;
  if (workspace.owner_user_id === user.id) return true;
  return user.role === 'bidder_manager' && (
    workspace.manager_user_id === user.id || workspace.owner.manager_user_id === user.id
  );

canEdit(user, workspace): boolean

  // Same admin/owner checks, but manager assignment alone never grants edits.
```

Consequences:
- A **bidder cannot see another workspace exists.** `GET /workspaces` returns only owned rows, so
  the workspace switcher is naturally filtered — no client-side hiding.
- Every application endpoint derives `workspaceId` from **the row**, not from the request body, then re-checks
  scope. So you cannot move a row into a workspace you can't write to, and you cannot read row `X` by guessing
  its id.
- Manager assignment is a view-only grant resolved server-side. The dedicated bidder-assignment endpoint is
  the only exception: it verifies both that the profile was allocated to the caller and that the new owner is
  an active bidder allocated to that caller.

## 3.3 (C) Field-level policy — the security core

### Writable field sets

```ts
BIDDER_WRITABLE = { job_title, company_name, url, job_source,
                    application_status, note, date }

ADMIN_ONLY      = { pipeline_status, interview_date, interview_note,
                    paid, workspace_id, number }
```

`filterPatchByRole()` **strips** admin-only keys from a non-admin patch rather than rejecting the whole
request when the value is unchanged, and throws `403` when a non-admin actively tries to change one. Stripping
no-ops keeps the UI simple (it can PATCH a whole row object) while still blocking real escalation.

### Status transition state machine

```
        ┌──────── admin only ─────────┐
        │                             │
        ▼                             │
   ┌─────────┐   any role    ┌─────────┐   any role   ┌──────────┐
   │ Pending │──────────────▶│ Applied │─────────────▶│ Rejected │
   └─────────┘               └─────────┘              └──────────┘
        ▲                         ▲                         │
        │                         └──── admin only ─────────┘
        │                                                   │
        └──────────────── admin only ───────────────────────┘

   ┌────────────┐
   │ Duplicated │  ◀── set ONLY by the system (duplicate detector) or admin
   └────────────┘      exit ONLY by admin  →  any status
```

Implemented as an explicit allow-list, not a deny-list:

```ts
const BIDDER_ALLOWED_TRANSITIONS = new Set([
  'Pending>Applied',
  'Applied>Rejected',
  'Pending>Cancelled',
  'Applied>Cancelled',
]);
```

Everything else — `Rejected→Applied`, `Rejected→Pending`, `*→Duplicated`, `Duplicated→*`, and even
`Pending→Rejected` — requires `admin`. An allow-list is the right shape because the failure mode of forgetting
an entry is "admin has to do it" (annoying, safe), whereas a deny-list fails toward "bidder can inflate their
own payment" (silent, expensive).

> Note: `Pending → Rejected` is admin-only by strict reading of the spec (the only bidder transitions listed are
> `Pending→Applied` and `Applied→Rejected`). Flip `ALLOW_BIDDER_PENDING_TO_REJECTED=true` if you want juniors to
> be able to discard un-applied rows themselves; the constant is isolated in `application.policy.ts`.

### Why `Duplicated` is admin-only

Unpaid `Pending` and `Applied` applications can also be changed to `Cancelled` by bidders and
managers when they did not submit the application. Cancelled records stay in the table and company
duplicate history, are excluded from payment, and require an admin to reopen.

The system marks a new company match `Duplicated` when another row at that normalized company
exists in the same profile within `COMPANY_APPLICATION_COOLDOWN_DAYS` (default 90), regardless of
the existing row's status or note. Single edits, bulk edits, manual creation, generation, and imports
use the same company rule under a workspace transaction lock.

`Duplicated` rows are excluded from the weekly `Applied` count. If a bidder could clear the flag, they could
convert a duplicate paste into billable work — self-service payment inflation. If they could *set* it, they
could bury a competitor's row. So the flag is written by exactly two actors: the duplicate detector (system,
at insert time) and admin (manual correction).

### Paid-row locking

```ts
assertRowNotLocked(row, role) {
  if (row.paid && role !== 'admin') throw Forbidden('Row is paid and locked');
}
```

Checked **before** the patch filter, on single edits, bulk edits, and delete. A paid row is a settled financial
record; it renders gray and read-only in the UI, but the UI is only a courtesy — the 403 is the actual control.

## 3.4 Enforcement points (every write path)

| Path | Endpoint | Guards applied |
|---|---|---|
| Single cell edit | `PATCH /applications/:id` | scope=edit, not-locked, patch filter, transition check |
| Bulk edit | `PATCH /applications/bulk` | same, evaluated **per row**; partial success reported per id |
| Bulk delete | `POST /applications/bulk-delete` | admin only |
| Manual create | `POST /applications` | scope=edit; required title/company/URL/status; status transition policy enforced |
| Excel/CSV import | `POST /import/:workspaceId` | scope=edit; imported `Status` clamped — non-admins cannot import `Duplicated`/paid |
| Pipeline/interview update | `PATCH /applications/:id/pipeline` | admin only; validates pipeline status, interview date, and note |

The import path is the classic hole: a CSV column named `Status` containing `Duplicated` would otherwise let a
bidder bypass the state machine. `import.service.ts` therefore routes every row's status through the *same*
`assertStatusTransition('Pending' → value, role)` call used by inline editing.

## 3.5 Authentication summary

- `POST /auth/login` → `{ email, password }` → bcrypt compare → JWT `{ sub, role, username }`, 7 d expiry.
- `GET /auth/me` → current user (never includes `password_hash`; a global Prisma `omit` + explicit `select`
  makes leaking it require deliberate effort).
- `POST /auth/change-password` → requires current password, any role, self only.
- Admin resets: `POST /users/:id/reset-password` → sets a new password directly, no email involved.
- Inactive users (`is_active=false`) fail login and fail the JWT strategy's `validate()`, so existing tokens die
  immediately on deactivation rather than surviving until expiry.
- Default admin bootstrap runs once at startup, guarded by `count(role='admin') === 0`, so restarts and scale-out
  never create duplicates. Credentials come from env only, are never logged, and never appear in any response.
