ALTER TABLE "users" ADD COLUMN "manager_user_id" TEXT;

CREATE INDEX "users_manager_user_id_idx" ON "users"("manager_user_id");

ALTER TABLE "users"
ADD CONSTRAINT "users_manager_user_id_fkey"
FOREIGN KEY ("manager_user_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
