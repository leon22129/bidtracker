ALTER TABLE "job_applications"
ADD COLUMN "interview_date" TIMESTAMP(3),
ADD COLUMN "interview_note" TEXT;

CREATE INDEX "job_applications_interview_date_idx"
ON "job_applications"("interview_date");
