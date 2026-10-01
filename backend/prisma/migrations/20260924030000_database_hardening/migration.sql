-- DTO validation protects HTTP writes; these constraints protect direct SQL, scripts, and bugs.
ALTER TABLE "users"
ADD CONSTRAINT "users_role_check"
CHECK ("role" IN ('super_admin', 'admin', 'bidder_manager', 'bidder')) NOT VALID;

ALTER TABLE "workspace_permissions"
ADD CONSTRAINT "workspace_permissions_type_check"
CHECK ("permission_type" IN ('view', 'edit')) NOT VALID;

ALTER TABLE "job_applications"
ADD CONSTRAINT "job_applications_application_status_check"
CHECK ("application_status" IN ('Pending', 'Applied', 'Rejected', 'Duplicated')) NOT VALID,
ADD CONSTRAINT "job_applications_pipeline_status_check"
CHECK ("pipeline_status" IN (
  'Not Started', 'Recruiter Interview', 'Technical Interview', 'Final Interview',
  'Offer Received', 'Accepted', 'Rejected'
)) NOT VALID,
ADD CONSTRAINT "job_applications_job_source_check"
CHECK ("job_source" IN (
  'Greenhouse', 'Workday', 'ADP', 'Dayforce', 'Lever', 'SmartRecruiters', 'iCIMS',
  'Taleo', 'LinkedIn', 'Indeed', 'ZipRecruiter', 'Company Career Page', 'Other'
)) NOT VALID;

ALTER TABLE "users" VALIDATE CONSTRAINT "users_role_check";
ALTER TABLE "workspace_permissions" VALIDATE CONSTRAINT "workspace_permissions_type_check";
ALTER TABLE "job_applications" VALIDATE CONSTRAINT "job_applications_application_status_check";
ALTER TABLE "job_applications" VALIDATE CONSTRAINT "job_applications_pipeline_status_check";
ALTER TABLE "job_applications" VALIDATE CONSTRAINT "job_applications_job_source_check";

-- Prisma's contains + mode:insensitive filters compile to ILIKE '%term%'. Trigram GIN indexes make
-- those four OR branches indexable without changing search semantics.
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE INDEX "job_applications_job_title_trgm_idx"
ON "job_applications" USING GIN ("job_title" gin_trgm_ops);

CREATE INDEX "job_applications_company_name_trgm_idx"
ON "job_applications" USING GIN ("company_name" gin_trgm_ops);

CREATE INDEX "job_applications_url_trgm_idx"
ON "job_applications" USING GIN ("url" gin_trgm_ops);

CREATE INDEX "job_applications_note_trgm_idx"
ON "job_applications" USING GIN ("note" gin_trgm_ops);
