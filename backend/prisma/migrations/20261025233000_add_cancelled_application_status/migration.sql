-- Expand the status constraint without changing any existing application or payment record.
ALTER TABLE "job_applications"
DROP CONSTRAINT IF EXISTS "job_applications_application_status_check",
ADD CONSTRAINT "job_applications_application_status_check"
CHECK ("application_status" IN ('Pending', 'Applied', 'Cancelled', 'Rejected', 'Banned', 'Duplicated')) NOT VALID;

ALTER TABLE "job_applications" VALIDATE CONSTRAINT "job_applications_application_status_check";
