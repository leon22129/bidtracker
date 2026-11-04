CREATE TABLE "extension_release" (
    "id" TEXT NOT NULL DEFAULT 'current',
    "latest_version" TEXT NOT NULL,
    "download_url" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extension_release_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "extension_release_singleton" CHECK ("id" = 'current')
);
