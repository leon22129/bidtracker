# BidTracker

Job application, bidder, payment, and recruiting-analytics management for a bid team.

Three roles (**admin**, **bidder manager**, **junior bidder**) work in per-bidder workspaces
("tabs"). Bidders paste job URLs or import spreadsheets; the system normalises each URL, extracts
the company and job title, detects duplicates, and numbers rows per date. Admins manage the
recruiting pipeline, settle weekly bid payments, and read conversion analytics.

**Stack:** Next.js 14 + TypeScript + Tailwind · NestJS 10 + TypeScript · SQLite + Prisma · Docker.
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

### With Docker (how it's meant to run)

```bash
cp .env.example .env
# Edit .env: set JWT_SECRET (openssl rand -base64 48) and DEFAULT_ADMIN_PASSWORD.

docker compose up -d --build
docker compose logs -f backend      # watch for "Default admin created"
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
.\start.ps1 --dev
```

Development mode is always local-only and does not start a Cloudflare tunnel.
Stopping the script with Ctrl+C or closing its terminal also stops both development servers.

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
printf 'DATABASE_URL="file:./dev.db"\nJWT_SECRET=dev-secret-not-for-production\nDEFAULT_ADMIN_EMAIL=admin@example.com\nDEFAULT_ADMIN_USERNAME=admin\nDEFAULT_ADMIN_PASSWORD=devpassword\n' > .env
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
`mike` (bidder\_manager, granted **edit** on *John Applications*), `sarah` (bidder).

To exercise the stated performance target:

```bash
cd backend && npm run seed -- --reset --applications 50000
```

### Verification commands

```bash
cd backend  && npm run typecheck              # tsc --noEmit over src + prisma
cd backend  && npm run build && npm test      # 43 unit tests over the policy + URL + date logic
cd frontend && npm run typecheck && npm run build
```

The unit tests cover the policy functions in isolation. Two scripts cover what they cannot — that the
guards are actually mounted, the DTOs actually validate, and every deny rule holds over real HTTP.
Both need a **running server** and both **write data**, which is why neither is part of the Jest suite:

```bash
cd backend && npm run smoke                   # 100+ assertions end-to-end; exits non-zero on any failure
cd backend && npm run perf                    # latency benchmark, median of 5 after a warm-up
```

`smoke` provisions the users, workspaces, permission grant and fixture rows it needs through the admin
API, so it runs against a stack that contains nothing but the bootstrapped admin account, and it is
idempotent across repeated runs. Point it at any deployment:

```bash
SMOKE_BASE=http://127.0.0.1:3000/api \
  SMOKE_ADMIN_EMAIL=admin@example.com \
  SMOKE_ADMIN_PASSWORD='...' node smoke.mjs   # a docker compose stack, through the frontend proxy
```

### Measured performance

Median of 5 requests after one warm-up, on a database seeded to the stated target — **50,082 rows in
the workspace being queried, 150,148 rows in total** — running SQLite on a laptop SSD:

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
| [docs/02-DATABASE.md](docs/02-DATABASE.md)         | ER diagram, every table and column, index strategy, database-enforced invariants, SQLite pragmas                         |
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
| GET    | `/health`               | 🔓     | Liveness + database probe for Docker and the tunnel        |

### Users — `/api/users` 🛡

| Method | Path                          | Description                                                                                 |
| ------ | ----------------------------- | ------------------------------------------------------------------------------------------- |
| GET    | `/users`                    | All users with owned/granted workspace counts                                               |
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
| GET    | `/workspaces`                         | 👤     | Only workspaces you own or were granted (admins see all).`?includeArchived=true` |
| GET    | `/workspaces/:id`                     | 🔑     | One workspace incl.`my_access`                                                   |
| POST   | `/workspaces`                         | 🛡     | `{ name, owner_user_id }` — owner controls the current profile assignment       |
| PATCH  | `/workspaces/:id`                     | 🛡     | `{ name?, owner_user_id?, is_archived? }`                                        |
| DELETE | `/workspaces/:id`                     | 🛡     | Cascades to its applications; returns the deleted count                            |
| POST   | `/workspaces/:id/permissions`         | 🛡     | `{ user_id, permission_type: 'view' \| 'edit' }`                                  |
| DELETE | `/workspaces/:id/permissions/:userId` | 🛡     | Revoke                                                                             |

Requesting a workspace you can't see returns **404, not 403** — a 403 would confirm the id exists.

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
| POST   | `/applications/generate`     | 🔑 edit | Generate an eligible resume candidate without writing an application |
| POST   | `/applications/generated`    | 🔑 edit | Idempotently save `{ workspace_id, url, job_title, company_name }` by normalized URL |
| GET/POST/DELETE | `/applications/banned-patterns` | 🛡 | Manage database-backed banned URL substrings |

**`GET /applications` query parameters**

| Parameter                  | Type                | Notes                                                                                                                                                            |
| -------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspace_id`           | string              | **required**                                                                                                                                               |
| `page`                   | int                 | 1-based, default 1                                                                                                                                               |
| `page_size`              | int                 | default 100,**capped at 500** so one request can't pull the table                                                                                          |
| `search`                 | string              | matches job title, company, URL, note                                                                                                                            |
| `application_status`     | csv                 | `Pending,Applied,Rejected,Duplicated`                                                                                                                          |
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
| GET    | `/analytics/upcoming-interviews`     | Future`interview_date`s, ascending                           |

Rates return `null`, never `NaN` or `0`, when the denominator is zero.

---

## Backend folder structure

```
backend/
├── prisma/
│   ├── schema.prisma                 # 5 models; String "enums" (SQLite has none)
│   ├── migrations/
│   │   ├── 20260101000000_init/
│   │   │   └── migration.sql         # handcrafted so `migrate deploy` works in the container
│   │   └── migration_lock.toml
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
│   ├── prisma/prisma.service.ts      # connection + WAL/foreign_keys/busy_timeout pragmas
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
│   │   └── duplicate.service.ts      # exact URL, then normalised URL, chunked for SQLite
│   ├── import/                       # ExcelJS + a hand-written RFC-4180 CSV parser
│   ├── payments/
│   │   ├── payments.service.ts       # Mon–Sun weeks, Applied only, credited to the owner
│   │   └── payments.cron.ts          # Monday 00:05 UTC
│   └── analytics/
├── Dockerfile
└── docker-entrypoint.sh              # migrate deploy, then drop to the `node` user
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
    │       │   ├── page.tsx          # workspace cards + PermissionsModal
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

**Scope** resolves to `edit` for admins and for the workspace owner, otherwise to the granted
`WorkspacePermission` (`view` / `edit`), otherwise `none`.

**Field-level rules, all enforced server-side:**

- Admin-only fields: `pipeline_status`, `interview_date`, `interview_note`, `paid`, `paid_by`,
  `paid_at`, `number`, `workspace_id`.
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
who actually created/performed the application. Reassigning a workspace or resume profile therefore
does not move earlier unpaid work to the new owner. Archived workspaces remain eligible until their
`Applied` rows are processed. Creators with application history are deactivated rather than deleted.

---

## Database & migrations

SQLite at `/data/app.db` on a Docker volume. Core tables include `users`, `workspaces`,
`resume_profiles`, `workspace_permissions`, `job_applications`, and `payment_reports`.
Full column-by-column reference in [docs/02-DATABASE.md](docs/02-DATABASE.md).

### Migrations

```bash
# Production / container — applies committed migrations only, never generates or resets.
npx prisma migrate deploy

# Development — after editing schema.prisma
npx prisma migrate dev --name describe_your_change
```

The container entrypoint runs `migrate deploy` on every boot. It is idempotent, so restarts are safe.
The initial migration is committed as SQL, which means the image needs no dev tooling to bring up a
fresh database.

### Pragmas

Applied on connect in [prisma.service.ts](backend/src/prisma/prisma.service.ts):

| Pragma           | Value      | Why                                                                                      |
| ---------------- | ---------- | ---------------------------------------------------------------------------------------- |
| `journal_mode` | `WAL`    | Readers don't block the writer — essential when a 50k-row scroll runs beside an import  |
| `busy_timeout` | `5000`   | Wait for a lock instead of failing instantly under concurrent writes                     |
| `synchronous`  | `NORMAL` | WAL makes this durable enough;`FULL` costs an fsync per commit                         |
| `foreign_keys` | `ON`     | **SQLite defaults this OFF.** Without it, cascades and restrictions are decorative |
| `cache_size`   | `-64000` | 64 MB page cache — keeps the hot indexes resident                                       |
| `temp_store`   | `MEMORY` | Sorting a large filtered result doesn't hit disk                                         |

### Indexes

Every composite index leads with `workspace_id`, because no query in the application ever crosses
workspaces without also filtering by one. Covered: `(workspace_id, date, number)` UNIQUE (the
numbering guarantee *and* the default sort), plus `workspace_id` paired with `application_status`,
`pipeline_status`, `job_source`, `paid`, `job_fingerprint`, and `created_at`; standalone indexes on
`normalized_url` and `date` support global URL duplicate detection and cross-tab reporting.

Two things are deliberately *not* indexed, which is why they are the slowest rows in the
[performance table](#measured-performance):

- **Free-text search** (~115 ms at 50k rows) is `LIKE '%term%'` across url, company and title. A B-tree
  cannot serve a leading wildcard, so this is a scan by construction. The fix would be an FTS5 virtual
  table plus triggers to keep it in sync — real cost in migration complexity and write latency, for a
  feature used to find one known row, not to browse. Revisit if search becomes a primary workflow.
- **Sorting by `company_name`** (~88 ms) has no index to read in order, so SQLite materialises and sorts
  the filtered set. Adding `(workspace_id, company_name)` would fix it, but every extra index is paid
  for on every insert — and imports write in batches of 500. The default sort is `(date, number)`, which
  *is* indexed; sorting by company is an occasional click.

---

## Deployment

Target: a small VPS (1 vCPU / 1 GB is enough), a home server, or anything that runs Docker. No
managed database, no external cache, no object storage.

### 1. Host prerequisites

```bash
# Docker Engine + compose plugin
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"   # then log out and back in
```

### 2. Deploy

```bash
git clone <your-repo> /srv/bidtracker && cd /srv/bidtracker
cp .env.example .env

# Two values are mandatory:
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -base64 48)|" .env
$EDITOR .env                       # set DEFAULT_ADMIN_* 

docker compose up -d --build
docker compose ps                  # both services should reach (healthy)
```

The frontend binds to `127.0.0.1:3000` and the backend publishes **no** port at all. The browser only
ever talks to the frontend, which proxies `/api/*` to `http://backend:3001` over the internal Docker
network. One origin, no CORS, and an API that isn't reachable from the internet even if the firewall
is wrong. The proxy is a Node route handler at
[frontend/src/app/api/[...path]/route.ts](frontend/src/app/api/%5B...path%5D/route.ts) rather than a
`next.config` rewrite, because rewrites are baked into the build manifest and would freeze the backend
address at image-build time — the file says so at length.

Then verify the deployment answers correctly, not just that the containers are up:

```bash
curl -s localhost:3000/api/health                       # {"ok":true,"db":"up",...}
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/api/users   # 401 — deny-by-default is on

cd backend && SMOKE_BASE=http://127.0.0.1:3000/api \
  SMOKE_ADMIN_EMAIL="$DEFAULT_ADMIN_EMAIL" \
  SMOKE_ADMIN_PASSWORD="$DEFAULT_ADMIN_PASSWORD" node smoke.mjs
```

`smoke.mjs` needs no seed data and exits non-zero if any of its ~100 assertions fail. It **writes test
rows**, so run it before the deployment carries real data — or accept the fixture users and rows it
leaves behind (`docker compose down -v` clears them, along with everything else).

### 3. Expose it — pick one

**A. Cloudflare Tunnel (free, no open ports, no public IP needed)**

1. [https://one.dash.cloudflare.com](https://one.dash.cloudflare.com) → Networks → Tunnels → **Create a tunnel** (Cloudflared).
2. Add a public hostname, e.g. `bids.example.com`, service `http://frontend:3000`.
3. Copy the token into `.env` as `CLOUDFLARE_TUNNEL_TOKEN`.
4. `docker compose --profile tunnel up -d`

Cloudflare terminates TLS and the tunnel dials outbound, so the host needs no inbound rule at all.
Worth adding: **Cloudflare Access** in front of the hostname, which puts a second identity check
ahead of the login page.

**B. Caddy on the host (automatic Let's Encrypt)**

```caddyfile
bids.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

**C. LAN only** — change the frontend port mapping to `3000:3000` and reach it at
`http://<host-ip>:3000`.

### 4. Updating

```bash
cd /srv/bidtracker
./scripts/backup.sh                 # always, before a schema change
git pull
docker compose up -d --build        # entrypoint applies new migrations
docker compose logs -f --tail=50
```

### 5. Sizing and limits

| Concern           | Reality                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Disk              | ~250 MB per 500k applications, plus WAL. Budget 2 GB.                                                                                       |
| Memory            | Backend ~150 MB idle, ~400 MB peak during a large import (ExcelJS holds the workbook).                                                      |
| Concurrent users  | Comfortable to a few dozen. SQLite serialises writers; readers are unaffected.                                                              |
| Scaling           | **Vertically.** Do not run `--scale backend=2`: it would be correct but would burn time retrying `SQLITE_BUSY`.                   |
| Outgrowing SQLite | Every "enum" is already a`String` and no raw SQL is dialect-specific — switching `provider` to `postgresql` needs no column changes. |

---

## Backup & restore

**The rule that matters: never `cp app.db`.** In WAL mode, committed transactions may live in
`app.db-wal` and not yet in `app.db`. Copying the main file alone yields a torn, stale snapshot;
copying all three during a write yields a corrupt one.

[scripts/backup.sh](scripts/backup.sh) uses `VACUUM INTO`, which takes a read lock, writes a
fully-checkpointed and defragmented copy to a new file, and never blocks writers. The result is one
self-contained, immediately-usable database file.

```bash
./scripts/backup.sh                       # back up the running container's database
BACKUP_DIR=/mnt/backups ./scripts/backup.sh
./scripts/backup.sh /path/to/app.db       # direct-file mode (needs sqlite3 on the host)
```

What the script does, in order:

1. `VACUUM INTO` a timestamped file (inside the container, via Prisma — the image has no `sqlite3`).
2. `PRAGMA integrity_check` and a row count. **A backup you haven't verified is a rumour.** A failed
   check renames the file `.CORRUPT` and exits non-zero so cron alerts you.
3. `gzip -9` (these files compress to roughly a quarter of their size).
4. Retention: 14 daily copies, and Sunday's copy promoted to a weekly set kept for 8 weeks.

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
docker compose stop backend
gunzip -c backups/daily/app-20260825-031500.db.gz > /tmp/app.db
docker run --rm -v bidtracker-data:/data -v /tmp:/in alpine \
  sh -c 'rm -f /data/app.db-wal /data/app.db-shm && cp /in/app.db /data/app.db'
docker compose start backend
docker compose logs backend | tail -20
```

Deleting the stale `-wal`/`-shm` files is not optional: left beside a restored database, SQLite will
try to replay a write-ahead log that belongs to a different file.

**Test the restore.** Once a quarter, restore the newest backup into a throwaway volume and log in.
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
| `DUPLICATE_SCOPE`                                  | `global`              | `global` = a URL seen in any workspace is a duplicate; `workspace` = per-tab only. |
| `JOB_FINGERPRINT_WINDOW_DAYS`                     | `90`                  | Window for workspace-local company/title cross-site duplicate warnings.                |
| `MAX_UPLOAD_MB`                                    | `25`                  | Import file ceiling.                                                                   |
| `DISABLE_CRON`                                     | `false`               | Set`true` on a staging copy so it can't produce authoritative-looking reports.       |
| `ALLOW_BIDDER_PENDING_TO_REJECTED`                 | `false`               | Adds one extra transition beyond the spec's two.                                       |
| `OPENAI_API_KEY`                                    | —                    | Server-only key used by `POST /api/applications/generate`; never send it to the browser. |
| `OPENAI_MODEL`                                      | `gpt-5.6-sol`        | OpenAI Responses API model used for eligibility, resume, and answer generation.        |

### Resume generation

`GET /api/workspaces/profiles/assigned` returns only profiles assigned to the authenticated user.
`POST /api/applications/generate` accepts `{ workspace_id, url, job_description, profile_id?, questions? }`,
checks the supplied job description, and generates the resume and optional application answers through OpenAI. It returns
an application candidate without writing it, so a lost extension response cannot leave an inaccessible
duplicate behind. The extension explicitly saves that candidate with `POST /api/applications/generated`
after receiving the resume. Both `job_title` and `company_name` are required by the extension client,
the request DTO, and the save service. `/api/resume/generate` remains available as a compatibility alias for older
extension builds. Admins manage database-backed URL deny patterns from **Banned URLs** in the dashboard.
Workspace profile details are edited through `PATCH /api/workspaces/:id`.

### Common tasks

```bash
docker compose logs -f backend            # tail logs
docker compose restart backend            # restart just the API
docker compose exec backend npx prisma studio --port 5555   # inspect data (admin-only, port-forward it)

# Process a bidder's payment period by hand
curl -X POST localhost:3000/api/payments/process \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d '{"start_date":"2026-08-24","end_date":"2026-08-30","bidder_id":"USER_ID"}'
```

### Troubleshooting

| Symptom                                    | Cause and fix                                                                                                                                                                                        |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JWT_SECRET must be set` on boot         | `.env` missing or unset. `cp .env.example .env` and fill it in.                                                                                                                                  |
| Login fails right after a fresh deploy     | Look for "Default admin created" in`docker compose logs backend`. If the database already had an admin, the env vars were ignored — use the real password or reset it from another admin account. |
| `SQLITE_BUSY` in the logs                | Concurrent writers exceeding`busy_timeout`. Check for a second backend replica; there should be exactly one.                                                                                       |
| Import reports many skipped rows           | Open the skip list on the results panel — it gives a reason per row. Usually a missing/unparseable URL column.                                                                                      |
| Company/title columns arrive blank         | The import result lists every affected spreadsheet row. Fill those values in on the table after import.                                                                                              |
| Weekly report shows an amber "Live" figure | Rows changed after settlement. Expected when an admin edits history; regenerate the week if the new figure is the correct one.                                                                       |
| Table scrolls but rows stay blank          | Backend unreachable — check`docker compose ps` and `/api/health`.     

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
- **Never write `Duplicated` in the Status column.** The system decides that by comparing normalised
  URLs, and it overrides whatever the file says. A bidder or manager who tries gets the row imported as
  `Pending` plus an explanatory line in the skip list; only an admin can set it, because it determines
  who gets paid.
- **Duplicate company names are fine.** A company becomes a possible cross-site duplicate only when
  its normalized job title also matches a recent row in the same workspace. The user can confirm that
  it is a different opening.
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
