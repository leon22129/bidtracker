CREATE TABLE "ai_settings" (
  "admin_id" TEXT NOT NULL PRIMARY KEY,
  "provider" TEXT NOT NULL DEFAULT 'openai' CHECK ("provider" IN ('openai', 'deepseek')),
  "model" TEXT NOT NULL DEFAULT 'gpt-6.1-sol',
  "openai_key" TEXT,
  "deepseek_key" TEXT,
  "updated_at" DATETIME NOT NULL,
  CONSTRAINT "ai_settings_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
ALTER TABLE "resume_conversations" ADD COLUMN "reference_context" TEXT;
