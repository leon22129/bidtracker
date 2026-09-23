# 4. Development Roadmap

Each phase is independently shippable and leaves the app in a working state. Phases 0–7 are **implemented in
this repository**; 8+ are the honest "what's next" list.

| Phase | Deliverable | Status |
|---|---|---|
| **0. Foundation** | Monorepo, Docker, Prisma schema + init migration, SQLite WAL config, health endpoint | ✅ built |
| **1. Auth & users** | bcrypt + JWT, admin bootstrap from env, `RolesGuard`, user CRUD, password reset/change | ✅ built |
| **2. Workspaces** | Workspace CRUD, `WorkspacePermission` grants, `WorkspaceAccessService` scope resolution | ✅ built |
| **3. Applications core** | Paginated/filtered/sorted list API, per-date numbering with unique-index retry, inline PATCH, policy layer | ✅ built |
| **4. Ingestion** | Required-field manual creation, URL normaliser, source detector, duplicate detection, Excel/CSV import with chunked `createMany` | ✅ built |
| **5. Table UX** | Virtualised 50k-row grid, sticky header, column resize, inline edit, sort, filter, search, bulk actions, paid shading | ✅ built |
| **6. Pipeline & interviews** | Admin-only pipeline status, interview date/note, upcoming-interview view | ✅ built |
| **7. Money & analytics** | Date-range `Applied` aggregation by visible workspace, atomic `PaymentReport` settlement, payment dashboard, conversion + source + workspace analytics | ✅ built |
| **8. Realtime collaboration** | WebSocket gateway broadcasting row deltas; presence indicators; per-cell conflict badges | next |
| **9. Audit log** | `ApplicationAudit(row_id, actor, field, old, new, at)` — matters once payment disputes happen | next |
| **10. Hardening** | Rate limiting on `/auth/login`, refresh tokens, CSP tightening, Playwright E2E on the policy matrix | next |
| **11. Scale-out** | Swap Prisma provider to Postgres (schema is portable); move large imports to a worker queue | if needed |

## Build order rationale

The order is driven by **risk, not by layer**. The two things that can invalidate the whole design are
(a) the permission model and (b) table performance at 50k rows. So Phase 3 delivers the policy layer and the
paginated query *before* any UI polish, and Phase 5 proves virtual scrolling against real volume (see
`backend/prisma/seed.ts --applications 50000`). Ingestion sits at Phase 4 because duplicate detection is what
makes the payment number trustworthy, and payment (Phase 7) depends on it.

Analytics is deliberately last: it is pure read-side aggregation over a schema that is already correct, so it
carries almost no design risk and would have been wasted effort earlier.

## Verification per phase

| Phase | How you check it actually works |
|---|---|
| 0 | `docker compose up` → `curl :3001/api/health` returns `{ok:true}`; `data/app.db` exists on host |
| 1 | Log in with `DEFAULT_ADMIN_*`; restart container → still exactly one admin |
| 2 | Create `John Applications`, grant Mike `edit`, log in as a junior → sees only their own tab |
| 3 | `npm run seed -- --applications 50000` → table page loads, scroll to row 49,000 |
| 4 | Paste the same URL twice → second row is `Duplicated` (red) and excluded from payment |
| 5 | Bidder tries to set `Duplicated` in the UI → option disabled **and** direct `curl` PATCH returns 403 |
| 6 | Bidder PATCHes `pipeline_status` via curl → 403; admin succeeds |
| 7 | `POST /payments/process` for Aug 24–30 → count matches eligible unpaid `Applied` rows only and the same rows become paid |
