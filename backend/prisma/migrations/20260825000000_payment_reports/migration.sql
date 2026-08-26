-- Replace workspace weekly snapshots with bidder-level processing history.
PRAGMA foreign_keys=OFF;

CREATE TABLE "payment_reports" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bidder_id" TEXT NOT NULL,
    "start_date" DATETIME NOT NULL,
    "end_date" DATETIME NOT NULL,
    "applied_count" INTEGER NOT NULL,
    "processed_by" TEXT,
    "processed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "payment_reports_bidder_id_fkey" FOREIGN KEY ("bidder_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "payment_reports_processed_by_fkey" FOREIGN KEY ("processed_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "payment_reports_bidder_id_start_date_end_date_idx" ON "payment_reports"("bidder_id", "start_date", "end_date");
CREATE INDEX "payment_reports_processed_at_idx" ON "payment_reports"("processed_at");

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
    "interview_date" DATETIME,
    "interview_note" TEXT,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "resume_link" TEXT,
    "created_by_user_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "job_applications_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "job_applications_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "job_applications_new" ("id", "workspace_id", "date", "number", "job_title", "company_name", "url", "normalized_url", "job_source", "application_status", "pipeline_status", "note", "interview_date", "interview_note", "paid", "resume_link", "created_by_user_id", "created_at", "updated_at")
SELECT "id", "workspace_id", "date", "number", "job_title", "company_name", "url", "normalized_url", "job_source", "application_status", "pipeline_status", "note", "interview_date", "interview_note", "paid", "resume_link", "created_by_user_id", "created_at", "updated_at"
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
CREATE INDEX "job_applications_interview_date_idx" ON "job_applications"("interview_date");
CREATE INDEX "job_applications_workspace_id_created_at_idx" ON "job_applications"("workspace_id", "created_at");
CREATE UNIQUE INDEX "job_applications_workspace_id_date_number_key" ON "job_applications"("workspace_id", "date", "number");
DROP TABLE "weekly_bid_reports";
PRAGMA foreign_keys=ON;
