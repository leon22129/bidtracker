ALTER TABLE "users" ADD COLUMN "manager_user_id" TEXT
REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "users_manager_user_id_idx" ON "users"("manager_user_id");
