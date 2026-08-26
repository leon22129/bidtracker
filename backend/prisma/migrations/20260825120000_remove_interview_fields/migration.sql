-- Remove unused interview scheduling fields from job applications.
PRAGMA foreign_keys=OFF;

CREATE TABLE "job_applications_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspace_id" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "number" INTEGER NOT NULL,
    "job_title" TEXT,
    "company_name" TEXT,
    "url" TEXT NOT NULL,
    "normalized_url" TEXT NOT NULL,
    "job_source" TEXT NOT NULL DEFAULT 'Other',
    "application_status" TEXT NOT NULL DEFAULT 'Pending',
    "pipeline_status" TEXT NOT NULL DEFAULT 'Not Started',
    "note" TEXT,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "resume_link" TEXT,
    "created_by_user_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "job_applications_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "job_applications_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "job_applications_new" ("id", "workspace_id", "date", "number", "job_title", "company_name", "url", "normalized_url", "job_source", "application_status", "pipeline_status", "note", "paid", "resume_link", "created_by_user_id", "created_at", "updated_at")
SELECT "id", "workspace_id", "date", "number", "job_title", "company_name", "url", "normalized_url", "job_source", "application_status", "pipeline_status", "note", "paid", "resume_link", "created_by_user_id", "created_at", "updated_at"
FROM "job_applications";

DROP TABLE "job_applications";
ALTER TABLE "job_applications_new" RENAME TO "job_applications";
CREATE INDEX "job_applications_workspace_id_application_status_idx" ON "job_applications"("workspace_id", "application_status");
CREATE INDEX "job_applications_workspace_id_pipeline_status_idx" ON "job_applications"("workspace_id", "pipeline_status");
CREATE INDEX "job_applications_workspace_id_job_source_idx" ON "job_applications"("workspace_id", "job_source");
CREATE INDEX "job_applications_workspace_id_paid_idx" ON "job_applications"("workspace_id", "paid");
CREATE INDEX "job_applications_workspace_id_normalized_url_idx" ON "job_applications"("workspace_id", "normalized_url");
CREATE INDEX "job_applications_normalized_url_idx" ON "job_applications"("normalized_url");
CREATE INDEX "job_applications_url_idx" ON "job_applications"("url");
CREATE INDEX "job_applications_date_idx" ON "job_applications"("date");
CREATE INDEX "job_applications_workspace_id_created_at_idx" ON "job_applications"("workspace_id", "created_at");
CREATE UNIQUE INDEX "job_applications_workspace_id_date_number_key" ON "job_applications"("workspace_id", "date", "number");

PRAGMA foreign_keys=ON;