CREATE TABLE "profile_ai_settings" (
  "workspace_id" TEXT NOT NULL PRIMARY KEY,
  "provider" TEXT NOT NULL DEFAULT 'openai' CHECK ("provider" IN ('openai', 'deepseek', 'gemini', 'claude')),
  "model" TEXT NOT NULL DEFAULT 'gpt-6.1-sol',
  "openai_key" TEXT,
  "deepseek_key" TEXT,
  "gemini_key" TEXT,
  "claude_key" TEXT,
  "legacy_admin_id" TEXT,
  "updated_at" DATETIME NOT NULL,
  CONSTRAINT "profile_ai_settings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Only explicitly saved profile overrides create rows here.
-- Existing and new profiles inherit their admin's live account settings by default.
-- Account credentials and prompts remain unchanged in ai_settings.
