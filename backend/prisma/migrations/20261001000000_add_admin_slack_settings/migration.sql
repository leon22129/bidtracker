ALTER TABLE "users"
  ADD COLUMN "slack_webhook_url" TEXT,
  ADD COLUMN "slack_user_id" TEXT,
  ADD COLUMN "slack_milestone_day" TIMESTAMP(3),
  ADD COLUMN "slack_last_milestone" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "job_applications_created_by_user_id_created_at_idx"
  ON "job_applications"("created_by_user_id", "created_at");
