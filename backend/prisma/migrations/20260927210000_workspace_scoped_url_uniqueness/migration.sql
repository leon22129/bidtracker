DROP INDEX IF EXISTS "job_applications_active_normalized_url_key";
DROP INDEX IF EXISTS "job_applications_normalized_url_idx";

CREATE INDEX "job_applications_workspace_id_normalized_url_idx"
ON "job_applications"("workspace_id", "normalized_url");

-- Active URL uniqueness is tenant-local: the same posting can be worked independently in different
-- workspaces, while concurrent duplicate inserts remain impossible inside one workspace.
CREATE UNIQUE INDEX "job_applications_workspace_active_normalized_url_key"
ON "job_applications"("workspace_id", "normalized_url")
WHERE "application_status" IN ('Pending', 'Applied');
