-- Add resume-builder download settings without changing existing profile content.
ALTER TABLE "resume_profiles" ADD COLUMN "template" TEXT NOT NULL DEFAULT 'classic';
ALTER TABLE "resume_profiles" ADD COLUMN "save_in_folder" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "resume_profiles" ADD COLUMN "auto_download" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "resume_profiles" ADD COLUMN "download_jd_with_pdf" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "resume_profiles" ADD COLUMN "use_company_name" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "resume_profiles" ADD COLUMN "generate_cover_letter" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "resume_profiles" ADD COLUMN "cover_letter_template" TEXT NOT NULL DEFAULT 'classic';

