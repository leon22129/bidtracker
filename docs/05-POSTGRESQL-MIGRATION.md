# SQLite to PostgreSQL cutover

The application now runs on PostgreSQL 16. The legacy SQLite schema is retained only so existing
installations can copy their data once. The importer preserves primary keys and timestamps, copies
large tables in 500-row pages, and refuses to write when any destination table already contains data.
All destination writes run in one PostgreSQL transaction, so a failure rolls the entire import back.
Legacy profiles are attached to their workspace; a profile referenced by multiple legacy workspaces is
cloned so the PostgreSQL one-profile-per-workspace invariant is preserved without losing settings.

## 1. Back up and stop the old application

Create a verified SQLite backup using the old release's backup procedure, then stop every old backend
process. Do not copy a live WAL-mode database file. Stop the old application cleanly and copy its
SQLite database to a private location on the host.

## 2. Configure and start PostgreSQL

Copy `.env.example` to `backend/.env` and set `DATABASE_URL`, `JWT_SECRET`, and
`DEFAULT_ADMIN_PASSWORD`. Use a long URL-safe PostgreSQL password in the connection URL.

```bash
# Start the host PostgreSQL service first.
cd backend
npm install
export DATABASE_URL='postgresql://bidtracker:YOUR_PASSWORD@127.0.0.1:5432/bidtracker?schema=public'
npx prisma migrate deploy
```

The destination must be fresh. If it already contains application data, stop and restore into a new
database rather than attempting a merge.

## 3. Copy the data

Use an absolute SQLite file URL. Keep both credentials out of shell history where possible.

```bash
cd backend
export SQLITE_DATABASE_URL='file:/absolute/path/to/app.db'
export DATABASE_URL='postgresql://bidtracker:YOUR_PASSWORD@127.0.0.1:5432/bidtracker?schema=public'
npm run migrate:sqlite-to-postgres
```

PowerShell equivalent:

```powershell
cd backend
$env:SQLITE_DATABASE_URL = 'file:D:/absolute/path/to/app.db'
$env:DATABASE_URL = 'postgresql://bidtracker:YOUR_PASSWORD@127.0.0.1:5432/bidtracker?schema=public'
npm run migrate:sqlite-to-postgres
```

The command prints the attempted row count for every table. If any step fails, PostgreSQL rolls back
the complete destination import; fix the cause and rerun against the still-empty destination. Set
`MIGRATION_TRANSACTION_TIMEOUT_MINUTES` only when a very large offline import needs more than the
default 60-minute transaction timeout.

## 4. Start and verify

```bash
cd backend
npm ci
npx prisma generate
npm run build
npm run start:prod
# In another terminal:
cd frontend && npm ci && npm run build && npm start
curl -s http://127.0.0.1:3000/api/health
```

Log in and verify user, workspace, application, payment, and resume-profile counts before removing
the SQLite copy. Retain the SQLite backup through at least one successful PostgreSQL backup cycle.

## Rollback

Stop the new services and deploy the previous application release against the untouched SQLite backup.
Changes made after the PostgreSQL cutover are not written back to SQLite, so rollback loses those new
changes. Prefer fixing forward once users resume writing.
