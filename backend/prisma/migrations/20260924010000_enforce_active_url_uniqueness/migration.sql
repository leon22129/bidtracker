-- Keep one active application per normalized URL. Prefer an already-paid row, then an Applied row,
-- then the oldest record so cleanup is deterministic and preserves the most consequential record.
WITH ranked_active_urls AS (
    SELECT
        "id",
        ROW_NUMBER() OVER (
            PARTITION BY "normalized_url"
            ORDER BY
                "paid" DESC,
                CASE "application_status" WHEN 'Applied' THEN 0 ELSE 1 END,
                "created_at" ASC,
                "id" ASC
        ) AS duplicate_rank
    FROM "job_applications"
    WHERE "application_status" IN ('Pending', 'Applied')
)
UPDATE "job_applications" AS application
SET
    "application_status" = 'Duplicated',
    "updated_at" = CURRENT_TIMESTAMP
FROM ranked_active_urls
WHERE application."id" = ranked_active_urls."id"
  AND ranked_active_urls.duplicate_rank > 1;

-- This partial unique index is the concurrency-safe invariant. Rejected and explicitly Duplicated
-- rows remain valid history, but two active requests can no longer commit the same normalized URL.
CREATE UNIQUE INDEX "job_applications_active_normalized_url_key"
ON "job_applications"("normalized_url")
WHERE "application_status" IN ('Pending', 'Applied');
