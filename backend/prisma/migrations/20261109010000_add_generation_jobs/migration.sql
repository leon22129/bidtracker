CREATE TABLE "generation_jobs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "request_json" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "result_json" TEXT,
    "error_message" TEXT,
    "error_status" INTEGER,
    "lease_expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    CONSTRAINT "generation_jobs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "generation_jobs_status_check" CHECK ("status" IN ('queued', 'running', 'completed', 'failed')),
    CONSTRAINT "generation_jobs_kind_check" CHECK ("kind" IN ('application', 'profile', 'answers'))
);
CREATE INDEX "generation_jobs_status_created_at_idx" ON "generation_jobs"("status", "created_at");
CREATE INDEX "generation_jobs_user_id_status_idx" ON "generation_jobs"("user_id", "status");
CREATE INDEX "generation_jobs_workspace_id_idx" ON "generation_jobs"("workspace_id");
CREATE INDEX "generation_jobs_completed_at_idx" ON "generation_jobs"("completed_at");
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
