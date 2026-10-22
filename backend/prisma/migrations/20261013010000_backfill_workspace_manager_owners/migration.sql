UPDATE "workspaces" AS workspace
SET "manager_user_id" = workspace."owner_user_id"
FROM "users" AS owner
WHERE workspace."owner_user_id" = owner."id"
  AND owner."role" = 'bidder_manager'
  AND workspace."manager_user_id" IS NULL;
