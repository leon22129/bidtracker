ALTER TABLE "job_applications"
DROP CONSTRAINT "job_applications_application_status_check",
ADD CONSTRAINT "job_applications_application_status_check"
CHECK ("application_status" IN ('Pending', 'Applied', 'Rejected', 'Banned', 'Duplicated')) NOT VALID;

-- Only reclassify rejections identified by the note written by the banned-list checks.
UPDATE "job_applications"
SET "application_status" = 'Banned'
WHERE "application_status" = 'Rejected'
  AND "note" = 'this job is in banned list';

ALTER TABLE "job_applications" VALIDATE CONSTRAINT "job_applications_application_status_check";
