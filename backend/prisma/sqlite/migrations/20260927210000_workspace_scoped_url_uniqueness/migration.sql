DROP INDEX IF EXISTS "job_applications_normalized_url_idx";

-- Older SQLite databases did not enforce the active-URL invariant. Resolve any local conflicts
-- deterministically before adding the workspace-scoped partial unique index.
WITH ranked_active_urls AS (
    SELECT
        "id",
        ROW_NUMBER() OVER (
            PARTITION BY "workspace_id", "normalized_url"
            ORDER BY
                "paid" DESC,
                CASE "application_status" WHEN 'Applied' THEN 0 ELSE 1 END,
                "created_at" ASC,
                "id" ASC
        ) AS duplicate_rank
    FROM "job_applications"
    WHERE "application_status" IN ('Pending', 'Applied')
)
UPDATE "job_applications"
SET
    "application_status" = 'Duplicated',
    "updated_at" = CURRENT_TIMESTAMP
WHERE "id" IN (
    SELECT "id" FROM ranked_active_urls WHERE duplicate_rank > 1
);

CREATE INDEX "job_applications_workspace_id_normalized_url_idx"
ON "job_applications"("workspace_id", "normalized_url");

CREATE UNIQUE INDEX "job_applications_workspace_active_normalized_url_key"
ON "job_applications"("workspace_id", "normalized_url")
WHERE "application_status" IN ('Pending', 'Applied');
