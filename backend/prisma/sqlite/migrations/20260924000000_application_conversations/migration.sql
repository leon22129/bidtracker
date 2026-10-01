-- CreateTable
CREATE TABLE "resume_conversations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "openai_conversation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "workspace_id" TEXT,
    "profile_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "resume_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "resume_conversations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "resume_conversations_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "resume_profiles" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "resume_conversations_openai_conversation_id_key" ON "resume_conversations"("openai_conversation_id");

-- CreateIndex
CREATE INDEX "resume_conversations_user_id_idx" ON "resume_conversations"("user_id");

-- CreateIndex
CREATE INDEX "resume_conversations_workspace_id_idx" ON "resume_conversations"("workspace_id");

-- CreateIndex
CREATE INDEX "resume_conversations_profile_id_idx" ON "resume_conversations"("profile_id");

