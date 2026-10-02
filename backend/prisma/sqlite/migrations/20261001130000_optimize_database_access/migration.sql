CREATE INDEX "resume_conversations_updated_at_idx"
ON "resume_conversations"("updated_at");

DROP INDEX IF EXISTS "job_applications_payment_lookup_idx";

CREATE INDEX "job_applications_unpaid_applied_creator_date_idx"
ON "job_applications"("created_by_user_id", "date", "workspace_id")
WHERE "application_status" = 'Applied' AND "paid" = 0;

CREATE INDEX "job_applications_unpaid_applied_workspace_date_idx"
ON "job_applications"("workspace_id", "date", "created_by_user_id")
WHERE "application_status" = 'Applied' AND "paid" = 0;

CREATE INDEX "job_applications_latest_generated_idx"
ON "job_applications"(
  "workspace_id",
  "created_by_user_id",
  "resume_generated_at" DESC,
  "created_at" DESC
)
WHERE "generated_resume_json" IS NOT NULL;

CREATE INDEX "payment_reports_processed_by_processed_at_idx"
ON "payment_reports"("processed_by", "processed_at" DESC);
