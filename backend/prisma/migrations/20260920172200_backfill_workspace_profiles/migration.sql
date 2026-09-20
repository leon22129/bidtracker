-- Create blank profiles for legacy workspaces that predate resume-profile integration.
-- Existing workspace and application data is preserved; only profile rows and links are added.
INSERT INTO "resume_profiles" (
  "id", "user_id", "created_by_user_id", "name", "career_path", "full_name", "title",
  "email", "phone", "location", "linkedin", "education_json", "certifications_json",
  "created_at", "updated_at"
)
SELECT
  'cm' || lower(hex(randomblob(12))),
  "owner_user_id",
  "created_by_user_id",
  "name",
  '', '', '', '', '', '', '', '[]', '[]',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "workspaces"
WHERE "resume_profile_id" IS NULL;

UPDATE "workspaces"
SET "resume_profile_id" = (
  SELECT "resume_profiles"."id"
  FROM "resume_profiles"
  WHERE "resume_profiles"."user_id" = "workspaces"."owner_user_id"
    AND "resume_profiles"."name" = "workspaces"."name"
  ORDER BY "resume_profiles"."created_at" DESC
  LIMIT 1
)
WHERE "resume_profile_id" IS NULL;
