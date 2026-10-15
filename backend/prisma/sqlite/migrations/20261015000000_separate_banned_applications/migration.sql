-- Only reclassify rejections identified by the note written by the banned-list checks.
UPDATE "job_applications"
SET "application_status" = 'Banned'
WHERE "application_status" = 'Rejected'
  AND "note" = 'this job is in banned list';
