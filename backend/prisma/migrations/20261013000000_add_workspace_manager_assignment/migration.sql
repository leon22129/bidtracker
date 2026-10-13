ALTER TABLE "workspaces" ADD COLUMN "manager_user_id" TEXT;

CREATE INDEX "workspaces_manager_user_id_idx" ON "workspaces"("manager_user_id");

ALTER TABLE "workspaces"
ADD CONSTRAINT "workspaces_manager_user_id_fkey"
FOREIGN KEY ("manager_user_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
