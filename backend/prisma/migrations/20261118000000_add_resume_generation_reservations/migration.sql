CREATE TABLE "resume_generation_reservations" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "company_identity" TEXT NOT NULL,
    "normalized_url" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "resume_generation_reservations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "resume_generation_reservations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "resume_generation_reservations_workspace_id_company_identity_key" ON "resume_generation_reservations"("workspace_id", "company_identity");
CREATE UNIQUE INDEX "resume_generation_reservations_workspace_id_normalized_url_key" ON "resume_generation_reservations"("workspace_id", "normalized_url");
CREATE INDEX "resume_generation_reservations_expires_at_idx" ON "resume_generation_reservations"("expires_at");
