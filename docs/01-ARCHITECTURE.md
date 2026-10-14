# 1. Requirements Analysis & Architecture Design

## 1.1 What this system actually is

Stripped of the feature list, this is **an internal operations tool for a bid farm**:

- A small, fixed set of trusted users (you + a handful of bidders). No public signup, no tenant isolation
  problem, no email deliverability problem. That is why the auth spec is deliberately minimal — and it's the
  *correct* call for this scale.
- The core artifact is a **very wide, very long spreadsheet** (50k+ rows/workspace) that several people edit
  concurrently. The hard engineering problem is not "CRUD", it is **table UX at 50k rows** plus
  **field-level authorization** (who may change *which column* to *which value*).
- The money is derived data: unpaid `Applied` rows per period per **application creator**. That means correctness of
  `application_status` and immutable `JobApplication.created_by_user_id` is financially load-bearing, which is exactly why
  `Duplicated` and `paid` are admin-only. The permission model isn't bureaucracy — it's fraud control.

### Requirement → design consequence table

| Requirement | Consequence |
|---|---|
| 50,000+ rows/workspace, Sheets-like feel | Server-side keyset/offset pagination + windowed row cache + `@tanstack/react-virtual`. Never ship 50k rows to the browser. |
| Sorting/filtering/search on those rows | All filtering happens in SQL, backed by composite indexes. Client filters are a UI shell over query params. |
| Multiple users editing one table | Optimistic cell edits with per-cell rollback + `updated_at` returned on every write. |
| Number resets per date | Uniqueness is `(workspace_id, date, number)` enforced by a DB unique index, assigned inside a transaction. |
| Duplicate detection across job boards | Exact URLs use workspace-scoped `(workspace_id, normalized_url)`; normalized company names enforce a workspace/profile-local 90-day cooldown even when titles differ. |
| Bidders must not set `Duplicated` / edit paid rows | Enforced in a **backend field-level policy layer**, not in the UI. UI only mirrors it. |
| Payment survives workspace reassignment | Aggregation uses immutable `JobApplication.created_by_user_id`; workspace ownership controls current assignment, not historical credit. |
| Large Excel imports | Streamed parse (ExcelJS/CSV) → validate → chunked `createMany` in a transaction. Enrichment is bounded-concurrency and optional. |
| Free VPS / Cloudflare Tunnel / no managed DB | Self-hosted PostgreSQL and Node.js services on one host. |

## 1.2 Architecture

```
                          ┌───────────────────────────────┐
   Browser  ──── HTTPS ───▶│  Cloudflare Tunnel / Caddy    │
                          └───────────────┬───────────────┘
                                          │ (same origin, path routed)
                        ┌─────────────────┴─────────────────┐
                        │                                   │
              ┌─────────▼──────────┐            ┌───────────▼────────────┐
              │  frontend (3000)   │            │   backend (3001)       │
              │  Next.js 14 App    │  fetch     │   NestJS 10 REST       │
              │  React 18 + TS     │───────────▶│   JWT bearer auth      │
              │  Tailwind 3        │  /api/*    │   class-validator DTOs │
              │  react-virtual     │            │   Policy layer         │
              └────────────────────┘            └───────────┬────────────┘
                                                            │ Prisma 5
                                                ┌───────────▼────────────┐
                                                │  PostgreSQL 16         │
                                                │  host-managed data     │
                                                │  directory             │
                                                └────────────────────────┘
```

### Layering inside the backend

```
Controller      HTTP shape only. DTO validation. No business rules.
   │
Guard chain     JwtAuthGuard → RolesGuard  (coarse: is this user even allowed here?)
   │
Service         Business rules + transactions.
   │
Policy          Pure functions: canEditRow(), assertStatusTransition(), filterPatchByRole().
   │             ← the security-critical core, unit-testable, zero I/O
Prisma          Data access.
```

The **Policy layer is the heart of the design**. Every mutation path (single edit, bulk edit, import,
paid toggle) funnels through the same pure functions, so a bidder cannot reach a forbidden state through a
side door such as "bulk update" or "CSV import". This is the single most important structural decision in
the project.

### Request lifecycle for a cell edit

```
PATCH /api/applications/:id  { application_status: "Applied" }
 1. JwtAuthGuard      → attaches { userId, role }
 2. Service loads the row and verifies workspace ownership/creator scope
 3. WorkspaceAccessService rejects users outside that ownership scope
 4. Policy.assertRowNotLocked(row, role)            → paid rows: admin only
 5. Policy.filterPatchByRole(patch, role)           → strips pipeline_status, paid, duplicate writes
 6. Policy.assertStatusTransition(from, to, role)   → Pending→Applied ok, Rejected→Applied admin-only
 7. Prisma update, return fresh row
```

## 1.3 Technical decisions and tradeoffs

| Decision | Why | Tradeoff / mitigation |
|---|---|---|
| **Self-hosted PostgreSQL** | Supports concurrent writers, future backend replicas, and continued growth without a managed-database bill. | Database operation and backups are host responsibilities; health probes and verified `pg_dump` archives keep that explicit. |
| **String columns instead of Prisma enums** | Keeps API constants and DTO validation as the application source of truth and makes the SQLite cutover lossless. | Values are validated by `@IsIn(...)` at the API boundary and mirrored by PostgreSQL `CHECK` constraints for direct SQL and scripts. |
| **`bcryptjs` over `bcrypt`** | Pure JS avoids node-gyp and native build dependencies across development and server hosts. | ~2× slower hashing. Irrelevant for a login-a-day tool; cost factor 10 keeps it ~50ms. |
| **JWT bearer in `localStorage`** | "Keep authentication simple." No CSRF surface, works identically for the Next.js client and any future script/CLI. | XSS could exfiltrate the token. Mitigated by: React's default escaping, no `dangerouslySetInnerHTML` anywhere, 7-day expiry, and a strict CSP header. If you later want defence-in-depth, switch to an httpOnly cookie + `SameSite=Lax` — one file changes (`lib/api.ts`) plus a cookie extractor in the JWT strategy. |
| **Offset pagination, not cursor** | The table needs *random access* — a virtual scrollbar can jump to row 43,000. Cursors can't do that. | `OFFSET 43000` degrades on huge tables. Mitigated by covering indexes and a hard cap of 500 rows/page; measured well under 30 ms at 50k rows. Sorted-by-`(date, number)` scans use the index directly. |
| **Windowed page cache + virtualizer (not "load all")** | 50k rows × ~15 fields ≈ 30 MB JSON — would freeze the tab. | Slightly more complex client state (`Map<pageIndex, Row[]>`). Encapsulated entirely in `useApplications()`. |
| **Active URL uniqueness is global and database-enforced** | Two bidders pasting the same job is the exact abuse the duplicate flag exists to catch. A PostgreSQL partial unique index permits only one `Pending`/`Applied` row per normalized URL, including across backend replicas. | `Rejected` and `Duplicated` rows remain as history. Cross-workspace conflicts disclose no tenant or application metadata. |
| **Payment processing is atomic and materialised (`PaymentReport`)** | Payment history must be stable — a later status edit must not silently rewrite a settled period. | `POST /payments/process` updates only eligible unpaid rows and records the returned count in the same transaction; bidders may read only their own creator-attributed live count, including work in reassigned profiles. |
| **Monorepo, host-managed services, no gateway** | The tunnel or reverse proxy terminates TLS and the frontend proxies `/api`; PostgreSQL binds only to a trusted interface. | Database and process supervision are part of host operations, but backend replicas can share PostgreSQL when needed. |
| **REST over GraphQL/tRPC** | The client is one table plus a few dashboards; REST + typed hand-written client is less machinery, and lets you curl/import from scripts. | No end-to-end type inference. Mitigated by a shared `types.ts` mirroring the Prisma model. |

### Explicitly rejected

- **Realtime CRDT / WebSocket collaborative editing** — genuinely nice for a Sheets clone, but it's a
  multi-week subsystem and the spec's concurrency need is "a few bidders editing different rows." Last-write-wins
  per cell + `updated_at` is adequate. Noted in the roadmap as Phase 8.
- **Redis / BullMQ for import jobs** — adds a service to a free VPS. Imports are chunked and streamed; a 20k-row
  file finishes in seconds inside the request. A synchronous-with-progress endpoint is the right size.
- **Soft deletes everywhere** — only `User` deactivation matters (payment history must survive), so `User.is_active`
  exists and applications are hard-deletable by admin only.
