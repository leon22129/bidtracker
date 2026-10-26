# BidTracker

Job application, bidder, payment, and recruiting-analytics management for a bid team.

Three roles (**admin**, **bidder manager**, **junior bidder**) work in per-bidder workspaces
("tabs"). Bidders paste job URLs or import spreadsheets; the system normalises each URL, extracts
the company and job title, detects duplicates, and numbers rows per date. Admins manage the
recruiting pipeline, settle weekly bid payments, and read conversion analytics.

Resume Builder follows a draft workflow: scan the JD, check company/URL bans and duplicates, check
eligibility, then generate the resume and expected rate. The URL, original JD, updated JD, resume,
and generated answers are saved in `application_drafts`. The JD input is cleared after generation
and stays empty when a prepared job is restored; the saved JD appears in a separate read-only panel.
Blocked and ineligible jobs do not add table rows.

Saved JDs and `jd.txt` downloads use separated headings, paragraphs, bullet lists, and wrapped text.
Scanning preserves HTML paragraphs and lists; the untouched scanned JD is retained in the draft.
Existing saved JDs receive the same readable formatting when downloaded.

After successfully applying, the bidder confirms submission and chooses **Take screenshot & add
application**. The backend rechecks bans and duplicates and commits the application, its saved
documents/answers, and screenshot in one transaction. Screenshot failures add no row, and retries
reuse the submission receipt. Concurrent submissions to the same company are marked `Duplicated`
and excluded from payment. Preparing a draft never counts as an applied or payable application.
Each profile tab keeps its own prepared draft, JD, resume, answers, and submission state, including
when multiple tabs use the same profile. This state is restored when the panel is reopened. The
screenshot button submits that tab's draft using its original browser page; there is no separate
application dropdown. After a successful save, a toast confirms completion and capture is disabled
for that job. Failed saves remain available for retry; saved screenshots stay with their applications.

To copy job links, check the desired rows and choose **Copy links**, or press **Ctrl+C**
(**Cmd+C** on Mac) while the table is focused. Full URLs are copied one per line in table order.
Shift-click a row checkbox to select a range; the header checkbox selects the rows currently shown.
Copying also works in read-only workspaces, and selected links remain available after scrolling away.

**Stack:** Next.js 14 + TypeScript + Tailwind · NestJS + TypeScript · PostgreSQL + Prisma.
No managed services, no paid dependencies, runs on the smallest VPS you can rent.

---

## Table of contents

1. [Quick start](#quick-start)
2. [Design documents](#design-documents)
3. [API reference](#api-reference)
4. [Backend folder structure](#backend-folder-structure)
5. [Frontend folder structure](#frontend-folder-structure)
6. [Authentication](#authentication)
7. [Authorization](#authorization)
8. [Database &amp; migrations](#database--migrations)
9. [Deployment](#deployment)
10. [Backup &amp; restore](#backup--restore)
11. [Operations reference](#operations-reference)
12. [Import file format](#import-file-format)

---

## Quick start

### Windows quick start

```powershell
Copy-Item .env.example backend/.env
# Start PostgreSQL 16 as a local service, then edit backend/.env.
cd backend
npm install
npx prisma migrate deploy
cd ..
.\start.ps1 --no-cloudflare
```

Open [http://localhost:3000](http://localhost:3000) and sign in with `DEFAULT_ADMIN_EMAIL` /
`DEFAULT_ADMIN_PASSWORD`. Change the password immediately from **Account**.

On Windows, `start.ps1` starts the local services and a temporary Cloudflare Quick Tunnel by
default. To run without Cloudflare, use:

```powershell
.\start.ps1 --no-cloudflare
```

For development, run both the backend and frontend directly from source with automatic reloads and
no build step:

```powershell
# Start PostgreSQL locally and put the DATABASE_URL shown in .env.example into backend/.env first.
.\start.ps1 --dev
```

Development mode is always local-only and does not start a Cloudflare tunnel.
Stopping the script with Ctrl+C or closing its terminal also stops both development servers.
The backend regenerates its Prisma client before compiling so schema updates are available to TypeScript.

Use [http://127.0.0.1:3000](http://127.0.0.1:3000) for BidTracker and
[http://127.0.0.1:3002](http://127.0.0.1:3002) for Resume Builder. `--local` is an alias for
`--no-cloudflare`.

### Local development

On Windows, the `--dev` command above starts both source watchers. To run them separately (or on
another operating system), use two terminals:

```bash
# --- terminal 1: backend on :3001
cd backend
npm install
printf 'DATABASE_URL="postgresql://bidtracker:YOUR_PASSWORD@127.0.0.1:5432/bidtracker?schema=public"\nJWT_SECRET=dev-secret-not-for-production\nDEFAULT_ADMIN_EMAIL=admin@example.com\nDEFAULT_ADMIN_USERNAME=admin\nDEFAULT_ADMIN_PASSWORD=devpassword\n' > .env
npx prisma migrate deploy
npx prisma generate
npm run seed                          # users + workspaces + 2,000 applications
npm run start:dev

# --- terminal 2: frontend on :3000
cd frontend
npm install
npm run dev
```

Seed accounts (bidders share the password `Password123!`): `admin`, `john` (bidder),
`mike` (bidder\_manager, owner of *Mike Applications*), `sarah` (bidder).

To exercise the stated performance target:

```bash
cd backend && npm run seed -- --reset --applications 50000
```

### Verification commands

```bash
cd backend  && npm run typecheck              # tsc --noEmit over src + prisma
cd backend  && npm run build && npm test      # backend unit and service tests
cd frontend && npm run typecheck && npm run build
```

After building the backend, `cd backend && npm run test:company-cooldown` verifies simultaneous
company submissions against PostgreSQL. It creates and removes an isolated schema for its fixtures.

For resume-generation connection errors, run `cd backend && npm run check:ai` on the API server.
It checks the configured OpenAI key and model access without generating text or displaying the key.
Rebuild and restart the API after backend changes so Resume Builder uses the updated code.

The unit tests cover the policy functions in isolation. Two scripts cover what they cannot — that the
guards are actually mounted, the DTOs actually validate, and every deny rule holds over real HTTP.
Both need a **running server** and both **write data**, which is why neither is part of the Jest suite:

```bash
cd backend && npm run smoke                   # 100+ assertions end-to-end; exits non-zero on any failure
cd backend && npm run perf                    # latency benchmark, median of 5 after a warm-up
```

`smoke` provisions the users, owned workspaces, and fixture rows it needs through the admin
API, so it runs against a stack that contains nothing but the bootstrapped admin account, and it is
idempotent across repeated runs. Point it at any deployment:

```bash
SMOKE_BASE=http://127.0.0.1:3000/api \
  SMOKE_ADMIN_EMAIL=admin@example.com \
  SMOKE_ADMIN_PASSWORD='...' node smoke.mjs   # through the frontend proxy
```

### Measured performance

Median of 5 requests after one warm-up, on a database seeded to the stated target — **50,082 rows in
the workspace being queried, 150,148 rows in total**. These historical numbers were measured on the
previous SQLite deployment; rerun `npm run perf` to establish the PostgreSQL baseline for your host:

| Operation                          | Latency |
| ---------------------------------- | ------- |
| First page (100 rows)              | 32 ms   |
| Mid page (offset 25,000)           | 34 ms   |
| Last page (offset 50,000)          | 35 ms   |
| Max page size (500 rows)           | 57 ms   |
| Filter by status                   | 29 ms   |
| Filter by status + source + paid   | 151 ms  |
| Filter by date range               | 27 ms   |
| Free-text search                   | 115 ms  |
| Sort by company name (not indexed) | 88 ms   |
| Workspace summary counts           | 55 ms   |
| Analytics: conversion funnel       | 128 ms  |
| Analytics: full dashboard          | 500 ms  |
| Weekly payment preview             | 9 ms    |
| Weekly payment settlement (write)  | 60 ms   |

Deep paging costs the same as the first page because the offset walks a covering index rather than the
table. The two slowest entries are the ones that cannot use an index: free-text search is a `LIKE`
scan, and sorting by `company_name` has no index to read in order. Both were left as-is deliberately —
see [Indexes](#indexes) for why, and what to add if the workload changes.

---

## Design documents

The reasoning behind the code, written before it:

| Document                                          | Contents                                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| [docs/01-ARCHITECTURE.md](docs/01-ARCHITECTURE.md) | Requirements analysis, system diagram, request lifecycle, technical decisions and tradeoffs, explicitly rejected options |
| [docs/02-DATABASE.md](docs/02-DATABASE.md)         | ER diagram, every table and column, index strategy, and database-enforced invariants                                    |
| [docs/03-PERMISSIONS.md](docs/03-PERMISSIONS.md)   | The three-layer authorization model, role capability matrix, status state machine, enforcement-point audit               |
| [docs/04-ROADMAP.md](docs/04-ROADMAP.md)           | Build phases 0–11, why this order, per-phase verification                                                               |

---

## API reference

All routes are prefixed `/api`. Every route requires
`Authorization: Bearer <jwt>` **except** the two marked *public* — authentication is deny-by-default
via a global guard, so a new controller is protected the moment it is written.

Legend: 🔓 public · 👤 any authenticated user · 🛡 **admin only** (enforced by `RolesGuard`)
· 🔑 workspace access checked per request.

### Auth — `/api/auth`

| Method | Path                      | Access | Description                                                |
| ------ | ------------------------- | ------ | ---------------------------------------------------------- |
| POST   | `/auth/login`           | 🔓     | `{ email, password }` → `{ access_token, user }`      |
| GET    | `/auth/me`              | 👤     | Current user, re-read from the database                    |
| POST   | `/auth/change-password` | 👤     | `{ current_password, new_password }` — own account only |
| GET    | `/health`               | 🔓     | Readiness probe: HTTP 200 when PostgreSQL is up, 503 when down |

### Users — `/api/users` 🛡

| Method | Path                          | Description                                                                                 |
| ------ | ----------------------------- | ------------------------------------------------------------------------------------------- |
| GET    | `/users`                    | Manageable users with owned workspace counts                                                 |
| GET    | `/users/:id`                | One user                                                                                    |
| POST   | `/users`                    | `{ username, email, password, role }`                                                     |
| PATCH  | `/users/:id`                | `{ username?, email?, role?, is_active? }` — refuses to demote/deactivate the last admin |
| POST   | `/users/:id/reset-password` | `{ new_password }` (there is no reset-by-email flow, by design)                           |
| DELETE | `/users/:id`                | Refused while the user owns workspaces or has application/payment history                   |

`password_hash` is never present in any response — every user object is built by an explicit
whitelist projection, not by deleting fields from a Prisma row.

### Workspaces — `/api/workspaces`

| Method | Path                                    | Access | Description                                                                        |
| ------ | --------------------------------------- | ------ | ---------------------------------------------------------------------------------- |
| GET    | `/workspaces`                         | 👤     | Owned workspaces; admins see ones they created, super-admin sees all. `?includeArchived=true` |
| GET    | `/workspaces/:id`                     | 🔑     | One accessible workspace                                                         |
| POST   | `/workspaces`                         | 🛡     | `{ name, owner_user_id }` — owner controls the current profile assignment       |
| PATCH  | `/workspaces/:id`                     | 🛡     | `{ name?, owner_user_id?, is_archived? }`                                        |
| DELETE | `/workspaces/:id`                     | 🛡     | Cascades to its applications; returns the deleted count                            |

Requesting a workspace you can't see returns **404, not 403** — a 403 would confirm the id exists.

Archived profiles reject new applications, imports, and resume/answer generation on the server,
including requests from already-open clients. Existing history remains readable, and admins can
maintain historical records or unarchive the profile to resume applying.

### Applications — `/api/applications`

| Method | Path                           | Access  | Description                                                     |
| ------ | ------------------------------ | ------- | --------------------------------------------------------------- |
| GET    | `/applications/meta`         | 👤      | Enum values + which fields your role may write                  |
| GET    | `/applications`              | 🔑      | Paginated list — see query parameters below                    |
| POST   | `/applications`              | 🔑 edit | Manually create a complete `{ workspace_id, job_title, company_name, url, application_status }` row |
| GET    | `/applications/summary`      | 🔑      | Counts by status / pipeline / source, and paid count            |
| GET    | `/applications/:id`          | 🔑      | One row                                                         |
| PATCH  | `/applications/:id`          | 🔑 edit | Inline cell edit; field-level policy applies                    |
| PATCH  | `/applications/:id/pipeline` | 🛡      | `pipeline_status`, `interview_date`, `interview_note`     |
| PATCH  | `/applications/bulk`         | 🔑 edit | `{ ids, patch }` — per-row policy, per-id failure reasons    |
| POST   | `/applications/bulk-delete`  | 🛡      | `{ ids }`                                                     |
| POST   | `/applications/generate`     | 🔑 edit | Check bans/duplicates and eligibility, generate the resume, and save a prepared draft |
| POST   | `/applications/generated`    | 🔑 edit | Retired: returns 400; submit a prepared draft with a screenshot instead |
| GET/POST/DELETE | `/applications/banned-patterns` | 🛡 | Manage database-backed banned URL substrings |

Additional generated-resume routes:

- `GET /applications/drafts/latest?workspace_id=...` restores the bidder's latest prepared job and answers.
- `POST /applications/drafts/:draftId/submit` requires multipart `screenshot` (PNG) and `submitted=true`;
  atomically adds the application and screenshot after successful submission.

- `GET /applications/:id/resume` returns the durable resume snapshot for frontend PDF download.

**`GET /applications` query parameters**

| Parameter                  | Type                | Notes                                                                                                                                                            |
| -------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspace_id`           | string              | **required**                                                                                                                                               |
| `page`                   | int                 | 1-based, default 1                                                                                                                                               |
| `page_size`              | int                 | default 100,**capped at 500** so one request can't pull the table                                                                                          |
| `search`                 | string              | matches job title, company, URL, note                                                                                                                            |
| `application_status`     | csv                 | `Pending,Applied,Cancelled,Rejected,Banned,Duplicated`                                                                                                                   |
| `pipeline_status`        | csv                 | the 7 pipeline values                                                                                                                                            |
| `job_source`             | csv                 | the 13 sources                                                                                                                                                   |
| `paid`                   | bool                |                                                                                                                                                                  |
| `date_from`, `date_to` | `YYYY-MM-DD`      | inclusive                                                                                                                                                        |
| `sort_by`                | string              | `date`, `number`, `job_title`, `company_name`, `job_source`, `application_status`, `pipeline_status`, `paid`, `interview_date`, `created_at` |
| `sort_dir`               | `asc` \| `desc` | `number` is always appended as a tiebreaker so pagination is stable                                                                                            |

Response: `{ items, total, page, page_size, total_pages }`.

### Import — `/api/import`

| Method | Path                             | Access  | Description                                                                                                             |
| ------ | -------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------- |
| POST   | `/import/:workspaceId/preview` | 🔑 edit | multipart`file` → detected columns + sample rows, no writes                                                          |
| POST   | `/import/:workspaceId`         | 🔑 edit | multipart`file`, `default_date` → `{ total_rows, created, duplicates, skipped[], missing_fields[], detected_columns }` |

Accepts `.xlsx` and `.csv`. Recognised headers (fuzzy-matched): Date, Job Title, Company Name, URL,
Status and Note. A `Status` column in the file is run through the **same** status-transition
policy as a UI edit — otherwise a bidder could set `Duplicated` from a spreadsheet.
Rows with a URL already recorded in the profile or repeated within the file are skipped.
The `duplicates` count includes skipped URL matches and company matches saved as `Duplicated`.

### Payments — `/api/payments`

| Method | Path                | Description                                                                                                      |
| ------ | ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| GET    | `/payments/report`  | Unpaid `Applied` totals for `?start_date&end_date`; bidders see only work they created, including reassigned profiles |
| GET    | `/payments/history` | Immutable payment-processing history; regular admins see their own settlements and super admins see all reports |
| POST   | `/payments/process` | `{ start_date, end_date, bidder_id }` — atomically marks eligible rows paid and records the settled count        |

### Analytics — `/api/analytics` 🛡

All accept `?from&to&workspace_id`.

| Method | Path                                   | Description                                                    |
| ------ | -------------------------------------- | -------------------------------------------------------------- |
| GET    | `/analytics/overview`                | Everything below in one request (what the dashboard calls)     |
| GET    | `/analytics/conversion`              | Totals +`interview_rate`, `offer_rate`, `duplicate_rate` |
| GET    | `/analytics/interviews-by-workspace` |                                                                |
| GET    | `/analytics/interviews-by-source`    | Includes per-source interview rate                             |
| GET    | `/analytics/pipeline`                | Count per pipeline stage                                       |
| GET    | `/analytics/upcoming-interviews`     | Future `interview_date`s, ascending                           |

Rates return `null`, never `NaN` or `0`, when the denominator is zero.

---

## Backend folder structure

```
backend/
├── prisma/
│   ├── schema.prisma                 # PostgreSQL application schema
│   ├── migrations/
│   │   ├── 20260924000000_postgresql_baseline/
│   │   │   └── migration.sql         # complete PostgreSQL baseline
│   │   └── migration_lock.toml
│   ├── sqlite/                       # legacy schema + migrations for one-time data import
│   └── seed.ts                       # dev data + 50k-row load generator
├── src/
│   ├── main.ts                       # /api prefix, ValidationPipe, filters, security headers
│   ├── app.module.ts                 # wires the global JwtAuthGuard + RolesGuard
│   ├── health.controller.ts
│   │
│   ├── common/                       # ← nothing here imports a feature module
│   │   ├── constants.ts              # the enum value lists
│   │   ├── decorators/               # @Public, @Roles, @CurrentUser
│   │   ├── guards/                   # JwtAuthGuard (global), RolesGuard
│   │   ├── filters/                  # Prisma error → HTTP status
│   │   ├── policies/
│   │   │   ├── application.policy.ts       # ★ THE SECURITY CORE — field + transition + paid lock
│   │   │   └── application.policy.spec.ts
│   │   └── utils/
│   │       ├── url.util.ts           # normalise, detect source, extract company/title (+ spec)
│   │       └── date.util.ts          # UTC day buckets, Mon–Sun weeks (+ spec)
│   │
│   ├── prisma/prisma.service.ts      # shared PostgreSQL client lifecycle
│   ├── bootstrap/admin-bootstrap.service.ts   # default admin, only when zero admins exist
│   │
│   ├── auth/                         # login, /me, change-password, JWT strategy
│   ├── users/                        # admin CRUD
│   ├── workspaces/
│   │   ├── workspaces.service.ts
│   │   └── workspace-access.service.ts  # ★ the single answer to "can X touch workspace Y?"
│   ├── applications/
│   │   ├── applications.service.ts   # list/update/bulk/generated — every write goes through the policy
│   │   ├── numbering.service.ts      # per-date numbering, unique index + P2002 retry
│   │   └── duplicate.service.ts      # exact URL, then normalised URL, bounded batches
│   ├── import/                       # ExcelJS + a hand-written RFC-4180 CSV parser
│   ├── payments/
│   │   ├── payments.service.ts       # Mon–Sun weeks, Applied only, credited to the creator
│   │   └── payments.cron.ts          # Monday 00:05 UTC
│   └── analytics/
└── package.json
```

**Layering rule:** Controller → Guards → Service → *Policy* → Prisma. Controllers hold no business
logic, services hold no permission decisions, and the policy layer is pure functions with no
dependencies — which is why it is the only part with exhaustive unit tests.

## Frontend folder structure

```
frontend/
├── next.config.mjs                   # standalone output, /api/* rewrite, CSP
├── tailwind.config.ts                # status palette, 2xs type scale, sticky shadows
└── src/
    ├── app/
    │   ├── layout.tsx                # AuthProvider + ToastProvider
    │   ├── globals.css               # .cell/.btn/.input component classes, status pills
    │   ├── page.tsx                  # → /workspaces or /login
    │   ├── login/page.tsx
    │   └── (app)/                    # route group: everything behind auth
    │       ├── layout.tsx            # header, role-filtered nav, sign-out
    │       ├── account/page.tsx      # change own password
    │       ├── workspaces/
    │       │   ├── page.tsx          # workspace cards + ownership controls
    │       │   └── [id]/
    │       │       ├── page.tsx      # ★ the grid page (owns filters + selection)
    │       │       ├── add/page.tsx  # required-field manual application form
    │       │       └── import/page.tsx
    │       └── admin/
    │           ├── users/page.tsx
    │           ├── payments/page.tsx
    │           └── analytics/page.tsx
    ├── components/
    │   ├── table/
    │   │   ├── applications-table.tsx  # virtualiser, sticky header/columns, resize
    │   │   ├── cell.tsx                # click-to-edit, permission-aware editors
    │   │   ├── columns.ts              # column defs, widths, localStorage persistence
    │   │   ├── toolbar.tsx             # debounced search, filter chips
    │   │   └── bulk-actions.tsx        # floating bar for the current selection
    │   └── ui/                         # status-pill, toast
    └── lib/
        ├── api.ts                    # one fetch wrapper; centralises 401 → /login
        ├── types.ts                  # hand-written mirror of the HTTP contract
        ├── auth-context.tsx
        ├── permissions.ts            # UI mirror of the backend policy (NOT enforcement)
        └── use-applications.ts       # ★ windowed page cache for 50k rows
```

### How the 50,000-row table works

Three cooperating pieces:

1. **Server-side offset pagination.** `page_size` is capped at 500 and the query is served by the
   `(workspace_id, date, number)` index. Offset rather than cursor pagination because a virtual
   scrollbar needs random access — you must be able to drag to row 43,000.
2. **A windowed page cache** ([use-applications.ts](frontend/src/lib/use-applications.ts)):
   `Map<pageIndex, rows>` holding at most 12 pages of 200 (~2,400 rows), evicting whichever pages are
   furthest from the viewport. A generation counter discards responses from a superseded filter state.
3. **Row virtualisation** (`@tanstack/react-virtual`): ~30 rows in the DOM regardless of the total.
   Rows whose page hasn't landed render as same-height skeletons, so the scroll position never jumps.

Loading all 50k rows would be ~30 MB of JSON and several seconds of parse time; plain page-by-page
paging would lose the spreadsheet feel the brief asks for. This is the middle path.

---

## Authentication

Deliberately minimal, exactly as specified: **email + password only**. No email verification, no
confirmation emails, no OAuth, no SSO.

- **Hashing** — bcrypt (`bcryptjs`, cost 10). `hashPassword()` in
  [auth.service.ts](backend/src/auth/auth.service.ts) is the *only* place in the codebase that hashes
  or compares a password. Plain-text passwords are never stored, logged, or returned.
  `bcryptjs` over `bcrypt` because the native module needs node-gyp, which Alpine doesn't have.
- **Login** — a wrong password and a non-existent email return the identical message, and the
  non-existent-email path still runs a dummy bcrypt compare so response timing can't be used to
  enumerate accounts.
- **Token** — a JWT (`{ sub, role }`) carried in `Authorization: Bearer`. The strategy re-reads the
  user from the database on every request, so a deactivation or role change takes effect on the very
  next call rather than at token expiry.
- **Storage** — `localStorage`. The honest tradeoff: an httpOnly cookie resists XSS better, but needs
  CSRF protection, and this app's XSS surface is small and locked down by a strict CSP. The 401
  handler in [api.ts](frontend/src/lib/api.ts) clears the token and redirects centrally, so no page
  handles expiry itself.

### Default admin account

On startup, [admin-bootstrap.service.ts](backend/src/bootstrap/admin-bootstrap.service.ts):

1. counts users with `role = 'admin'`;
2. if the count is **zero**, creates one from `DEFAULT_ADMIN_EMAIL` / `DEFAULT_ADMIN_USERNAME` /
   `DEFAULT_ADMIN_PASSWORD`, hashed before insert;
3. if the count is non-zero, does nothing.

Consequences, each of which is a requirement:

- **No duplicate default admins** — the guard is a count, not an upsert on email.
- **A changed password is never reverted.** Once an admin exists, the env vars are ignored entirely.
  This is why the check is "any admin exists" rather than "this email exists".
- **Credentials are never exposed through the API.** The startup log records the email and username
  so an operator can confirm which account was created; the password is never logged.
- If a non-admin user already holds that email, they are promoted rather than the boot crash-looping
  on a unique-constraint violation.

After the first login, change the password under **Account**, then clear
`DEFAULT_ADMIN_PASSWORD` from `.env` if you like — it is only read when no admin exists.

---

## Authorization

Three independent layers. A request must pass all three; see
[docs/03-PERMISSIONS.md](docs/03-PERMISSIONS.md) for the full matrix.

| Layer              | Question                                                          | Where                                |
| ------------------ | ----------------------------------------------------------------- | ------------------------------------ |
| **A. Role**  | Is this endpoint open to your role at all?                        | `RolesGuard` + `@Roles('admin')` |
| **B. Scope** | May you see/edit*this workspace*?                               | `WorkspaceAccessService.resolve()` |
| **C. Field** | May you change*this field*, to *this value*, on *this row*? | `application.policy.ts`            |

**Scope** is ownership-based. Super-admin can access every workspace, an admin can access workspaces
they created, and a bidder or bidder manager can access the workspace assigned to them. There is no
sharing or view-only access mode.

**Field-level rules, all enforced server-side:**

- Admin-only fields: `pipeline_status`, `interview_date`, `interview_note`, `paid`, `number`,
  `workspace_id`.
- Status transitions for non-admins are an **allow-list**: `Pending → Applied` and
  `Applied → Rejected`. Nothing else. In particular nobody but an admin may set or clear
  `Duplicated`, because duplicates are excluded from payment.
- A row with `paid = true` is locked: every non-admin write to it is rejected.

The rules live in **one module of pure functions** that every write path calls — inline edit, bulk
edit, **and Excel import**. Bulk endpoints and the import file's `Status` column are the
two realistic side doors around a permission system like this, so they were closed deliberately
rather than incidentally.

`frontend/src/lib/permissions.ts` mirrors these rules to grey out cells and hide menus. It is
convenience only: bypassing it with devtools or curl produces a 403, not an escalation.

### Payment integrity

The credit for an applied row goes to its immutable `JobApplication.created_by_user_id`: the bidder
who actually created/performed the application. Reassigning a workspace therefore
does not move earlier unpaid work to the new owner. Archived workspaces remain eligible until their
`Applied` rows are processed. Creators with application history are deactivated rather than deleted.

At Monday 00:05 UTC, the scheduler atomically settles the previous Monday–Sunday period for every
eligible bidder. A PostgreSQL advisory transaction lock ensures only one backend replica performs the
run. Automated reports have `processed_by = null`; set `DISABLE_CRON=true` to disable this job.

---

## Database & migrations

PostgreSQL 16 stores its cluster in the host PostgreSQL data directory. Core tables include `users`, `workspaces`,
`resume_profiles`, `job_applications`, and `payment_reports`.
Full column-by-column reference in [docs/02-DATABASE.md](docs/02-DATABASE.md).

### Migrations

```bash
# Production — applies committed migrations only, never generates or resets.
npx prisma migrate deploy

# Development — after editing schema.prisma
npx prisma migrate dev --name describe_your_change
```

Run `migrate deploy` before starting a new backend release. It is idempotent, so repeated runs are
safe. The initial migration is committed as SQL.

### Moving an existing SQLite deployment

The previous SQLite schema and migrations remain under `backend/prisma/sqlite` only for the one-time
data transfer. Follow [docs/05-POSTGRESQL-MIGRATION.md](docs/05-POSTGRESQL-MIGRATION.md); the importer
copies in 500-row pages, preserves IDs and timestamps, and refuses a non-empty destination.

### Indexes

Every composite index leads with `workspace_id`, because no query in the application ever crosses
workspaces without also filtering by one. Covered: `(workspace_id, date, number)` UNIQUE (the
numbering guarantee *and* the default sort), plus `workspace_id` paired with `application_status`,
`pipeline_status`, `job_source`, `paid`, `job_fingerprint`, and `created_at`; standalone indexes on
`date` support cross-tab reporting. A composite `(workspace_id, normalized_url)` index supports
workspace-local duplicate detection, and a partial unique index on the same columns is the final
concurrency-safe guarantee for `Pending`/`Applied` rows within each workspace.

Free-text search uses PostgreSQL `pg_trgm` GIN indexes on URL, company, title, and note, allowing the
existing case-insensitive `%contains%` query to avoid a full table scan. The 115 ms figure in the
[performance table](#measured-performance) predates those indexes.

One occasional query remains deliberately unindexed:

- **Sorting by `company_name`** (~88 ms in the historical benchmark) has no index to read in order, so PostgreSQL sorts
  the filtered set. Adding `(workspace_id, company_name)` would fix it, but every extra index is paid
  for on every insert — and imports write in batches of 500. The default sort is `(date, number)`, which
  *is* indexed; sorting by company is an occasional click.

---

## Deployment

Target: a small VPS (1 vCPU / 1 GB is enough), a home server, or a local workstation. No managed
database, external cache, or object storage is required.

### 1. Host prerequisites

Install Node.js 22.22.3 or newer, PostgreSQL 16, `pg_dump`, `pg_restore`, and a process manager such as systemd or
PM2. Ensure PostgreSQL is running and create the configured database and user.

### 2. Deploy

```bash
git clone <your-repo> /srv/bidtracker && cd /srv/bidtracker
cp .env.example backend/.env

# Configure the backend environment and mandatory values:
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -base64 48)|" backend/.env
$EDITOR backend/.env               # set DATABASE_URL and DEFAULT_ADMIN_PASSWORD

cd backend
npm ci
npx prisma generate
npx prisma migrate deploy
npm run build
cd ../frontend
npm ci
npm run build
```

Start `backend/dist/main.js` on port 3001 and `next start` on port 3000 with your process manager.
Set `BACKEND_URL=http://127.0.0.1:3001` for the frontend service. The browser talks to the frontend,
which proxies `/api/*` to the backend. The proxy is a Node route handler at
[frontend/src/app/api/[...path]/route.ts](frontend/src/app/api/%5B...path%5D/route.ts) rather than a
`next.config` rewrite so the backend address can be changed at server startup.

Then verify the deployment answers correctly:

```bash
curl -s localhost:3000/api/health                       # {"ok":true,"db":"up",...}
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/api/users   # 401 — deny-by-default is on

cd backend && SMOKE_BASE=http://127.0.0.1:3000/api \
  SMOKE_ADMIN_EMAIL="$DEFAULT_ADMIN_EMAIL" \
  SMOKE_ADMIN_PASSWORD="$DEFAULT_ADMIN_PASSWORD" node smoke.mjs
```

`smoke.mjs` needs no seed data and exits non-zero if any of its ~100 assertions fail. It **writes test
rows**, so run it before the deployment carries real data or remove its fixture rows afterward.

### 3. Expose it — pick one

**A. Cloudflare Tunnel (free, no open ports, no public IP needed)**

1. [https://one.dash.cloudflare.com](https://one.dash.cloudflare.com) → Networks → Tunnels → **Create a tunnel** (Cloudflared).
2. Add a public hostname, e.g. `bids.example.com`, with service `http://127.0.0.1:3000`.
3. Install `cloudflared` on the host and run the tunnel as a system service.

Cloudflare terminates TLS and the tunnel dials outbound, so the host needs no inbound rule at all.
Worth adding: **Cloudflare Access** in front of the hostname, which puts a second identity check
ahead of the login page.

**B. Caddy on the host (automatic Let's Encrypt)**

```caddyfile
bids.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

**C. LAN only** — bind the frontend server to the host LAN address and reach it at
`http://<host-ip>:3000`.

### 4. Updating

```bash
cd /srv/bidtracker
./scripts/backup.sh                 # always, before a schema change
git pull
cd backend && npm ci && npx prisma generate && npx prisma migrate deploy && npm run build
cd ../frontend && npm ci && npm run build
# Restart both services with your process manager.
```

### 5. Sizing and limits

| Concern           | Reality                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Disk              | Budget at least 2 GB for PostgreSQL data, indexes, and backups.                                                                              |
| Memory            | Backend ~150 MB idle, ~400 MB peak during a large import (ExcelJS holds the workbook).                                                      |
| Concurrent users  | PostgreSQL supports concurrent readers and writers; application-level load is the practical limit.                                            |
| Scaling           | Backend replicas may share PostgreSQL, though scheduled jobs should still have one designated runner.                                      |

---

## Backup & restore

[scripts/backup.sh](scripts/backup.sh) uses PostgreSQL's custom-format `pg_dump`, then parses the
complete archive with `pg_restore --list` before accepting it.

```bash
./scripts/backup.sh                       # back up the running PostgreSQL service
BACKUP_DIR=/mnt/backups ./scripts/backup.sh
```

What the script does, in order:

1. `pg_dump --format custom` creates a compressed, consistent archive without stopping the app.
2. `pg_restore --list` validates the archive. A failed check renames it `.CORRUPT` and exits non-zero.
3. Retention keeps 14 daily copies and promotes Sunday's copy to an 8-week set.

**Schedule it:**

```cron
15 3 * * * cd /srv/bidtracker && ./scripts/backup.sh 2>&1 | logger -t bidtracker-backup
```

**Get a copy off the machine** — a backup on the same disk as the database protects you from
mistakes, not from hardware:

```cron
30 3 * * * rclone sync /srv/bidtracker/backups remote:bidtracker-backups
```

**Restore:**

```bash
# Stop the backend service first.
dropdb -U bidtracker --if-exists bidtracker
createdb -U bidtracker bidtracker
pg_restore -U bidtracker -d bidtracker --no-owner --no-privileges \
  backups/daily/bidtracker-20260825-031500.dump
# Start the backend service again and inspect backend/logs.
```

**Test the restore.** Once a quarter, restore the newest backup into a throwaway database and log in.
An untested restore procedure is a plan, not a backup.

---

## Operations reference

### Environment variables

Full annotated list in [.env.example](.env.example). The ones worth knowing:

| Variable                                             | Default                 | Effect                                                                                 |
| ---------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------- |
| `JWT_SECRET`                                       | — (**required**) | Signs tokens. Changing it signs everyone out.                                          |
| `DEFAULT_ADMIN_*`                                  | — (**required**) | First-boot admin; ignored once any admin exists.                                       |
| `JWT_EXPIRES_IN`                                   | `7d`                  | Session length.                                                                        |
| `COMPANY_APPLICATION_COOLDOWN_DAYS`               | `90`                  | Per-profile cooldown before another application to the same normalized company.        |
| `MAX_UPLOAD_MB`                                    | `25`                  | Import file ceiling.                                                                   |
| `MAX_XLSX_EXPANDED_MB`                            | `100`                 | Maximum streamed XLSX expansion before parsing.                                        |
| `MAX_XLSX_ZIP_ENTRIES`                            | `2000`                | Maximum number of files inside an XLSX archive.                                        |
| `DISABLE_CRON`                                     | `false`               | Set`true` on a staging copy so it can't produce authoritative-looking reports.       |
| `OPENAI_CONVERSATION_RETENTION_DAYS`              | `90`                  | Deletes inactive provider items, conversations, and local mappings daily.               |
| `DISABLE_CONVERSATION_CLEANUP`                    | `false`               | Disables provider conversation retention cleanup when explicitly required.             |
| `ALLOW_BIDDER_PENDING_TO_REJECTED`                 | `false`               | Adds one extra transition beyond the spec's two.                                       |
| `OPENAI_API_KEY`                                    | —                    | Server-only key used by `POST /api/applications/generate`; never send it to the browser. |
| `OPENAI_MODEL`                                      | `gpt-6.1-sol`        | OpenAI Responses API model used for eligibility, resume, and answer generation.        |

### Logging and AI cost variables

`LOG_LEVEL` defaults to `info` and accepts `fatal`, `error`, `warn`, `info`, `debug`, or
`verbose`. Every API response includes `X-Request-Id`; use it to correlate the JSON payloads in
`http_request_*` and `openai_request_*` log events.

AI content is excluded by default because prompts and responses contain resumes and job
descriptions. Set `AI_LOG_CONTENT=true` to include previews, bounded by
`AI_LOG_CONTENT_MAX_CHARS` (default 2,000; hard maximum 10,000). Token usage, latency, model, and
provider request IDs are logged regardless. Set `OPENAI_INPUT_COST_PER_1M_TOKENS`,
`OPENAI_CACHED_INPUT_COST_PER_1M_TOKENS`, and `OPENAI_OUTPUT_COST_PER_1M_TOKENS` to the current
rates for `OPENAI_MODEL` to add separate input/output and total estimated USD costs.
The example configuration uses GPT-6.1 Sol Standard rates per million tokens: $2 input,
$0.10 cached input, and $10 output for prompts up to 272K input tokens. Confirm current
[OpenAI pricing](https://developers.openai.com/api/docs/models/gpt-6.1-sol) when changing models.
For each successfully generated application, the launcher also prints a compact comparison of the
resume-only usage and the combined eligibility-plus-resume usage. Later application-answer calls
are logged separately and are not included in that initial generation total.

The launcher prints a compact AI usage/cost comparison after each generated application. Detailed
service output is redirected under `%TEMP%\bidtracker`, and structured events are stored as
newline-delimited JSON in `backend/logs/YYYY-MM-DD.log`. Filesystem writes are queued asynchronously,
and files older than `LOG_RETENTION_DAYS` (default 30) are removed during startup and daily rotation.

### Resume generation

`GET /api/workspaces/profiles/assigned` returns the one-to-one profiles belonging to workspaces the authenticated user can access.
`POST /api/applications/generate` accepts `{ workspace_id, url, job_description, profile_id? }`.
It extracts company/title metadata, checks company and URL bans and duplicates before eligibility,
then generates the resume and expected rate and saves a separate prepared draft. It returns
`{ success, eligible, draft, resume, job_description, conversation_id, full_name }`. No application
row is added yet. Original and enriched JDs, URL, resume snapshot, template, optional cover letter,
and local conversation ID remain in the draft while `/api/resume/answers` saves generated answers.
After a successful application, `POST /api/applications/drafts/:draftId/submit` commits a required
PNG screenshot and all draft documents/answers to the application table together. Documents remain
available after provider conversation retention. `/api/resume/generate` uses the same draft workflow;
the old `/api/applications/generated` save route returns 400 to prevent premature table entries.
Admins manage company names and URL deny patterns from **Banned URLs** in the dashboard.
Workspace profile details are edited through `PATCH /api/workspaces/:id`.

### Common tasks

```bash
tail -f backend/logs/$(date -u +%F).log
cd backend && npx prisma studio --port 5555   # inspect data on a trusted host only

# Process a bidder's payment period by hand
curl -X POST localhost:3000/api/payments/process \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d '{"start_date":"2026-08-24","end_date":"2026-08-30","bidder_id":"USER_ID"}'
```

### Troubleshooting

| Symptom                                    | Cause and fix                                                                                                                                                                                        |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JWT_SECRET must be set` on boot         | `backend/.env` missing or unset. Copy `.env.example` there and fill it in. |
| Login fails right after a fresh deploy     | Check the backend log for "Default admin created". If the database already had an admin, use the real password or reset it from another admin account. |
| PostgreSQL connection error on boot      | Confirm the PostgreSQL service is running and that `DATABASE_URL` contains the correct host, user, password, and database. |
| Import reports many skipped rows           | Open the skip list on the results panel — it gives a reason per row. Usually a missing/unparseable URL column.                                                                                      |
| Company/title columns arrive blank         | The import result lists every affected spreadsheet row. Fill those values in on the table after import.                                                                                              |
| Weekly report shows an amber "Live" figure | Rows changed after settlement. Expected when an admin edits history; regenerate the week if the new figure is the correct one.                                                                       |
| Table scrolls but rows stay blank          | Backend unreachable — check the backend process and `/api/health`. |

## Import file format

Ready-to-use templates: **[docs/import-template.xlsx](docs/import-template.xlsx)** ·
[docs/import-template.csv](docs/import-template.csv). Regenerate with `cd backend && npm run template`.

One header row, then one row per application. **`URL` is the only required column** — everything else
can be blank or absent entirely.

| Column | Required | Accepts | Blank means |
| --- | --- | --- | --- |
| `URL` | **yes** | any `http(s)` URL. Hyperlink cells, `HYPERLINK()` formulas and rich text all work — the link target is read, not the display text | row is skipped |
| `Date` | no | `YYYY-MM-DD`, `M/D/YYYY`, an ISO datetime, or a real Excel date cell | the date picked on the upload page (defaults to today) |
| `Job Title` | no | free text | imported blank and reported for review |
| `Company Name` | no | free text | imported blank and reported for review |
| `Status` | no | `Pending`, `Applied`, `Rejected` | `Pending` |
| `Note` | no | free text | empty |

URLs matching the banned list receive `Banned`, which has its own filter and analytics count.
`Rejected` counts exclude these applications. The status migration also reclassifies older
`Rejected` rows whose note is exactly `this job is in banned list`.

**Headers are fuzzy-matched.** Comparison is case-, space- and punctuation-insensitive, over a list of
synonyms — so `JOB URL`, `Job_Url` and `link` all resolve to `URL`. Column **order is irrelevant** and
unrecognised columns are ignored:

| Field | Accepted headers |
| --- | --- |
| `url` | url, job url, link, job link, application url, job posting |
| `date` | date, applied date, application date, day, submitted date |
| `job_title` | job title, title, position, role, job name |
| `company_name` | company name, company, employer, organization, org |
| `application_status` | status, application status, app status |
| `note` | note, notes, comment, comments, remark, remarks |

The canonical list lives in `COLUMN_ALIASES` at
[backend/src/import/import.service.ts:19](backend/src/import/import.service.ts#L19).

### Rules worth knowing before you upload

- **Only the first worksheet is read.** Extra sheets are ignored — which is where the template keeps its
  instructions.
- **Every non-empty row is a record.** Don't put notes or a totals row below your data; they come back
  as `row 14: Missing URL`.
- **Never write `Duplicated` in the Status column.** Repeated normalized URLs are skipped.
  A bidder or manager who supplies this status gets the row imported as
  `Pending` plus an explanatory line in the skip list; only an admin can set it, because it determines
  who gets paid.
- **A company has a 90-day cooldown per profile.** A second row for the same normalized company is
  saved as `Duplicated` even when the title or job-board URL differs.
  The configured `COMPANY_APPLICATION_COOLDOWN_DAYS` applies to all recorded company rows,
  regardless of status or note, including `Cancelled`. The window uses the table's UTC application
  date and includes the whole boundary date. Exact URL retries do not create additional rows.
  Checks and writes share a database transaction and workspace lock, including concurrent requests.
- **Use `Cancelled` when you did not submit the application.** Bidders and managers can change unpaid
  `Pending` or `Applied` rows to `Cancelled`, individually or in bulk. Cancelled rows remain in the
  table and company history but are excluded from payment. Only an admin can reopen them.
- **`Rejected` is a one-way door.** The transition allow-list is `Pending → Applied` and
  `Applied → Rejected`, and it applies to imports too. Importing `Rejected` directly is fine; getting
  back out of it needs an admin.
- **Limits:** 20,000 rows and 25 MB per file (`MAX_UPLOAD_MB`). Split anything larger.
- **Numbering is assigned on insert**, restarting at 1 for each distinct date. Any `Number` column in
  your file is ignored.
- **Semicolon-delimited CSV works** — the parser sniffs `;` vs `,` from the header line, so European
  Excel exports need no conversion. UTF-8 BOM is stripped. Quoted fields with embedded commas,
  newlines and doubled quotes parse per RFC 4180.

### Preview first

The upload page runs `POST /import/:workspaceId/preview` before anything is written and shows which
columns it matched (green) and what's missing (red), plus the first five rows as parsed. If `URL` comes
back unmatched the import is refused outright with the headers it did find. Use it — it costs nothing
and catches a mis-named column before it becomes 500 skipped rows.

---                                                                                                                          |

# QUICK START COMMAND FOR LOCAL ENVIRONMENT

```PowerShell
Start-Process powershell -ArgumentList '-NoExit','-Command','Set-Location .\backend; npm run start:dev'; Start-Process powershell -ArgumentList '-NoExit','-Command','Set-Location .\frontend; npm run dev'
```

```command
cloudflared tunnel --url http://localhost:3000
```


# Cloudflared download URL
```
https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.msi
```
