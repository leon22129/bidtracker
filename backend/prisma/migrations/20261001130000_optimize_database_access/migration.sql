-- Retention cleanup reads the oldest expired conversations in small batches.
CREATE INDEX "resume_conversations_updated_at_idx"
ON "resume_conversations"("updated_at");

-- The former full-table index put the date range before creator/workspace. Once PostgreSQL reached
-- the date range, the trailing equality columns could no longer narrow the index scan. These partial
-- indexes cover the two payment access paths and only retain rows that are eligible for payment.
DROP INDEX IF EXISTS "job_applications_payment_lookup_idx";

CREATE INDEX "job_applications_unpaid_applied_creator_date_idx"
ON "job_applications"("created_by_user_id", "date", "workspace_id")
WHERE "application_status" = 'Applied' AND "paid" = false;

CREATE INDEX "job_applications_unpaid_applied_workspace_date_idx"
ON "job_applications"("workspace_id", "date", "created_by_user_id")
WHERE "application_status" = 'Applied' AND "paid" = false;

-- Restoring the latest generated application is workspace- and creator-scoped. Keeping only rows
-- with a generated artifact makes this index much smaller than a full-table sort index.
CREATE INDEX "job_applications_latest_generated_idx"
ON "job_applications"(
  "workspace_id",
  "created_by_user_id",
  "resume_generated_at" DESC,
  "created_at" DESC
)
WHERE "generated_resume_json" IS NOT NULL;

-- Regular admins filter history by processor and then request newest-first rows.
CREATE INDEX "payment_reports_processed_by_processed_at_idx"
ON "payment_reports"("processed_by", "processed_at" DESC);
