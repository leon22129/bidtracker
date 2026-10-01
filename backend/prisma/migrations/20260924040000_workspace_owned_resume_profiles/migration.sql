-- Resume profiles are workspace-owned one-to-one records. The migration preserves the existing
-- profile id for the first workspace and clones data if an older database shared a profile.
ALTER TABLE "resume_profiles" ADD COLUMN "workspace_id" TEXT;

WITH ranked AS (
  SELECT
    w."id" AS workspace_id,
    w."resume_profile_id",
    ROW_NUMBER() OVER (PARTITION BY w."resume_profile_id" ORDER BY w."id") AS position
  FROM "workspaces" w
  WHERE w."resume_profile_id" IS NOT NULL
)
INSERT INTO "resume_profiles" (
  "id", "user_id", "created_by_user_id", "workspace_id", "name", "career_path",
  "full_name", "title", "email", "phone", "location", "linkedin", "update_headline",
  "use_generated_role_titles", "template", "save_in_folder", "auto_download",
  "download_jd_with_pdf", "use_company_name", "generate_cover_letter",
  "cover_letter_template", "education_json", "certifications_json", "created_at", "updated_at"
)
SELECT
  'workspace_profile_clone_' || md5(r."resume_profile_id" || ':' || r.workspace_id),
  p."user_id", p."created_by_user_id", r.workspace_id, p."name", p."career_path",
  p."full_name", p."title", p."email", p."phone", p."location", p."linkedin",
  p."update_headline", p."use_generated_role_titles", p."template", p."save_in_folder",
  p."auto_download", p."download_jd_with_pdf", p."use_company_name",
  p."generate_cover_letter", p."cover_letter_template", p."education_json",
  p."certifications_json", p."created_at", p."updated_at"
FROM ranked r
JOIN "resume_profiles" p ON p."id" = r."resume_profile_id"
WHERE r.position > 1;

-- Conversations already tied to a workspace must follow that workspace's cloned profile.
WITH ranked AS (
  SELECT
    w."id" AS workspace_id,
    w."resume_profile_id",
    ROW_NUMBER() OVER (PARTITION BY w."resume_profile_id" ORDER BY w."id") AS position
  FROM "workspaces" w
  WHERE w."resume_profile_id" IS NOT NULL
)
UPDATE "resume_conversations" c
SET "profile_id" = 'workspace_profile_clone_' || md5(r."resume_profile_id" || ':' || r.workspace_id)
FROM ranked r
WHERE r.position > 1
  AND c."workspace_id" = r.workspace_id
  AND c."profile_id" = r."resume_profile_id";

WITH ranked AS (
  SELECT
    w."id" AS workspace_id,
    w."resume_profile_id",
    ROW_NUMBER() OVER (PARTITION BY w."resume_profile_id" ORDER BY w."id") AS position
  FROM "workspaces" w
  WHERE w."resume_profile_id" IS NOT NULL
)
UPDATE "resume_profiles" p
SET "workspace_id" = r.workspace_id
FROM ranked r
WHERE r.position = 1 AND p."id" = r."resume_profile_id";

-- Repair any legacy workspace without a profile before enforcing the invariant.
INSERT INTO "resume_profiles" (
  "id", "user_id", "created_by_user_id", "workspace_id", "name", "updated_at"
)
SELECT
  'workspace_profile_' || md5(w."id"),
  w."owner_user_id",
  w."created_by_user_id",
  w."id",
  'Profile for ' || w."id",
  CURRENT_TIMESTAMP
FROM "workspaces" w
WHERE w."resume_profile_id" IS NULL;

-- Older profile-only conversations now inherit the workspace owning their profile.
UPDATE "resume_conversations" c
SET "workspace_id" = p."workspace_id"
FROM "resume_profiles" p
WHERE c."profile_id" = p."id" AND c."workspace_id" IS NULL;

-- Do not silently discard orphan profiles or their possible provider-side conversations.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "resume_profiles" WHERE "workspace_id" IS NULL) THEN
    RAISE EXCEPTION 'Cannot convert orphan resume profiles; attach or remove them explicitly first';
  END IF;
END $$;

ALTER TABLE "workspaces" DROP CONSTRAINT "workspaces_resume_profile_id_fkey";
DROP INDEX "workspaces_resume_profile_id_idx";
ALTER TABLE "workspaces" DROP COLUMN "resume_profile_id";

ALTER TABLE "resume_profiles" DROP CONSTRAINT "resume_profiles_user_id_fkey";
ALTER TABLE "resume_profiles" DROP CONSTRAINT "resume_profiles_created_by_user_id_fkey";
DROP INDEX "resume_profiles_user_id_name_key";
DROP INDEX "resume_profiles_user_id_idx";
DROP INDEX "resume_profiles_created_by_user_id_idx";
ALTER TABLE "resume_profiles" DROP COLUMN "user_id";
ALTER TABLE "resume_profiles" DROP COLUMN "created_by_user_id";
ALTER TABLE "resume_profiles" ALTER COLUMN "workspace_id" SET NOT NULL;

CREATE UNIQUE INDEX "resume_profiles_workspace_id_key" ON "resume_profiles"("workspace_id");
ALTER TABLE "resume_profiles"
ADD CONSTRAINT "resume_profiles_workspace_id_fkey"
FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
