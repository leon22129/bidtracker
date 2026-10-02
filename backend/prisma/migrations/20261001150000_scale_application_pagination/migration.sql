DROP INDEX IF EXISTS "job_applications_workspace_id_application_status_idx";
DROP INDEX IF EXISTS "job_applications_workspace_id_pipeline_status_idx";
DROP INDEX IF EXISTS "job_applications_workspace_id_job_source_idx";
DROP INDEX IF EXISTS "job_applications_workspace_id_paid_idx";
DROP INDEX IF EXISTS "job_applications_workspace_id_created_at_idx";

CREATE INDEX "job_applications_sort_application_status_idx"
ON "job_applications"("workspace_id", "application_status", "date", "number", "id");

CREATE INDEX "job_applications_sort_pipeline_status_idx"
ON "job_applications"("workspace_id", "pipeline_status", "date", "number", "id");

CREATE INDEX "job_applications_sort_job_source_idx"
ON "job_applications"("workspace_id", "job_source", "date", "number", "id");

CREATE INDEX "job_applications_sort_paid_idx"
ON "job_applications"("workspace_id", "paid", "date", "number", "id");

CREATE INDEX "job_applications_sort_number_idx"
ON "job_applications"("workspace_id", "number", "date", "id");

CREATE INDEX "job_applications_sort_job_title_idx"
ON "job_applications"("workspace_id", "job_title", "date", "number", "id");

CREATE INDEX "job_applications_sort_company_name_idx"
ON "job_applications"("workspace_id", "company_name", "date", "number", "id");

CREATE INDEX "job_applications_sort_interview_date_idx"
ON "job_applications"("workspace_id", "interview_date", "date", "number", "id");

CREATE INDEX "job_applications_sort_created_at_idx"
ON "job_applications"("workspace_id", "created_at", "date", "number", "id");
