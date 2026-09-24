-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'bidder',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_user_id" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "created_by_user_id" TEXT,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "resume_profile_id" TEXT,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resume_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_by_user_id" TEXT,
    "name" TEXT NOT NULL,
    "career_path" TEXT NOT NULL DEFAULT '',
    "full_name" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "linkedin" TEXT NOT NULL DEFAULT '',
    "update_headline" BOOLEAN NOT NULL DEFAULT true,
    "use_generated_role_titles" BOOLEAN NOT NULL DEFAULT true,
    "template" TEXT NOT NULL DEFAULT 'classic',
    "save_in_folder" BOOLEAN NOT NULL DEFAULT false,
    "auto_download" BOOLEAN NOT NULL DEFAULT false,
    "download_jd_with_pdf" BOOLEAN NOT NULL DEFAULT false,
    "use_company_name" BOOLEAN NOT NULL DEFAULT true,
    "generate_cover_letter" BOOLEAN NOT NULL DEFAULT false,
    "cover_letter_template" TEXT NOT NULL DEFAULT 'classic',
    "education_json" TEXT NOT NULL DEFAULT '[]',
    "certifications_json" TEXT NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resume_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resume_conversations" (
    "id" TEXT NOT NULL,
    "openai_conversation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "workspace_id" TEXT,
    "profile_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resume_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_permissions" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "permission_type" TEXT NOT NULL DEFAULT 'edit',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_applications" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "number" INTEGER NOT NULL,
    "job_title" TEXT,
    "company_name" TEXT,
    "url" TEXT NOT NULL,
    "normalized_url" TEXT NOT NULL,
    "job_fingerprint" TEXT,
    "job_source" TEXT NOT NULL DEFAULT 'Other',
    "application_status" TEXT NOT NULL DEFAULT 'Pending',
    "pipeline_status" TEXT NOT NULL DEFAULT 'Not Started',
    "note" TEXT,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_reports" (
    "id" TEXT NOT NULL,
    "bidder_id" TEXT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "applied_count" INTEGER NOT NULL,
    "processed_by" TEXT,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "banned_url_patterns" (
    "id" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "banned_url_patterns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_created_by_user_id_idx" ON "users"("created_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_name_key" ON "workspaces"("name");

-- CreateIndex
CREATE INDEX "workspaces_owner_user_id_idx" ON "workspaces"("owner_user_id");

-- CreateIndex
CREATE INDEX "workspaces_created_by_user_id_idx" ON "workspaces"("created_by_user_id");

-- CreateIndex
CREATE INDEX "workspaces_is_archived_idx" ON "workspaces"("is_archived");

-- CreateIndex
CREATE INDEX "workspaces_resume_profile_id_idx" ON "workspaces"("resume_profile_id");

-- CreateIndex
CREATE INDEX "resume_profiles_user_id_idx" ON "resume_profiles"("user_id");

-- CreateIndex
CREATE INDEX "resume_profiles_created_by_user_id_idx" ON "resume_profiles"("created_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "resume_profiles_user_id_name_key" ON "resume_profiles"("user_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "resume_conversations_openai_conversation_id_key" ON "resume_conversations"("openai_conversation_id");

-- CreateIndex
CREATE INDEX "resume_conversations_user_id_idx" ON "resume_conversations"("user_id");

-- CreateIndex
CREATE INDEX "resume_conversations_workspace_id_idx" ON "resume_conversations"("workspace_id");

-- CreateIndex
CREATE INDEX "resume_conversations_profile_id_idx" ON "resume_conversations"("profile_id");

-- CreateIndex
CREATE INDEX "workspace_permissions_user_id_idx" ON "workspace_permissions"("user_id");

-- CreateIndex
CREATE INDEX "workspace_permissions_workspace_id_idx" ON "workspace_permissions"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_permissions_workspace_id_user_id_key" ON "workspace_permissions"("workspace_id", "user_id");

-- CreateIndex
CREATE INDEX "job_applications_workspace_id_application_status_idx" ON "job_applications"("workspace_id", "application_status");

-- CreateIndex
CREATE INDEX "job_applications_workspace_id_pipeline_status_idx" ON "job_applications"("workspace_id", "pipeline_status");

-- CreateIndex
CREATE INDEX "job_applications_workspace_id_job_source_idx" ON "job_applications"("workspace_id", "job_source");

-- CreateIndex
CREATE INDEX "job_applications_workspace_id_paid_idx" ON "job_applications"("workspace_id", "paid");

-- CreateIndex
CREATE INDEX "job_applications_normalized_url_idx" ON "job_applications"("normalized_url");

-- CreateIndex
CREATE INDEX "job_applications_workspace_id_job_fingerprint_created_at_idx" ON "job_applications"("workspace_id", "job_fingerprint", "created_at");

-- CreateIndex
CREATE INDEX "job_applications_date_idx" ON "job_applications"("date");

-- CreateIndex
CREATE INDEX "job_applications_workspace_id_created_at_idx" ON "job_applications"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "job_applications_payment_lookup_idx" ON "job_applications"("application_status", "paid", "date", "created_by_user_id", "workspace_id");

-- CreateIndex
CREATE INDEX "job_applications_workspace_date_desc_number_asc_idx" ON "job_applications"("workspace_id", "date" DESC, "number" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "job_applications_workspace_id_date_number_key" ON "job_applications"("workspace_id", "date", "number");

-- CreateIndex
CREATE INDEX "payment_reports_bidder_id_start_date_end_date_idx" ON "payment_reports"("bidder_id", "start_date", "end_date");

-- CreateIndex
CREATE INDEX "payment_reports_processed_at_idx" ON "payment_reports"("processed_at");

-- CreateIndex
CREATE UNIQUE INDEX "banned_url_patterns_pattern_key" ON "banned_url_patterns"("pattern");

-- CreateIndex
CREATE INDEX "banned_url_patterns_created_by_user_id_idx" ON "banned_url_patterns"("created_by_user_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_resume_profile_id_fkey" FOREIGN KEY ("resume_profile_id") REFERENCES "resume_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resume_profiles" ADD CONSTRAINT "resume_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resume_profiles" ADD CONSTRAINT "resume_profiles_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resume_conversations" ADD CONSTRAINT "resume_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resume_conversations" ADD CONSTRAINT "resume_conversations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resume_conversations" ADD CONSTRAINT "resume_conversations_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "resume_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_permissions" ADD CONSTRAINT "workspace_permissions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_permissions" ADD CONSTRAINT "workspace_permissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reports" ADD CONSTRAINT "payment_reports_bidder_id_fkey" FOREIGN KEY ("bidder_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reports" ADD CONSTRAINT "payment_reports_processed_by_fkey" FOREIGN KEY ("processed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banned_url_patterns" ADD CONSTRAINT "banned_url_patterns_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


