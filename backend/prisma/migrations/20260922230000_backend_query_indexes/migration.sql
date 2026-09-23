CREATE INDEX "job_applications_payment_lookup_idx"
ON "job_applications"("application_status", "paid", "date", "workspace_id");

CREATE INDEX "job_applications_workspace_date_desc_number_asc_idx"
ON "job_applications"("workspace_id", "date" DESC, "number" ASC);
