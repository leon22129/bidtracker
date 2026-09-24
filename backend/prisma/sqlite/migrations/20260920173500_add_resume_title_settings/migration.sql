-- Add resume title behavior settings without changing existing profile content.
ALTER TABLE "resume_profiles" ADD COLUMN "update_headline" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "resume_profiles" ADD COLUMN "use_generated_role_titles" BOOLEAN NOT NULL DEFAULT true;

