CREATE TABLE "application_documents" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    CONSTRAINT "application_documents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "application_documents_application_id_fkey" FOREIGN KEY ("application_id")
        REFERENCES "job_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "application_documents_application_id_kind_format_key"
    ON "application_documents"("application_id", "kind", "format");
