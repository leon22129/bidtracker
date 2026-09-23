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
│JobApplication │ │  │   PaymentReport    │    │
│ ...15 cols... │    │ bidder_id          │    │
│ paid_by ──────┼────┼────────────────────┼────┘
└───────────────┘    │ start/end dates    │
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
| `owner_user_id` | TEXT FK→User | current workspace/profile assignment; not historical payment attribution |
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
| `job_title` | TEXT NULL | required for generated/manual creation; nullable for imports and banned rows |
| `company_name` | TEXT NULL | required for generated/manual creation; nullable for imports and banned rows |
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
| `created_by_user_id` | TEXT FK→User RESTRICT | immutable bidder/payment subject; backfilled for legacy rows |
| `created_at` / `updated_at` | DATETIME | |

### BannedUrlPattern
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `pattern` | TEXT UNIQUE | lowercase substring matched against the URL |
| `created_by_user_id` | TEXT NULL FK→User | audit field; retained as NULL if the admin is removed |
| `created_at` / `updated_at` | DATETIME | |

### PaymentReport
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `bidder_id` | TEXT FK→User RESTRICT | bidder whose eligible applications were settled |
| `start_date` / `end_date` | DATETIME | inclusive payment period |
| `applied_count` | INT | number of unpaid `Applied` rows atomically marked paid |
| `processed_by` | TEXT NULL FK→User | admin who processed the period |
| `processed_at` | DATETIME | immutable audit timestamp |

## 2.3 Index strategy

Every index below exists to serve a *named* query, not speculatively.

| Index | Serves |
|---|---|
| `JobApplication(workspace_id, date, number)` UNIQUE | the number-reset invariant **and** the default table sort — one structure, two jobs |
| `JobApplication(workspace_id, application_status)` | status filter chips + the weekly `Applied` count |
| `JobApplication(workspace_id, pipeline_status)` | pipeline board + interview analytics |
| `JobApplication(workspace_id, job_source)` | source filter |
| `JobApplication(workspace_id, paid)` | payment sweep / locked-row shading |
| `JobApplication(application_status, paid, date, created_by_user_id, workspace_id)` | creator-attributed live payment report and atomic settlement filter |
| `JobApplication(workspace_id, date DESC, number ASC)` | default paginated workspace ordering without a temporary sort |
| `JobApplication(normalized_url)` | **global duplicate probe** — the hottest write-path lookup |
| `JobApplication(workspace_id, job_fingerprint, created_at)` | recent cross-site company/title duplicate probe |
| `JobApplication(date)` | cross-workspace weekly aggregation |
| `JobApplication(interview_date)` | upcoming-interview list |
| `WorkspacePermission(user_id)` | "which tabs can I see?" on every request |
| `Workspace(owner_user_id)` | current ownership/access lookup |

Note the deliberate ordering: **`workspace_id` leads every composite index**, because *every* table query is
scoped to one workspace. A filter on status alone never happens in this product.

## 2.4 Invariants the database itself guarantees

1. `(workspace_id, date, number)` is unique → numbering can never silently collide, even under a race.
   The service retries on `P2002` rather than trusting an in-memory counter.
2. `(workspace_id, user_id)` unique on permissions → no ambiguous "view *and* edit" grant.
3. FK cascades from `Workspace` → applications and permissions, so deleting a tab cannot orphan rows.
4. `JobApplication.created_by_user_id` is required and uses `ON DELETE RESTRICT`, so reassignment or
   deletion cannot silently move or erase payment attribution. Deactivate creators instead.

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
