-- Preserve existing profile content while attributing legacy workspace profiles to their creator.
UPDATE "resume_profiles"
SET "created_by_user_id" = (
  SELECT "created_by_user_id"
  FROM "workspaces"
  WHERE "workspaces"."resume_profile_id" = "resume_profiles"."id"
)
WHERE "created_by_user_id" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "workspaces"
    WHERE "workspaces"."resume_profile_id" = "resume_profiles"."id"
      AND "workspaces"."created_by_user_id" IS NOT NULL
  );
