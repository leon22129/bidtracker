CREATE TABLE "application_screenshots" (
    "application_id" TEXT NOT NULL,
    "image_data" BYTEA NOT NULL,
    "content_type" TEXT NOT NULL DEFAULT 'image/png',
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "application_screenshots_pkey" PRIMARY KEY ("application_id")
);

CREATE INDEX "application_screenshots_expires_at_idx" ON "application_screenshots"("expires_at");

ALTER TABLE "application_screenshots"
ADD CONSTRAINT "application_screenshots_application_id_fkey"
FOREIGN KEY ("application_id") REFERENCES "job_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
