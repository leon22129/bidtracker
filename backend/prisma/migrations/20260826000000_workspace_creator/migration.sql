-- Add the admin that created/manages each workspace. Legacy rows remain visible only to super admins until assigned.
ALTER TABLE "workspaces" ADD COLUMN "created_by_user_id" TEXT;

UPDATE "workspaces"
SET "created_by_user_id" = (
    SELECT "id" FROM "users" WHERE "role" = 'admin' ORDER BY "created_at" ASC LIMIT 1
)
WHERE "created_by_user_id" IS NULL;

PRAGMA foreign_keys=OFF;
CREATE TABLE "new_workspaces" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "created_by_user_id" TEXT,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "new_workspaces_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "new_workspaces_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_workspaces" ("id", "name", "owner_user_id", "created_by_user_id", "is_archived", "created_at", "updated_at")
SELECT "id", "name", "owner_user_id", "created_by_user_id", "is_archived", "created_at", "updated_at" FROM "workspaces";
DROP TABLE "workspaces";
ALTER TABLE "new_workspaces" RENAME TO "workspaces";
CREATE UNIQUE INDEX "workspaces_name_key" ON "workspaces"("name");
CREATE INDEX "workspaces_owner_user_id_idx" ON "workspaces"("owner_user_id");
CREATE INDEX "workspaces_created_by_user_id_idx" ON "workspaces"("created_by_user_id");
CREATE INDEX "workspaces_is_archived_idx" ON "workspaces"("is_archived");
PRAGMA foreign_keys=ON;
