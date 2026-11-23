CREATE TABLE "new_ai_settings" (
  "admin_id" TEXT NOT NULL PRIMARY KEY,
  "provider" TEXT NOT NULL DEFAULT 'openai' CHECK ("provider" IN ('openai', 'deepseek', 'gemini', 'claude')),
  "model" TEXT NOT NULL DEFAULT 'gpt-6.1-sol',
  "openai_key" TEXT,
  "deepseek_key" TEXT,
  "gemini_key" TEXT,
  "claude_key" TEXT,
  "resume_prompt" TEXT,
  "updated_at" DATETIME NOT NULL,
  CONSTRAINT "ai_settings_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ai_settings" ("admin_id", "provider", "model", "openai_key", "deepseek_key", "resume_prompt", "updated_at")
  SELECT "admin_id", "provider", "model", "openai_key", "deepseek_key", "resume_prompt", "updated_at" FROM "ai_settings";
DROP TABLE "ai_settings";
ALTER TABLE "new_ai_settings" RENAME TO "ai_settings";
