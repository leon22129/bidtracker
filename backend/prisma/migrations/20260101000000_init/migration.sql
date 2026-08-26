-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'bidder',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "workspaces_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "workspace_permissions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "permission_type" TEXT NOT NULL DEFAULT 'edit',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "workspace_permissions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "workspace_permissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "job_applications" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspace_id" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "number" INTEGER NOT NULL,
    "job_title" TEXT,
    "company_name" TEXT,
    "url" TEXT NOT NULL,
    "normalized_url" TEXT NOT NULL,
    "job_source" TEXT NOT NULL DEFAULT 'Other',
    "application_status" TEXT NOT NULL DEFAULT 'Pending',
    "pipeline_status" TEXT NOT NULL DEFAULT 'Not Started',
    "note" TEXT,
    "interview_date" DATETIME,
    "interview_note" TEXT,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "paid_by" TEXT,
    "paid_at" DATETIME,
    "resume_link" TEXT,
    "created_by_user_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "job_applications_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "job_applications_paid_by_fkey" FOREIGN KEY ("paid_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "job_applications_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "weekly_bid_reports" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspace_id" TEXT NOT NULL,
    "week_start_date" DATETIME NOT NULL,
    "week_end_date" DATETIME NOT NULL,
    "applied_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "weekly_bid_reports_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_name_key" ON "workspaces"("name");
CREATE INDEX "workspaces_owner_user_id_idx" ON "workspaces"("owner_user_id");
CREATE INDEX "workspaces_is_archived_idx" ON "workspaces"("is_archived");

-- CreateIndex
CREATE INDEX "workspace_permissions_user_id_idx" ON "workspace_permissions"("user_id");
CREATE INDEX "workspace_permissions_workspace_id_idx" ON "workspace_permissions"("workspace_id");
CREATE UNIQUE INDEX "workspace_permissions_workspace_id_user_id_key" ON "workspace_permissions"("workspace_id", "user_id");

-- CreateIndex
CREATE INDEX "job_applications_workspace_id_application_status_idx" ON "job_applications"("workspace_id", "application_status");
CREATE INDEX "job_applications_workspace_id_pipeline_status_idx" ON "job_applications"("workspace_id", "pipeline_status");
CREATE INDEX "job_applications_workspace_id_job_source_idx" ON "job_applications"("workspace_id", "job_source");
CREATE INDEX "job_applications_workspace_id_paid_idx" ON "job_applications"("workspace_id", "paid");
CREATE INDEX "job_applications_workspace_id_normalized_url_idx" ON "job_applications"("workspace_id", "normalized_url");
CREATE INDEX "job_applications_normalized_url_idx" ON "job_applications"("normalized_url");
CREATE INDEX "job_applications_url_idx" ON "job_applications"("url");
CREATE INDEX "job_applications_date_idx" ON "job_applications"("date");
CREATE INDEX "job_applications_interview_date_idx" ON "job_applications"("interview_date");
CREATE INDEX "job_applications_workspace_id_created_at_idx" ON "job_applications"("workspace_id", "created_at");
CREATE UNIQUE INDEX "job_applications_workspace_id_date_number_key" ON "job_applications"("workspace_id", "date", "number");

-- CreateIndex
CREATE INDEX "weekly_bid_reports_week_start_date_idx" ON "weekly_bid_reports"("week_start_date");
CREATE UNIQUE INDEX "weekly_bid_reports_workspace_id_week_start_date_key" ON "weekly_bid_reports"("workspace_id", "week_start_date");
