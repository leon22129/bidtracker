ALTER TABLE "job_applications" ADD COLUMN "job_fingerprint" TEXT;

CREATE INDEX "job_applications_workspace_id_job_fingerprint_created_at_idx"
ON "job_applications"("workspace_id", "job_fingerprint", "created_at");
