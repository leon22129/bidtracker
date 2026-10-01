-- Add normalized_company_name column for company-name-based duplicate detection.
-- This column contains the company name after normalization: keep only [a-zA-Z0-9], then lowercase.
-- Empty company names or names that normalize to empty strings have NULL in this column.
ALTER TABLE "job_applications" ADD COLUMN "normalized_company_name" TEXT;

-- Create an index to support efficient lookups during duplicate detection.
-- Index key: (workspace_id, normalized_company_name) for workspace-scoped duplicate checks.
CREATE INDEX "job_applications_workspace_id_normalized_company_name" ON "job_applications"("workspace_id", "normalized_company_name");

-- Also index globally for historical global duplicate lookups.
CREATE INDEX "job_applications_normalized_company_name" ON "job_applications"("normalized_company_name");
