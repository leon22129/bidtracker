CREATE TABLE "application_screenshots" (
    "application_id" TEXT NOT NULL PRIMARY KEY,
    "image_data" BLOB NOT NULL,
    "content_type" TEXT NOT NULL DEFAULT 'image/png',
    "captured_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" DATETIME NOT NULL,
    CONSTRAINT "application_screenshots_application_id_fkey"
      FOREIGN KEY ("application_id") REFERENCES "job_applications" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "application_screenshots_expires_at_idx" ON "application_screenshots"("expires_at");
