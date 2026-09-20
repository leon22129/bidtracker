-- Add creator ownership metadata without changing existing profile assignments.
ALTER TABLE "resume_profiles" ADD COLUMN "created_by_user_id" TEXT REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "resume_profiles_created_by_user_id_idx" ON "resume_profiles"("created_by_user_id");
