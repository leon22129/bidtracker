ALTER TABLE "job_applications"
  ADD COLUMN "conversation_id" TEXT,
  ADD COLUMN "job_description" TEXT,
  ADD COLUMN "generated_resume_json" TEXT,
  ADD COLUMN "resume_template" TEXT,
  ADD COLUMN "resume_generated_at" TIMESTAMP(3);

CREATE INDEX "job_applications_conversation_id_idx"
  ON "job_applications"("conversation_id");

ALTER TABLE "job_applications"
  ADD CONSTRAINT "job_applications_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "resume_conversations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
