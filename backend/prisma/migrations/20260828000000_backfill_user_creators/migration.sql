-- Associate legacy bidder accounts with the admin who created their workspace.
-- Existing users with no workspace remain unassigned until a superadmin or admin recreates/assigns them.
UPDATE "users"
SET "created_by_user_id" = (
    SELECT "created_by_user_id"
    FROM "workspaces"
    WHERE "workspaces"."owner_user_id" = "users"."id"
      AND "workspaces"."created_by_user_id" IS NOT NULL
    ORDER BY "workspaces"."created_at" ASC
    LIMIT 1
)
WHERE "role" IN ('bidder', 'bidder_manager')
  AND "created_by_user_id" IS NULL;
