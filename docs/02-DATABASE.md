# 2. Database Schema Design

## 2.1 Entity relationships

```text
User ──1:N──> Workspace (current owner)
User ──1:N──> JobApplication (immutable created_by_user_id/payment subject)
User ──1:N──> PaymentReport (bidder_id)
User ──1:N──> PaymentReport (optional processed_by; NULL for automatic settlement)
Workspace ──1:N──> JobApplication
Workspace ──1:1──> ResumeProfile
```

Workspace ownership controls current access. Payment attribution instead uses the immutable application
creator, so reassignment cannot move earlier work to another bidder.

## 2.2 Table definitions

### User
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | cuid |
| `username` | TEXT UNIQUE | admin-changeable |
| `email` | TEXT UNIQUE | login identity, stored lowercase |
| `password_hash` | TEXT | bcrypt, cost 10. Never selected into any API response. |
| `role` | TEXT | `super_admin` \| `admin` \| `bidder_manager` \| `bidder` |
| `manager_user_id` | TEXT FK nullable | For bidder rows, the assigned `bidder_manager`; deleting the manager clears the assignment |
| `is_active` | BOOL | deactivation instead of delete when the user has payment history |
| `created_at` / `updated_at` | DATETIME | |

### Workspace
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `name` | TEXT UNIQUE | e.g. `John Applications` |
| `owner_user_id` | TEXT FK→User | current workspace/profile assignment; not historical payment attribution |
| `is_archived` | BOOL | hide from pickers without losing history |

### ResumeProfile
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | stable profile identifier used by the resume client |
| `workspace_id` | TEXT UNIQUE FK→Workspace ON DELETE CASCADE | exactly one owning workspace; profiles cannot be shared |
| `name` and resume fields | TEXT/BOOL | identity, resume content, template, and download settings |
| `us_work_status` | TEXT | optional application-autofill status: `US Citizen`, `Green Card`, or `Other` |

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
| `normalized_url` | TEXT | canonical form — duplicate key within a workspace |
| `job_fingerprint` | TEXT NULL | legacy 128-bit company/title hash retained for compatibility |
| `job_source` | TEXT | detected platform, default `Other` |
| `application_status` | TEXT | `Pending`\|`Applied`\|`Rejected`\|`Banned`\|`Duplicated` |
| `pipeline_status` | TEXT | `Not Started` … `Rejected` — admin only |
| `note` | TEXT NULL | |
| `interview_date` | DATETIME NULL | admin only |
| `interview_note` | TEXT NULL | admin only |
| `paid` | BOOL | admin only; locks the row |
| `conversation_id` | TEXT NULL FK to ResumeConversation SET NULL | temporary follow-up context; cleared when retention deletes the conversation |
| `job_description` | TEXT NULL | durable job-description download for generated applications |
| `generated_resume_json` | TEXT NULL | durable, reviewed resume snapshot used for later PDF downloads |
| `resume_template` | TEXT NULL | template captured with the snapshot |
| `resume_generated_at` | DATETIME NULL | presence/timestamp exposed by list responses without returning the large snapshot |
| `cover_letter_text` | TEXT NULL | durable generated/edited cover-letter snapshot |
| `cover_letter_template` | TEXT NULL | cover-letter template and lightweight list marker |
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
| `processed_by` | TEXT NULL FK→User | admin who processed the period; NULL for the weekly scheduler |
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
| `JobApplication(workspace_id, normalized_url)` | workspace-local duplicate probe; a partial UNIQUE index additionally permits only one `Pending`/`Applied` row per URL in each workspace |
| Trigram GIN on `JobApplication(job_title/company_name/url/note)` | case-insensitive leading-wildcard free-text search |
| `JobApplication(workspace_id, job_fingerprint, created_at)` | legacy company/title lookup index; retained for compatibility |
| `JobApplication(date)` | cross-workspace weekly aggregation |
| `JobApplication(interview_date)` | upcoming-interview list |
| `Workspace(owner_user_id)` | current ownership/access lookup |
| `Workspace(created_by_user_id)` | workspaces visible to their creating admin |

Role, application-status, pipeline-status, and job-source strings also have PostgreSQL
`CHECK` constraints. DTO validation gives clients useful errors; the constraints protect direct SQL,
migration scripts, and future code paths.

Note the deliberate ordering: **`workspace_id` leads every composite index**, because *every* table query is
scoped to one workspace. A filter on status alone never happens in this product.

## 2.4 Invariants the database itself guarantees

1. `(workspace_id, date, number)` is unique → numbering can never silently collide, even under a race.
   The service retries on `P2002` rather than trusting an in-memory counter.
2. FK cascades from `Workspace` → applications and its resume profile, so deleting a tab cannot orphan rows.
3. `JobApplication.created_by_user_id` is required and uses `ON DELETE RESTRICT`, so reassignment or
   deletion cannot silently move or erase payment attribution. Deactivate creators instead.
4. `ResumeProfile.workspace_id` is unique and cascading, and deferred constraint triggers require a
   profile at commit → every workspace has exactly one profile, removed with that workspace.

## 2.5 PostgreSQL runtime

Prisma connects through `DATABASE_URL`; PostgreSQL enforces all declared foreign keys without
connection-level pragmas. Operators run committed migrations before starting a new backend release
and configure their service manager to start the backend only after PostgreSQL is ready.

The previous SQLite schema and migration history live under `backend/prisma/sqlite` only for the
one-time importer documented in `docs/05-POSTGRESQL-MIGRATION.md`.
