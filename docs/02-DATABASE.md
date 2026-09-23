# 2. Database Schema Design

## 2.1 Entity relationships

```
        ┌──────────────────────────────────────────────┐
        │                    User                      │
        │  id · username · email · password_hash       │
        │  role · is_active · created_at · updated_at  │
        └───┬──────────────┬───────────────────┬───────┘
            │ owns         │ granted           │ paid_by
            │ 1:N          │ 1:N               │ 1:N
   ┌────────▼─────────┐  ┌─▼─────────────────┐ │
   │    Workspace     │  │WorkspacePermission│ │
   │ id · name        │◀─┤ workspace_id      │ │
   │ owner_user_id    │  │ user_id           │ │
   │ is_archived      │  │ permission_type   │ │
   └───┬──────────┬───┘  └───────────────────┘ │
       │ 1:N      │ 1:N                        │
┌──────▼────────┐ │  ┌────────────────────┐    │
│JobApplication │ │  │  WeeklyBidReport   │    │
│ ...15 cols... │◀┘  │ workspace_id       │    │
│ paid_by ──────┼────┼────────────────────┼────┘
└───────────────┘    │ week_start/end     │
                     │ applied_count      │
                     └────────────────────┘
```

`User → Workspace` is 1:N on ownership (**one workspace = one paid bidder**), and N:M on *access* through
`WorkspacePermission`. That split is what makes "Mike edits John's tab but John gets paid" expressible.

## 2.2 Table definitions

### User
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | cuid |
| `username` | TEXT UNIQUE | admin-changeable |
| `email` | TEXT UNIQUE | login identity, stored lowercase |
| `password_hash` | TEXT | bcrypt, cost 10. Never selected into any API response. |
| `role` | TEXT | `admin` \| `bidder_manager` \| `bidder` |
| `is_active` | BOOL | deactivation instead of delete when the user has payment history |
| `created_at` / `updated_at` | DATETIME | |

### Workspace
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `name` | TEXT UNIQUE | e.g. `John Applications` |
| `owner_user_id` | TEXT FK→User | **the payment subject** |
| `is_archived` | BOOL | hide from pickers without losing history |

### WorkspacePermission
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `workspace_id` | TEXT FK→Workspace ON DELETE CASCADE | |
| `user_id` | TEXT FK→User ON DELETE CASCADE | |
| `permission_type` | TEXT | `view` \| `edit` |
| unique | `(workspace_id, user_id)` | one grant per pair; re-granting upserts the level |

### JobApplication
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `workspace_id` | TEXT FK→Workspace CASCADE | |
| `date` | DATETIME | **normalised to UTC midnight** — the day bucket |
| `number` | INT | per-`(workspace, date)` sequence starting at 1 |
| `job_title` | TEXT NULL | required for generated candidates; nullable for banned/manual rows |
| `company_name` | TEXT NULL | required for generated candidates; nullable for banned/manual rows |
| `url` | TEXT | as pasted |
| `normalized_url` | TEXT | canonical form — the duplicate key |
| `job_fingerprint` | TEXT NULL | 128-bit company/title hash for recent cross-site duplicate warnings |
| `job_source` | TEXT | detected platform, default `Other` |
| `application_status` | TEXT | `Pending`\|`Applied`\|`Rejected`\|`Duplicated` |
| `pipeline_status` | TEXT | `Not Started` … `Rejected` — admin only |
| `note` | TEXT NULL | |
| `interview_date` | DATETIME NULL | admin only |
| `interview_note` | TEXT NULL | admin only |
| `paid` | BOOL | admin only; locks the row |
| `paid_by` | TEXT NULL FK→User | |
| `paid_at` | DATETIME NULL | |
| `resume_link` | TEXT NULL | |
| `created_by_user_id` | TEXT NULL FK→User | **audit only — explicitly not a payment input** |
| `created_at` / `updated_at` | DATETIME | |

### BannedUrlPattern
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `pattern` | TEXT UNIQUE | lowercase substring matched against the URL |
| `created_by_user_id` | TEXT NULL FK→User | audit field; retained as NULL if the admin is removed |
| `created_at` / `updated_at` | DATETIME | |

### WeeklyBidReport
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `workspace_id` | TEXT FK→Workspace CASCADE | |
| `week_start_date` / `week_end_date` | DATETIME | Monday 00:00 UTC / Sunday 00:00 UTC |
| `applied_count` | INT | snapshot of `application_status='Applied'` in range |
| unique | `(workspace_id, week_start_date)` | makes generation idempotent (upsert) |

## 2.3 Index strategy

Every index below exists to serve a *named* query, not speculatively.

| Index | Serves |
|---|---|
| `JobApplication(workspace_id, date, number)` UNIQUE | the number-reset invariant **and** the default table sort — one structure, two jobs |
| `JobApplication(workspace_id, application_status)` | status filter chips + the weekly `Applied` count |
| `JobApplication(workspace_id, pipeline_status)` | pipeline board + interview analytics |
| `JobApplication(workspace_id, job_source)` | source filter |
| `JobApplication(workspace_id, paid)` | payment sweep / locked-row shading |
| `JobApplication(normalized_url)` | **global duplicate probe** — the hottest write-path lookup |
| `JobApplication(workspace_id, job_fingerprint, created_at)` | recent cross-site company/title duplicate probe |
| `JobApplication(date)` | cross-workspace weekly aggregation |
| `JobApplication(interview_date)` | upcoming-interview list |
| `WorkspacePermission(user_id)` | "which tabs can I see?" on every request |
| `Workspace(owner_user_id)` | payment grouping |

Note the deliberate ordering: **`workspace_id` leads every composite index**, because *every* table query is
scoped to one workspace. A filter on status alone never happens in this product.

## 2.4 Invariants the database itself guarantees

1. `(workspace_id, date, number)` is unique → numbering can never silently collide, even under a race.
   The service retries on `P2002` rather than trusting an in-memory counter.
2. `(workspace_id, user_id)` unique on permissions → no ambiguous "view *and* edit" grant.
3. `(workspace_id, week_start_date)` unique on reports → regeneration is upsert, never duplicate payroll rows.
4. FK cascades from `Workspace` → applications/permissions/reports, so deleting a tab can't orphan rows.
5. `User` deletion is **blocked** by `Workspace.owner_user_id` FK if they own a tab — payment attribution
   cannot be destroyed by accident. Deactivate instead.

## 2.5 SQLite runtime configuration

Applied on every connection in `PrismaService.onModuleInit()`:

```sql
PRAGMA journal_mode = WAL;      -- concurrent readers during writes
PRAGMA busy_timeout = 5000;     -- wait instead of throwing SQLITE_BUSY
PRAGMA synchronous = NORMAL;    -- safe with WAL, ~3× faster writes
PRAGMA foreign_keys = ON;       -- SQLite defaults to OFF (!)
PRAGMA cache_size = -64000;     -- 64 MB page cache
```

`foreign_keys = ON` is not optional — without it every cascade and every FK guarantee above is decorative.
