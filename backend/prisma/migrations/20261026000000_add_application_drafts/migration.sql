-- CreateTable
CREATE TABLE "application_drafts" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "normalized_url" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "job_title" TEXT NOT NULL,
    "source_job_description" TEXT NOT NULL,
    "job_description" TEXT NOT NULL,
    "generated_resume_json" TEXT NOT NULL,
    "resume_template" TEXT NOT NULL DEFAULT 'classic',
    "cover_letter_text" TEXT,
    "cover_letter_template" TEXT NOT NULL DEFAULT 'classic',
    "conversation_id" TEXT,
    "application_questions_json" TEXT,
    "application_answers_json" TEXT,
    "submitted_application_id" TEXT,
    "submitted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "application_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "application_drafts_conversation_id_key" ON "application_drafts"("conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "application_drafts_submitted_application_id_key" ON "application_drafts"("submitted_application_id");

-- CreateIndex
CREATE INDEX "application_drafts_workspace_id_created_by_user_id_created__idx" ON "application_drafts"("workspace_id", "created_by_user_id", "created_at");

-- AddForeignKey
ALTER TABLE "application_drafts" ADD CONSTRAINT "application_drafts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_drafts" ADD CONSTRAINT "application_drafts_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_drafts" ADD CONSTRAINT "application_drafts_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "resume_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_drafts" ADD CONSTRAINT "application_drafts_submitted_application_id_fkey" FOREIGN KEY ("submitted_application_id") REFERENCES "job_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

