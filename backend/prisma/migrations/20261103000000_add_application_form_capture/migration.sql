-- Observed form entries are independent of generated answer suggestions.
ALTER TABLE "application_drafts" ADD COLUMN "application_form_json" TEXT;
ALTER TABLE "job_applications" ADD COLUMN "application_form_json" TEXT;
