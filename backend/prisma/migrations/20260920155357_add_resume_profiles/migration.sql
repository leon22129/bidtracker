-- CreateTable
CREATE TABLE "resume_profiles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "career_path" TEXT NOT NULL DEFAULT '',
    "full_name" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "linkedin" TEXT NOT NULL DEFAULT '',
    "education_json" TEXT NOT NULL DEFAULT '[]',
    "certifications_json" TEXT NOT NULL DEFAULT '[]',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "resume_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_workspaces" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "created_by_user_id" TEXT,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "resume_profile_id" TEXT,
    CONSTRAINT "workspaces_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "workspaces_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "workspaces_resume_profile_id_fkey" FOREIGN KEY ("resume_profile_id") REFERENCES "resume_profiles" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_workspaces" ("created_at", "created_by_user_id", "id", "is_archived", "name", "owner_user_id", "updated_at") SELECT "created_at", "created_by_user_id", "id", "is_archived", "name", "owner_user_id", "updated_at" FROM "workspaces";
DROP TABLE "workspaces";
ALTER TABLE "new_workspaces" RENAME TO "workspaces";
CREATE UNIQUE INDEX "workspaces_name_key" ON "workspaces"("name");
CREATE INDEX "workspaces_owner_user_id_idx" ON "workspaces"("owner_user_id");
CREATE INDEX "workspaces_created_by_user_id_idx" ON "workspaces"("created_by_user_id");
CREATE INDEX "workspaces_is_archived_idx" ON "workspaces"("is_archived");
CREATE INDEX "workspaces_resume_profile_id_idx" ON "workspaces"("resume_profile_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "resume_profiles_user_id_idx" ON "resume_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "resume_profiles_user_id_name_key" ON "resume_profiles"("user_id", "name");

-- RedefineIndex
DROP INDEX "job_applications_normalized_company_name";
CREATE INDEX "job_applications_normalized_company_name_idx" ON "job_applications"("normalized_company_name");

-- RedefineIndex
DROP INDEX "job_applications_workspace_id_normalized_company_name";
CREATE INDEX "job_applications_workspace_id_normalized_company_name_idx" ON "job_applications"("workspace_id", "normalized_company_name");
