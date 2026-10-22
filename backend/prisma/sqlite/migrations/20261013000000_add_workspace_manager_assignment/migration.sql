ALTER TABLE "workspaces" ADD COLUMN "manager_user_id" TEXT REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "workspaces_manager_user_id_idx" ON "workspaces"("manager_user_id");
