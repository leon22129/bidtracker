ALTER TABLE "resume_profiles"
  ADD COLUMN "requires_sponsorship" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "legally_authorized_us" TEXT NOT NULL DEFAULT '';
