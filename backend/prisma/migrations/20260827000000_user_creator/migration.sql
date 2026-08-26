-- Track which admin created each regular user so user management can be scoped.
ALTER TABLE "users" ADD COLUMN "created_by_user_id" TEXT;

PRAGMA foreign_keys=OFF;
CREATE TABLE "new_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'bidder',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "created_by_user_id" TEXT,
    CONSTRAINT "new_users_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_users" ("id", "username", "email", "password_hash", "role", "is_active", "created_at", "updated_at", "created_by_user_id")
SELECT "id", "username", "email", "password_hash", "role", "is_active", "created_at", "updated_at", "created_by_user_id" FROM "users";
DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "users_role_idx" ON "users"("role");
CREATE INDEX "users_created_by_user_id_idx" ON "users"("created_by_user_id");
PRAGMA foreign_keys=ON;
