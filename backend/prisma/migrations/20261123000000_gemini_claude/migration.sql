ALTER TABLE "ai_settings" ADD COLUMN "gemini_key" TEXT;
ALTER TABLE "ai_settings" ADD COLUMN "claude_key" TEXT;
ALTER TABLE "ai_settings" DROP CONSTRAINT "ai_settings_provider_check";
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_provider_check"
  CHECK ("provider" IN ('openai', 'deepseek', 'gemini', 'claude'));
