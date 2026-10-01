-- Older rows predate reliable creator attribution. Their current workspace owner is the only
-- recoverable payment subject; all current write paths already store the authenticated creator.
UPDATE "job_applications"
SET "created_by_user_id" = (
  SELECT "owner_user_id"
  FROM "workspaces"
  WHERE "workspaces"."id" = "job_applications"."workspace_id"
)
WHERE "created_by_user_id" IS NULL;

-- Make payment attribution durable: every application must retain its creator, and a creator with
-- application history must be deactivated rather than deleted.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_job_applications" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspace_id" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "number" INTEGER NOT NULL,
    "job_title" TEXT,
    "company_name" TEXT,
    "url" TEXT NOT NULL,
    "normalized_url" TEXT NOT NULL,
    "job_fingerprint" TEXT,
    "job_source" TEXT NOT NULL DEFAULT 'Other',
    "application_status" TEXT NOT NULL DEFAULT 'Pending',
    "pipeline_status" TEXT NOT NULL DEFAULT 'Not Started',
    "note" TEXT,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "job_applications_workspace_id_fkey"
      FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "job_applications_created_by_user_id_fkey"
      FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id")
      ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_job_applications" (
  "id", "workspace_id", "date", "number", "job_title", "company_name", "url",
  "normalized_url", "job_fingerprint", "job_source", "application_status", "pipeline_status",
  "note", "paid", "created_by_user_id", "created_at", "updated_at"
)
SELECT
  "id", "workspace_id", "date", "number", "job_title", "company_name", "url",
  "normalized_url", "job_fingerprint", "job_source", "application_status", "pipeline_status",
  "note", "paid", "created_by_user_id", "created_at", "updated_at"
FROM "job_applications";

DROP TABLE "job_applications";
ALTER TABLE "new_job_applications" RENAME TO "job_applications";

CREATE UNIQUE INDEX "job_applications_workspace_id_date_number_key"
ON "job_applications"("workspace_id", "date", "number");
CREATE INDEX "job_applications_workspace_id_application_status_idx"
ON "job_applications"("workspace_id", "application_status");
CREATE INDEX "job_applications_workspace_id_pipeline_status_idx"
ON "job_applications"("workspace_id", "pipeline_status");
CREATE INDEX "job_applications_workspace_id_job_source_idx"
ON "job_applications"("workspace_id", "job_source");
CREATE INDEX "job_applications_workspace_id_paid_idx"
ON "job_applications"("workspace_id", "paid");
CREATE INDEX "job_applications_normalized_url_idx"
ON "job_applications"("normalized_url");
CREATE INDEX "job_applications_workspace_id_job_fingerprint_created_at_idx"
ON "job_applications"("workspace_id", "job_fingerprint", "created_at");
CREATE INDEX "job_applications_date_idx"
ON "job_applications"("date");
CREATE INDEX "job_applications_workspace_id_created_at_idx"
ON "job_applications"("workspace_id", "created_at");
CREATE INDEX "job_applications_payment_lookup_idx"
ON "job_applications"("application_status", "paid", "date", "created_by_user_id", "workspace_id");
CREATE INDEX "job_applications_workspace_date_desc_number_asc_idx"
ON "job_applications"("workspace_id", "date" DESC, "number" ASC);

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

