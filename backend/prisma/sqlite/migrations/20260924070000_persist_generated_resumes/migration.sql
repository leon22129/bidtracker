ALTER TABLE "job_applications" ADD COLUMN "conversation_id" TEXT
  REFERENCES "resume_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "job_applications" ADD COLUMN "job_description" TEXT;
ALTER TABLE "job_applications" ADD COLUMN "generated_resume_json" TEXT;
ALTER TABLE "job_applications" ADD COLUMN "resume_template" TEXT;
ALTER TABLE "job_applications" ADD COLUMN "resume_generated_at" DATETIME;

CREATE INDEX "job_applications_conversation_id_idx"
  ON "job_applications"("conversation_id");
