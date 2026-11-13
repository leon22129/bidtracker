ALTER TABLE "users"
ADD COLUMN "can_continue_after_eligibility_failure" BOOLEAN NOT NULL DEFAULT false;
