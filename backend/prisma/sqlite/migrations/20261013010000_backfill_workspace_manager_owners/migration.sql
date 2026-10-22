UPDATE "workspaces"
SET "manager_user_id" = "owner_user_id"
WHERE "manager_user_id" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "users"
    WHERE "users"."id" = "workspaces"."owner_user_id"
      AND "users"."role" = 'bidder_manager'
  );
