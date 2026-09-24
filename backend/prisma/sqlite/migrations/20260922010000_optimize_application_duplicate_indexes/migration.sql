-- Production uses global URL duplicate detection. Keep the single normalized-URL index used by
-- that query and remove redundant exact-URL, workspace-normalized-URL, and company indexes.
DROP INDEX IF EXISTS "job_applications_url_idx";
DROP INDEX IF EXISTS "job_applications_workspace_id_normalized_url_idx";
DROP INDEX IF EXISTS "job_applications_normalized_company_name_idx";
DROP INDEX IF EXISTS "job_applications_workspace_id_normalized_company_name_idx";

-- Company names are display data, not duplicate keys.
ALTER TABLE "job_applications" DROP COLUMN "normalized_company_name";

